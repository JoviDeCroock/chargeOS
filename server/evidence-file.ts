import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";

export class EvidenceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceFileError";
  }
}

export async function hashEvidenceFile(path: string): Promise<string> {
  const inspected = await inspectPath(path);
  let file: FileHandle | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await file.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== inspected.dev ||
      opened.ino !== inspected.ino ||
      opened.size !== inspected.size ||
      opened.size === 0n
    ) {
      throw new EvidenceFileError("Evidence file changed while it was opened");
    }

    const digest = createHash("sha256");
    const stream = file.createReadStream({ autoClose: false });
    for await (const chunk of stream) digest.update(chunk);

    const after = await file.stat({ bigint: true });
    if (!sameSnapshot(opened, after)) {
      throw new EvidenceFileError("Evidence file changed while it was hashed");
    }
    const finalPath = await inspectPath(path);
    if (!sameSnapshot(opened, finalPath)) {
      throw new EvidenceFileError("Evidence file path changed while it was hashed");
    }
    return digest.digest("hex");
  } catch (error) {
    if (error instanceof EvidenceFileError) throw error;
    throw new EvidenceFileError("Evidence file is unreadable");
  } finally {
    await file?.close();
  }
}

async function inspectPath(path: string) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new EvidenceFileError("Evidence input must be a regular, non-symlinked file");
    }
    if (metadata.size === 0n) throw new EvidenceFileError("Evidence input must not be empty");
    return metadata;
  } catch (error) {
    if (error instanceof EvidenceFileError) throw error;
    throw new EvidenceFileError("Evidence file cannot be inspected");
  }
}

function sameSnapshot(before: BigIntStats, after: BigIntStats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}
