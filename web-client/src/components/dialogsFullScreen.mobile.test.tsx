// @vitest-environment jsdom
//
// Mobile guard (docs/mobile.md): the core dialogs must render full-screen at
// phone widths. This is the cheapest regression that would break the phone
// experience hardest, so it runs in CI even though the full verification is
// the screenshot matrix (docs/scripts/capture-mobile-media.mjs).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import CreateTicketDialog from "./CreateTicketDialog";
import RunScriptDialog from "./RunScriptDialog";
import FilterDialog from "./FilterDialog";
import TicketDialog from "./TicketDialog";
import MergeTicketDialog from "./MergeTicketDialog";
import { ConnectionEditorDialog, JobEditorDialog } from "./admin/TicketSyncPanel";
import SyncRunHistoryDialog from "./admin/SyncRunHistoryDialog";
import type { Ticket } from "../interfaces";

vi.mock("../api/client", () => ({
  listAssignees: () => Promise.resolve([]),
  listCompanies: () => Promise.resolve([]),
  listTeams: () => Promise.resolve([]),
  listCustomFields: () => Promise.resolve([]),
  listLabels: () => Promise.resolve([]),
  getCompany: () => Promise.resolve({ contacts: [] }),
  createCompany: () => Promise.resolve(null),
  createTicket: () => Promise.resolve({}),
  listScripts: () => Promise.resolve([]),
  runScript: () => Promise.resolve({}),
  getScriptJob: () => Promise.resolve({}),
  listSyncRuns: () => Promise.resolve([]),
  getSyncRun: () => Promise.resolve({}),
  searchTickets: () => Promise.resolve([]),
  mergePreview: () => Promise.resolve({}),
  mergeTicket: () => Promise.resolve({}),
  unmergeTicket: () => Promise.resolve({}),
  setTicketParent: () => Promise.resolve({}),
}));

// MUI's useMediaQuery reads window.matchMedia. breakpoints.down("sm") compiles
// to "(max-width:599.95px)", so flipping `phone` swaps the emulated viewport.
let phone = true;
function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: phone ? query.includes("max-width:599.95px") : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={buildTheme("default-light")}>{ui}</ThemeProvider>);
}

const noop = () => {};
const ticket: Ticket = {
  ticketnumber: "10482",
  ticketTitle: "Mobile ticket cockpit",
  ticketSummary: "Verify the primary ticket dialog contract.",
  status: "New",
  priority: "Medium",
  company: { CompanyName: "ACME", Acronym: "ACME", PrimaryEngagementMgr: "" },
  technician: null,
  timeEntries: [],
  dateEntered: "2026-07-15T12:00:00.000Z",
};

describe("dialogs at phone width", () => {
  beforeEach(() => {
    phone = true;
    installMatchMedia();
  });
  afterEach(cleanup);

  it("CreateTicketDialog renders full-screen", () => {
    renderInTheme(<CreateTicketDialog open onClose={noop} onCreated={noop} />);
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("RunScriptDialog renders full-screen", () => {
    renderInTheme(
      <RunScriptDialog open onClose={noop} deviceId={1} deviceName="dev" deviceSource="tactical_rmm" />
    );
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("FilterDialog renders full-screen", () => {
    renderInTheme(<FilterDialog open onClose={noop} value={{}} applyFilters={noop} />);
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("TicketDialog renders full-screen", () => {
    renderInTheme(
      <TicketDialog
        open
        ticket={ticket}
        notes={[]}
        currentUser={{ canWrite: false }}
        onClose={noop}
      />
    );
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("MergeTicketDialog renders full-screen", () => {
    renderInTheme(
      <MergeTicketDialog
        open
        source={{ id: 1, ticketNumber: "10482", title: "Mobile ticket cockpit" }}
        onClose={noop}
        onMerged={noop}
      />
    );
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  // Admin → Ticket sync (docs/sow-sync-ux.md) — the connection and sync-job
  // editors are the two dialogs a fresh admin must complete to reach a working
  // sync, so they carry the same full-screen guarantee as the ticket dialogs.
  it("TicketSyncPanel's ConnectionEditorDialog renders full-screen", () => {
    renderInTheme(<ConnectionEditorDialog connection={null} onClose={noop} onSaved={noop} />);
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("TicketSyncPanel's JobEditorDialog renders full-screen", () => {
    renderInTheme(<JobEditorDialog job={null} connections={[]} onClose={noop} onSaved={noop} />);
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("Ticket sync run history renders full-screen", () => {
    renderInTheme(
      <SyncRunHistoryDialog
        open
        onClose={noop}
        job={{
          id: 1,
          name: "Contoso Jira",
          type: "jira",
          enabled: true,
          lastSyncedAt: null,
          configRevision: 1,
          connectionId: 1,
          config: {},
          health: {
            status: "never_run",
            lastAttemptAt: null,
            lastSuccessAt: null,
            consecutiveFailures: 0,
            latestError: null,
            latestRun: null,
          },
        }}
      />
    );
    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("stays windowed on desktop widths (control)", () => {
    phone = false;
    installMatchMedia();
    renderInTheme(<CreateTicketDialog open onClose={noop} onCreated={noop} />);
    expect(document.querySelector(".MuiDialog-paper")).not.toBeNull();
    expect(document.querySelector(".MuiDialog-paperFullScreen")).toBeNull();
  });
});
