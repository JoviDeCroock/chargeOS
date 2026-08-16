import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createReleaseManifest } from "./create-release-manifest.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
const workspace = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
const ocppPatch = await readFile(join(root, "patches/ocpp-rpc@2.2.1.patch"), "utf8");

assert(workflow.includes('tags: ["v*.*.*"]'), "release workflow must be tag-only");
assert(
  !workflow.includes("pull_request_target"),
  "release workflow must never use pull_request_target",
);
assert(
  /permissions:\n  contents: read\n/u.test(workflow),
  "release workflow must default to read-only contents",
);
for (const permission of [
  "artifact-metadata: write",
  "attestations: write",
  "contents: read",
  "id-token: write",
  "packages: write",
]) {
  assert(workflow.includes(`      ${permission}`), `release job is missing ${permission}`);
}
assert(
  workflow.includes("persist-credentials: false"),
  "release checkout must not persist credentials",
);
assert(
  workflow.includes("package.json version $package_version does not match tag $RELEASE_TAG"),
  "release identity must bind the tag to package.json",
);
assert(
  workflow.includes("Refusing to replace existing image tag"),
  "release must refuse an existing version tag",
);
assert(
  workflow.includes(
    "CHARGEOS_RUNTIME_IMAGE: ${{ steps.release.outputs.image }}@${{ steps.candidate.outputs.digest }}",
  ),
  "runtime smoke must use the exact candidate digest",
);
assert(
  workflow.includes("subject-digest: ${{ steps.candidate.outputs.digest }}"),
  "attestations must bind the tested digest",
);
assert(
  count(workflow, "uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6") === 2,
  "release must create exactly one provenance and one SBOM attestation with the pinned action",
);
assert(
  workflow.includes("sbom-path: release/chargeos-${{ steps.release.outputs.version }}.cdx.json"),
  "release must attest its generated SBOM",
);
assert(
  workflow.includes("provenance: false") && workflow.includes("sbom: false"),
  "candidate build must rely on the explicit post-test GitHub attestations",
);
assert(
  workspace.includes("ajv: 8.20.0") && workspace.includes("fast-uri: 3.1.5"),
  "production validator overrides must remain on the audited versions",
);
assert(
  workspace.includes("ocpp-rpc@2.2.1: patches/ocpp-rpc@2.2.1.patch") &&
    ocppPatch.includes("urn:ocpp-rpc:${schemaId.slice(4)}") &&
    ocppPatch.includes("getSchema(normalizeSchemaId(schemaId))"),
  "ocpp-rpc must retain the narrow private-schema URN normalization patch",
);

const actionReferences = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+).*$/gmu)].map(
  (match) => match[1],
);
assert(actionReferences.length >= 7, "release workflow unexpectedly lost pinned actions");
for (const reference of actionReferences) {
  assert(
    /@[a-f0-9]{40}$/u.test(reference),
    `release action must use a full immutable commit SHA: ${reference}`,
  );
}

const candidateIndex = workflow.indexOf("Build and push commit candidate");
const auditIndex = workflow.indexOf("Reject production dependency advisories");
const runtimeIndex = workflow.indexOf("Exercise the exact registry candidate");
const provenanceIndex = workflow.indexOf("Attest image build provenance");
const sbomIndex = workflow.indexOf("Attest image SBOM");
const uploadIndex = workflow.indexOf("Upload release evidence");
const promoteIndex = workflow.indexOf("Promote the tested and attested digest");
assert(
  [
    auditIndex,
    candidateIndex,
    runtimeIndex,
    provenanceIndex,
    sbomIndex,
    uploadIndex,
    promoteIndex,
  ].every((index) => index >= 0) &&
    auditIndex < candidateIndex &&
    candidateIndex < runtimeIndex &&
    runtimeIndex < provenanceIndex &&
    provenanceIndex < sbomIndex &&
    sbomIndex < uploadIndex &&
    uploadIndex < promoteIndex,
  "version promotion must be the final step after runtime, attestations, and evidence upload",
);

await verifyManifestContract();
verifyImmutableRuntimeReference();
console.log("Release workflow trust boundary is valid");

async function verifyManifestContract() {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-release-policy-"));
  const sbom = join(directory, "chargeos-0.0.0.cdx.json");
  const output = join(directory, "chargeos-0.0.0.manifest.json");
  try {
    await writeFile(sbom, '{"bomFormat":"CycloneDX","specVersion":"1.6"}\n', "utf8");
    const options = {
      digest: `sha256:${"a".repeat(64)}`,
      image: "ghcr.io/example/chargeos",
      output,
      repository: "example/chargeos",
      revision: "b".repeat(40),
      sbom,
      version: "0.0.0",
    };
    const manifest = await createReleaseManifest(options);
    assert(
      manifest.image.reference === `${options.image}@${options.digest}`,
      "manifest image mismatch",
    );
    assert(manifest.source.ref === "refs/tags/v0.0.0", "manifest source ref mismatch");
    assert(((await stat(output)).mode & 0o777) === 0o644, "manifest mode must be 0644");
    assert(
      JSON.parse(await readFile(output, "utf8")).sbom.format === "CycloneDX",
      "manifest invalid",
    );
    await expectFailure(
      () => createReleaseManifest(options),
      "release manifest must not overwrite",
    );
    await expectFailure(
      () =>
        createReleaseManifest({ ...options, digest: "sha256:bad", output: join(directory, "bad") }),
      "release manifest must reject malformed digests",
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function verifyImmutableRuntimeReference() {
  const result = spawnSync(process.execPath, [join(root, "scripts/smoke-production-runtime.mjs")], {
    encoding: "utf8",
    env: { ...process.env, CHARGEOS_RUNTIME_IMAGE: "ghcr.io/example/chargeos:mutable" },
  });
  assert(result.status !== 0, "runtime smoke accepted a mutable release image");
  assert(
    result.stderr.includes(
      "CHARGEOS_RUNTIME_IMAGE must be an immutable lowercase sha256 image reference",
    ),
    "runtime smoke did not fail at the immutable image boundary",
  );
}

async function expectFailure(operation, message) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
