// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import ReportsView from "./ReportsView";

const api = vi.hoisted(() => ({
  listCompanies: vi.fn(),
  listTeams: vi.fn(),
  listAssignees: vi.fn(),
  getVolumeReport: vi.fn(),
  getDurationReport: vi.fn(),
  getSlaComplianceReport: vi.fn(),
  getBacklogAgeReport: vi.fn(),
  getTeamThroughputReport: vi.fn(),
  getFeedbackReport: vi.fn(),
  getAssigneeThroughputReport: vi.fn(),
  getTimeByCompanyReport: vi.fn(),
  downloadTimeByCompanyCsv: vi.fn(),
}));
const auth = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("../api/client", () => api);
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => auth,
}));

const meta = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-08T00:00:00.000Z",
  includesReconstructed: false,
  reconstructedFrom: null,
  reconstructedThrough: null,
};
const feedbackMeta = {
  ...meta,
  includesReconstructed: false,
  reconstructedFrom: null,
  reconstructedThrough: null,
};

function installPopulatedReports() {
  api.getVolumeReport.mockResolvedValue({
    data: [{ day: "2026-07-01", created: 7, resolved: 5 }],
    meta,
  });
  api.getDurationReport.mockResolvedValue({
    data: {
      firstResponse: { count: 5, p50Minutes: 24, p90Minutes: 80 },
      resolution: { count: 4, p50Minutes: 480, p90Minutes: 1440 },
    },
    meta,
  });
  api.getSlaComplianceReport.mockResolvedValue({
    data: [
      { kind: "response", met: 4, onTrack: 1, atRisk: 1, breached: 1 },
      { kind: "resolution", met: 3, onTrack: 1, atRisk: 0, breached: 1 },
    ],
    meta: {
      ...meta,
      slaSnapshotCoverageFrom: "2026-06-01T00:00:00.000Z",
      includesUnrecordedSlaHistory: false,
    },
  });
  api.getBacklogAgeReport.mockResolvedValue({
    data: [
      { bucket: "<1d", count: 2 },
      { bucket: "1-3d", count: 3 },
      { bucket: "3-7d", count: 1 },
      { bucket: "7-30d", count: 1 },
      { bucket: "30d+", count: 1 },
    ],
    meta,
  });
  api.getTeamThroughputReport.mockResolvedValue({
    data: [{ teamId: 2, teamName: "Service desk", resolved: 5 }],
    meta,
  });
  api.getFeedbackReport.mockResolvedValue({
    data: [{ companyId: 7, companyName: "Acme", positive: 6, neutral: 1, negative: 2 }],
    meta: feedbackMeta,
  });
  api.getAssigneeThroughputReport.mockResolvedValue({
    data: [{ assigneeId: 9, assigneeName: "Priya", resolved: 4 }],
    meta,
  });
  api.getTimeByCompanyReport.mockResolvedValue({
    data: [{ companyId: 7, companyName: "Acme", minutes: 315 }],
    meta,
  });
}

