// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import SyncScopeBar from "./SyncScopeBar";

const api = vi.hoisted(() => ({
  getTicketSyncScope: vi.fn(),
  listSyncDestinations: vi.fn(),
  requestSyncBypass: vi.fn(),
  decideSyncBypass: vi.fn(),
  removeSyncBypass: vi.fn(),
  sendTicketToPsa: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { role: "technician" } as { role: string } }));
vi.mock("../api/client", () => api);
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));

const detachedScope = {
  job: { id: 7, name: "Joe's queue", type: "jira" },
  detached: true,
  detachReason: "it's assigned to “Bob Smith”; this job only syncs Joe Tran",
  detachedAt: "2026-09-29T10:00:00Z",
  pinned: false,
  requests: [] as unknown[],
};

function renderBar(ticket: Record<string, unknown>, onChanged = vi.fn()) {
  render(
    <ThemeProvider theme={buildTheme("default-light")}>
      <SyncScopeBar ticketId={5} ticket={ticket} canMutate onChanged={onChanged} />
    </ThemeProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  auth.user = { role: "technician" };
  api.getTicketSyncScope.mockResolvedValue(detachedScope);
  api.listSyncDestinations.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SyncScopeBar", () => {
  const detached = { externalId: "HELP-3", externalProvider: "jira", syncState: "detached" };

  it("says sync stopped, which job, and why", async () => {
    renderBar(detached);
    expect(await screen.findByText("Sync with Jira stopped")).toBeTruthy();
    expect(screen.getByText("Joe's queue")).toBeTruthy();
    expect(screen.getByText(/this job only syncs Joe Tran/)).toBeTruthy();
  });

  it("lets a technician request a bypass with a reason", async () => {
    api.requestSyncBypass.mockResolvedValue({ id: 1 });
    const onChanged = renderBar(detached);
    fireEvent.click(await screen.findByRole("button", { name: "Request bypass" }));
    const dialog = await screen.findByRole("dialog");
    const send = within(dialog).getByRole("button", { name: "Send request" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Why should it keep syncing?"), { target: { value: "Temporary cover" } });
    fireEvent.click(send);
    await waitFor(() => expect(api.requestSyncBypass).toHaveBeenCalledWith(5, "Temporary cover"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows a pending request and lets an admin approve it inline", async () => {
    auth.user = { role: "admin" };
    api.getTicketSyncScope.mockResolvedValue({
      ...detachedScope,
      requests: [{ id: 9, status: "pending", reason: "VIP", requestedBy: "priya", requestedAt: "2026-09-29T11:00:00Z" }],
    });
    api.decideSyncBypass.mockResolvedValue({});
    renderBar(detached);
    expect(await screen.findByText(/waiting for an admin/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.decideSyncBypass).toHaveBeenCalledWith(9, "approve"));
  });

  it("offers a pinned ticket's bypass removal to admins only", async () => {
    api.getTicketSyncScope.mockResolvedValue({ ...detachedScope, detached: false, pinned: true });
    renderBar({ externalId: "HELP-3", externalProvider: "jira", syncState: "synced", syncScopePinned: true });
    expect(await screen.findByText(/keeps syncing with Jira even outside/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove bypass" })).toBeNull();
  });

  it("offers a local ticket to the PSA and reports what came back", async () => {
    api.listSyncDestinations.mockResolvedValue([{ jobId: 7, name: "Helpdesk", type: "jira", target: "Jira · project HELP", blocker: null }]);
    api.sendTicketToPsa.mockResolvedValue({ ticketId: 5, externalId: "HELP-12", provider: "jira", jobName: "Helpdesk", warnings: [] });
    renderBar({ externalId: null, externalProvider: null, syncState: null });
    fireEvent.click(await screen.findByRole("button", { name: /Send to Jira · project HELP/ }));
    await waitFor(() => expect(api.sendTicketToPsa).toHaveBeenCalledWith(5, 7));
    expect(await screen.findByText("HELP-12")).toBeTruthy();
  });

  it("treats an email ticket as local, so it can be sent", async () => {
    api.listSyncDestinations.mockResolvedValue([{ jobId: 7, name: "Helpdesk", type: "jira", target: "Jira · project HELP", blocker: null }]);
    renderBar({ externalId: "<abc@mail>", externalProvider: "imap", syncState: null });
    expect(await screen.findByText(/Local only/)).toBeTruthy();
  });
});
