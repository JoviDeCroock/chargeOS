import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTroubleshooter,
  troubleshootingInput,
  troubleshootingPreview,
} from "../server/troubleshooting.js";
import { createOwnerApi, type OwnerApi } from "../server/api.js";
import { loadConfig } from "../server/config.js";
import { OwnerTagRegistry } from "../server/owner-tags.js";
import type { EvidenceStore } from "../server/events.js";
import type { ChargeGateway } from "../server/gateway.js";
import type { OwnerSnapshot, TroubleshootingInput } from "../shared/contracts.js";

const secret = "synthetic-provider-key-DO-NOT-PERSIST";
function snapshot(): OwnerSnapshot {
  return {
    station: {
      connected: false,
      id: "private-home",
      boot: { vendor: "secret-vendor", model: "secret-model", firmwareVersion: "secret-firmware" },
    },
    readiness: {
      checkedAt: "2026-10-31T12:00:00Z",
      state: "blocked",
      restartRequired: false,
      checks: [
        { id: "known-tags-offline", state: "unknown", observed: "12345678", label: "private" },
        { id: "unknown-tags-rejected", state: "pass", observed: "false", label: "private" },
        { id: "unrecognized-secret", state: "fail", observed: "secret-value" },
      ],
    },
    authorization: {
      syncState: "pending",
      pendingAdditions: ["private-tag"],
      pendingRevocations: ["private-tag-2"],
    },
    sessions: [{ integrity: "conflict", tagPseudonym: "private-tag", transactionId: 123 }],
    evidence: [{ payload: { password: "private-password" } }],
  } as unknown as OwnerSnapshot;
}
const preview = () => troubleshootingPreview(snapshot());
const input = (extra: Partial<TroubleshootingInput> = {}): TroubleshootingInput => ({
  provider: "openai",
  model: "test-model",
  apiKey: secret,
  question: "Why is offline charging blocked?",
  contextSha256: preview().sha256,
  consent: true,
  webSearch: false,
  ...extra,
});
const openaiReply = () =>
  Response.json({
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: "Check the supported local authorization settings." },
        ],
      },
    ],
  });
let api: OwnerApi | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await api?.close();
  api = undefined;
});

