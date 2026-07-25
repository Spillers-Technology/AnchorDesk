import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function SyncRunStatusChip({ status }: { status: api.SyncRunStatus }) {
  switch (status) {
    case "running":
      return <Chip size="small" color="info" icon={<HourglassTopIcon />} label="Running" />;
    case "success":
      return <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Healthy" />;
    case "degraded":
      return <Chip size="small" color="warning" icon={<WarningAmberIcon />} label="Degraded" />;
    case "error":
      return <Chip size="small" color="error" icon={<ErrorIcon />} label="Failed" />;
  }
}

export function SyncHealthChip({ status }: { status: api.SyncHealthStatus }) {
  if (status === "never_run") return <Chip size="small" variant="outlined" label="Never run" />;
  if (status === "healthy") return <SyncRunStatusChip status="success" />;
  if (status === "failing") return <SyncRunStatusChip status="error" />;
  return <SyncRunStatusChip status={status} />;
}

function Counts({ run }: { run: api.SyncRunSummary }) {
  const counts = [
    ["Created", run.ticketsCreated],
    ["Updated", run.ticketsUpdated],
    ["Notes", run.notesUpserted],
    ["Filtered locally", run.ticketsFiltered],
    ["Skipped", run.ticketsSkipped],
    ["Conflicts", run.ticketsConflicted],
    ["Errors", run.errorCount],
  ] as const;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
        gap: 1,
      }}
    >
      {counts.map(([label, value]) => (
        <Paper key={label} variant="outlined" sx={{ p: 1 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {label}
          </Typography>
          <Typography sx={{ fontWeight: 600 }}>{value}</Typography>
        </Paper>
      ))}
    </Box>
  );
}

export default function SyncRunHistoryDialog({
  open,
  job,
  onClose,
}: {
  open: boolean;
  job: api.SyncProvider;
  onClose: () => void;
}) {
  const isPhone = useIsPhone();
  const [runs, setRuns] = useState<api.SyncRunSummary[] | null>(null);
  const [details, setDetails] = useState<Record<number, api.SyncRunDetail>>({});
  const [expanded, setExpanded] = useState<number | false>(false);
  const [loadingRun, setLoadingRun] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRuns(null);
    setDetails({});
    setExpanded(false);
    setActivityFilter("");
    setError(null);
    api
      .listSyncRuns({ provider: job.name, limit: 50 })
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load sync run history");
          setRuns([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job.name, open]);

  const expandRun = async (runId: number, isExpanded: boolean) => {
    setExpanded(isExpanded ? runId : false);
    setActivityFilter("");
    if (!isExpanded || details[runId]) return;
    setLoadingRun(runId);
    setError(null);
    try {
      const detail = await api.getSyncRun(runId);
      setDetails((current) => ({ ...current, [runId]: detail }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this run");
    } finally {
      setLoadingRun(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={isPhone}>
      <DialogTitle>{job.name} — run history</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {runs === null ? (
            <CircularProgress aria-label="Loading sync run history" />
          ) : runs.length === 0 ? (
            <Alert severity="info">This job has not run yet.</Alert>
          ) : (
            runs.map((run) => {
              const detail = details[run.id];
              return (
                <Accordion
                  key={run.id}
                  expanded={expanded === run.id}
                  onChange={(_event, isExpanded) => void expandRun(run.id, isExpanded)}
                  disableGutters
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ width: "100%", pr: 1, alignItems: { sm: "center" }, justifyContent: "space-between" }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                        <SyncRunStatusChip status={run.status} />
                        <Typography variant="body2">{formatDate(run.startedAt)}</Typography>
                      </Stack>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {run.trigger}
                        {run.durationMs != null ? ` · ${run.durationMs}ms` : ""}
                      </Typography>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    {loadingRun === run.id && !detail ? (
                      <CircularProgress size={24} aria-label="Loading run details" />
                    ) : (
                      <RunDetails
                        run={detail ?? run}
                        activityFilter={activityFilter}
                        onActivityFilter={setActivityFilter}
                      />
                    )}
                  </AccordionDetails>
                </Accordion>
              );
            })
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function RunDetails({
  run,
  activityFilter,
  onActivityFilter,
}: {
  run: api.SyncRunSummary | api.SyncRunDetail;
  activityFilter: string;
  onActivityFilter: (value: string) => void;
}) {
  const detail = "logs" in run ? run : null;
  const visibleLogs = useMemo(() => {
    if (!detail) return [];
    const needle = activityFilter.trim().toLowerCase();
    if (!needle) return detail.logs;
    return detail.logs.filter((entry) =>
      [entry.externalId, entry.message, entry.status, entry.direction]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [activityFilter, detail]);

  return (
    <Stack spacing={2}>
      {run.latestError && <Alert severity={run.status === "error" ? "error" : "warning"}>{run.latestError}</Alert>}
      <Counts run={run} />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        Started {formatDate(run.startedAt)}
        {run.completedAt ? ` · completed ${formatDate(run.completedAt)}` : " · still running"}
        {run.initiatedBy ? ` · by ${run.initiatedBy}` : ""}
      </Typography>

      {detail && (
        <>
          {detail.logsTruncated && (
            <Alert severity="info">
              Showing the newest {detail.logs.length} of {detail.logCount} record-level entries.
            </Alert>
          )}
          <TextField
            size="small"
            label="Filter record activity"
            value={activityFilter}
            onChange={(event) => onActivityFilter(event.target.value)}
          />
          {detail.logs.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No record-level activity. A zero-ticket run can still be healthy.
            </Typography>
          ) : visibleLogs.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>No activity matches that filter.</Typography>
          ) : (
            <Stack spacing={1}>
              {visibleLogs.map((entry) => (
                <Paper key={entry.id} variant="outlined" sx={{ p: 1.25 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Chip
                      size="small"
                      color={entry.status === "error" ? "error" : entry.status === "skipped" ? "warning" : "success"}
                      label={entry.status}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {entry.externalId ?? (entry.internalId ? `Ticket ${entry.internalId}` : "Provider")}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{entry.direction}</Typography>
                  </Stack>
                  {entry.message && (
                    <Typography variant="body2" sx={{ mt: 0.5, wordBreak: "break-word" }}>{entry.message}</Typography>
                  )}
                </Paper>
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
