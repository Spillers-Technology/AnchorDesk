// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { buildTheme } from "../theme";
import AdminView from "./AdminView";

const api = vi.hoisted(() => ({
  ApiError: class ApiError extends Error { body = ""; },
  getAdminOverview: vi.fn(),
  getIntegrations: vi.fn(),
  getAuthSettings: vi.fn(),
  listSlaPolicies: vi.fn(),
  listMailboxes: vi.fn(),
  listUsers: vi.fn(),
  deleteUser: vi.fn(),
  setUserPassword: vi.fn(),
  updateUser: vi.fn(),
  createUser: vi.fn(),
}));
vi.mock("../api/client", () => api);
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ canWrite: true, isAdmin: true }) }));

const users = [
  { id: 1, username: "root", displayName: "Root Admin", email: null, role: "admin", authProvider: "local", themePref: null, kanbanColumns: null, isActive: true, hasPassword: true, mfaEnabled: true, lastSeenAt: null, createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, username: "jess", displayName: "Jess Tran", email: "jess@example.com", role: "technician", authProvider: "local", themePref: null, kanbanColumns: null, isActive: true, hasPassword: true, mfaEnabled: false, lastSeenAt: null, createdAt: "2026-01-01T00:00:00Z" },
];

function renderAdmin(section?: string) {
  return render(
    <MemoryRouter initialEntries={[section ? `/?admin=${section}` : "/?admin"]}>
      <ThemeProvider theme={buildTheme("default-dark")}>
        <AdminView />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getAdminOverview.mockResolvedValue({
    tickets: { open: 3, total: 9 },
    devices: { total: 4, online: 3 },
    probes: { total: 0, online: 0 },
    users: 2,
    mailboxes: 1,
    recentAudit: [{ id: "1", entityType: "ticket", entityId: 101, action: "update", changedBy: "jess", oldValue: {}, newValue: {}, occurredAt: new Date().toISOString() }],
  });
  api.getIntegrations.mockResolvedValue({ smtp: { host: "smtp.example.com", port: 587 }, connectwise: {}, jira: {}, tactical: {}, ninjaone: {}, datto: {}, storage: { backend: "local" }, tickets: {} });
  api.getAuthSettings.mockResolvedValue({
    localEnabled: true,
    oidc: { enabled: false, issuerUrl: null, clientId: null, redirectUri: "https://desk/cb", hasClientSecret: false },
    saml: { enabled: false, entryPoint: null, issuer: null, callbackUrl: "https://desk/saml", hasIdpCert: false },
    mfa: { required: false, issuer: "AnchorDesk" },
  });
  api.listSlaPolicies.mockResolvedValue([{ id: 1, name: "Default", priority: null, companyId: null, responseMinutes: 240, resolutionMinutes: 4320, enabled: true }]);
  api.listMailboxes.mockResolvedValue([]);
  api.listUsers.mockResolvedValue(users);
  api.deleteUser.mockResolvedValue(undefined);
  api.setUserPassword.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminView", () => {
  it("opens on an overview that scores setup from real settings and links each gap to its fix", async () => {
    renderAdmin();
    expect(await screen.findByText("Open tickets")).toBeTruthy();
    // SMTP, SLA default and storage are fine; no mailbox and optional MFA are not.
    expect(await screen.findByText("3/5")).toBeTruthy();
    expect(screen.getByText("2 need attention")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Require MFA: Multi-factor sign-in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add mailbox: Inbound email" })).toBeTruthy();
  });

  it("finds a section by keyword from the phone switcher", async () => {
    renderAdmin();
    await screen.findByText("Open tickets");
    fireEvent.click(screen.getByRole("button", { name: "Choose admin section" }));
    const find = await screen.findByRole("textbox", { name: "Find a setting" });
    fireEvent.change(find, { target: { value: "sso" } });
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByText("Authentication")).toBeTruthy();
    expect(within(nav).queryByText("Labels")).toBeNull();
    fireEvent.keyDown(find, { key: "Enter" });
    // The sheet closes on pick; the page stays aria-hidden until its exit transition ends.
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Find a setting" })).toBeNull(), { timeout: 4000 });
    expect(await screen.findByRole("heading", { name: "Authentication" })).toBeTruthy();
  });

  it("asks before deleting a user, and protects the last admin", async () => {
    renderAdmin("users");
    await screen.findByText("Jess Tran");
    expect((screen.getByRole("button", { name: "Delete Root Admin" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Delete Jess Tran" }));
    expect(api.deleteUser).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteUser).toHaveBeenCalledWith(2));
  });

  it("resets a password through a confirmed dialog instead of a browser prompt", async () => {
    renderAdmin("users");
    await screen.findByText("Jess Tran");
    fireEvent.click(screen.getByRole("button", { name: "Reset password for Jess Tran" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Reset password" }) as HTMLButtonElement;
    fireEvent.change(within(dialog).getByLabelText("New password"), { target: { value: "correct-horse-1" } });
    fireEvent.change(within(dialog).getByLabelText("Confirm password"), { target: { value: "correct-horse-2" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Confirm password"), { target: { value: "correct-horse-1" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api.setUserPassword).toHaveBeenCalledWith(2, "correct-horse-1"));
  });
});
