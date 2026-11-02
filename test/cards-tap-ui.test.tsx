// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardCaptureProjection, OwnerSnapshot } from "../shared/contracts.js";
import { locale } from "../src/i18n/index.js";
import { action, ownerToken, snapshot } from "../src/model.js";
import { CardsPage } from "../src/pages/cards.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";
const PSEUDONYM = "tag_0123456789abcdef01234567";

function ownerSnapshot(cardCapture: CardCaptureProjection, tagCount = 0): OwnerSnapshot {
  return {
    authorization: {
      acknowledgedTagPseudonyms: [],
      pendingAdditions: [],
      pendingRevocations: [],
      syncState: "never-synced",
      tagCount,
      tagPseudonyms: tagCount ? [PSEUDONYM] : [],
    },
    cardCapture,
    readiness: null,
    station: { connected: true, id: "HOME-1", label: "Driveway" },
  } as unknown as OwnerSnapshot;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("tap a card on the cards page", () => {
  beforeEach(() => {
    locale.value = "en";
    ownerToken.value = TOKEN;
    action.value = null;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks for a first card and starts listening at the charger", async () => {
    const listening: CardCaptureProjection = {
      state: "listening",
      tagPseudonym: null,
      tappedAt: null,
      until: "2026-11-02T10:02:00.000Z",
    };
    const fetchMock = vi.fn(async (_path: string) => json(listening));
    vi.stubGlobal("fetch", fetchMock);
    snapshot.value = ownerSnapshot({
      state: "idle",
      tagPseudonym: null,
      tappedAt: null,
      until: null,
    });
    const { rerender } = render(
      <CardsPage snapshot={snapshot.value} directory={null} go={() => undefined} />,
    );
    expect(screen.getByRole("heading", { name: "Add your first card" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Tap a card at the charger" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (button) => button.textContent === "Tap a card at the charger",
      )!,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/stations/HOME-1/card-capture");
    await waitFor(() => expect(snapshot.value?.cardCapture.state).toBe("listening"));
    rerender(<CardsPage snapshot={snapshot.value!} directory={null} go={() => undefined} />);
    expect(screen.getByText("Tap your card at the charger now")).toBeTruthy();
  });

  it("adds the tapped card by its reference only", async () => {
    const fetchMock = vi.fn(async (path: string) =>
      path.endsWith("/confirm")
        ? json({ stateVersion: 2, tagCount: 1, tagPseudonym: PSEUDONYM }, 201)
        : json(
            ownerSnapshot({ state: "idle", tagPseudonym: null, tappedAt: null, until: null }, 1),
          ),
    );
    vi.stubGlobal("fetch", fetchMock);
    snapshot.value = ownerSnapshot({
      state: "captured",
      tagPseudonym: PSEUDONYM,
      tappedAt: "2026-11-02T10:00:30.000Z",
      until: "2026-11-02T10:05:30.000Z",
    });
    render(<CardsPage snapshot={snapshot.value} directory={null} go={() => undefined} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Tap a card at the charger" })[0]!);
    expect(await screen.findByText("Card found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add this card" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/stations/HOME-1/card-capture/confirm",
        expect.objectContaining({ body: JSON.stringify({ tagPseudonym: PSEUDONYM }) }),
      ),
    );
  });
});
