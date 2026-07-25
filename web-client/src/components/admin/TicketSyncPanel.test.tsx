// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import TicketSyncPanel, {
  ConnectionEditorDialog,
  JobEditorDialog,
  isJiraConnectionReady,
  isLegacyConnectwiseConfigured,
} from "./TicketSyncPanel";
import type { Connection, IntegrationsView, SyncProvider, SyncRunResult } from "../../api/client";

const api = vi.hoisted(() => ({
  listConnections: vi.fn(),
  listSyncProviders: vi.fn(),
  getSyncLog: vi.fn(),
  getIntegrations: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  testConnection: vi.fn(),
  updateIntegration: vi.fn(),
  createSyncProvider: vi.fn(),
  updateSyncProvider: vi.fn(),
  deleteSyncProvider: vi.fn(),
  runSync: vi.fn(),
  listSyncRuns: vi.fn(),
  getSyncRun: vi.fn(),
}));

vi.mock("../../api/client", () => api);

const readyConnection: Connection = {
  id: 7,
  name: "Acme Jira",
  type: "jira",
  enabled: true,
  config: {
    baseUrl: "https://acme.atlassian.net",
    email: "sync@acme.example",
    hasApiToken: true,
  },
  lastTestAt: "2026-07-25T12:00:00.000Z",
  lastTestOk: true,
  lastTestMessage: "Connected as Sync Bot. 2 projects visible.",
  configured: true,
};

const filteredJob: SyncProvider = {
  id: 11,
  name: "Acme helpdesk",
  type: "jira",
  enabled: true,
  lastSyncedAt: "2026-07-25T12:30:00.000Z",
  configRevision: 1,
  connectionId: readyConnection.id,
  health: {
    status: "healthy",
    lastAttemptAt: "2026-07-25T12:30:00.000Z",
    lastSuccessAt: "2026-07-25T12:30:00.000Z",
    consecutiveFailures: 0,
    latestError: null,
    latestRun: null,
  },
  config: { projectKey: "HELP", filter: { status: ["New"] } },
};

const emptyIntegrations: IntegrationsView = {
  smtp: {},
  connectwise: {},
  jira: {},
  tactical: {},
  ninjaone: {},
  datto: {},
  storage: { backend: "local" },
  tickets: {},
};

function installMatchMedia() {
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
}

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={buildTheme("default-light")}>{ui}</ThemeProvider>);
}

async function renderPanel({
  connections = [readyConnection],
  jobs = [filteredJob],
  connectwise = {},
}: {
  connections?: Connection[];
  jobs?: SyncProvider[];
  connectwise?: IntegrationsView["connectwise"];
} = {}) {
  api.listConnections.mockResolvedValue(connections);
  api.listSyncProviders.mockResolvedValue(jobs);
  api.getSyncLog.mockResolvedValue([]);
  api.getIntegrations.mockResolvedValue({ ...emptyIntegrations, connectwise });
  renderInTheme(<TicketSyncPanel />);
  await screen.findByText("Connections");
  await screen.findByText("Sync jobs");
}

beforeEach(() => {
  installMatchMedia();
  vi.clearAllMocks();
  api.listConnections.mockResolvedValue([]);
  api.listSyncProviders.mockResolvedValue([]);
  api.getSyncLog.mockResolvedValue([]);
  api.getIntegrations.mockResolvedValue(emptyIntegrations);
  api.listSyncRuns.mockResolvedValue([]);
});

afterEach(cleanup);

describe("connection readiness", () => {
  it("requires Jira to be enabled, complete, and successfully tested", () => {
    expect(isJiraConnectionReady(readyConnection)).toBe(true);
    expect(isJiraConnectionReady({ ...readyConnection, lastTestOk: false })).toBe(false);
    expect(isJiraConnectionReady({ ...readyConnection, configured: false })).toBe(false);
    expect(isJiraConnectionReady({ ...readyConnection, enabled: false })).toBe(false);
  });

  it("requires every legacy ConnectWise credential field", () => {
    expect(isLegacyConnectwiseConfigured({
      server: "na.myconnectwise.net",
      company: "acme",
      publicKey: "public",
      hasPrivateKey: true,
      hasClientId: true,
    })).toBe(true);
    expect(isLegacyConnectwiseConfigured({ server: "na.myconnectwise.net" })).toBe(false);
  });
});

