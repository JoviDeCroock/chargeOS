import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const imagePattern = /^ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export async function createReleaseManifest({
  digest,
  image,
  output,
  repository,
  revision,
  sbom,
  version,
}) {
  assert(imagePattern.test(image), "image must be a lowercase untagged ghcr.io name");
  assert(digestPattern.test(digest), "digest must be a lowercase sha256 digest");
  assert(repositoryPattern.test(repository), "repository must be an owner/name pair");
  assert(revisionPattern.test(revision), "revision must be a lowercase 40-character Git SHA");
  assert(versionPattern.test(version), "version must be an exact stable SemVer value");

  const sbomBytes = await readFile(sbom);
  let sbomDocument;
  try {
    sbomDocument = JSON.parse(sbomBytes.toString("utf8"));
  } catch {
    throw new Error("SBOM must be valid JSON");
  }
  assert(sbomDocument?.bomFormat === "CycloneDX", "SBOM must use the CycloneDX format");
  assert(
    typeof sbomDocument?.specVersion === "string" && /^1\.[4-9]$/u.test(sbomDocument.specVersion),
    "SBOM must declare a supported CycloneDX specVersion",
  );

  const tag = `v${version}`;
  const manifest = {
    schemaVersion: 1,
    image: {
      digest,
      name: image,
      reference: `${image}@${digest}`,
    },
    release: {
      tag,
      version,
    },
    sbom: {
      file: basename(sbom),
      format: "CycloneDX",
      sha256: createHash("sha256").update(sbomBytes).digest("hex"),
      specVersion: sbomDocument.specVersion,
    },
    source: {
      ref: `refs/tags/${tag}`,
      repository: `https://github.com/${repository}`,
      revision,
    },
  };

  await mkdir(dirname(output), { recursive: true });
  const handle = await open(output, "wx", 0o644);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(output, { force: true });
    throw error;
  }
  await handle.close();
  return manifest;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    assert(name?.startsWith("--") && value !== undefined, `Invalid argument near ${name ?? "end"}`);
    assert(!values.has(name), `Duplicate argument: ${name}`);
    values.set(name, value);
  }
  const expected = [
    "--digest",
    "--image",
    "--output",
    "--repository",
    "--revision",
    "--sbom",
    "--version",
  ];
  for (const name of expected) assert(values.has(name), `Missing required argument: ${name}`);
  for (const name of values.keys()) assert(expected.includes(name), `Unknown argument: ${name}`);
  return Object.fromEntries(expected.map((name) => [name.slice(2), values.get(name)]));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const values = parseArguments(process.argv.slice(2));
  await createReleaseManifest({
    digest: values.digest,
    image: values.image,
    output: resolve(values.output),
    repository: values.repository,
    revision: values.revision,
    sbom: resolve(values.sbom),
    version: values.version,
  });
  process.stdout.write(`Created release manifest at ${resolve(values.output)}\n`);
}
