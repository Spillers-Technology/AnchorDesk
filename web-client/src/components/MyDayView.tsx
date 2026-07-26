import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import HistoryToggleOffIcon from "@mui/icons-material/HistoryToggleOff";
import ScheduleIcon from "@mui/icons-material/Schedule";
import TableRowsIcon from "@mui/icons-material/TableRows";
import TimelineIcon from "@mui/icons-material/Timeline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import * as api from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { chartColor, chartCssVars } from "./reports/chartPalette";
import {
  DEFAULT_WORKDAY_MINUTES,
  calculateWorkdayCoverage,
  formatMinutes,
  localDayBounds,
  shiftLocalDay,
} from "./timeCalendarModel";

interface Props {
  onOpenTicket?: (ticketId: number) => void;
}

type TimeMode = "day" | "sla";
type DataMode = "calendar" | "table";

interface TicketOption {
  id: number;
  ticketNumber: string;
  title: string;
  status?: string;
  companyName?: string;
}

interface PlacedBlock {
  entry: api.MyDayEntry;
  start: Date;
  stop: Date;
  lane: number;
}

function dateInputValue(day: Date): string {
  const year = day.getFullYear();
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

function dateFromInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clock(value: Date): string {
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function preciseTime(value: string | Date): string {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function errorText(error: unknown): string {
  if (error instanceof api.ApiError) {
    try {
      const parsed = JSON.parse(error.body) as { error?: unknown };
      if (typeof parsed.error === "string") return parsed.error;
    } catch {
      // Preserve the shared client's useful fallback message.
    }
  }
  return error instanceof Error ? error.message : "The TIME data could not be loaded.";
}

function toTicketOption(value: unknown): TicketOption | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    ticketNumber: String(row.ticketNumber ?? row.id),
    title: String(row.title ?? ""),
    status: row.status == null ? undefined : String(row.status),
    companyName: row.companyName == null ? undefined : String(row.companyName),
  };
}

export default function MyDayView({ onOpenTicket }: Props) {
  const [mode, setMode] = useState<TimeMode>("day");

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Box>
        <Typography variant="h4">TIME calendar</Typography>
        <Typography variant="body2" color="text.secondary">
          Find missing work time, then inspect the frozen promise behind a ticket&apos;s SLA.
        </Typography>
      </Box>
      <Paper variant="outlined">
        <Tabs
          value={mode}
          onChange={(_event, value: TimeMode) => setMode(value)}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="TIME calendar mode"
        >
          <Tab icon={<ScheduleIcon />} iconPosition="start" value="day" label="Day spread" />
          <Tab icon={<TimelineIcon />} iconPosition="start" value="sla" label="Ticket SLA timeline" />
        </Tabs>
      </Paper>
      {mode === "day" ? (
        <DaySpread onOpenTicket={onOpenTicket} />
      ) : (
        <TicketSlaTimeline onOpenTicket={onOpenTicket} />
      )}
    </Stack>
  );
}

