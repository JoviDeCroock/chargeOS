import { useState } from "preact/hooks";
import type {
  AiProvider,
  TroubleshootingPreview,
  TroubleshootingResult,
} from "../shared/contracts.js";
import { askTroubleshooter, fetchTroubleshootingPreview } from "./api.js";
import "./troubleshooting.css";

export function TroubleshootingPanel({ stationId, token }: { stationId: string; token: string }) {
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [question, setQuestion] = useState("");
  const [preview, setPreview] = useState<TroubleshootingPreview | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TroubleshootingResult | null>(null);
  const [webSearch, setWebSearch] = useState(false);

  async function review() {
    setBusy(true);
    setError("");
    setConsent(false);
    setResult(null);
    try {
      setPreview(await fetchTroubleshootingPreview(stationId, token));
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not load diagnostics. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview || !consent || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    const apiKey = key;
    setKey("");
    try {
      setResult(
        await askTroubleshooter(stationId, token, {
          provider,
          model,
          apiKey,
          question,
          contextSha256: preview.sha256,
          consent: true,
          webSearch,
        }),
      );
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not get advice. Retry with your key.",
      );
      setConsent(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="section-stack ai-panel">
      <header class="page-head">
        <h1>Troubleshoot with your own AI key</h1>
        <p class="lede">
          Ask about offline authorization, configuration checks or session conflicts. Your provider
          receives your question and the diagnostics you review below. Its API usage is charged to
          your account.
        </p>
      </header>
      <section class="panel glass">
        <ol class="ai-steps">
          <li class={preview ? "done" : "current"}>
            <div>
              <strong>Review what will be shared</strong>
              <p class="ai-muted">
                Keys stay in memory for this request and are cleared when sent. Advice needs owner
                review; this assistant cannot change your charger.
              </p>
            </div>
            <button
              type="button"
              class="button secondary"
              disabled={busy}
              onClick={() => void review()}
            >
              {busy ? "Working…" : preview ? "Refresh diagnostic preview" : "Review diagnostics"}
            </button>
          </li>
        </ol>
        {preview && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div class="ai-preview">
              <h3>Diagnostics to send</h3>
              <p>
                Connection, continuity checks, pending authorization counts and conflict count.
                Device identity, session details, RFID identifiers and credentials are excluded.
              </p>
              <pre tabIndex={0}>{JSON.stringify(preview.context, null, 2)}</pre>
            </div>
            <div class="ai-fields">
              <label>
                AI provider
                <select
                  value={provider}
                  disabled={busy}
                  onChange={(event) => {
                    setProvider(event.currentTarget.value as AiProvider);
                    setModel("");
                    setKey("");
                    setConsent(false);
                    setResult(null);
                  }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label>
                Model ID
                <input
                  required
                  maxLength={100}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._:\-]*"
                  placeholder="Model available in your provider account"
                  value={model}
                  disabled={busy}
                  onInput={(event) => setModel(event.currentTarget.value)}
                />
              </label>
              <label class="ai-full">
                Your API key
                <input
                  type="password"
                  autoComplete="off"
                  spellcheck={false}
                  required
                  minLength={16}
                  maxLength={512}
                  value={key}
                  disabled={busy}
                  onInput={(event) => setKey(event.currentTarget.value)}
                />
              </label>
              <label class="ai-full">
                What needs troubleshooting?
                <textarea
                  required
                  maxLength={2000}
                  rows={3}
                  placeholder="For example: why is offline authorization blocked? Keep passwords and personal data out of your question."
                  value={question}
                  disabled={busy}
                  onInput={(event) => {
                    setQuestion(event.currentTarget.value);
                    setConsent(false);
                  }}
                />
              </label>
            </div>
            <label class="ai-consent">
              <input
                type="checkbox"
                checked={webSearch}
                disabled={busy}
                onChange={(event) => {
                  setWebSearch(event.currentTarget.checked);
                  setConsent(false);
                }}
              />
              Allow internet searches for manufacturer documentation. Your provider may charge for
              searches; up to three tool calls are allowed.
            </label>
            <label class="ai-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.currentTarget.checked)}
              />
              Send this question and diagnostic preview to{" "}
              {provider === "openai" ? "OpenAI" : "Anthropic"} using my key.
            </label>
            <button class="button primary" type="submit" disabled={busy || !consent}>
              {busy ? "Asking your provider…" : "Get troubleshooting advice"}
            </button>
          </form>
        )}
        {error && (
          <p class="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <section class="ai-answer" aria-live="polite">
            <h3>Advice for owner review</h3>
            <p class="ai-muted">
              {result.provider} · {result.model} · no charger changes made
            </p>
            <div>{result.advice}</div>
            {result.sources.length > 0 && (
              <>
                <h4>Sources to check</h4>
                <ul>
                  {result.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </section>
    </div>
  );
}
