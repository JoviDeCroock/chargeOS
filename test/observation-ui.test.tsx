// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ObservationWorkspace } from "../src/observation/app.js";

describe("local observation workspace", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw Error("No remote calls allowed");
      }),
    );
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("imports an example, calculates an exact draft and keeps unresolved money visible", async () => {
    render(<ObservationWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Load fictional example" }));
    await screen.findByText("5 source records · 6 columns");
    fireEvent.click(screen.getByRole("button", { name: /Calculate local draft/ }));
    expect(screen.getByText("€35.96")).toBeTruthy();
    expect(screen.getByText("3 / 1")).toBeTruthy();
    expect(screen.getByText("1 / 0 / 0")).toBeTruthy();
    fireEvent.input(screen.getByRole("textbox", { name: "Reported total · EUR" }), {
      target: { value: "35.96" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare declared amount" }));
    expect(screen.getByRole("status").textContent).toContain("unresolved records remain");
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("invalidates results when policy inputs change and clears all source data on reset", async () => {
    render(<ObservationWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Load fictional example" }));
    await screen.findByText("5 source records · 6 columns");
    fireEvent.click(screen.getByRole("button", { name: /Calculate local draft/ }));
    fireEvent.input(screen.getByRole("textbox", { name: /Declared rate/ }), {
      target: { value: "0.4" },
    });
    expect(screen.queryByRole("region", { name: "Observation results" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Calculate local draft/ }));
    expect(screen.getByText("€44.64")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear local analysis" }));
    expect(screen.queryByText(/source records ·/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Observation results" })).toBeNull();
    expect((screen.getByRole("textbox", { name: /Declared rate/ }) as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("does not apply a fictional policy to a newly chosen real export", async () => {
    render(<ObservationWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Load fictional example" }));
    await screen.findByText("5 source records · 6 columns");
    const text =
      "session_id,station_id,driver_alias,started_at,ended_at,energy_kwh\nmy-1,MY-STATION,employee-001,2026-10-28T08:00:00Z,2026-10-28T09:00:00Z,7.4";
    const file = new File([text], "own.csv", { type: "text/csv" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode(text).buffer,
    });
    fireEvent.change(screen.getByLabelText("Session CSV", { selector: "input" }), {
      target: { files: [file] },
    });
    await screen.findByText("1 source records · 6 columns");
    expect((screen.getByRole("textbox", { name: /Declared rate/ }) as HTMLInputElement).value).toBe(
      "",
    );
    fireEvent.click(screen.getByRole("button", { name: /Calculate local draft/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Driver alias"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cannot restore a source after the user clears an in-flight fingerprint", async () => {
    let finishDigest: ((value: ArrayBuffer) => void) | undefined;
    vi.stubGlobal("crypto", {
      subtle: {
        digest: () =>
          new Promise<ArrayBuffer>((resolve) => {
            finishDigest = resolve;
          }),
      },
    });
    render(<ObservationWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Load fictional example" }));
    expect(screen.getByRole("status").textContent).toContain("fingerprinting");
    fireEvent.click(screen.getByRole("button", { name: "Clear local analysis" }));
    finishDigest!(new Uint8Array(32).buffer);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByText(/source records ·/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Calculate local draft/ }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
