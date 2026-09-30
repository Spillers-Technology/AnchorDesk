import { describe, expect, it } from "vitest";
import { formatMinutes, initials, readableTextOn, relativeTime } from "./kit";
import { NAV_ITEMS, navMatches } from "./nav";
import { buildChecks, type SetupData } from "./OverviewPanel";
import type * as api from "../../api/client";

describe("formatMinutes", () => {
  it("renders SLA targets in the largest sensible units", () => {
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(4320)).toBe("3 d");
    expect(formatMinutes(1500)).toBe("1 d 1 h");
    expect(formatMinutes(0)).toBe("—");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  it("says how long ago in words", () => {
    expect(relativeTime("2026-09-29T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-09-29T11:55:00Z", now)).toMatch(/5 minutes ago/);
    expect(relativeTime("2026-09-28T12:00:00Z", now)).toMatch(/yesterday|1 day ago/);
  });
  it("handles missing and invalid timestamps", () => {
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("not a date", now)).toBe("—");
  });
});

describe("readableTextOn", () => {
  it("puts dark text on light label colors and white on dark ones", () => {
    expect(readableTextOn("#f1fa8c")).toBe("#111");
    expect(readableTextOn("#ffffff")).toBe("#111");
    expect(readableTextOn("#4f46e5")).toBe("#fff");
    expect(readableTextOn("#000000")).toBe("#fff");
  });
  it("falls back to white for values it can't parse", () => {
    expect(readableTextOn("red")).toBe("#fff");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two name parts", () => {
    expect(initials("Jess Tran")).toBe("JT");
    expect(initials("jess.tran@example.com")).toBe("JT");
    expect(initials("admin")).toBe("A");
  });
});

describe("navMatches", () => {
  const find = (q: string) => NAV_ITEMS.filter((i) => navMatches(i, q)).map((i) => i.id);
  it("finds sections by words that aren't in their label", () => {
    expect(find("smtp")).toContain("integrations");
    expect(find("sso")).toEqual(["auth"]);
    expect(find("imap")).toContain("mailboxes");
  });
  it("requires every term to match", () => {
    expect(find("jira connectwise")).toEqual(["ticket-sync"]);
    expect(find("zzz")).toEqual([]);
  });
});

describe("buildChecks", () => {
  const overview: api.AdminOverview = {
    tickets: { open: 3, total: 9 },
    devices: { total: 4, online: 3 },
    probes: { total: 0, online: 0 },
    users: 2,
    mailboxes: 1,
    recentAudit: [],
  };
  const auth = {
    localEnabled: true,
    oidc: { enabled: false, issuerUrl: null, clientId: null, redirectUri: "", hasClientSecret: false },
    saml: { enabled: false, entryPoint: null, issuer: null, callbackUrl: "", hasIdpCert: false },
    mfa: { required: true, issuer: "AnchorDesk" },
  } satisfies api.AuthSettings;
  const ready: SetupData = {
    integrations: { smtp: { host: "smtp.example.com", port: 587 }, connectwise: {}, jira: {}, tactical: {}, ninjaone: {}, datto: {}, storage: { backend: "local" }, tickets: {} },
    auth,
    sla: [{ id: 1, name: "Default", priority: null, companyId: null, responseMinutes: 240, resolutionMinutes: 4320, enabled: true }],
    mailboxes: [{ id: 1, name: "Help", host: "imap", port: 993, secure: true, username: "help", hasPassword: true, folder: "INBOX", companyName: null, enabled: true, lastUid: null, lastPolledAt: null, lastError: null }],
  };
  const tone = (checks: ReturnType<typeof buildChecks>, id: string) => checks.find((c) => c.id === id)?.tone;

  it("marks a fully configured install ready, leaving optional items out of the verdict", () => {
    const checks = buildChecks(overview, ready);
    expect(checks.filter((c) => !c.optional).every((c) => c.tone === "success")).toBe(true);
    expect(checks.filter((c) => c.optional).map((c) => c.id).sort()).toEqual(["probes", "sso"]);
  });

  it("flags the problems an admin must fix", () => {
    const checks = buildChecks(overview, {
      ...ready,
      integrations: { ...ready.integrations!, smtp: {}, storage: { backend: "s3" } },
      auth: { ...auth, mfa: { required: false, issuer: "AnchorDesk" } },
      sla: [{ ...ready.sla![0], priority: "High" }],
      mailboxes: [{ ...ready.mailboxes![0], lastError: "AUTHENTICATIONFAILED" }],
    });
    expect(tone(checks, "smtp")).toBe("error");
    expect(tone(checks, "storage")).toBe("error");
    expect(tone(checks, "mfa")).toBe("warning");
    expect(tone(checks, "sla")).toBe("warning");
    expect(tone(checks, "imap")).toBe("error");
  });

  it("degrades a source that failed to load instead of guessing", () => {
    const checks = buildChecks(overview, { integrations: null, auth: null, sla: null, mailboxes: null });
    expect(tone(checks, "smtp")).toBe("neutral");
    expect(tone(checks, "mfa")).toBe("neutral");
    expect(checks.find((c) => c.id === "storage")).toBeUndefined();
  });

  it("ignores disabled SLA policies when looking for a default", () => {
    const checks = buildChecks(overview, { ...ready, sla: [{ ...ready.sla![0], enabled: false }] });
    expect(tone(checks, "sla")).toBe("warning");
  });
});
