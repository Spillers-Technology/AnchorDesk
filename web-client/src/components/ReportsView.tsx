import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import RefreshIcon from "@mui/icons-material/Refresh";
import * as api from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  BacklogBarChart,
  GroupedBarChart,
  HorizontalBarChart,
  SlaStatusChart,
  VolumeLineChart,
} from "./reports/ReportCharts";
import { chartCssVars } from "./reports/chartPalette";

type SelectValue = number | "";

interface FilterDraft {
  from: string;
  through: string;
  companyId: SelectValue;
  teamId: SelectValue;
  assigneeId: SelectValue;
}

interface ReportBundle {
  volume: api.ReportResponse<api.VolumeBucket[]>;
  durations: api.ReportResponse<api.DurationPercentiles>;
  sla: api.ReportResponse<api.SlaComplianceRow[], api.SlaComplianceMeta>;
  backlog: api.ReportResponse<api.BacklogAgeBucket[]>;
  team: api.ReportResponse<api.TeamThroughput[]>;
  assignee: api.ReportResponse<api.AssigneeThroughput[]> | null;
  companyTime: api.ReportResponse<api.CompanyTimeLogged[]> | null;
}

function inputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialFilters(): FilterDraft {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return {
    from: inputDate(from),
    through: inputDate(today),
    companyId: "",
    teamId: "",
    assigneeId: "",
  };
}

