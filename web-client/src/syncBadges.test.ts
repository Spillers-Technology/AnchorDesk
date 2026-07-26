import { describe, expect, it } from "vitest";
import { syncProvidersForTicket } from "./syncBadges";

describe("syncProvidersForTicket", () => {
  it("hides purely local tickets", () => {
    expect(syncProvidersForTicket({ source: "local" })).toEqual([]);
  });

  it("deduplicates matching source and provider values", () => {
    expect(syncProvidersForTicket({ source: "connectwise", externalProvider: "connectwise" })).toEqual([
      "connectwise",
    ]);
  });

  it("preserves distinct integration provenance", () => {
    expect(syncProvidersForTicket({ source: "api", externalProvider: "connectwise" })).toEqual([
      "connectwise",
      "api",
    ]);
  });

  it("keeps customer-portal provenance visible on ordinary tickets", () => {
    expect(syncProvidersForTicket({ source: "portal" })).toEqual(["portal"]);
  });
});
