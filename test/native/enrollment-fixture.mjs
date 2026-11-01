import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fixture, draft, approve } from "../service/reimbursement-helpers.ts";
import { env } from "./env.mjs";
import {
  exportCommercialRecovery,
  restoreCommercialRecovery,
} from "../../service/node/recovery.ts";
import {
  checkpointNativeCommercial,
  createNativeRecoveryReviewTemplate,
  RECOVERY_REVIEW_CONFIRMATION,
} from "../../service/node/recovery-review.ts";
import { nativeConfiguration } from "../../service/node/configuration.ts";

export async function enrollmentFixture() {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-enrollment-test-")),
    company = await fixture();
  await approve(company, await draft(company));
  const bundle = join(directory, "source.bundle"),
    checkpoint = join(directory, "financial-checkpoint.json"),
    target = join(directory, "replacement"),
    manifest = join(directory, "review.json"),
    proof = join(directory, "reviewed-evidence.txt");
  await exportCommercialRecovery(
    env,
    dirname(env.SERVICE_DB.path),
    bundle,
    "synthetic enrollment recovery phrase!",
  );
  await checkpointNativeCommercial(env, dirname(env.SERVICE_DB.path), checkpoint);
  await restoreCommercialRecovery(bundle, target, "synthetic enrollment recovery phrase!");
  const data = join(target, "data");
  await createNativeRecoveryReviewTemplate(data, manifest);
  const review = JSON.parse(await readFile(manifest, "utf8"));
  await writeFile(
    proof,
    "Synthetic operator-reviewed identity, HR, unpaid finance and retired-source records; no real-world customer evidence.",
    { mode: 0o600 },
  );
  review.confirmation = RECOVERY_REVIEW_CONFIRMATION;
  review.reviewedThrough = new Date().toISOString();
  review.sourceRetirementEvidenceFile = proof;
  review.financialCheckpointFile = checkpoint;
  for (const org of review.organizations) {
    org.rosterEvidenceFile = proof;
    org.financialEvidenceFile = proof;
    for (const member of org.members) {
      member.decision = member.email === company.driver.email ? "remove" : "keep";
      member.identityEvidenceFile = member.decision === "keep" ? proof : "";
    }
    org.eligibilityEnds = org.reference.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      expectedExistingUntil: assignment.existingEnd,
      effectiveUntil: assignment.existingEnd ?? "2026-10-01T00:00:00.000Z",
    }));
  }
  await writeFile(manifest, JSON.stringify(review));
  const configuration = nativeConfiguration({
    SERVICE_NATIVE_CONFIG: join(target, "service.vars"),
    SERVICE_NATIVE_DATA: data,
  }).configuration;
  return { directory, data, target, manifest, configuration, company, proof };
}
