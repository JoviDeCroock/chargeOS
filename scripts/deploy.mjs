import { execFile, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deploymentInput,
  prepareDeployment,
  deployToCoolify,
  DeploymentError,
  repositoryRoot,
} from "./deployment.mjs";
import { companyDeploymentInput, prepareCompanyDeployment } from "./company-deployment.mjs";
import { deployCompanyToCoolify } from "./company-cloud.mjs";
import {
  inspectLocalDocker,
  proveLocalDocker,
  deploymentDockerEnvironment,
} from "./docker-destination.mjs";

export function createSetupServer({
  prepare = prepareDeployment,
  cloud = deployToCoolify,
  docker = runDocker,
  companyPrepare = prepareCompanyDeployment,
  companyCloud = deployCompanyToCoolify,
  dockerDestination = inspectLocalDocker,
  dockerProbe = proveLocalDocker,
} = {}) {
  const nonce = randomBytes(32).toString("hex");
  let active = false;
  let origin = "";
  const server = createServer((request, response) => {
    void handle(request, response).catch(() =>
      reply(response, 500, {
        error:
          "Setup failed. Private files may have been prepared; inspect the setup folder before retrying.",
      }),
    );
  });
  const reply = (response, status, value) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  };
  async function handle(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (request.headers.host !== new URL(origin).host)
      return reply(response, 403, {
        error: "Open the exact local setup address printed in the terminal.",
      });
    const company = request.url === "/deploy/company";
    if ((request.url === "/deploy" || company) && request.method === "POST") {
      const supplied = request.headers["x-setup-token"];
      if (
        request.headers.origin !== origin ||
        typeof supplied !== "string" ||
        supplied.length !== nonce.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(nonce))
      )
        return reply(response, 403, {
          error: "This setup tab is no longer authorized. Reopen the terminal's setup link.",
        });
      if (active)
        return reply(response, 409, {
          error: "A deployment is already running. Wait for its result.",
        });
      if (request.headers["content-type"] !== "application/json")
        return reply(response, 415, { error: "Use JSON setup data." });
      active = true;
      try {
        const chunks = [];
        let size = 0;
        // Bound authenticated slow uploads independently of the deployment timeout.
        request.setTimeout(10_000, () => request.destroy());
        for await (const chunk of request) {
          size += chunk.length;
          if (size > (company ? 32768 : 8192))
            return reply(response, 413, { error: "Setup data is too large." });
          chunks.push(chunk);
        }
        request.setTimeout(0);
        let raw;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return reply(response, 400, { error: "Setup data must be valid JSON." });
        }
        const input = company ? companyDeploymentInput(raw) : deploymentInput(raw);
        const destination = input.target === "docker" ? await dockerDestination() : undefined;
        if (destination) {
          if (input.deploy) await dockerProbe(destination);
          input.dockerContext = destination.context;
        }
        const prepared = company ? await companyPrepare(input) : await prepare(input);
        let receipt = prepared.receipt;
        if (input.deploy) {
          if (input.target === "coolify")
            receipt = await (company ? companyCloud : cloud)(input, prepared);
          else {
            await docker(prepared.directory, {
              project: prepared.model.name,
              context: destination?.context,
            });
            receipt = { ...receipt, status: "containers-started" };
          }
        }
        const { ownerToken, stationSecret: _stationSecret, ...publicReceipt } = receipt;
        reply(response, 200, {
          ...publicReceipt,
          directory: prepared.directory,
          // Only this nonce-authorized loopback tab receives it, to hand to the console it opens
          // through postMessage. It is never rendered, stored or put in a URL. The charger
          // password stays in the private folder.
          ...(company ? {} : { signInToken: ownerToken }),
        });
      } catch (error) {
        reply(response, error instanceof DeploymentError ? 400 : 500, {
          error:
            error instanceof DeploymentError
              ? error.message
              : "Deployment did not complete. Private setup files were preserved; inspect START-HERE.txt before retrying.",
        });
      } finally {
        active = false;
      }
      return;
    }
    const assets = {
      "/": ["deploy/setup.html", "text/html"],
      "/setup.js": ["deploy/setup.js", "text/javascript"],
      "/setup.css": ["deploy/setup.css", "text/css"],
      "/company": ["deploy/company-setup.html", "text/html"],
      "/company-setup.js": ["deploy/company-setup.js", "text/javascript"],
    };
    const asset = assets[request.url];
    if (request.method !== "GET" || !asset) return reply(response, 404, { error: "Not found" });
    response.writeHead(200, { "Content-Type": `${asset[1]}; charset=utf-8` });
    response.end(await readFile(join(repositoryRoot, asset[0])));
  }
  return {
    async listen(port = 0) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      origin = `http://127.0.0.1:${server.address().port}`;
      return { origin, url: `${origin}/#${nonce}` };
    },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
export function runDocker(directory, { project, context }, start = spawn) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,100}$/.test(project) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context)
  )
    throw new DeploymentError("The verified Docker destination is missing. Reopen setup.");
  return new Promise((resolve, reject) => {
    // No shell, no secrets in arguments or inherited setup input. Compose reads
    // private files; child output stays on the operator's terminal.
    const child = start(
      "docker",
      [
        "--context",
        context,
        "compose",
        "--project-name",
        project,
        "--file",
        "compose.json",
        "up",
        "--detach",
        "--build",
        "--wait",
        "--wait-timeout",
        "180",
      ],
      {
        cwd: directory,
        env: deploymentDockerEnvironment(),
        stdio: ["ignore", "inherit", "inherit"],
        shell: false,
        timeout: 600_000,
      },
    );
    child.once("error", () =>
      reject(
        new DeploymentError(
          "Docker could not start. Install and start Docker with Compose, then follow the saved START-HERE.txt.",
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new DeploymentError(
              "Docker did not report a healthy start. Your files and data were kept. Check the terminal and saved START-HERE.txt; no cleanup or automatic retry was performed.",
            ),
          ),
    );
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const setup = createSetupServer();
  const { url } = await setup.listen();
  console.log(
    `Open chargeOS setup: ${url}\nKeep this terminal open. Press Ctrl+C when finished.\nNothing is deployed until you submit the setup form.`,
  );
  if (!process.argv.includes("--no-open")) {
    const command =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
          : ["xdg-open", [url]];
    execFile(command[0], command[1], () => {});
  }
}
