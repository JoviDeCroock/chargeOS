import { describe, expect, it } from "vitest";

import { assessOwnerContinuity, planOwnerContinuityPreparation } from "../server/capabilities.js";

describe("assessOwnerContinuity", () => {
  it("reports ready only when known owners work and unknown tags remain rejected", () => {
    const result = assessOwnerContinuity(
      configuration({
        AllowOfflineTxForUnknownId: "false",
        LocalAuthListEnabled: "true",
        LocalAuthListMaxLength: "10",
        LocalAuthorizeOffline: "true",
        SendLocalListMaxLength: "10",
      }),
      { listVersion: 4 },
      2,
    );

    expect(result.state).toBe("ready");
    expect(result.localListVersion).toBe(4);
    expect(result.checks).toHaveLength(6);
  });

  it("accepts boolean and integer spellings that vary between charger firmwares", () => {
    const result = assessOwnerContinuity(
      configuration({
        AllowOfflineTxForUnknownId: "FALSE",
        LocalAuthListEnabled: "True",
        LocalAuthListMaxLength: "32",
        LocalAuthorizeOffline: "true",
        SendLocalListMaxLength: "32",
      }),
      { listVersion: 0 },
      1,
    );
    expect(result.state).toBe("ready");
  });

  it("never trims a padded value into a pass and plans a canonical rewrite instead", () => {
    const padded = configuration(
      {
        AllowOfflineTxForUnknownId: "false",
        LocalAuthListEnabled: "true",
        LocalAuthListMaxLength: " 32 ",
        LocalAuthorizeOffline: "true ",
        SendLocalListMaxLength: "32",
      },
      false,
    );
    const result = assessOwnerContinuity(padded, { listVersion: 0 }, 1);
    expect(result.state).toBe("unknown");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "known-tags-offline", state: "unknown" }),
    );
    expect(planOwnerContinuityPreparation(padded)).toContainEqual(
      expect.objectContaining({ key: "LocalAuthorizeOffline", state: "change-required" }),
    );
  });

  it("blocks when local list storage cannot hold every owner tag", () => {
    const result = assessOwnerContinuity(
      configuration({
        AllowOfflineTxForUnknownId: "false",
        LocalAuthListEnabled: "true",
        LocalAuthListMaxLength: "1",
        LocalAuthorizeOffline: "true",
        SendLocalListMaxLength: "10",
      }),
      { listVersion: 1 },
      2,
    );
    expect(result.state).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "local-list-storage", observed: "1 entries", state: "fail" }),
    );
  });

  it("fails a required key the charger explicitly reports as unknown instead of guessing", () => {
    const result = assessOwnerContinuity(
      {
        ...configuration({
          AllowOfflineTxForUnknownId: "false",
          LocalAuthorizeOffline: "true",
          SendLocalListMaxLength: "10",
        }),
        unknownKey: ["LocalAuthListEnabled", "LocalAuthListMaxLength"],
      },
      { listVersion: 1 },
      1,
    );
    expect(result.state).toBe("blocked");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local-list-enabled",
          observed: "not supported by this charger",
          state: "fail",
        }),
        expect.objectContaining({
          id: "local-list-storage",
          observed: "not supported by this charger",
          state: "fail",
        }),
      ]),
    );
  });

  it("passes unknown-tag rejection when the charger does not offer Unknown Offline Authorization", () => {
    // OCPP 1.6 edition 2, section 9.1.1: the key exists only when the capability is supported.
    const response = {
      ...configuration({
        LocalAuthListEnabled: "true",
        LocalAuthListMaxLength: "42",
        LocalAuthorizeOffline: "true",
        SendLocalListMaxLength: "42",
      }),
      unknownKey: ["AllowOfflineTxForUnknownId"],
    };
    const result = assessOwnerContinuity(response, { listVersion: 1 }, 1);
    expect(result.state).toBe("ready");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "unknown-tags-rejected",
        observed: "not offered by this charger, so unknown cards are never authorized offline",
        state: "pass",
      }),
    );
    expect(planOwnerContinuityPreparation(response)).toContainEqual({
      currentValue: null,
      desiredValue: "false",
      key: "AllowOfflineTxForUnknownId",
      state: "already-safe",
    });
  });

  it("never passes unknown-tag rejection when the answer also reports the key as present", () => {
    const base = {
      LocalAuthListEnabled: "true",
      LocalAuthListMaxLength: "42",
      LocalAuthorizeOffline: "true",
      SendLocalListMaxLength: "42",
    };
    const contradictions = [
      // Present without a value: the key exists, so the capability exists.
      [{ key: "AllowOfflineTxForUnknownId", readonly: false }],
      // Present in another letter case and enabled.
      [{ key: "allowofflinetxforunknownid", readonly: false, value: "true" }],
      [{ key: "AllowOfflineTxForUnknownId", readonly: false, value: "true" }],
    ];
    for (const extra of contradictions) {
      const base_ = configuration(base);
      const response = {
        configurationKey: [...base_.configurationKey, ...extra],
        unknownKey: ["AllowOfflineTxForUnknownId"],
      };
      const result = assessOwnerContinuity(response, { listVersion: 1 }, 1);
      expect(result.state).not.toBe("ready");
      expect(result.checks).toContainEqual(
        expect.objectContaining({
          id: "unknown-tags-rejected",
          state: expect.not.stringMatching(/^pass$/u),
        }),
      );
      expect(planOwnerContinuityPreparation(response)).not.toContainEqual(
        expect.objectContaining({ key: "AllowOfflineTxForUnknownId", state: "already-safe" }),
      );
    }
  });

  it("never passes unknown-tag rejection when the key is merely missing from the answer", () => {
    const response = configuration({
      LocalAuthListEnabled: "true",
      LocalAuthListMaxLength: "42",
      LocalAuthorizeOffline: "true",
      SendLocalListMaxLength: "42",
    });
    const result = assessOwnerContinuity(response, { listVersion: 1 }, 1);
    expect(result.state).toBe("unknown");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "unknown-tags-rejected", state: "unknown" }),
    );
    expect(planOwnerContinuityPreparation(response)).toContainEqual(
      expect.objectContaining({ key: "AllowOfflineTxForUnknownId", state: "blocked" }),
    );
    // Only this one optional key is read as safe when unsupported; required keys still fail.
    expect(
      planOwnerContinuityPreparation({
        configurationKey: [],
        unknownKey: ["LocalAuthorizeOffline"],
      }),
    ).toContainEqual(expect.objectContaining({ key: "LocalAuthorizeOffline", state: "blocked" }));
  });

  it("does not read malformed capacities as numbers", () => {
    const result = assessOwnerContinuity(
      configuration({
        AllowOfflineTxForUnknownId: "false",
        LocalAuthListEnabled: "true",
        LocalAuthListMaxLength: "",
        LocalAuthorizeOffline: "true",
        SendLocalListMaxLength: "1e3",
      }),
      { listVersion: 1 },
      1,
    );
    expect(result.state).toBe("unknown");
  });

  it("blocks synchronization when offline policy would accept unknown tags", () => {
    const result = assessOwnerContinuity(
      configuration({
        AllowOfflineTxForUnknownId: "true",
        LocalAuthListEnabled: "true",
        LocalAuthListMaxLength: "10",
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