function DaySpread({ onOpenTicket }: Props) {
  const theme = useTheme();
  const { user, isAdmin } = useAuth();
  const [day, setDay] = useState(() => localDayBounds(new Date()).from);
  const [assignees, setAssignees] = useState<api.Assignee[]>([]);
  const [assigneeId, setAssigneeId] = useState<number | "">(
    user && user.id > 0 ? user.id : "",
  );
  const [response, setResponse] = useState<api.TimeDaySpreadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<DataMode>("calendar");
  const bounds = useMemo(() => localDayBounds(day), [day]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    api
      .listAssignees()
      .then((items) => {
        if (!active) return;
        setAssignees(items);
        setAssigneeId((current) => current || items[0]?.id || "");
      })
      .catch((cause) => {
        if (active) setError(`Technician list: ${errorText(cause)}`);
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const effectiveAssigneeId = isAdmin
    ? assigneeId
    : user && user.id > 0
      ? user.id
      : "";

  useEffect(() => {
    if (effectiveAssigneeId === "") {
      setResponse(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getTimeDaySpread(bounds.from, bounds.to, effectiveAssigneeId)
      .then((result) => {
        if (active) setResponse(result);
      })
      .catch((cause) => {
        if (active) {
          setResponse(null);
          setError(errorText(cause));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bounds.from, bounds.to, effectiveAssigneeId]);

  const data = response?.data ?? null;
  const entries = data?.entries ?? [];
  const placedEntries = entries.filter(
    (entry) => entry.placed && entry.timeStart && entry.timeStop,
  );
  const unplacedEntries = entries.filter((entry) => !entry.placed);
  const coverage = useMemo(
    () =>
      calculateWorkdayCoverage(
        placedEntries.map((entry) => ({
          start: new Date(entry.timeStart!),
          end: new Date(entry.timeStop!),
        })),
        day,
      ),
    [day, placedEntries],
  );
  const blocks = useMemo(() => placeInLanes(placedEntries), [placedEntries]);
  const loggedMinutes = data?.summary.loggedMinutes ?? 0;
  const unloggedMinutes = Math.max(0, DEFAULT_WORKDAY_MINUTES - loggedMinutes);
  const hasData = entries.length > 0;
  const targetPercent = Math.min(
    100,
    (loggedMinutes / DEFAULT_WORKDAY_MINUTES) * 100,
  );
  const isToday = dateInputValue(day) === dateInputValue(new Date());

  return (
    <Stack
      data-testid="time-day-spread"
      spacing={2}
      style={chartCssVars(theme.palette.mode)}
      sx={{ minWidth: 0 }}
    >
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { xs: "stretch", sm: "center" } }}
        >
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Tooltip title="Previous day">
              <Button
                aria-label="Previous day"
                onClick={() => setDay((current) => shiftLocalDay(current, -1))}
                sx={{ minWidth: 40, px: 0 }}
              >
                <ChevronLeftIcon />
              </Button>
            </Tooltip>
            <Tooltip title="Next day">
              <Button
                aria-label="Next day"
                onClick={() => setDay((current) => shiftLocalDay(current, 1))}
                sx={{ minWidth: 40, px: 0 }}
              >
                <ChevronRightIcon />
              </Button>
            </Tooltip>
            <Button
              size="small"
              variant={isToday ? "contained" : "outlined"}
              onClick={() => setDay(localDayBounds(new Date()).from)}
            >
              Today
            </Button>
          </Stack>
          <TextField
            type="date"
            label="Work date"
            value={dateInputValue(day)}
            onChange={(event) => {
              const selected = dateFromInput(event.target.value);
              if (selected) setDay(selected);
            }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {isAdmin ? (
            <FormControl size="small" sx={{ minWidth: 210 }}>
              <InputLabel id="time-technician-label">Technician</InputLabel>
              <Select
                labelId="time-technician-label"
                label="Technician"
                value={assigneeId}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setAssigneeId(Number.isInteger(value) && value > 0 ? value : "");
                }}
              >
                {assignees.map((assignee) => (
                  <MenuItem key={assignee.id} value={assignee.id}>
                    {assignee.displayName || assignee.username}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <Chip label={user?.displayName || user?.username || "My time"} />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={dataMode}
            onChange={(_event, value: DataMode | null) => value && setDataMode(value)}
            aria-label="Day spread presentation"
          >
            <ToggleButton value="calendar" aria-label="Calendar view">
              <ScheduleIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="table" aria-label="Table view">
              <TableRowsIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Paper>

      {response?.meta.includesReconstructed && (
        <Alert severity="warning" icon={<HistoryToggleOffIcon />}>
          This day overlaps reconstructed history
          {response.meta.reconstructedThrough
            ? ` through ${preciseTime(response.meta.reconstructedThrough)}`
            : ""}
          . Reconstructed events are estimates from the audit record, not original recordings.
        </Alert>
      )}
      <Alert severity="info" icon={<ScheduleIcon />}>
        The 9:00 AM–5:00 PM, eight-hour target is a reporting default, not a recorded
        employment schedule.
      </Alert>

      {error && <Alert severity="error">{error}</Alert>}
      {loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : effectiveAssigneeId === "" ? (
        <Alert severity="info">Choose a technician to inspect a day.</Alert>
      ) : !hasData ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <EventBusyIcon color="disabled" sx={{ fontSize: 42 }} />
          <Typography variant="h6">No time-entry data for this day</Typography>
          <Typography variant="body2" color="text.secondary">
            No-data is not shown as zero logged time.
          </Typography>
        </Paper>
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2, minmax(0, 1fr))",
                md: "repeat(4, minmax(0, 1fr))",
              },
              gap: 1.5,
            }}
          >
            <TimeStat
              label="Logged"
              value={formatMinutes(loggedMinutes)}
              detail={`of ${formatMinutes(DEFAULT_WORKDAY_MINUTES)} target`}
              icon={<AccessTimeIcon />}
            />
            <TimeStat
              label="Unlogged"
              value={formatMinutes(unloggedMinutes)}
              detail={loggedMinutes > DEFAULT_WORKDAY_MINUTES ? "Target exceeded" : "against default target"}
              icon={<WarningAmberIcon color="warning" />}
            />
            <TimeStat
              label="Placed coverage"
              value={formatMinutes(coverage.coveredMinutes)}
              detail="union of clock windows"
              icon={<ScheduleIcon />}
            />
            <TimeStat
              label="Unplaced"
              value={formatMinutes(data!.summary.unplacedMinutes)}
              detail={`${unplacedEntries.length} duration-only entr${unplacedEntries.length === 1 ? "y" : "ies"}`}
              icon={<ErrorOutlineIcon />}
            />
          </Box>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.75 }}>
              <Typography variant="subtitle2">Daily target coverage</Typography>
              <Typography variant="h6">{Math.round(targetPercent)}%</Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={targetPercent}
              color={targetPercent >= 100 ? "success" : "warning"}
              sx={{ height: 12, borderRadius: 6 }}
              aria-label={`${Math.round(targetPercent)} percent of default daily target logged`}
            />
            <Typography variant="caption" color="text.secondary">
              Logged minutes are the billing sum. Placed coverage unions overlapping clock
              windows, so the two can legitimately differ.
            </Typography>
          </Paper>

          {dataMode === "calendar" ? (
            <DayCalendar
              day={day}
              blocks={blocks}
              gaps={coverage.gaps}
              onOpenTicket={onOpenTicket}
            />
          ) : (
            <DayTable
              entries={entries}
              gaps={coverage.gaps}
              onOpenTicket={onOpenTicket}
            />
          )}

          {unplacedEntries.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1">Duration-only entries</Typography>
              <Typography variant="body2" color="text.secondary">
                They count toward logged time, but workedAt is not proof of a start/stop
                window, so placing them on the calendar would invent precision.
              </Typography>
              <Divider sx={{ my: 1.5 }} />
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {unplacedEntries.map((entry) => (
                  <Button
                    key={entry.id}
                    variant="outlined"
                    onClick={() => onOpenTicket?.(entry.ticketId)}
                    sx={{ justifyContent: "flex-start", color: "text.primary" }}
                  >
                    #{entry.ticketNumber ?? entry.ticketId} · {formatMinutes(entry.minutes)} ·{" "}
                    {entry.ticketTitle || entry.content}
                  </Button>
                ))}
              </Stack>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

function TimeStat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        {icon}
        <Typography variant="overline" color="text.secondary">
          {label}
        </Typography>
      </Stack>
      <Typography variant="h4" sx={{ mt: 0.5 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {detail}
      </Typography>
    </Paper>
  );
}

function placeInLanes(entries: api.MyDayEntry[]): PlacedBlock[] {
  const sorted = entries
    .filter((entry) => entry.timeStart && entry.timeStop)
    .map((entry) => ({
      entry,
      start: new Date(entry.timeStart!),
      stop: new Date(entry.timeStop!),
    }))
    .filter(({ start, stop }) => stop > start)
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const laneEnds: number[] = [];
  return sorted.map((block) => {
    let lane = laneEnds.findIndex((end) => end <= block.start.getTime());
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.stop.getTime());
    } else {
      laneEnds[lane] = block.stop.getTime();
    }
    return { ...block, lane };
  });
}

function DayCalendar({
  day,
  blocks,
  gaps,
  onOpenTicket,
}: {
  day: Date;
  blocks: PlacedBlock[];
  gaps: Array<{ start: Date; end: Date; minutes: number }>;
  onOpenTicket?: (ticketId: number) => void;
}) {
  const range = useMemo(() => {
    let startHour = 7;
    let endHour = 19;
    for (const block of blocks) {
      startHour = Math.min(startHour, block.start.getHours());
      endHour = Math.max(endHour, block.stop.getHours() + (block.stop.getMinutes() ? 1 : 0));
    }
    const start = new Date(day);
    start.setHours(startHour, 0, 0, 0);
    const end = new Date(day);
    end.setHours(endHour, 0, 0, 0);
    return { start, end };
  }, [blocks, day]);
  const totalMinutes = (range.end.getTime() - range.start.getTime()) / 60_000;
  const height = (totalMinutes / 60) * 58;
  const top = (at: Date) =>
    ((at.getTime() - range.start.getTime()) / 60_000 / totalMinutes) * height;
  const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1));
  const marks: Date[] = [];
  for (let at = new Date(range.start); at <= range.end; at.setHours(at.getHours() + 1)) {
    marks.push(new Date(at));
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <WarningAmberIcon color="warning" fontSize="small" />
        <Typography variant="subtitle1">Visible workday gaps</Typography>
        <Typography variant="caption" color="text.secondary">
          leading, between-entry, and trailing
        </Typography>
      </Stack>
      <Box sx={{ overflowX: "auto", maxWidth: "100%" }}>
        <Box sx={{ display: "flex", minWidth: 680 }}>
          <Box sx={{ width: 68, flexShrink: 0, position: "relative", height }}>
            {marks.map((mark) => (
              <Typography
                key={mark.getTime()}
                variant="caption"
                color="text.secondary"
                sx={{ position: "absolute", right: 10, top: top(mark) - 9 }}
              >
                {mark.toLocaleTimeString([], { hour: "numeric" })}
              </Typography>
            ))}
          </Box>
          <Box
            aria-label="Logged time calendar"
            sx={{
              position: "relative",
              flexGrow: 1,
              height,
              borderLeft: 1,
              borderColor: "divider",
              bgcolor: "background.paper",
            }}
          >
            {marks.map((mark) => (
              <Box
                key={mark.getTime()}
                sx={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: top(mark),
                  borderTop: 1,
                  borderColor: "divider",
                  opacity: 0.55,
                }}
              />
            ))}
            {gaps.map((gap) => {
              const gapTop = top(gap.start);
              const gapHeight = Math.max(
                12,
                top(gap.end) - top(gap.start) - 2,
              );
              return (
                <Tooltip
                  key={`${gap.start.toISOString()}-${gap.end.toISOString()}`}
                  title={`${clock(gap.start)}–${clock(gap.end)} · ${formatMinutes(gap.minutes)} unlogged`}
                  arrow
                >
                  <Box
                    tabIndex={0}
                    aria-label={`${formatMinutes(gap.minutes)} unlogged gap from ${clock(gap.start)} to ${clock(gap.end)}`}
                    sx={{
                      position: "absolute",
                      top: gapTop + 1,
                      height: gapHeight,
                      left: 4,
                      right: 4,
                      border: "1px dashed",
                      borderColor: "warning.main",
                      bgcolor: "action.hover",
                      borderRadius: 1,
                      zIndex: 1,
                      minHeight: 12,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {gapHeight >= 24 && (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                        <WarningAmberIcon color="warning" sx={{ fontSize: 15 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                          {formatMinutes(gap.minutes)} gap
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                </Tooltip>
              );
            })}
            {blocks.map((block) => {
              const laneWidth = 100 / laneCount;
              const duration = (block.stop.getTime() - block.start.getTime()) / 60_000;
              const blockHeight = Math.max(20, top(block.stop) - top(block.start) - 2);
              return (
                <Tooltip
                  key={block.entry.id}
                  title={`${clock(block.start)}–${clock(block.stop)} · ${formatMinutes(duration)} · #${block.entry.ticketNumber ?? block.entry.ticketId} ${block.entry.ticketTitle || block.entry.content}`}
                  arrow
                >
                  <Box
                    component={onOpenTicket ? "button" : "div"}
                    onClick={() => onOpenTicket?.(block.entry.ticketId)}
                    aria-label={`Open ticket ${block.entry.ticketNumber ?? block.entry.ticketId}, ${formatMinutes(duration)} logged`}
                    sx={{
                      position: "absolute",
                      top: top(block.start) + 1,
                      height: blockHeight,
                      left: `calc(${block.lane * laneWidth}% + 7px)`,
                      width: `calc(${laneWidth}% - 14px)`,
                      zIndex: 2,
                      border: 1,
                      borderColor: "divider",
                      borderLeft: "5px solid",
                      borderLeftColor: chartColor(1),
                      borderRadius: 1,
                      bgcolor: "background.paper",
                      color: "text.primary",
                      textAlign: "left",
                      px: 1,
                      py: 0.5,
                      overflow: "hidden",
                      cursor: onOpenTicket ? "pointer" : "default",
                      font: "inherit",
                      "&:hover, &:focus-visible": { bgcolor: "action.hover" },
                    }}
                  >
                    <Typography variant="caption" noWrap sx={{ display: "block", fontWeight: 700 }}>
                      #{block.entry.ticketNumber ?? block.entry.ticketId} · {formatMinutes(duration)}
                    </Typography>
                    {blockHeight >= 38 && (
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                        {block.entry.ticketTitle || block.entry.content}
                      </Typography>
                    )}
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

function DayTable({
  entries,
  gaps,
  onOpenTicket,
}: {
  entries: api.MyDayEntry[];
  gaps: Array<{ start: Date; end: Date; minutes: number }>;
  onOpenTicket?: (ticketId: number) => void;
}) {
  const rows = [
    ...entries.map((entry) => ({
      key: `entry-${entry.id}`,
      type: "Logged entry",
      start: entry.timeStart ? new Date(entry.timeStart) : new Date(entry.workedAt),
      stop: entry.timeStop ? new Date(entry.timeStop) : null,
      minutes: entry.minutes,
      ticket: `#${entry.ticketNumber ?? entry.ticketId} · ${entry.ticketTitle || entry.content}`,
      ticketId: entry.ticketId,
    })),
    ...gaps.map((gap) => ({
      key: `gap-${gap.start.toISOString()}`,
      type: "Unlogged gap",
      start: gap.start,
      stop: gap.end,
      minutes: gap.minutes,
      ticket: "—",
      ticketId: null,
    })),
  ].sort((left, right) => left.start.getTime() - right.start.getTime());

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: "100%", overflowX: "auto" }}>
      <Table size="small" aria-label="Day spread table" sx={{ minWidth: 680 }}>
        <TableHead>
          <TableRow>
            <TableCell>Kind</TableCell>
            <TableCell>When</TableCell>
            <TableCell>Duration</TableCell>
            <TableCell>Ticket / meaning</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  {row.type === "Unlogged gap" ? (
                    <WarningAmberIcon color="warning" fontSize="small" />
                  ) : (
                    <AccessTimeIcon sx={{ color: chartColor(1) }} fontSize="small" />
                  )}
                  <span>{row.type}</span>
                </Stack>
              </TableCell>
              <TableCell>
                {clock(row.start)}
                {row.stop ? `–${clock(row.stop)}` : " · no window"}
              </TableCell>
              <TableCell>{formatMinutes(row.minutes)}</TableCell>
              <TableCell>
                {row.ticketId && onOpenTicket ? (
                  <Button size="small" onClick={() => onOpenTicket(row.ticketId!)}>
                    {row.ticket}
                  </Button>
                ) : (
                  row.ticket
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface TimelineItem {
  key: string;
  at: Date;
  lane: "lifecycle" | "target" | "breach";
  label: string;
  detail: string;
  reconstructed: boolean;
  direct: boolean;
}

function TicketSlaTimeline({ onOpenTicket }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<TicketOption[]>([]);
  const [target, setTarget] = useState<TicketOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [response, setResponse] = useState<api.TicketSlaTimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<"track" | "table">("track");

  useEffect(() => {
    if (query.trim().length === 0) {
      setOptions([]);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .searchTickets(query.trim(), 20)
        .then((rows) => {
          if (active) {
            setOptions(
              rows.map(toTicketOption).filter((row): row is TicketOption => row !== null),
            );
          }
        })
        .catch((cause) => {
          if (active) setError(errorText(cause));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!target) {
      setResponse(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getTicketSlaTimeline(target.id)
      .then((result) => {
        if (active) setResponse(result);
      })
      .catch((cause) => {
        if (active) {
          setResponse(null);
          setError(errorText(cause));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [target]);

  const items = useMemo(() => timelineItems(response?.data), [response?.data]);
  const snapshotCount = response?.data.targets.length ?? 0;

  return (
    <Stack
      data-testid="time-sla-timeline"
      spacing={2}
      style={chartCssVars(theme.palette.mode)}
      sx={{ minWidth: 0 }}
    >
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { xs: "stretch", sm: "center" } }}
        >
          <Autocomplete
            options={options}
            value={target}
            inputValue={query}
            onInputChange={(_event, value) => setQuery(value)}
            onChange={(_event, value) => setTarget(value)}
            getOptionLabel={(option) => `#${option.ticketNumber} · ${option.title}`}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            loading={searching}
            sx={{ flexGrow: 1, minWidth: { sm: 340 } }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Find a ticket"
                placeholder="Number, title, company…"
              />
            )}
          />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={dataMode}
            onChange={(_event, value: "track" | "table" | null) => value && setDataMode(value)}
            aria-label="SLA timeline presentation"
          >
            <ToggleButton value="track" aria-label="Track view">
              <TimelineIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="table" aria-label="Table view">
              <TableRowsIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
          {target && onOpenTicket && (
            <Button variant="outlined" onClick={() => onOpenTicket(target.id)}>
              Open ticket
            </Button>
          )}
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {response?.meta.includesReconstructed && (
        <Alert severity="warning" icon={<HistoryToggleOffIcon />}>
          This track includes reconstructed lifecycle history. Markers labelled
          reconstructed were inferred from audit history and are not original recordings.
        </Alert>
      )}
      {response && snapshotCount === 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon />}>
          No frozen SLA target was recorded for this ticket. Its historical promise is
          unknown; the current SLA policy is deliberately not substituted.
        </Alert>
      )}

      {!target ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
          <FlagOutlinedIcon color="disabled" sx={{ fontSize: 44 }} />
          <Typography variant="h6">Choose one ticket</Typography>
          <Typography variant="body2" color="text.secondary">
            The track will show recorded lifecycle facts and the frozen targets in force.
          </Typography>
        </Paper>
      ) : loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : response && items.length === 0 ? (
        <Alert severity="info">No recorded lifecycle or SLA target data for this ticket.</Alert>
      ) : response ? (
        dataMode === "track" ? (
          <TimelineTrack items={items} />
        ) : (
          <TimelineTable items={items} />
        )
      ) : null}
    </Stack>
  );
}

function timelineItems(data: api.TicketSlaTimelineData | undefined): TimelineItem[] {
  if (!data) return [];
  const eventItems: TimelineItem[] = data.events.map((event) => {
    const reconstructed = event.actor === "backfill";
    const breach = event.kind === "sla_breached";
    return {
      key: `event-${event.id}`,
      at: new Date(event.occurredAt),
      lane: breach ? "breach" : "lifecycle",
      label: eventLabel(event.kind),
      detail: eventDetail(event),
      reconstructed,
      direct:
        breach ||
        ["created", "first_response", "resolved", "reopened"].includes(event.kind),
    };
  });
  const snapshotItems = data.targets.flatMap((snapshot) => {
    const common = `${snapshot.policyName || "Unnamed policy"} · frozen when established ${preciseTime(snapshot.establishedAt)}`;
    const rows: TimelineItem[] = [
      {
        key: `snapshot-${snapshot.id}-established`,
        at: new Date(snapshot.establishedAt),
        lane: "target",
        label: "SLA established",
        detail: common,
        reconstructed: false,
        direct: false,
      },
    ];
    if (snapshot.responseDueAt) {
      rows.push({
        key: `snapshot-${snapshot.id}-response`,
        at: new Date(snapshot.responseDueAt),
        lane: "target",
        label: "Response target",
        detail: `${common} · ${snapshot.responseMinutes ?? "?"} minutes`,
        reconstructed: false,
        direct: true,
      });
    }
    if (snapshot.resolutionDueAt) {
      rows.push({
        key: `snapshot-${snapshot.id}-resolution`,
        at: new Date(snapshot.resolutionDueAt),
        lane: "target",
        label: "Resolution target",
        detail: `${common} · ${snapshot.resolutionMinutes ?? "?"} minutes`,
        reconstructed: false,
        direct: true,
      });
    }
    return rows;
  });
  return [...eventItems, ...snapshotItems]
    .filter((item) => !Number.isNaN(item.at.getTime()))
    .sort((left, right) => left.at.getTime() - right.at.getTime());
}

function eventLabel(kind: string): string {
  const labels: Record<string, string> = {
    created: "Created",
    status_changed: "Status changed",
    assigned: "Assigned",
    context_changed: "Context changed",
    first_response: "First response",
    resolved: "Resolved",
    reopened: "Reopened",
    merged: "Merged",
    sla_breached: "SLA breached",
  };
  return labels[kind] ?? kind.replace(/_/g, " ");
}

function eventDetail(event: api.TicketSlaTimelineEvent): string {
  const transition =
    event.fromValue || event.toValue
      ? `${event.fromValue || "—"} → ${event.toValue || "—"}`
      : "Recorded lifecycle fact";
  return `${transition}${event.actor ? ` · ${event.actor}` : ""}`;
}

function TimelineTrack({ items }: { items: TimelineItem[] }) {
  const minAt = items[0].at.getTime();
  const maxAt = items[items.length - 1].at.getTime();
  const padding = maxAt === minAt ? 60 * 60 * 1000 : (maxAt - minAt) * 0.04;
  const start = minAt - padding;
  const end = maxAt + padding;
  const position = (at: Date) => ((at.getTime() - start) / (end - start)) * 100;
  const lanes: Array<{ id: TimelineItem["lane"]; label: string; top: number }> = [
    { id: "lifecycle", label: "Lifecycle", top: 72 },
    { id: "target", label: "Frozen targets", top: 156 },
    { id: "breach", label: "Breach", top: 240 },
  ];
  const ticks = Array.from({ length: 5 }, (_unused, index) => {
    const at = new Date(start + ((end - start) * index) / 4);
    return { at, left: (index / 4) * 100 };
  });

  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
        <LegendMark shape="circle" label="Recorded lifecycle" color={chartColor(1)} />
        <LegendMark shape="diamond" label="Frozen SLA target" color={chartColor(2)} />
        <LegendMark shape="ring" label="Breach" color="error.main" />
        <Chip size="small" icon={<HistoryToggleOffIcon />} label="Reconstructed is text-labelled" />
      </Stack>
      <Box sx={{ overflowX: "auto", maxWidth: "100%" }}>
        <Box sx={{ minWidth: 900, position: "relative", height: 310, pl: 110, pr: 2 }}>
          {lanes.map((lane) => (
            <Box key={lane.id}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ position: "absolute", left: 0, top: lane.top - 9, width: 100 }}
              >
                {lane.label}
              </Typography>
              <Box
                sx={{
                  position: "absolute",
                  left: 110,
                  right: 16,
                  top: lane.top,
                  borderTop: 1,
                  borderColor: "divider",
                }}
              />
            </Box>
          ))}
          {ticks.map((tick) => (
            <Box
              key={tick.at.toISOString()}
              sx={{
                position: "absolute",
                left: `calc(110px + (100% - 126px) * ${tick.left / 100})`,
                top: 35,
                bottom: 30,
                borderLeft: 1,
                borderColor: "divider",
                opacity: 0.5,
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ position: "absolute", top: 246, left: -42, width: 84, textAlign: "center" }}
              >
                {tick.at.toLocaleDateString([], { month: "short", day: "numeric" })}
              </Typography>
            </Box>
          ))}
          {items.map((item, index) => {
            const lane = lanes.find((candidate) => candidate.id === item.lane)!;
            const left = position(item.at);
            const color =
              item.lane === "target"
                ? chartColor(2)
                : item.lane === "breach"
                  ? "error.main"
                  : chartColor(1);
            return (
              <Tooltip
                key={item.key}
                arrow
                title={`${item.label} · ${preciseTime(item.at)} · ${item.detail}${item.reconstructed ? " · reconstructed" : ""}`}
              >
                <Box
                  tabIndex={0}
                  aria-label={`${item.label} at ${preciseTime(item.at)}${item.reconstructed ? ", reconstructed" : ""}`}
                  sx={{
                    position: "absolute",
                    left: `calc(110px + (100% - 126px) * ${left / 100})`,
                    top: lane.top - 10,
                    width: 20,
                    height: 20,
                    ml: -1.25,
                    display: "grid",
                    placeItems: "center",
                    zIndex: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: item.lane === "breach" ? 16 : 12,
                      height: item.lane === "breach" ? 16 : 12,
                      borderRadius: item.lane === "target" ? 0 : "50%",
                      transform: item.lane === "target" ? "rotate(45deg)" : "none",
                      bgcolor: item.lane === "breach" ? "background.paper" : color,
                      border: item.lane === "breach" ? "3px solid" : "2px solid",
                      borderColor: color,
                      boxShadow: "0 0 0 2px",
                      color: "background.paper",
                    }}
                  />
                  {item.direct && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        position: "absolute",
                        top: index % 2 === 0 ? -31 : 23,
                        width: 112,
                        textAlign: "center",
                        fontWeight: 700,
                        lineHeight: 1.1,
                      }}
                    >
                      {item.label}
                      {item.reconstructed ? " · reconstructed" : ""}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
}

function LegendMark({
  shape,
  label,
  color,
}: {
  shape: "circle" | "diamond" | "ring";
  label: string;
  color: string;
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: shape === "diamond" ? 0 : "50%",
          transform: shape === "diamond" ? "rotate(45deg)" : "none",
          bgcolor: shape === "ring" ? "background.paper" : color,
          border: shape === "ring" ? "2px solid" : 0,
          borderColor: color,
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

function TimelineTable({ items }: { items: TimelineItem[] }) {
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto", maxWidth: "100%" }}>
      <Table size="small" aria-label="Ticket SLA timeline table" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            <TableCell>When</TableCell>
            <TableCell>Track</TableCell>
            <TableCell>Fact</TableCell>
            <TableCell>Detail</TableCell>
            <TableCell>Provenance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.key}>
              <TableCell>{preciseTime(item.at)}</TableCell>
              <TableCell>{item.lane === "target" ? "Frozen target" : item.lane}</TableCell>
              <TableCell>{item.label}</TableCell>
              <TableCell>{item.detail}</TableCell>
              <TableCell>
                {item.reconstructed ? (
                  <Chip size="small" icon={<HistoryToggleOffIcon />} label="Reconstructed" />
                ) : (
                  "Recorded"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
