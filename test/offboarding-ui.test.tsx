// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FleetCard, FleetSnapshot } from "../shared/contracts.js";
import type { OwnerDirectory } from "../shared/directory.js";
import { fleetCards } from "../src/fleet-model.js";
import { locale } from "../src/i18n/index.js";
import { action } from "../src/model.js";
import { OffboardDialog } from "../src/pages/offboarding.js";

const SELF_ADDED = "tag_aaaaaaaaaaaaaaaaaaaaaaaa";
const COMPANY = "tag_bbbbbbbbbbbbbbbbbbbbbbbb";
const SHARED = "tag_cccccccccccccccccccccccc";

const directory: OwnerDirectory = {
  cards: [
    {
      holderPersonId: "person-sam",
      name: "Blue key fob",
      stationId: "HOME-1",
      tagPseudonym: COMPANY,
    },
  ],
  people: [{ id: "person-sam", name: "Sam" }],
  stations: [{ driverPersonId: "person-sam", id: "HOME-1", label: "Driveway", site: "Home" }],
  writable: true,
};

function fleet(ownership: "company" | "employee"): FleetSnapshot {
  return {
    stations: [
      { id: "HOME-1", label: "Driveway", ownership },
      { id: "OFFICE-1", label: "Office bay 1", ownership: "company" },
    ],
  } as unknown as FleetSnapshot;
}

const card = (tagPseudonym: string, policy: FleetCard["policy"]): FleetCard => ({
  members: [{ onCharger: true, stationId: "HOME-1", tagPseudonym }],
  policy,
});

describe("an employee leaves", () => {
  beforeEach(() => {
    locale.value = "en";
    action.value = null;
    fleetCards.value = {
      cards: [
        card(COMPANY, { ownership: "company", use: "business" }),
        // Added from the employee page: no holder name in the directory.
        card(SELF_ADDED, { ownership: "personal", use: "private" }),
        // Never classified and shared with the office: it leaves only the employee's charger.
        {
          members: [
            { onCharger: true, stationId: "HOME-1", tagPseudonym: SHARED },
            { onCharger: true, stationId: "OFFICE-1", tagPseudonym: SHARED },
          ],
          policy: null,
        },
      ],
    };
  });
  afterEach(() => {
    cleanup();
    fleetCards.value = null;
  });

  const planLines = () =>
    [...document.querySelectorAll(".plan-box li")].map(({ textContent }) => textContent);

  it("removes cards the employee added themselves when the company keeps the charger", () => {
    render(
      <OffboardDialog
        person={directory.people[0]!}
        directory={directory}
        fleet={fleet("company")}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText(/The company keeps the charger/u));
    expect(planLines()).toEqual([
      "Remove Blue key fob from Driveway",
      "Remove Unnamed card · aaaaaa from Driveway",
      "Remove Unnamed card · cccccc from Driveway",
      "End the employee page for Driveway",
      "Unassign Driveway",
    ]);
  });

  it("removes only company cards and skips an ownership mark already recorded", () => {
    render(
      <OffboardDialog
        person={directory.people[0]!}
        directory={directory}
        fleet={fleet("employee")}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Sam takes the charger/u));
    expect(planLines()).toEqual([
      "Remove Blue key fob from Driveway",
      "Remove Unnamed card · cccccc from Driveway",
      "End the employee page for Driveway",
    ]);
  });
});
