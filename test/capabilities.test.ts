import { describe, expect, it } from "vitest";

import { assessOwnerContinuity, planOwnerContinuityPreparation } from "../server/capabilities.js";

describe("assessOwnerContinuity", () => {
  it("reports ready only when known owners work and unknown tags remain rejected", () => {
    const result = assessOwnerContinuity(
      configuration({
        AllowOfflineTxForUnknownId: "false",
        LocalAuthListEnabled: "true",
        LocalAuthorizeOffline: "true",
        SendLocalListMaxLength: "10",
      }),
      { listVersion: 4 },
      2,
    );

    expect(result.state).toBe("ready");
    expect(result.localListVersion).toBe(4);
    expect(result.checks).toHaveLength(5);
  });

  it("blocks synchronization when offline policy would accept unknown tags", () => {
    const result = assessOwnerContinuity(
      configuration({
        AllowOfflineTxForUnknownId: "true",
        LocalAuthListEnabled: "true",
        LocalAuthorizeOffline: "true",
        SendLocalListMaxLength: "10",
      }),
      { listVersion: 0 },
      1,
    );

    expect(result.state).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "unknown-tags-rejected", state: "fail" }),
    );
  });

  it("keeps readiness unknown when the charger omits required evidence", () => {
    expect(assessOwnerContinuity({}, {}, 1).state).toBe("unknown");
  });

  it("plans only one-way safe changes and blocks missing or read-only settings", () => {
    expect(
      planOwnerContinuityPreparation(
        configuration(
          {
            AllowOfflineTxForUnknownId: "true",
            LocalAuthListEnabled: "false",
            LocalAuthorizeOffline: "true",
          },
          false,
        ),
      ),
    ).toEqual([
      expect.objectContaining({ key: "LocalAuthListEnabled", state: "change-required" }),
      expect.objectContaining({ key: "LocalAuthorizeOffline", state: "already-safe" }),
      expect.objectContaining({ key: "AllowOfflineTxForUnknownId", state: "change-required" }),
    ]);

    expect(
      planOwnerContinuityPreparation(
        configuration({ AllowOfflineTxForUnknownId: "true", LocalAuthListEnabled: "false" }, true),
      ).every((setting) => setting.state === "blocked"),
    ).toBe(true);
  });
});

function configuration(values: Record<string, string>, readonly?: boolean) {
  return {
    configurationKey: Object.entries(values).map(([key, value]) => ({ key, readonly, value })),
  };
}
