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

  it("stays windowed on desktop widths (control)", () => {
    phone = false;
    installMatchMedia();
    renderInTheme(<CreateTicketDialog open onClose={noop} onCreated={noop} />);
    expect(document.querySelector(".MuiDialog-paper")).not.toBeNull();
    expect(document.querySelector(".MuiDialog-paperFullScreen")).toBeNull();
  });
});
