import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function syncRecoveryDirectory(path: string): Promise<void> {
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function readPrivateRecoveryFile(path: string, maximum: number): Promise<Buffer> {
  const original = await lstat(path);
  if (!original.isFile() || original.isSymbolicLink())
    throw new Error("Recovery input must be a private regular file without links");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      (before.mode & 0o077) !== 0 ||
      before.dev !== original.dev ||
      before.ino !== original.ino ||
      before.size > maximum
    )
      throw new Error("Recovery input must be bounded, owner-private and without links");
    const parts: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(16384, maximum + 1 - size));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) throw new Error("Recovery input is too large");
      parts.push(chunk.subarray(0, bytesRead));
    }
    const after = await file.stat(),
      current = await lstat(path);
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.isSymbolicLink() ||
      current.dev !== after.dev ||
      current.ino !== after.ino
    )
      throw new Error("Recovery input changed while reading");
    return Buffer.concat(parts, size);
  } finally {
    await file.close();
  }
}

export async function readCommercialPassphrase(path: string): Promise<string> {
  const passphrase = (await readPrivateRecoveryFile(path, 4096))
    .toString("utf8")
    .replace(/\r?\n$/, "");
  requireCommercialPassphrase(passphrase);
  return passphrase;
}
export function requireCommercialPassphrase(value: string): void {
  if (value.length < 20 || Buffer.byteLength(value) > 4096 || /[\r\n\0]/u.test(value))
    throw new Error(
      "Use a single recovery passphrase of at least 20 characters (at most 4096 bytes)",
    );
}
export async function writePrivateRecoveryFile(
  path: string,
  bytes: string | Buffer,
): Promise<void> {
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  const created = await file.stat();
  try {
    await file.writeFile(bytes);
    await file.sync();
    await syncRecoveryDirectory(dirname(path));
  } catch (error) {
    const current = await lstat(path).catch(() => null);
    if (current?.dev === created.dev && current.ino === created.ino) await unlink(path);
    throw error;
  } finally {
    await file.close();
  }
}
