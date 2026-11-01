import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { resolve, sep } from "node:path";

/** Only an actual read-only mount in a non-root Linux container permits shared
 * Docker secret modes. Host files retain the ordinary owner-private boundary. */
function mountedReadOnlySecret(path: string): boolean {
  if (
    process.platform !== "linux" ||
    !process.getuid ||
    process.getuid() === 0 ||
    !path.startsWith("/run/secrets/") ||
    realpathSync(path) !== path
  )
    return false;
  const records = readFileSync("/proc/self/mountinfo", "utf8")
    .split("\n")
    .map((line) => line.split(" "))
    .filter((fields) => fields.length >= 6);
  const matching = records
    .filter((fields) => {
      const mount = fields[4]!.replace(/\\([0-7]{3})/g, (_match, digits: string) =>
        String.fromCharCode(parseInt(digits, 8)),
      );
      return path === mount || path.startsWith(mount.endsWith(sep) ? mount : mount + sep);
    })
    .sort((a, b) => b[4]!.length - a[4]!.length);
  const deepest = matching[0];
  if (!deepest) return false;
  const mount = deepest[4]!.replace(/\\([0-7]{3})/g, (_match, digits: string) =>
    String.fromCharCode(parseInt(digits, 8)),
  );
  return (
    (mount === "/run/secrets" || mount.startsWith("/run/secrets/")) &&
    deepest[5]!.split(",").includes("ro")
  );
}
export function readRuntimeFile(path: string, maximum: number, allowMounted = false): string {
  path = resolve(path);
  const original = lstatSync(path),
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      original.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.dev !== original.dev ||
      before.ino !== original.ino ||
      before.size > maximum ||
      ((before.mode & 0o077) !== 0 &&
        !(allowMounted && (before.mode & 0o222) === 0 && mountedReadOnlySecret(path)))
    )
      throw new Error(
        "Runtime settings must be bounded private files or verified read-only Docker secrets",
      );
    const value = readFileSync(fd, "utf8"),
      after = fstatSync(fd),
      current = lstatSync(path);
    if (
      Buffer.byteLength(value) > maximum ||
      before.size !== after.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.isSymbolicLink() ||
      current.dev !== before.dev ||
      current.ino !== before.ino
    )
      throw new Error("Runtime settings changed while reading");
    return value;
  } finally {
    closeSync(fd);
  }
}
