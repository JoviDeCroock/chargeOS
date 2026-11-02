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
  // Managed hosting deploys a pinned template that still seeds the owner card.
  document.getElementById("ownerTag").required = managed;
  document.getElementById("owner-tag-optional").hidden = managed;
  // Managed hosting starts the Home console; the profile can be changed later in the console.
  document.getElementById("profile-choice").hidden = managed;
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
  if (values.target === "coolify") delete values.profile;
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
    const { signInToken, ...result } = await response.json();
    if (!response.ok) throw new Error(result.error || "Setup did not complete.");
    offerConsoleSignIn(result.consoleUrl, signInToken);
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

const SIGN_IN_CONTEXT = "chargeos-setup-sign-in-v1\n";
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA-256 of the challenge keyed by the owner token, as the console's server computes it. */
async function expectedProof(signInToken, challenge) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signInToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(SIGN_IN_CONTEXT + challenge)));
}

/**
 * Opens the console and hands it the owner token by postMessage, to that exact origin, only after
 * the tab this page opened proves its server holds the same token (an HMAC of a fresh challenge).
 * A page at a mistyped or stale hostname cannot answer, so it never receives the token. The token
 * is never shown, stored or put in a URL.
 */
function offerConsoleSignIn(consoleUrl, signInToken) {
  const button = document.getElementById("open-console");
  const help = document.getElementById("open-console-help");
  let consoleOrigin;
  try {
    consoleOrigin = new URL(consoleUrl).origin;
  } catch {
    button.hidden = true;
    return;
  }
  if (typeof signInToken !== "string" || !signInToken) {
    button.onclick = () => window.open(consoleOrigin, "_blank", "noopener");
    help.textContent = "Start chargeOS, then sign in with the owner token from credentials.json.";
    return;
  }
  let opened = null;
  let challenge = null;
  const listener = async (event) => {
    if (opened === null || event.source !== opened || event.origin !== consoleOrigin) return;
    const data = event.data;
    if (data?.type === "chargeos-sign-in-ready" && challenge === null) {
      challenge = hex(crypto.getRandomValues(new Uint8Array(32)));
      opened.postMessage({ type: "chargeos-sign-in-challenge", challenge }, consoleOrigin);
      return;
    }
    if (data?.type !== "chargeos-sign-in-proof" || challenge === null) return;
    const sent = challenge;
    if (data.challenge !== sent || typeof data.proof !== "string") return;
    if (data.proof !== (await expectedProof(signInToken, sent))) {
      window.removeEventListener("message", listener);
      opened = null;
      help.textContent =
        "That address answered but is not this chargeOS installation, so you were not signed in. Check the console hostname and DNS, then sign in with the owner token from credentials.json.";
      return;
    }
    if (opened === null || challenge !== sent) return;
    opened.postMessage({ type: "chargeos-sign-in", token: signInToken }, consoleOrigin);
    window.removeEventListener("message", listener);
    opened = null;
    help.textContent = "Signed in. You can close this tab and stop the setup tool.";
  };
  button.onclick = () => {
    window.removeEventListener("message", listener);
    challenge = null;
    opened = window.open(`${consoleOrigin}/#sign-in`, "_blank");
    window.addEventListener("message", listener);
  };
}