describe("Jira save and test", () => {
  it("keeps the site URL editable while creating a connection", () => {
    renderInTheme(<ConnectionEditorDialog connection={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const siteUrl = screen.getByLabelText(/Site URL/) as HTMLInputElement;
    expect(siteUrl.disabled).toBe(false);
    expect(screen.getByText(/fixed Jira tenant after it is saved/i)).not.toBeNull();
  });

  it("locks the tenant URL when editing an existing connection", () => {
    renderInTheme(<ConnectionEditorDialog connection={readyConnection} onClose={vi.fn()} onSaved={vi.fn()} />);

    const siteUrl = screen.getByLabelText(/Site URL/) as HTMLInputElement;
    expect(siteUrl.disabled).toBe(true);
    expect(siteUrl.value).toBe("https://acme.atlassian.net");
    expect(screen.getByText(/Create a new connection to use a different site/i)).not.toBeNull();
  });

  it("keeps the editor open with the actionable test failure", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const saved = { ...readyConnection, lastTestAt: null, lastTestOk: null, lastTestMessage: null };
    api.createConnection.mockResolvedValue(saved);
    api.updateConnection.mockResolvedValue(saved);
    api.testConnection.mockResolvedValueOnce({
      ok: false,
      category: "auth",
      message: "Authentication rejected — check the account email and API token.",
      testedAt: "2026-07-25T13:00:00.000Z",
    }).mockResolvedValueOnce({
      ok: true,
      category: "ok",
      identity: "Sync Bot",
      message: "Connected as Sync Bot. 2 projects visible.",
      testedAt: "2026-07-25T13:02:00.000Z",
    });

    renderInTheme(<ConnectionEditorDialog connection={null} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/Connection name/), { target: { value: "Acme Jira" } });
    fireEvent.change(screen.getByLabelText(/Site URL/), { target: { value: "https://acme.atlassian.net" } });
    fireEvent.change(screen.getByLabelText(/Account email/), { target: { value: "sync@acme.example" } });
    fireEvent.change(screen.getByLabelText(/API token/), { target: { value: "secret-token" } });
    await user.click(screen.getByRole("button", { name: "Save and test" }));

    await screen.findByText(/check the account email and API token/i);
    expect(screen.getByRole("heading", { name: "Add Jira connection" })).not.toBeNull();
    expect((screen.getByLabelText(/Site URL/) as HTMLInputElement).disabled).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.testConnection).toHaveBeenCalledWith(saved.id);

    fireEvent.change(screen.getByLabelText(/API token/), { target: { value: "corrected-token" } });
    await user.click(screen.getByRole("button", { name: "Save and test" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.updateConnection).toHaveBeenCalledWith(
      saved.id,
      expect.objectContaining({ config: expect.objectContaining({ apiToken: "corrected-token" }) })
    );
  });

  it("finishes the flow after a successful test", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    api.createConnection.mockResolvedValue(readyConnection);
    api.testConnection.mockResolvedValue({
      ok: true,
      category: "ok",
      identity: "Sync Bot",
      message: "Connected as Sync Bot. 2 projects visible.",
      testedAt: "2026-07-25T13:00:00.000Z",
    });

    renderInTheme(<ConnectionEditorDialog connection={null} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/Connection name/), { target: { value: "Acme Jira" } });
    fireEvent.change(screen.getByLabelText(/Site URL/), { target: { value: "https://acme.atlassian.net" } });
    fireEvent.change(screen.getByLabelText(/Account email/), { target: { value: "sync@acme.example" } });
    fireEvent.change(screen.getByLabelText(/API token/), { target: { value: "secret-token" } });
    await user.click(screen.getByRole("button", { name: "Save and test" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});

describe("guided setup and job actions", () => {
  it("leaves the generic Jira job connection blank until the admin chooses one", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Create sync job" }));

    expect(screen.getByText(/AnchorDesk never selects an account implicitly/i)).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /Job name/ }), { target: { value: "Explicit Jira job" } });
    expect((screen.getByRole("button", { name: "Create job" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("seeds Jira only from the connection-specific create action", async () => {
    const user = userEvent.setup();
    await renderPanel();

    await user.click(screen.getByRole("button", { name: "Create sync job with this connection" }));

    expect(screen.queryByText(/AnchorDesk never selects an account implicitly/i)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Connection" }).textContent).toContain(readyConnection.name);
  });

  it("does not add an implicit fallback inside the Jira job dialog", () => {
    renderInTheme(
      <JobEditorDialog
        job={null}
        initialType="jira"
        connections={[readyConnection]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText(/AnchorDesk never selects an account implicitly/i)).not.toBeNull();
  });

  it("requires an explicit ConnectWise board instead of an adapter default", () => {
    renderInTheme(
      <JobEditorDialog
        job={null}
        initialType="connectwise"
        connections={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Job name/ }), {
      target: { value: "ConnectWise support" },
    });
    const create = screen.getByRole("button", { name: "Create job" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByText(/never substitutes a hidden default/i)).not.toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: /Board name/ }), {
      target: { value: "Service Desk" },
    });
    expect(create.disabled).toBe(false);
  });

  it("does not offer job creation for a failed Jira connection or incomplete ConnectWise settings", async () => {
    await renderPanel({
      connections: [{ ...readyConnection, lastTestOk: false }],
      jobs: [],
      connectwise: { server: "na.myconnectwise.net" },
    });

    expect(screen.queryByRole("button", { name: "Create sync job" })).toBeNull();
    expect(screen.getByText(/must pass Test before it can create a job/i)).not.toBeNull();
    expect(screen.getByText("Incomplete")).not.toBeNull();
  });

  it("surfaces a connection-test request failure on its connection card", async () => {
    const user = userEvent.setup();
    api.testConnection.mockRejectedValue(new Error("Connection test service unavailable"));
    await renderPanel();

    await user.click(screen.getByRole("button", { name: `Test Jira connection ${readyConnection.name}` }));

    await screen.findByText("Connection test service unavailable");
  });

  it("shows the returned counts and record errors for an individual run", async () => {
    const user = userEvent.setup();
    const result: SyncRunResult = {
      runId: 91,
      providerId: filteredJob.id,
      providerName: filteredJob.name,
      status: "degraded",
      ticketsCreated: 3,
      ticketsUpdated: 2,
      notesUpserted: 5,
      ticketsFiltered: 4,
      ticketsSkipped: 1,
      ticketsConflicted: 1,
      errorCount: 1,
      errors: ["Ticket HELP-9: conflict held"],
      durationMs: 321,
    };
    api.runSync.mockResolvedValue(result);
    await renderPanel();

    await user.click(screen.getByRole("button", { name: `Run sync job ${filteredJob.name}` }));

    await screen.findByText(/3 created, 2 updated/i);
    expect(screen.getByText(/4 filtered locally/i)).not.toBeNull();
    expect(screen.getByText("Ticket HELP-9: conflict held")).not.toBeNull();
  });

  it("requires acknowledgement before the first unfiltered run", async () => {
    const user = userEvent.setup();
    const unfiltered = {
      ...filteredJob,
      config: {},
      lastSyncedAt: null,
      health: {
        status: "never_run" as const,
        lastAttemptAt: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        latestError: null,
        latestRun: null,
      },
    };
    api.runSync.mockResolvedValue({
      runId: 92,
      providerId: unfiltered.id,
      providerName: unfiltered.name,
      status: "success",
      ticketsCreated: 0,
      ticketsUpdated: 0,
      notesUpserted: 0,
      ticketsFiltered: 0,
      ticketsSkipped: 0,
      ticketsConflicted: 0,
      errorCount: 0,
      errors: [],
      durationMs: 10,
    });
    await renderPanel({ jobs: [unfiltered] });

    await user.click(screen.getByRole("button", { name: `Run sync job ${unfiltered.name}` }));
    expect(api.runSync).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: `Run unfiltered job "${unfiltered.name}"?` })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Run unfiltered job" }));
    await waitFor(() => expect(api.runSync).toHaveBeenCalledWith(unfiltered.name));
  });

  it("shows durable failing health and opens run history", async () => {
    const user = userEvent.setup();
    const failing = {
      ...filteredJob,
      health: {
        status: "failing" as const,
        lastAttemptAt: "2026-07-25T14:00:00.000Z",
        lastSuccessAt: null,
        consecutiveFailures: 3,
        latestError: "Authentication rejected",
        latestRun: null,
      },
    };
    await renderPanel({ jobs: [failing] });

    expect(screen.getByText("Failed")).not.toBeNull();
    expect(screen.getByText("Authentication rejected")).not.toBeNull();
    expect(screen.getByText(/3 consecutive failures/i)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: `View run history for ${failing.name}` }));
    expect(screen.getByRole("heading", { name: `${failing.name} — run history` })).not.toBeNull();
    await waitFor(() => expect(api.listSyncRuns).toHaveBeenCalledWith({ provider: failing.name, limit: 50 }));
  });

  it("surfaces enable and delete failures without pretending the action succeeded", async () => {
    const user = userEvent.setup();
    const disabled = { ...filteredJob, enabled: false };
    api.updateSyncProvider.mockRejectedValue(new Error("Connection is disabled"));
    api.deleteSyncProvider.mockRejectedValue(new Error("Delete was rejected"));
    await renderPanel({ jobs: [disabled] });

    await user.click(screen.getByRole("switch", { name: "Disabled" }));
    await screen.findByText("Connection is disabled");

    await user.click(screen.getByRole("button", { name: `Delete sync job ${disabled.name}` }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Delete was rejected");
    expect(screen.getByRole("heading", { name: `Delete sync job "${disabled.name}"?` })).not.toBeNull();
  });
});