/** Date controls are inclusive for humans; the aggregate contract is [from,to). */
function toApiFilters(filters: FilterDraft, isAdmin: boolean): api.ReportFilters {
  const through = new Date(`${filters.through}T00:00:00.000Z`);
  through.setUTCDate(through.getUTCDate() + 1);
  return {
    from: new Date(`${filters.from}T00:00:00.000Z`).toISOString(),
    to: through.toISOString(),
    companyId: filters.companyId === "" ? undefined : filters.companyId,
    teamId: filters.teamId === "" ? undefined : filters.teamId,
    assigneeId: isAdmin && filters.assigneeId !== "" ? filters.assigneeId : undefined,
  };
}

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "No data";
  if (minutes < 60) return `${decimal.format(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round((minutes - hours * 60) * 10) / 10;
  return remainder > 0
    ? `${integer.format(hours)}h ${decimal.format(remainder)}m`
    : `${integer.format(hours)}h`;
}

function formatMinutesExact(minutes: number | null): string {
  return minutes === null ? "No data" : `${decimal.format(minutes)} min`;
}

function formatMetaDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dateTime.format(parsed);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The report could not be loaded.";
}

function Provenance({ meta }: { meta: api.ReportMeta }) {
  const reconstructedFrom = formatMetaDate(meta.reconstructedFrom);
  const reconstructedThrough = formatMetaDate(meta.reconstructedThrough);
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        Source window: {formatMetaDate(meta.from) ?? meta.from} to{" "}
        {formatMetaDate(meta.to) ?? meta.to} (exclusive)
      </Typography>
      {meta.includesReconstructed && (
        <Alert severity="warning" icon="≈">
          Includes reconstructed history
          {reconstructedFrom && reconstructedThrough
            ? ` from ${reconstructedFrom} through ${reconstructedThrough}`
            : ""}
          . Reconstructed events are estimates, not recorded history.
        </Alert>
      )}
    </Stack>
  );
}

function SummaryTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | null;
  detail: string;
}) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ mt: 0.25 }}>
          {value ?? "—"}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {detail}
        </Typography>
      </CardContent>
    </Card>
  );
}

function NoData({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: 150,
        display: "grid",
        placeItems: "center",
        px: 2,
        textAlign: "center",
        borderRadius: 1,
        bgcolor: "action.hover",
      }}
    >
      <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 440 }}>
        {children}
      </Typography>
    </Box>
  );
}

function ReportCard({
  testId,
  title,
  question,
  meta,
  chart,
  table,
  emptyMessage,
  tableAvailableWhenEmpty = false,
  actions,
  children,
}: {
  testId: string;
  title: string;
  question: string;
  meta: api.ReportMeta;
  chart: React.ReactNode;
  table: React.ReactNode;
  emptyMessage?: string;
  tableAvailableWhenEmpty?: boolean;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const suppressBoth = Boolean(emptyMessage && !tableAvailableWhenEmpty);
  return (
    <Card component="section" data-testid={testId} sx={{ minWidth: 0 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2.5 }, "&:last-child": { pb: { xs: 1.5, sm: 2.5 } } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.25}
          sx={{ alignItems: { xs: "stretch", sm: "flex-start" }, mb: 1.5 }}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6">{title}</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {question}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
            {actions}
            <ToggleButtonGroup
              size="small"
              exclusive
              value={mode}
              aria-label={`${title} view`}
              onChange={(_event, next: "chart" | "table" | null) => {
                if (next) setMode(next);
              }}
            >
              <ToggleButton value="chart">Chart</ToggleButton>
              <ToggleButton value="table" disabled={suppressBoth}>Table</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
        <Provenance meta={meta} />
        {children}
        {emptyMessage && (mode === "chart" || suppressBoth) ? (
          <NoData>{emptyMessage}</NoData>
        ) : mode === "chart" ? (
          chart
        ) : (
          table
        )}
      </CardContent>
    </Card>
  );
}

function DataTable({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <TableContainer sx={{ maxWidth: "100%", overflowX: "auto" }}>
      <Table size="small" aria-label={label} sx={{ minWidth: 520 }}>
        <TableHead>
          <TableRow>
            {columns.map((column) => <TableCell key={column}>{column}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function ReportsView() {
  const { isAdmin } = useAuth();
  const theme = useTheme();
  const [draft, setDraft] = useState<FilterDraft>(initialFilters);
  const [applied, setApplied] = useState<FilterDraft>(initialFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [teams, setTeams] = useState<api.Team[]>([]);
  const [assignees, setAssignees] = useState<api.Assignee[]>([]);
  const [data, setData] = useState<ReportBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.listCompanies().catch(() => []),
      api.listTeams().catch(() => []),
      isAdmin ? api.listAssignees().catch(() => []) : Promise.resolve([]),
    ]).then(([companyRows, teamRows, assigneeRows]) => {
      if (!active) return;
      setCompanies(companyRows);
      setTeams(teamRows);
      setAssignees(assigneeRows);
    });
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    let active = true;
    const filters = toApiFilters(applied, isAdmin);
    setLoading(true);
    setError(null);
    setData(null);
    Promise.all([
      api.getVolumeReport(filters),
      api.getDurationReport(filters),
      api.getSlaComplianceReport(filters),
      api.getBacklogAgeReport(filters),
      api.getTeamThroughputReport(filters),
      isAdmin ? api.getAssigneeThroughputReport(filters) : Promise.resolve(null),
      isAdmin ? api.getTimeByCompanyReport(filters) : Promise.resolve(null),
    ])
      .then(([volume, durations, sla, backlog, team, assignee, companyTime]) => {
        if (!active) return;
        setData({ volume, durations, sla, backlog, team, assignee, companyTime });
      })
      .catch((reason: unknown) => {
        if (active) setError(errorText(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [applied, isAdmin, reloadKey]);

  const apiFilters = useMemo(() => toApiFilters(applied, isAdmin), [applied, isAdmin]);

  const applyFilters = () => {
    if (!draft.from || !draft.through) {
      setFilterError("Choose both a From and Through date.");
      return;
    }
    if (draft.from > draft.through) {
      setFilterError("From must be on or before Through.");
      return;
    }
    setFilterError(null);
    setApplied({ ...draft, assigneeId: isAdmin ? draft.assigneeId : "" });
  };

  const exportCsv = async () => {
    setCsvBusy(true);
    setCsvError(null);
    try {
      const blob = await api.downloadTimeByCompanyCsv(apiFilters);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `anchordesk-time-by-company-${applied.from}-to-${applied.through}.csv`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (reason) {
      setCsvError(errorText(reason));
    } finally {
      setCsvBusy(false);
    }
  };

  const totals = useMemo(() => {
    if (!data) return null;
    const created = data.volume.data.reduce((sum, row) => sum + row.created, 0);
    const resolved = data.volume.data.reduce((sum, row) => sum + row.resolved, 0);
    const backlog = data.backlog.data.reduce((sum, row) => sum + row.count, 0);
    return { created, resolved, backlog, hasVolume: created + resolved > 0 };
  }, [data]);

  return (
    <Box
      data-testid="reports-view"
      style={chartCssVars(theme.palette.mode)}
      sx={{ width: "100%", maxWidth: 1280, mx: "auto", minWidth: 0 }}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h4">Reports</Typography>
          <Typography variant="body1" sx={{ color: "text.secondary", mt: 0.5 }}>
            Recorded operational truth for the questions managers ask most.
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ p: 1, maxWidth: "100%", overflowX: "auto" }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ width: "max-content", minWidth: "100%", alignItems: "center" }}
          >
            <TextField
              type="date"
              label="From"
              value={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 155, flexShrink: 0 }}
            />
            <TextField
              type="date"
              label="Through"
              value={draft.through}
              onChange={(event) => setDraft((current) => ({ ...current, through: event.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 155, flexShrink: 0 }}
            />
            <TextField
              select
              label="Company"
              value={draft.companyId}
              onChange={(event) => setDraft((current) => ({
                ...current,
                companyId: event.target.value === "" ? "" : Number(event.target.value),
              }))}
              sx={{ width: 190, flexShrink: 0 }}
            >
              <MenuItem value="">All companies</MenuItem>
              {companies.map((company) => (
                <MenuItem key={company.id} value={company.id}>{company.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Team"
              value={draft.teamId}
              onChange={(event) => setDraft((current) => ({
                ...current,
                teamId: event.target.value === "" ? "" : Number(event.target.value),
              }))}
              sx={{ width: 180, flexShrink: 0 }}
            >
              <MenuItem value="">All teams</MenuItem>
              {teams.map((team) => (
                <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>
              ))}
            </TextField>
            {isAdmin && (
              <TextField
                select
                label="Technician"
                value={draft.assigneeId}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  assigneeId: event.target.value === "" ? "" : Number(event.target.value),
                }))}
                sx={{ width: 190, flexShrink: 0 }}
              >
                <MenuItem value="">All technicians</MenuItem>
                {assignees.map((assignee) => (
                  <MenuItem key={assignee.id} value={assignee.id}>
                    {assignee.displayName || assignee.username}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Button
              variant="contained"
              startIcon={<FilterAltIcon />}
              onClick={applyFilters}
              sx={{ minHeight: 40, flexShrink: 0 }}
            >
              Apply filters
            </Button>
          </Stack>
        </Paper>
        {filterError && <Alert severity="error">{filterError}</Alert>}

        {loading && (
          <Box sx={{ minHeight: 280, display: "grid", placeItems: "center" }}>
            <Stack spacing={1} sx={{ alignItems: "center" }}>
              <CircularProgress />
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Aggregating in Postgres…
              </Typography>
            </Stack>
          </Box>
        )}

        {!loading && error && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={() => setReloadKey((key) => key + 1)}>
                Retry
              </Button>
            }
          >
            Reports are unavailable. Nothing has been replaced with zero. {error}
          </Alert>
        )}

        {!loading && data && totals && (
          <>
            <Box>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <SummaryTile
                    label="Created"
                    value={totals.hasVolume ? integer.format(totals.created) : null}
                    detail={totals.hasVolume ? "tickets in range" : "No activity in range"}
                  />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <SummaryTile
                    label="Resolved"
                    value={totals.hasVolume ? integer.format(totals.resolved) : null}
                    detail={totals.hasVolume ? "tickets in range" : "No activity in range"}
                  />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <SummaryTile
                    label="Median first response"
                    value={data.durations.data.firstResponse.count > 0
                      ? formatMinutes(data.durations.data.firstResponse.p50Minutes)
                      : null}
                    detail={data.durations.data.firstResponse.count > 0
                      ? `${integer.format(data.durations.data.firstResponse.count)} measured`
                      : "No measured responses"}
                  />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <SummaryTile
                    label="Open backlog"
                    value={integer.format(totals.backlog)}
                    detail={totals.backlog === 0 ? "No open tickets" : `as of ${applied.through}`}
                  />
                </Grid>
              </Grid>
            </Box>

            <ReportCard
              testId="report-volume"
              title="Created vs resolved"
              question="Are we keeping up, or is the backlog growing?"
              meta={data.volume.meta}
              emptyMessage={!totals.hasVolume ? "No created or resolved ticket activity in this range." : undefined}
              chart={<VolumeLineChart data={data.volume.data} />}
              table={
                <DataTable
                  label="Created and resolved tickets by UTC day"
                  columns={["UTC day", "Created", "Resolved"]}
                  rows={data.volume.data.map((row) => [row.day, row.created, row.resolved])}
                />
              }
            />

            <ReportCard
              testId="report-durations"
              title="How long customers wait"
              question="Median and 90th-percentile wait, without a misleading average."
              meta={data.durations.meta}
              emptyMessage={
                data.durations.data.firstResponse.count + data.durations.data.resolution.count === 0
                  ? "No first-response or resolution durations were completed in this range."
                  : undefined
              }
              chart={
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>First response</Typography>
                    <GroupedBarChart
                      ariaLabel="First-response p50 and p90 duration in minutes"
                      categories={[
                        {
                          label: "First response",
                          values: [
                            data.durations.data.firstResponse.p50Minutes,
                            data.durations.data.firstResponse.p90Minutes,
                          ],
                        },
                      ]}
                      series={[
                        { label: "p50 (median)", slot: 1 },
                        { label: "p90", slot: 2 },
                      ]}
                      valueLabel={formatMinutes}
                      minWidth={500}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Resolution</Typography>
                    <GroupedBarChart
                      ariaLabel="Resolution p50 and p90 duration in minutes"
                      categories={[
                        {
                          label: "Resolution",
                          values: [
                            data.durations.data.resolution.p50Minutes,
                            data.durations.data.resolution.p90Minutes,
                          ],
                        },
                      ]}
                      series={[
                        { label: "p50 (median)", slot: 1 },
                        { label: "p90", slot: 2 },
                      ]}
                      valueLabel={formatMinutes}
                      minWidth={500}
                    />
                  </Grid>
                </Grid>
              }
              table={
                <DataTable
                  label="Duration percentiles"
                  columns={["Metric", "Measured tickets", "p50 (median)", "p90"]}
                  rows={[
                    [
                      "First response",
                      data.durations.data.firstResponse.count,
                      formatMinutesExact(data.durations.data.firstResponse.p50Minutes),
                      formatMinutesExact(data.durations.data.firstResponse.p90Minutes),
                    ],
                    [
                      "Resolution",
                      data.durations.data.resolution.count,
                      formatMinutesExact(data.durations.data.resolution.p50Minutes),
                      formatMinutesExact(data.durations.data.resolution.p90Minutes),
                    ],
                  ]}
                />
              }
            />

            <ReportCard
              testId="report-sla"
              title="SLA promise health"
              question="Are we keeping the frozen promise we sold?"
              meta={data.sla.meta}
              emptyMessage={
                data.sla.meta.slaSnapshotCoverageFrom === null
                  ? "SLA compliance is suppressed because no frozen SLA promise snapshots have been recorded yet."
                  : data.sla.data.reduce(
                    (sum, row) => sum + row.met + row.onTrack + row.atRisk + row.breached,
                    0
                  ) === 0
                    ? "No SLA promises are due in the recorded portion of this range."
                    : undefined
              }
              chart={<SlaStatusChart data={data.sla.data} />}
              table={
                <DataTable
                  label="SLA compliance from frozen promise snapshots"
                  columns={["Clock", "Met", "On track", "At risk", "Breached"]}
                  rows={data.sla.data.map((row) => [
                    row.kind === "response" ? "Response" : "Resolution",
                    row.met,
                    row.onTrack,
                    row.atRisk,
                    row.breached,
                  ])}
                />
              }
            >
              {data.sla.meta.includesUnrecordedSlaHistory && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {data.sla.meta.slaSnapshotCoverageFrom
                    ? `SLA promise history before ${formatMetaDate(data.sla.meta.slaSnapshotCoverageFrom) ?? data.sla.meta.slaSnapshotCoverageFrom} is unknown. The chart only judges frozen snapshots that were actually recorded.`
                    : "Historical SLA promises were not reconstructed. There is no truthful compliance coverage to show yet."}
                </Alert>
              )}
            </ReportCard>

            <ReportCard
              testId="report-backlog"
              title="Backlog age"
              question="What is rotting right now?"
              meta={data.backlog.meta}
              emptyMessage={totals.backlog === 0 ? "No open tickets at the end of this range." : undefined}
              tableAvailableWhenEmpty
              chart={<BacklogBarChart data={data.backlog.data} />}
              table={
                <DataTable
                  label="Open ticket backlog age buckets"
                  columns={["Age bucket", "Open tickets"]}
                  rows={data.backlog.data.map((row) => [row.bucket, row.count])}
                />
              }
            />

            <ReportCard
              testId="report-team-throughput"
              title="Team throughput"
              question="Where is the resolved-ticket load?"
              meta={data.team.meta}
              emptyMessage={data.team.data.length === 0 ? "No team resolved a ticket in this range." : undefined}
              chart={
                <>
                  <HorizontalBarChart
                    ariaLabel="Resolved ticket throughput by team"
                    data={data.team.data.slice(0, 10).map((row) => ({
                      id: String(row.teamId ?? "unassigned"),
                      label: row.teamName ?? "No team",
                      value: row.resolved,
                    }))}
                  />
                  {data.team.data.length > 10 && (
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Chart shows the top 10 of {data.team.data.length} teams. Table view includes every row.
                    </Typography>
                  )}
                </>
              }
              table={
                <DataTable
                  label="Resolved tickets by team"
                  columns={["Team", "Resolved"]}
                  rows={data.team.data.map((row) => [row.teamName ?? "No team", row.resolved])}
                />
              }
            />

            {isAdmin && data.assignee && (
              <ReportCard
                testId="report-assignee-throughput"
                title="Technician throughput"
                question="How is resolved-ticket load distributed across people?"
                meta={data.assignee.meta}
                emptyMessage={data.assignee.data.length === 0 ? "No technician resolved a ticket in this range." : undefined}
                chart={
                  <>
                    <HorizontalBarChart
                      ariaLabel="Resolved ticket throughput by technician"
                      data={data.assignee.data.slice(0, 10).map((row) => ({
                        id: String(row.assigneeId ?? "unassigned"),
                        label: row.assigneeName ?? "Unassigned",
                        value: row.resolved,
                      }))}
                    />
                    {data.assignee.data.length > 10 && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Chart shows the top 10 of {data.assignee.data.length} technicians. Table view includes every row.
                      </Typography>
                    )}
                  </>
                }
                table={
                  <DataTable
                    label="Resolved tickets by technician"
                    columns={["Technician", "Resolved"]}
                    rows={data.assignee.data.map((row) => [row.assigneeName ?? "Unassigned", row.resolved])}
                  />
                }
              />
            )}

            {isAdmin && data.companyTime && (
              <ReportCard
                testId="report-time-company"
                title="Time logged by company"
                question="What do we bill?"
                meta={data.companyTime.meta}
                emptyMessage={data.companyTime.data.length === 0 ? "No time was logged in this range." : undefined}
                actions={
                  <Button
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={() => void exportCsv()}
                    disabled={csvBusy}
                  >
                    {csvBusy ? "Exporting…" : "Export billing CSV"}
                  </Button>
                }
                chart={
                  <>
                    {csvError && <Alert severity="error" sx={{ mb: 1 }}>{csvError}</Alert>}
                    <HorizontalBarChart
                      ariaLabel="Logged minutes by company"
                      data={data.companyTime.data.slice(0, 10).map((row) => ({
                        id: String(row.companyId ?? "unknown"),
                        label: row.companyName ?? "Unknown company",
                        value: row.minutes,
                      }))}
                      valueLabel={formatMinutes}
                    />
                    {data.companyTime.data.length > 10 && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Chart shows the top 10 of {data.companyTime.data.length} companies. Table view and CSV include every row.
                      </Typography>
                    )}
                  </>
                }
                table={
                  <>
                    {csvError && <Alert severity="error" sx={{ mb: 1 }}>{csvError}</Alert>}
                    <DataTable
                      label="Logged time by company"
                      columns={["Company", "Minutes"]}
                      rows={data.companyTime.data.map((row) => [
                        row.companyName ?? "Unknown company",
                        row.minutes,
                      ])}
                    />
                  </>
                }
              />
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
