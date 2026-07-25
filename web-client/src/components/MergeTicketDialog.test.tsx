// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import MergeTicketDialog from "./MergeTicketDialog";
import * as api from "../api/client";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string, message: string) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
  searchTickets: vi.fn(),
  mergePreview: vi.fn(),
  mergeTicket: vi.fn(),
}));

const source = { id: 1, ticketNumber: "10482", title: "Duplicate printer issue" };
const target = { id: 2, ticketNumber: "10479", title: "Printer issue" };
const moves = {
  notes: 3,
  attachments: 1,
  checklistItems: 2,
  children: 0,
  labels: 1,
  deviceLinks: 1,
};

function renderDialog() {
  return render(
    <ThemeProvider theme={buildTheme("default-light")}>
      <MergeTicketDialog open source={source} onClose={() => {}} onMerged={() => {}} />
    </ThemeProvider>
  );
}

async function chooseTarget() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Surviving ticket"), "10479");
  await user.click(await screen.findByRole("option", { name: /#10479 · Printer issue/ }));
  await screen.findByText("Move from #10482 to #10479");
  return user;
}

describe("MergeTicketDialog acknowledgement gate", () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    vi.mocked(api.searchTickets).mockResolvedValue([target]);
    vi.mocked(api.mergeTicket).mockResolvedValue({
      parentId: null,
      mergedIntoId: target.id,
      mergedAt: "2026-07-25T12:00:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // 15s rather than the 5s default: this drives a full MUI Autocomplete search,
  // an async preview fetch, and two checkbox interactions through jsdom, which
  // lands just over the default limit on a cold run. The assertions are the
  // point — the gate must hold until every warning is ticked — so the budget is
  // raised rather than the interaction thinned out.
  it("keeps Merge disabled until every warning code is acknowledged", async () => {
    vi.mocked(api.mergePreview).mockResolvedValue({
      source,
      target,
      moves,
      warnings: [
        {
          code: "sync-stop",
          message: "HELP-1 stays open in Jira. AnchorDesk will stop syncing it. The remote issue is not closed, commented on, or linked by this merge.",
        },
        {
          code: "cross-company",
          message: "These tickets belong to different companies.",
        },
      ],
      blockers: [],
    });
    renderDialog();
    const user = await chooseTarget();
    const merge = screen.getByRole("button", { name: "Merge" });

    expect((merge as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Acknowledge sync-stop" }));
    expect((merge as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Acknowledge cross-company" }));

    await waitFor(() => expect((merge as HTMLButtonElement).disabled).toBe(false));
  }, 15000);

  // Consent is given for a specific target's warning text, not for a code in the
  // abstract: "these tickets belong to different companies" names the companies.
  // Carrying a tick over to a newly chosen target would let someone merge past a
  // sentence they never read.
  it("clears acknowledgements when the surviving ticket is changed", async () => {
    const other = { id: 3, ticketNumber: "10477", title: "Scanner issue" };
    vi.mocked(api.searchTickets).mockResolvedValue([target, other]);
    vi.mocked(api.mergePreview).mockResolvedValue({
      source,
      target,
      moves,
      warnings: [{ code: "cross-company", message: "These tickets belong to different companies." }],
      blockers: [],
    });
    renderDialog();
    const user = await chooseTarget();
    const merge = screen.getByRole("button", { name: "Merge" });

    await user.click(screen.getByRole("checkbox", { name: "Acknowledge cross-company" }));
    await waitFor(() => expect((merge as HTMLButtonElement).disabled).toBe(false));

    // Switch to a different survivor; the same warning code applies to it too.
    vi.mocked(api.mergePreview).mockResolvedValue({
      source,
      target: other,
      moves,
      warnings: [{ code: "cross-company", message: "These tickets belong to different companies." }],
      blockers: [],
    });
    await user.clear(screen.getByLabelText("Surviving ticket"));
    await user.type(screen.getByLabelText("Surviving ticket"), "10477");
    await user.click(await screen.findByRole("option", { name: /#10477 · Scanner issue/ }));

    await waitFor(() =>
      expect((screen.getByRole("checkbox", { name: "Acknowledge cross-company" }) as HTMLInputElement).checked).toBe(false)
    );
    expect((screen.getByRole("button", { name: "Merge" }) as HTMLButtonElement).disabled).toBe(true);
  }, 20000);

  it("keeps Merge disabled when the preview contains a blocker", async () => {
    vi.mocked(api.mergePreview).mockResolvedValue({
      source,
      target,
      moves,
      warnings: [],
      blockers: [{ code: "sync-conflict", message: "Resolve the source ticket sync conflict first." }],
    });
    renderDialog();
    await chooseTarget();

    expect(screen.getByText("Resolve the source ticket sync conflict first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Merge" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