describe("BYOK troubleshooting boundary", () => {
  it("withholds all identity, sessions, raw settings and numeric values in boolean checks", () => {
    const result = preview();
    const bytes = JSON.stringify(result);
    for (const withheld of [
      "private",
      "secret-",
      "12345678",
      "transactionId",
      "payload",
      "password",
      "label",
    ])
      expect(bytes).not.toContain(withheld);
    expect(result.context.checks[0]?.observed).toBe("unrecognized value (withheld)");
    expect(result.context.checks[1]?.observed).toBe("false");
    expect(result.context.authorization.pendingRevocations).toBe(1);
    expect(result.sha256).toBe(preview().sha256);
  });
  it("shares fixed readiness explanations but still withholds look-alikes", () => {
    const base = snapshot();
    const withObserved = (observed: string) =>
      troubleshootingPreview({
        ...base,
        readiness: {
          ...base.readiness!,
          checks: [{ id: "unknown-tags-rejected", label: "x", observed, state: "pass" }],
        },
      }).context.checks[0]?.observed;
    for (const fixed of [
      "not offered by this charger, so unknown cards are never authorized offline",
      "not supported by this charger",
    ]) {
      expect(withObserved(fixed)).toBe(fixed);
    }
    expect(withObserved("not supported by this charger OWNER-CARD-1")).toBe(
      "unrecognized value (withheld)",
    );
  });
  it("rejects unapproved, malformed, injected endpoint/tool and key-in-question requests", () => {
    for (const patch of [
      { consent: false },
      { webSearch: "true" },
      { provider: "custom" },
      { provider: ["openai"] },
      { apiKey: "short" },
      { model: "../bad" },
      { endpoint: "https://attacker.test" },
      { tools: [{ type: "computer" }] },
      { question: secret },
    ])
      expect(() => troubleshootingInput({ ...input(), ...patch })).toThrow();
    expect(troubleshootingInput({ ...input() })).toEqual(input());
  });
  it("sends only consented diagnostics to the fixed OpenAI endpoint, without storage or tools by default", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => openaiReply());
    const result = await createTroubleshooter(undefined, fetcher)(input(), preview());
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(init?.body as string);
    expect(body.store).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(body.input).not.toContain("private");
    expect(body.input).not.toContain(secret);
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`);
    expect(result.advice).toContain("local authorization");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("bounds opt-in search and extracts safe OpenAI source links without executing model output", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "<script>doNotRun()</script>",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://manufacturer.example/manual",
                    title: "Manual",
                  },
                  { type: "url_citation", url: "javascript:alert(1)" },
                  { type: "url_citation", url: "https://secret:password@example.test" },
                ],
              },
            ],
          },
        ],
      }),
    );
    const result = await createTroubleshooter("http://caddy:9092", fetcher)(
      input({ webSearch: true }),
      preview(),
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://caddy:9092/openai");
    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.max_tool_calls).toBe(3);
    expect(result.sources).toEqual([
      { url: "https://manufacturer.example/manual", title: "Manual" },
    ]);
  });
  it("uses Anthropic's distinct key, version, search budget and citation format", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        content: [
          {
            type: "text",
            text: "Read the manual.",
            citations: [{ url: "https://manufacturer.example/guide", title: "Guide" }],
          },
        ],
      }),
    );
    const result = await createTroubleshooter(undefined, fetcher)(
      input({ provider: "anthropic", webSearch: true }),
      preview(),
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    const init = fetcher.mock.calls[0]?.[1];
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe(secret);
    expect(JSON.parse(init?.body as string).tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    ]);
    expect(result.sources[0]?.title).toBe("Guide");
  });
  it("rejects stale consent before any provider request and bounds concurrent spending", async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const ask = createTroubleshooter(undefined, fetcher);
    await expect(ask(input({ contextSha256: "0".repeat(64) }), preview())).rejects.toMatchObject({
      status: 409,
    });
    expect(fetcher).not.toHaveBeenCalled();
    const pending = ask(input(), preview());
    await expect(ask(input(), preview())).rejects.toMatchObject({ status: 429 });
    complete(openaiReply());
    await pending;
    await expect(ask(input(), preview())).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("transports Anthropic relay keys in Caddy's redacted Authorization header", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ content: [{ type: "text", text: "Read-only advice." }] }),
    );
    await createTroubleshooter("http://caddy:9092", fetcher)(
      input({ provider: "anthropic" }),
      preview(),
    );
    const headers = fetcher.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(secret);
    expect(headers["x-api-key"]).toBeUndefined();
  });
  it("never echoes provider error bodies, transport exceptions or oversized responses", async () => {
    for (const fetcher of [
      async () => new Response(`provider echoed ${secret}`, { status: 401 }),
      async () => {
        throw new Error(secret);
      },
      async () => new Response("x".repeat(131073)),
      async () => Response.json({ output: [{ type: "message", content: [] }] }),
    ]) {
      await expect(
        createTroubleshooter(undefined, fetcher)(input(), preview()),
      ).rejects.not.toThrow(secret);
    }
  });
  it("requires owner authentication and a provisioned station; never invokes a charger command", async () => {
    const config = loadConfig({
      CHARGEOS_STATION_ID: "STATION_1",
      CHARGEOS_OWNER_API_TOKEN: "synthetic-owner-token-at-least-32-characters",
      CHARGEOS_STATION_SECRET: "synthetic-station-secret",
      CHARGEOS_OWNER_TAGS: "owner-only-card",
    });
    const command = vi.fn();
    const gateway: ChargeGateway = {
      getRuntime: () => ({ connected: false, connectedAt: null }),
      close: command,
      listen: command,
      inspectLocalAuthorization: command,
      prepareOwnerContinuity: command,
      sendStationCommand: command,
      syncOwnerList: command,
    };
    const evidence = { readEvents: async () => [] } as unknown as EvidenceStore;
    const fetcher = vi.fn<typeof fetch>(async () => openaiReply());
    api = createOwnerApi(
      config,
      gateway,
      evidence,
      OwnerTagRegistry.memory(config.ownerTags, config.stationSecret),
      fetcher,
    );
    const base = `http://127.0.0.1:${await api.listen(0, "127.0.0.1")}`;
    const path = "/api/v1/stations/STATION_1/troubleshooting";
    expect((await fetch(`${base}${path}/preview`)).status).toBe(401);
    const headers = {
      Authorization: `Bearer ${config.ownerApiToken}`,
      "Content-Type": "application/json",
    };
    expect(
      (await fetch(`${base}/api/v1/stations/UNKNOWN/troubleshooting/preview`, { headers })).status,
    ).toBe(404);
    const context = await (await fetch(`${base}${path}/preview`, { headers })).json();
    const response = await fetch(`${base}${path}`, {
      headers,
      method: "POST",
      body: JSON.stringify(input({ contextSha256: context.sha256 })),
    });
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalled();
  });
});
