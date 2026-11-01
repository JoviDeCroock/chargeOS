const token = location.hash.slice(1);
history.replaceState(null, "", "/");
document.getElementById("company-setup").href = `/company#${token}`;
const form = document.querySelector("#setup");
const target = document.querySelector("#target");
const cloud = document.querySelector("#cloud");
const status = document.querySelector("#status");
const error = document.querySelector("#error");
target.addEventListener("change", () => {
  const managed = target.value === "coolify";
  cloud.hidden = !managed;
  for (const id of [
    "cloudOrigin",
    "cloudToken",
    "projectId",
    "serverId",
    "environment",
    "gitRepository",
    "gitBranch",
    "gitCommit",
  ])
    document.getElementById(id).required = managed;
  document.getElementById("image").required = managed;
  document.getElementById("image-optional").hidden = managed;
  document.getElementById("destination-help").textContent = managed
    ? "Use an existing Coolify Cloud account with a connected server. Its proxy will provide HTTPS and WSS on two separate domains."
    : "Docker and Compose must run locally on this computer. Remote Docker contexts are not supported. Your server needs two DNS names pointing to it and ports 80 and 443 available.";
});
if (!/^[a-f0-9]{64}$/.test(token)) {
  error.hidden = false;
  error.textContent = "Open the full setup link from your terminal to authorize this tab.";
  for (const button of form.querySelectorAll("button")) button.disabled = true;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.busy) return;
  const values = Object.fromEntries(new FormData(form));
  values.deploy = event.submitter?.value === "deploy";
  if (values.target === "docker")
    for (const key of [
      "cloudOrigin",
      "cloudToken",
      "projectId",
      "serverId",
      "destinationId",
      "environment",
      "gitRepository",
      "gitBranch",
      "gitCommit",
      "githubAppId",
    ])
      delete values[key];
  form.dataset.busy = "true";
  for (const control of form.elements) control.disabled = true;
  document.getElementById("cloudToken").value = "";
  document.getElementById("ownerTag").value = "";
  error.hidden = true;
  status.textContent = values.deploy
    ? "Preparing and starting chargeOS. This can take several minutes; keep this tab and terminal open."
    : "Preparing your private setup files…";
  let success = false;
  try {
    const response = await fetch("/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Setup-Token": token },
      body: JSON.stringify(values),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Setup did not complete.");
    const receipt = document.getElementById("receipt");
    receipt.replaceChildren();
    for (const [label, value] of [
      ["Console", result.consoleUrl],
      ["Charger endpoint", result.ocppUrl],
      ["Private setup folder", result.directory],
      ...(result.serviceId ? [["Cloud service ID", result.serviceId]] : []),
    ]) {
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      receipt.append(term, detail);
    }
    document.getElementById("result-title").textContent =
      result.status === "submitted"
        ? "Submitted to Coolify"
        : result.status === "containers-started"
          ? "Your containers have started"
          : "Your setup files are ready";
    document.getElementById("result-message").textContent =
      result.status === "submitted"
        ? "Follow the deployment in your Coolify project. Submission does not yet prove the service is healthy."
        : "Read START-HERE.txt in your private setup folder for the next steps and restart instructions.";
    document.getElementById("result").hidden = false;
    status.textContent =
      "Setup saved. This form is locked to prevent accidental duplicate deployments.";
    success = true;
  } catch (problem) {
    error.hidden = false;
    error.textContent =
      problem instanceof Error
        ? problem.message
        : "Setup could not finish. Inspect your terminal and private setup folder before retrying.";
    status.textContent = "";
  } finally {
    delete form.dataset.busy;
    if (!success) for (const control of form.elements) control.disabled = false;
    // Credentials are deliberately absent from rendered result and storage.
    delete values.cloudToken;
    delete values.ownerTag;
  }
});
