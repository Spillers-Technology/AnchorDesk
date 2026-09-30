// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import CreateTicketDialog from "./CreateTicketDialog";

const api = vi.hoisted(() => ({
  listAssignees: vi.fn(() => Promise.resolve([])),
  listCompanies: vi.fn(() => Promise.resolve([])),
  listTeams: vi.fn(() => Promise.resolve([])),
  listCustomFields: vi.fn(() => Promise.resolve([])),
  getCompany: vi.fn(() => Promise.resolve({ contacts: [] })),
  createCompany: vi.fn(() => Promise.resolve(null)),
  listSyncDestinations: vi.fn(),
  createTicket: vi.fn(),
  sendTicketToPsa: vi.fn(),
}));
vi.mock("../api/client", () => api);

function open(onClose = vi.fn(), onCreated = vi.fn()) {
  render(
    <ThemeProvider theme={buildTheme("default-light")}>
      <CreateTicketDialog open onClose={onClose} onCreated={onCreated} />
    </ThemeProvider>,
  );
  return { onClose, onCreated };
}

async function chooseJira() {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: "Sync to external PSA" }));
  fireEvent.click(await screen.findByRole("option", { name: /Jira · project HELP/ }));
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
  api.listSyncDestinations.mockResolvedValue([
    { jobId: 7, name: "Helpdesk", type: "jira", target: "Jira · project HELP", blocker: null },
    { jobId: 8, name: "Contoso JQL", type: "jira", target: "Jira", blocker: "set a project key on this job to create issues from AnchorDesk" },
  ]);
  api.createTicket.mockResolvedValue({ id: 41, ticketNumber: "10041" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("New ticket → Sync to external PSA", () => {
  it("defaults to AnchorDesk only and shows why a destination can't be used", async () => {
    open();
    const select = await screen.findByRole("combobox", { name: "Sync to external PSA" });
    expect(select.textContent).toContain("AnchorDesk only");
    fireEvent.mouseDown(select);
    const blocked = await screen.findByRole("option", { name: /Contoso JQL|set a project key/ });
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
  });

  it("creates the ticket, then creates it in the PSA", async () => {
    api.sendTicketToPsa.mockResolvedValue({ ticketId: 41, externalId: "HELP-9", provider: "jira", jobName: "Helpdesk", warnings: [] });
    const { onClose } = open();
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Printer on fire" } });
    await chooseJira();
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    await waitFor(() => expect(api.sendTicketToPsa).toHaveBeenCalledWith(41, 7));
    expect(api.createTicket.mock.invocationCallOrder[0]).toBeLessThan(api.sendTicketToPsa.mock.invocationCallOrder[0]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the local ticket and says so when the PSA refuses it", async () => {
    api.sendTicketToPsa.mockRejectedValue(new Error("Helpdesk: Jira project HELP has no issue type \"Task\""));
    const { onClose, onCreated } = open();
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Printer on fire" } });
    await chooseJira();
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    const warning = await screen.findByText(/was created in AnchorDesk, but the PSA refused it/);
    expect(within(warning).getByText("Send to PSA")).toBeTruthy();
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
