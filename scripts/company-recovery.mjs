import { constants } from "node:fs";
import { access, open, lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { DeploymentError, repositoryRoot } from "./deployment.mjs";
import { prepareCompanyDeployment } from "./company-deployment.mjs";

export async function requireExternalRecoveryPath(path, { preparedDeployment = false } = {}) {
  const canonical = await realpath(path),
    sourceRoot = await realpath(repositoryRoot),
    roots = [sourceRoot];
  let ancestor = canonical;
  for (;;) {
    if (
      (
        await Promise.all(
          ["Dockerfile.company", "compose.company.json", "package.json"].map((name) =>
            access(join(ancestor, name)).then(
              () => true,
              () => false,
            ),
          ),
        )
      ).every(Boolean)
    )
      roots.push(ancestor);
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  for (const root of roots) {
    const inside = relative(root, canonical);
    // Only the generator's exact ignored output subtree may hold a prepared
    // deployment in this checkout. A moved folder gets no such exception.
    if (
      preparedDeployment &&
      root === sourceRoot &&
      inside.startsWith(`.chargeos-deploy${sep}`) &&
      (await readFile(join(sourceRoot, ".dockerignore"), "utf8"))
        .split(/\r?\n/)
        .includes(".chargeos-deploy")
    )
      continue;
    if (inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)))
      throw new DeploymentError(
        "Keep recovery capsules and settings outside the software checkout/build context. Prepared deployments may also use the original ignored .chargeos-deploy folder.",
      );
  }
}

export async function readPrivateSetupFile(path, maximum) {
  const original = await lstat(path),
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      original.isSymbolicLink() ||
      before.nlink !== 1 ||
      (before.mode & 0o077) !== 0 ||
      before.dev !== original.dev ||
      before.ino !== original.ino ||
      before.size > maximum
    )
      throw new DeploymentError(
        "Recovery setup needs bounded private regular files without links.",
      );
    const parts = [];
    let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(16384, maximum + 1 - size)),
        { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) throw new DeploymentError("Recovery setup input exceeds its boundary.");
      parts.push(chunk.subarray(0, bytesRead));
    }
    const bytes = Buffer.concat(parts, size),
      after = await file.stat(),
      current = await lstat(path);
    if (
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.ctimeMs !== before.ctimeMs ||
      after.mtimeMs !== before.mtimeMs ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.isSymbolicLink()
    )
      throw new DeploymentError("Recovery setup input changed while reading.");
    return bytes;
  } finally {
    await file.close();
  }
}
const sha = (value) => createHash("sha256").update(value).digest("hex");
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    throw new DeploymentError("Use the complete reviewed public handoff capsule.");
}
async function privateDirectory(path) {
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
    throw new DeploymentError("Keep the recovery capsule in its private real directory.");
}
/** Transport preparation only. The compiled network-free Docker installer
 * remains the authority for HMAC, exact schema, financials and fresh DB state. */
export async function prepareCompanyRecoveryDeployment(input, source, parent) {
  if (input.target !== "docker")
    throw new DeploymentError("Public recovery currently supports the local Docker adapter only.");
  await requireExternalRecoveryPath(source);
  await privateDirectory(source);
  source = await realpath(source);
  await privateDirectory(join(source, "data"));
  const [database, key, manifestBytes, readyBytes] = await Promise.all([
    readPrivateSetupFile(join(source, "data/commercial.sqlite"), 64 * 1024 * 1024),
    readPrivateSetupFile(join(source, "auth.key"), 4096),
    readPrivateSetupFile(join(source, "install.json"), 16384),
    readPrivateSetupFile(join(source, "READY"), 16384),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")),
    ready = JSON.parse(readyBytes.toString("utf8"));
  exact(manifest, [
    "format",
    "schemaVersion",
    "handoffId",
    "releaseId",
    "origin",
    "databaseSha256",
    "handoffSha256",
  ]);
  exact(ready, ["format", "schemaVersion", "handoffId", "installationSha256"]);
  if (
    manifest.format !== "chargeos-native-public-install" ||
    manifest.schemaVersion !== 1 ||
    ready.format !== "chargeos-public-handoff-ready" ||
    ready.schemaVersion !== 1 ||
    ready.handoffId !== manifest.handoffId ||
    ready.installationSha256 !== sha(manifestBytes) ||
    manifest.databaseSha256 !== sha(database) ||
    manifest.origin !== `https://${input.companyDomain}` ||
    typeof manifest.handoffId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(manifest.handoffId) ||
    database.subarray(0, 16).toString("binary") !== "SQLite format 3\0"
  )
    throw new DeploymentError(
      "The complete capsule, database and exact HTTPS hostname must match.",
    );
  const authSecret = key.toString("utf8");
  if (authSecret.length < 32 || authSecret.trim() !== authSecret || /[\0\r\n]/.test(authSecret))
    throw new DeploymentError("The capsule auth key is invalid.");
  return prepareCompanyDeployment(input, parent, {
    database,
    authSecret,
    manifest: manifestBytes.toString("utf8"),
    handoffId: manifest.handoffId,
  });
}
