import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { smtpConfiguration } from "./smtp.js";

const refused = () => new Error("Company credential initialization refused");
function validate(auth: unknown, smtp: unknown): asserts auth is string {
  if (
    typeof auth !== "string" ||
    !/^[A-Za-z0-9_-]{64}$/.test(auth) ||
    typeof smtp !== "string" ||
    Buffer.byteLength(smtp) > 16384
  )
    throw refused();
  const value: unknown = JSON.parse(smtp);
  // Managed bootstrap accepts public, system-trusted mail certificates only.
  // It cannot read an arbitrary path supplied through a platform variable.
  smtpConfiguration(value, () => {
    throw refused();
  });
}
function matchingFile(path: string, value: string): boolean {
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      before.isSymbolicLink() ||
      before.ino !== opened.ino ||
      before.dev !== opened.dev ||
      opened.uid !== process.getuid?.() ||
      opened.nlink !== 1 ||
      (opened.mode & 0o777) !== 0o444 ||
      opened.size !== Buffer.byteLength(value) ||
      readFileSync(fd, "utf8") !== value
    )
      throw refused();
    const after = fstatSync(fd),
      current = lstatSync(path);
    if (
      after.ctimeMs !== opened.ctimeMs ||
      after.mtimeMs !== opened.mtimeMs ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.isSymbolicLink()
    )
      throw refused();
    return true;
  } finally {
    closeSync(fd);
  }
}
/** Fresh empty secret volume only; exact restarts are safe, rotation is separate.
 * A private lock also refuses concurrent initializers and interrupted custody.
 * Never remove a partial credential or stale lock after an uncertain write. */
export function initializeCompanyCredentials(
  directory: string,
  auth: string,
  smtp: string,
  smtpDirectory = directory,
): void {
  validate(auth, smtp);
  directory = resolve(directory);
  smtpDirectory = resolve(smtpDirectory);
  const directories = [...new Set([directory, smtpDirectory])];
  for (const current of directories) {
    const info = lstatSync(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      realpathSync(current) !== current ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700
    )
      throw refused();
  }
  const locks: string[] = [];
  try {
    for (const current of directories) {
      const lock = join(current, ".company-bootstrap");
      mkdirSync(lock, { mode: 0o700 });
      locks.push(lock);
    }
    const entries = [
      [join(directory, "company_auth"), auth],
      [join(smtpDirectory, "company_smtp"), smtp],
    ] as const;
    // Validate ALL existing bytes before filling any missing file.
    const missing = entries.filter(([path, value]) => !matchingFile(path, value));
    for (const [name, value] of missing) {
      const fd = openSync(
        name,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, value, "utf8");
        fsyncSync(fd);
        fchmodSync(fd, 0o444);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    for (const current of directories) {
      const fd = openSync(current, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
  } finally {
    for (const lock of locks.reverse()) rmdirSync(lock);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const auth = process.env.COMPANY_BOOTSTRAP_AUTH,
      smtp = process.env.COMPANY_BOOTSTRAP_SMTP;
    delete process.env.COMPANY_BOOTSTRAP_AUTH;
    delete process.env.COMPANY_BOOTSTRAP_SMTP;
    validate(auth, smtp);
    initializeCompanyCredentials("/data", auth, smtp as string, "/smtp");
    console.log("Company credentials initialized");
  } catch {
    console.error(
      "Company credential initialization refused; inspect the private deployment without sharing credentials",
    );
    process.exitCode = 1;
  }
}
