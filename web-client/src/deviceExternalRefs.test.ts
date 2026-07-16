import { describe, expect, it } from "vitest";
import { externalReferencesForDevice } from "./deviceExternalRefs";

describe("externalReferencesForDevice", () => {
  it("surfaces all multi-provider identities", () => {
    const refs = [
      { provider: "datto_rmm", externalId: "datto-42" },
      { provider: "ninjaone", externalId: "ninja-88" },
    ];

    expect(externalReferencesForDevice({ externalRefs: refs })).toEqual(refs);
  });

  it("falls back to the legacy primary identity", () => {
    expect(externalReferencesForDevice({
      externalProvider: "tactical_rmm",
      externalId: "agent-7",
    })).toEqual([{ provider: "tactical_rmm", externalId: "agent-7" }]);
  });

  it("does not repeat the legacy identity when external refs exist", () => {
    const refs = [{ provider: "ninjaone", externalId: "ninja-88" }];
    expect(externalReferencesForDevice({
      externalRefs: refs,
      externalProvider: "tactical_rmm",
      externalId: "agent-7",
    })).toEqual(refs);
  });
});
