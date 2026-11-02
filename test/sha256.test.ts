import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EmptyEvidenceFileError, Sha256, sha256File } from "../src/sha256.js";

function nodeDigest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("browser evidence SHA-256", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(new Sha256().update(new TextEncoder().encode("abc")).hex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      new Sha256()
        .update(
          new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        )
        .hex(),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("matches node:crypto at every padding boundary and for arbitrary chunking", () => {
    for (const size of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 65_537]) {
      const data = randomBytes(size);
      const whole = new Sha256().update(data).hex();
      expect(whole).toBe(nodeDigest(data));
      const chunked = new Sha256();
      for (let offset = 0; offset < size;) {
        const length = 1 + ((offset * 7919) % 97);
        chunked.update(data.subarray(offset, offset + length));
        offset += length;
      }
      expect(chunked.hex()).toBe(whole);
    }
  });

  it("refuses to reuse a finished digest", () => {
    const hash = new Sha256();
    hash.hex();
    expect(() => hash.update(new Uint8Array(1))).toThrow();
    expect(() => hash.hex()).toThrow();
  });

  it("streams a file and reports progress without uploading it", async () => {
    const data = randomBytes(300_000);
    const progress: number[] = [];
    const digest = await sha256File(new Blob([data]), (fraction) => progress.push(fraction));
    expect(digest).toBe(nodeDigest(data));
    expect(progress.at(-1)).toBe(1);
  });

  it("refuses an empty file because it cannot be evidence", async () => {
    await expect(sha256File(new Blob([]))).rejects.toBeInstanceOf(EmptyEvidenceFileError);
  });
});
