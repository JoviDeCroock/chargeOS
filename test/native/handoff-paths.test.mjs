import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { requireExternalHandoffPath } from "../../service/node/handoff-paths.ts";

it("refuses recovery input and future capsule paths in source contexts including canonical aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "chargeos-handoff-paths-")),
    checkout = join(root, "checkout");
  try {
    await mkdir(checkout, { mode: 0o700 });
    for (const name of ["Dockerfile.company", "compose.company.json", "package.json"])
      await writeFile(join(checkout, name), "synthetic build root");
    await symlink(checkout, join(root, "alias"));
    for (const name of [
      "data",
      "service.vars",
      "review.json",
      "checkpoint.json",
      "identity",
      "roster",
      "finance",
      "retirement",
    ])
      await writeFile(join(checkout, name), "synthetic private input", { mode: 0o600 });
    for (const base of [checkout, join(root, "alias")])
      for (const name of [
        "data",
        "service.vars",
        "review.json",
        "checkpoint.json",
        "identity",
        "roster",
        "finance",
        "retirement",
        "future-capsule",
      ])
        await expect(requireExternalHandoffPath(join(base, name))).rejects.toThrow(
          /outside.*build context/,
        );
    await expect(
      requireExternalHandoffPath(join(root, "new-private-capsule")),
    ).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
