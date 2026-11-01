import { constants, closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const connectionOptions = {
  enableForeignKeyConstraints: true,
  enableDoubleQuotedStringLiterals: false,
  allowExtension: false,
  timeout: 5000,
};

function requireSqliteCapabilities(): void {
  // SQLite APIs were backported unevenly across Node release lines. Check
  // behavior in memory before creating or opening any commercial state.
  const probe = new DatabaseSync(":memory:", connectionOptions);
  try {
    const statement = probe.prepare("SELECT 1 AS value, 2 AS value");
    if (
      typeof statement.columns !== "function" ||
      typeof statement.setReturnArrays !== "function" ||
      typeof statement.sourceSQL !== "string" ||
      statement.columns().length !== 2 ||
      probe.prepare("PRAGMA busy_timeout").get()?.timeout !== 5000 ||
      probe.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1
    )
      throw new Error("Unsupported SQLite capabilities");
    statement.setReturnArrays(true);
    const row = statement.get();
    if (!Array.isArray(row) || row.length !== 2 || row[0] !== 1 || row[1] !== 2)
      throw new Error("Ordered SQLite results are unavailable");
  } catch {
    throw new Error(
      "This Node runtime lacks required SQLite APIs; use the tested Node.js 22.22.x runtime or a compatible newer release",
    );
  } finally {
    probe.close();
  }
}

function privateFile(path: string, create: boolean): void {
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (create)
      closeSync(
        openSync(
          path,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        ),
      );
    return;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
    throw new Error("Commercial database files must be owner-private regular files without links");
}

function parameters(values: unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    throw new Error("Unsupported SQLite binding type");
  });
}

/** Implements the D1 surface used by the commercial service on a single local
 * connection. This adapter has no replica, bookmark or public dump capability. */
export class NativeCommercialDatabase implements D1Database {
  readonly path: string;
  readonly #database: DatabaseSync;
  constructor(directory: string) {
    requireSqliteCapabilities();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
      throw new Error("Commercial database directory must be owner-private and not a symlink");
    this.path = join(directory, "commercial.sqlite");
    privateFile(this.path, true);
    for (const suffix of ["-journal", "-wal", "-shm"]) privateFile(`${this.path}${suffix}`, false);
    this.#database = new DatabaseSync(this.path, connectionOptions);
    try {
      // DELETE journals stay alongside the private 0600 main file. FULL sync
      // makes a successful atomic batch durable before its promise resolves.
      this.#database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
      this.checkIntegrity();
    } catch {
      this.#database.close();
      throw new Error("Commercial database failed startup verification");
    }
  }
  close(): void {
    this.#database.close();
  }
  checkIntegrity(): void {
    const result = this.#database.prepare("PRAGMA quick_check").all();
    if (
      result.length !== 1 ||
      result[0]?.quick_check !== "ok" ||
      this.#database.prepare("PRAGMA foreign_key_check").all().length !== 0
    )
      throw new Error("Commercial database integrity check failed");
  }
  prepare(query: string): D1PreparedStatement {
    return new NativeStatement(this, query, []);
  }
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (!statements.length) return [];
    const local = statements.map((statement) => {
      if (!(statement instanceof NativeStatement) || statement.database !== this)
        throw new Error("A SQLite batch must use statements from the same database");
      return statement;
    });
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      // No await may occur until commit/rollback; another request must never
      // interleave statements inside this financial or membership transaction.
      const result = local.map((statement) => this.execute<T>(statement.query, statement.values));
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
  async exec(_query: string): Promise<D1ExecResult> {
    throw new Error("Use prepared statements or atomic batches; raw SQLite exec is unavailable");
  }
  withSession(constraint?: D1SessionBookmark | D1SessionConstraint): D1DatabaseSession {
    if (constraint && !["first-primary", "first-unconstrained"].includes(constraint))
      throw new Error("Replica bookmarks are unavailable on native SQLite");
    return {
      prepare: (query) => this.prepare(query),
      batch: (statements) => this.batch(statements),
      getBookmark: () => null,
    };
  }
  async dump(): Promise<ArrayBuffer> {
    throw new Error("Public database dump and commercial recovery are not implemented");
  }

  execute<T>(
    query: string,
    values: SQLInputValue[],
    arrays = false,
  ): D1Result<T> & { columns: string[] } {
    const head = query.replace(/^(?:[\s;]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
    if (/^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(head))
      throw new Error("Async SQL transaction control is unavailable; use an atomic batch");
    const statement = this.#database.prepare(query);
    if (statement.sourceSQL.trim() !== query.trim())
      throw new Error("Use one SQL statement at a time");
    const columns = statement.columns().map((column) => column.name);
    const start = performance.now();
    const before = this.#database.prepare("SELECT total_changes() AS total").get()!.total as number;
    let results: T[] = [];
    if (columns.length) {
      statement.setReturnArrays(arrays);
      results = statement.all(...values) as T[];
    } else statement.run(...values);
    const meta = this.#database
      .prepare(
        "SELECT changes() AS changes, last_insert_rowid() AS last_row_id, total_changes() AS total",
      )
      .get()!;
    const changes = meta.total === before ? 0 : (meta.changes as number);
    return {
      success: true,
      results,
      columns,
      meta: {
        duration: performance.now() - start,
        changes,
        last_row_id: meta.last_row_id as number,
        changed_db: meta.total !== before,
        size_after: 0,
        rows_read: 0,
        rows_written: 0,
        served_by: "native-sqlite",
        statistics: "scan-and-size-statistics-unavailable",
      },
    };
  }
}

class NativeStatement implements D1PreparedStatement {
  constructor(
    readonly database: NativeCommercialDatabase,
    readonly query: string,
    readonly values: SQLInputValue[],
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new NativeStatement(this.database, this.query, parameters(values));
  }
  async first<T = unknown>(column: string): Promise<T | null>;
  async first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(column?: string): Promise<T | null> {
    const row = this.database.execute<Record<string, unknown>>(this.query, this.values).results[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!Object.hasOwn(row, column)) throw new Error("SQLite result column does not exist");
    return row[column] as T;
  }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const { columns: _columns, ...result } = this.database.execute<T>(this.query, this.values);
    return result;
  }
  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.run<T>();
  }
  async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const result = this.database.execute<T>(this.query, this.values, true);
    return options?.columnNames ? [result.columns, ...result.results] : result.results;
  }
}
