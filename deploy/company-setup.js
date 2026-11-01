const nonce = location.hash.slice(1);
history.replaceState(null, "", "/company");
const form = document.getElementById("company-setup"),
  status = document.getElementById("status"),
  error = document.getElementById("error");
document.getElementById("owner-setup").href = `/#${nonce}`;
document.getElementById("smtpSecurity").addEventListener("change", (event) => {
  const port = document.getElementById("smtpPort");
  if (["587", "465"].includes(port.value))
    port.value = event.target.value === "starttls" ? "587" : "465";
});
if (!/^[a-f0-9]{64}$/.test(nonce)) {
  error.hidden = false;
  error.textContent =
    "Open the full setup link printed by your terminal, then choose company accounts.";
  for (const button of form.querySelectorAll("button")) button.disabled = true;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.busy) return;
  const values = Object.fromEntries(new FormData(form));
  values.deploy = event.submitter?.value === "deploy";
  form.dataset.busy = "true";
  for (const control of form.elements) control.disabled = true;
  document.getElementById("smtpPassword").value = "";
  document.getElementById("smtpUsername").value = "";
  error.hidden = true;
  status.textContent = values.deploy
    ? "Preparing and starting company accounts. Keep this tab and terminal open while Docker builds the software."
    : "Preparing your private company setup files…";
  let success = false;
  try {
    const response = await fetch("/deploy/company", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Setup-Token": nonce },
      body: JSON.stringify(values),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Company setup did not complete.");
    const receipt = document.getElementById("receipt");
    receipt.replaceChildren();
    for (const [label, value] of [
      ["Company workspace", result.companyUrl],
      ["Private setup folder", result.directory],
    ]) {
      const term = document.createElement("dt"),
        detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      receipt.append(term, detail);
    }
    document.getElementById("result-title").textContent =
      result.status === "containers-started"
        ? "Your company containers have started"
        : "Your company setup files are ready";
    document.getElementById("result-message").textContent =
      "Check DNS, HTTPS and actual mailbox delivery before using the synthetic pilot. Read START-HERE.txt for status, restart and stop instructions.";
    document.getElementById("result").hidden = false;
    status.textContent =
      "Setup saved. This form is locked to prevent accidental duplicate deployments.";
    success = true;
  } catch (problem) {
    error.hidden = false;
    error.textContent =
      problem instanceof Error
        ? problem.message
        : "Setup could not finish. Inspect the private setup folder before retrying.";
    status.textContent = "";
  } finally {
    delete form.dataset.busy;
    if (!success) for (const control of form.elements) control.disabled = false;
    delete values.smtpPassword;
    delete values.smtpUsername;
  }
});
