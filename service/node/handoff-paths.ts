import { access, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

async function buildRoots(start: string): Promise<string[]> {
  const found: string[] = [];
  let current = resolve(start);
  for (;;) {
    if (
      (
        await Promise.all(
          ["Dockerfile.company", "compose.company.json", "package.json"].map((name) =>
            access(join(current, name)).then(
              () => true,
              () => false,
            ),
          ),
        )
      ).every(Boolean)
    )
      found.push(await realpath(current));
    const parent = dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}
/** Private recovery material must never enter a COPY . . source context, even
 * through a symlink alias or a compiled CLI run from another directory. */
export async function requireExternalHandoffPath(path: string): Promise<void> {
  const canonical = await realpath(path).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    return join(await realpath(dirname(resolve(path))), basename(resolve(path)));
  });
  const roots = new Set(
    (
      await Promise.all([
        buildRoots(dirname(fileURLToPath(import.meta.url))),
        buildRoots(process.cwd()),
        buildRoots(canonical),
      ])
    ).flat(),
  );
  for (const root of roots) {
    const inside = relative(root, canonical);
    if (inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)))
      throw new Error(
        "Keep recovery data, capsules, settings and evidence outside the software checkout/build context",
      );
  }
}
