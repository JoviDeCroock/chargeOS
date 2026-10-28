// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductPreview } from "../src/product/app.js";

describe("isolated charging-service product preview", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/preview");
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Preview must not contact a live service");
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps simulated charger actions local and identifies fictional records", () => {
    render(<ProductPreview />);
    expect(screen.getByText("Product preview · fictional data")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Pause preview/ }));
    expect(screen.getByRole("button", { name: /Resume preview/ })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("No command was sent");
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("separates sample approval, disputed money and actual settlement", () => {
    render(<ProductPreview />);
    fireEvent.change(screen.getByRole("combobox", { name: "Preview workspace" }), {
      target: { value: "employer" },
    });
    fireEvent.click(screen.getByRole("link", { name: /Reimbursements/ }));
    fireEvent.click(screen.getByRole("button", { name: "Simulate approval of eligible amount" }));
    expect(
      screen
        .getByRole("button", { name: "Preview eligible amount approved" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/held separately/).textContent).toContain("9.57");
    expect(screen.getAllByText("No real integration")).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toContain("no payment was sent");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("filters activity and opens an inspectable session with an accessible close action", () => {
    window.history.replaceState(null, "", "/preview#driver/activity");
    render(<ProductPreview />);
    fireEvent.change(screen.getByRole("combobox", { name: "Session location type" }), {
      target: { value: "Public" },
    });
    expect(screen.getByRole("button", { name: "View session DEMO-1024" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View session DEMO-1028" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View session DEMO-1024" }));
    expect(screen.getByRole("dialog").textContent).toContain("Fictional preview fixture");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("creates a sample support case without sending or persisting a message", () => {
    window.history.replaceState(null, "", "/preview#driver/help");
    render(<ProductPreview />);
    fireEvent.input(screen.getByLabelText("Short description"), {
      target: { value: "Example card question" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create preview case/ }));
    expect(screen.getByText("Example card question")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("No message was sent");
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("makes outage and empty states recoverable and disables simulated commands offline", () => {
    render(<ProductPreview />);
    const state = screen.getByRole("combobox", { name: "Preview state" });
    fireEvent.change(state, { target: { value: "offline" } });
    expect(screen.getByRole("button", { name: /Pause preview/ }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.change(state, { target: { value: "error" } });
    expect(screen.getByText("We couldn’t load this view.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(screen.getByText("A good day starts charged.")).toBeTruthy();
    fireEvent.change(state, { target: { value: "empty" } });
    fireEvent.click(screen.getByRole("button", { name: /Explore sample data/ }));
    expect(screen.getByRole("button", { name: /Pause preview/ }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});
