import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceFileError, hashEvidenceFile } from "../server/evidence-file.js";

describe("owner-held migration evidence files", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { force: true, recursive: true });
    directory = undefined;
  });

  it("hashes a stable regular file without exposing its contents", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-file-"));
    const path = join(directory, "configuration.exml");
    const contents = "synthetic private charger configuration";
    await writeFile(path, contents, { mode: 0o600 });

    await expect(hashEvidenceFile(path)).resolves.toBe(
      createHash("sha256").update(contents).digest("hex"),
    );
  });

  it("rejects empty files, directories, and symlinks", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-file-"));
    const empty = join(directory, "empty");
    const target = join(directory, "target");
    const link = join(directory, "link");
    await writeFile(empty, "");
    await writeFile(target, "evidence");
    await symlink(target, link);

    await expect(hashEvidenceFile(empty)).rejects.toThrow(/must not be empty/);
    await expect(hashEvidenceFile(directory)).rejects.toThrow(/regular, non-symlinked/);
    await expect(hashEvidenceFile(link)).rejects.toBeInstanceOf(EvidenceFileError);
  });

  it("rejects a file whose metadata changes while it is hashed", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-file-"));
    const path = join(directory, "large-evidence.bin");
    await writeFile(path, Buffer.alloc(64 * 1024 * 1024, 0x5a), { mode: 0o600 });

    const hashing = hashEvidenceFile(path);
    for (let index = 0; index < 20; index += 1) {
      const changed = new Date(Date.now() + index * 1_000);
      await utimes(path, changed, changed);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await expect(hashing).rejects.toThrow(/changed while/);
  });
});