function renderReports() {
  return render(
    <ThemeProvider theme={buildTheme("default-light")}>
      <ReportsView />
    </ThemeProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.isAdmin = true;
  api.listCompanies.mockResolvedValue([
    {
      id: 7,
      name: "Acme",
      domain: null,
      phone: null,
      email: null,
      website: null,
      address: null,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  api.listTeams.mockResolvedValue([]);
  api.listAssignees.mockResolvedValue([]);
  api.downloadTimeByCompanyCsv.mockResolvedValue(new Blob(["company,minutes"]));
  installPopulatedReports();
});

afterEach(cleanup);

describe("ReportsView", () => {
  it("renders no-data states instead of invented zero metrics", async () => {
    api.getVolumeReport.mockResolvedValue({
      data: [{ day: "2026-07-01", created: 0, resolved: 0 }],
      meta,
    });
    api.getDurationReport.mockResolvedValue({
      data: {
        firstResponse: { count: 0, p50Minutes: null, p90Minutes: null },
        resolution: { count: 0, p50Minutes: null, p90Minutes: null },
      },
      meta,
    });
    api.getSlaComplianceReport.mockResolvedValue({
      data: [
        { kind: "response", met: 0, onTrack: 0, atRisk: 0, breached: 0 },
        { kind: "resolution", met: 0, onTrack: 0, atRisk: 0, breached: 0 },
      ],
      meta: {
        ...meta,
        slaSnapshotCoverageFrom: null,
        includesUnrecordedSlaHistory: true,
      },
    });
    api.getBacklogAgeReport.mockResolvedValue({
      data: [
        { bucket: "<1d", count: 0 },
        { bucket: "1-3d", count: 0 },
        { bucket: "3-7d", count: 0 },
        { bucket: "7-30d", count: 0 },
        { bucket: "30d+", count: 0 },
      ],
      meta,
    });
    api.getTeamThroughputReport.mockResolvedValue({ data: [], meta });
    api.getFeedbackReport.mockResolvedValue({ data: [], meta: feedbackMeta });
    api.getAssigneeThroughputReport.mockResolvedValue({ data: [], meta });
    api.getTimeByCompanyReport.mockResolvedValue({ data: [], meta });

    renderReports();

    const volume = await screen.findByTestId("report-volume");
    expect(within(volume).getByText("No created or resolved ticket activity in this range.")).not.toBeNull();
    const createdTile = screen.getByText("Created").closest(".MuiCard-root");
    expect(createdTile).not.toBeNull();
    expect(within(createdTile as HTMLElement).getByText("—")).not.toBeNull();
    expect(screen.getByText("SLA compliance is suppressed because no frozen SLA promise snapshots have been recorded yet.")).not.toBeNull();
    expect(screen.getByText("No open tickets at the end of this range.")).not.toBeNull();
    expect(screen.getByText("No customer feedback was submitted in this range.")).not.toBeNull();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("repeats reconstructed-history provenance on every visible report card", async () => {
    const reconstructed = {
      ...meta,
      includesReconstructed: true,
      reconstructedFrom: "2026-07-01T01:00:00.000Z",
      reconstructedThrough: "2026-07-03T18:00:00.000Z",
    };
    api.getVolumeReport.mockResolvedValue({
      data: [{ day: "2026-07-01", created: 7, resolved: 5 }],
      meta: reconstructed,
    });
    api.getDurationReport.mockResolvedValue({
      data: {
        firstResponse: { count: 5, p50Minutes: 24, p90Minutes: 80 },
        resolution: { count: 4, p50Minutes: 480, p90Minutes: 1440 },
      },
      meta: reconstructed,
    });
    api.getBacklogAgeReport.mockResolvedValue({
      data: [{ bucket: "<1d", count: 2 }],
      meta: reconstructed,
    });
    api.getTeamThroughputReport.mockResolvedValue({
      data: [{ teamId: 2, teamName: "Service desk", resolved: 5 }],
      meta: reconstructed,
    });
    api.getFeedbackReport.mockResolvedValue({
      data: [{ companyId: 2, companyName: "Recorded only", positive: 1, neutral: 0, negative: 0 }],
      meta: feedbackMeta,
    });
    api.getAssigneeThroughputReport.mockResolvedValue({
      data: [{ assigneeId: 9, assigneeName: "Priya", resolved: 4 }],
      meta: reconstructed,
    });
    api.getTimeByCompanyReport.mockResolvedValue({
      data: [{ companyId: 7, companyName: "Acme", minutes: 315 }],
      meta: reconstructed,
    });
    api.getSlaComplianceReport.mockResolvedValue({
      data: [{ kind: "response", met: 1, onTrack: 0, atRisk: 0, breached: 0 }],
      meta: {
        ...reconstructed,
        slaSnapshotCoverageFrom: "2026-06-01T00:00:00.000Z",
        includesUnrecordedSlaHistory: false,
      },
    });

    renderReports();

    await screen.findByTestId("report-time-company");
    expect(screen.getAllByText(/Includes reconstructed history/)).toHaveLength(7);
  });

  it("offers an exact table view and forwards applied filters to the server", async () => {
    renderReports();

    const volume = await screen.findByTestId("report-volume");
    fireEvent.click(within(volume).getByRole("button", { name: "Table" }));
    const table = within(volume).getByRole("table", {
      name: "Created and resolved tickets by UTC day",
    });
    expect(within(table).getByText("2026-07-01")).not.toBeNull();
    expect(within(table).getByText("7")).not.toBeNull();
    expect(within(table).getByText("5")).not.toBeNull();

    const feedback = screen.getByTestId("report-feedback");
    fireEvent.click(within(feedback).getByRole("button", { name: "Table" }));
    const feedbackTable = within(feedback).getByRole("table", {
      name: "Customer feedback by company and rating",
    });
    expect(within(feedbackTable).getByText("Acme")).not.toBeNull();
    expect(within(feedbackTable).getByText("6")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-10" } });
    fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2026-07-12" } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Company" }));
    fireEvent.click(await screen.findByRole("option", { name: "Acme" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(api.getVolumeReport).toHaveBeenLastCalledWith({
      from: "2026-07-10T00:00:00.000Z",
      to: "2026-07-13T00:00:00.000Z",
      companyId: 7,
      teamId: undefined,
      assigneeId: undefined,
    }));
    expect(api.getFeedbackReport).toHaveBeenLastCalledWith({
      from: "2026-07-10T00:00:00.000Z",
      to: "2026-07-13T00:00:00.000Z",
      companyId: 7,
      teamId: undefined,
      assigneeId: undefined,
    });
  });

  it("does not request or render individual performance and billing for non-admin staff", async () => {
    auth.isAdmin = false;
    renderReports();

    await screen.findByTestId("report-team-throughput");
    expect(api.listAssignees).not.toHaveBeenCalled();
    expect(api.getAssigneeThroughputReport).not.toHaveBeenCalled();
    expect(api.getTimeByCompanyReport).not.toHaveBeenCalled();
    expect(screen.queryByTestId("report-assignee-throughput")).toBeNull();
    expect(screen.queryByTestId("report-time-company")).toBeNull();
    expect(screen.queryByLabelText("Technician")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export billing CSV" })).toBeNull();
  });
});
