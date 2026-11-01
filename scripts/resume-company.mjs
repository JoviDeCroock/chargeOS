import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { companyDeploymentInput } from "./company-deployment.mjs";
import {
  prepareCompanyRecoveryDeployment,
  readPrivateSetupFile,
  requireExternalRecoveryPath,
} from "./company-recovery.mjs";
import { inspectLocalDocker, proveLocalDocker } from "./docker-destination.mjs";
import { runDocker } from "./deploy.mjs";
import { DeploymentError } from "./deployment.mjs";

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "--package private-ready-capsule --settings private-company-settings.json --prepare|--deploy | --start existing-private-deployment-folder";
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return;
  }
  if (args.length === 2 && args[0] === "--start" && args[1]) {
    const directory = resolve(args[1]);
    await requireExternalRecoveryPath(directory, { preparedDeployment: true });
    const receipt = JSON.parse(
        (await readPrivateSetupFile(join(directory, "setup.json"), 16384)).toString("utf8"),
      ),
      model = JSON.parse(
        (await readPrivateSetupFile(join(directory, "compose.json"), 131072)).toString("utf8"),
      );
    if (
      receipt.workspace !== "company" ||
      receipt.target !== "docker" ||
      typeof receipt.recoveryHandoffId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(receipt.recoveryHandoffId) ||
      model.name !== `chargeos-company-${receipt.installId}`
    )
      throw new DeploymentError(
        "Choose the original private deployment prepared for this reviewed public recovery.",
      );
    const destination = await inspectLocalDocker();
    if (receipt.dockerContext !== destination.context)
      throw new DeploymentError(
        "Select the same local Docker context saved with this recovery deployment.",
      );
    await proveLocalDocker(destination);
    await runDocker(directory, { project: model.name, context: destination.context });
    console.log(JSON.stringify({ ...receipt, status: "containers-started", directory }));
    return;
  }
  if (
    args.length !== 5 ||
    args[0] !== "--package" ||
    !args[1] ||
    args[2] !== "--settings" ||
    !args[3] ||
    !["--prepare", "--deploy"].includes(args[4])
  )
    throw new DeploymentError(usage);
  await requireExternalRecoveryPath(resolve(args[3]));
  const input = companyDeploymentInput({
    ...JSON.parse((await readPrivateSetupFile(resolve(args[3]), 32768)).toString("utf8")),
    target: "docker",
    deploy: args[4] === "--deploy",
  });
  const destination = await inspectLocalDocker();
  if (input.deploy) await proveLocalDocker(destination);
  input.dockerContext = destination.context;
  const prepared = await prepareCompanyRecoveryDeployment(input, resolve(args[1]));
  if (input.deploy)
    await runDocker(prepared.directory, {
      project: prepared.model.name,
      context: destination.context,
    });
  console.log(
    JSON.stringify({
      ...prepared.receipt,
      status: input.deploy ? "containers-started" : "prepared",
      directory: prepared.directory,
    }),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error(
      error instanceof DeploymentError
        ? error.message
        : "Company recovery deployment did not complete. Retain the exact capsule, private setup and existing project/volumes; inspect its saved instructions before retrying.",
    );
    process.exitCode = 1;
  });
