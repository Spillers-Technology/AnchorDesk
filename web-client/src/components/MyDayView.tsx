// ./components/MyDayView.tsx
// "My Day" — a day-spread of the signed-in tech's logged time. The point is to
// make UNLOGGED time obvious: placed entries (with a start/stop window) sit on a
// vertical clock, and the spans between them render as labelled "gap" bands so
// holes in the day pop at a glance. Duration-only entries (no window) can't be
// placed, so they live in a side tray but still count toward the total.
import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Paper,
  Stack,
  Typography,
  IconButton,
  Button,
  Chip,
  CircularProgress,
  Tooltip,
  Divider,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import * as api from "../api/client";

const HOUR_PX = 56; // vertical pixels per hour on the spread
const DEFAULT_START_HOUR = 7; // window floor unless work starts earlier
const DEFAULT_END_HOUR = 19; // window ceiling unless work runs later
const GAP_MIN = 5; // ignore sub-5-minute gaps as noise

interface Props {
  onOpenTicket?: (ticketId: number) => void;
}

/** "2h 15m" / "45m" / "0m" */
function fmtMins(m: number): string {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface PlacedBlock {
  entry: api.MyDayEntry;
  start: Date;
  stop: Date;
  lane: number;
}

export default function MyDayView({ onOpenTicket }: Props) {
  const [day, setDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [data, setData] = useState<api.MyDay | null>(null);
  const [loading, setLoading] = useState(true);

  const from = day;
  const to = useMemo(() => new Date(day.getTime() + 24 * 60 * 60 * 1000), [day]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.getMyDay(from, to)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setData(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, to]);

  const isToday = useMemo(() => {
    const t = new Date();
    return t.getFullYear() === day.getFullYear() && t.getMonth() === day.getMonth() && t.getDate() === day.getDate();
  }, [day]);

  const placedEntries = (data?.entries ?? []).filter((e) => e.placed && e.timeStart && e.timeStop);
  const unplacedEntries = (data?.entries ?? []).filter((e) => !e.placed);

  // Vertical window: clamp the default working hours out to cover any work that
  // happened outside them, rounded to whole hours.
  const { windowStart, windowEnd } = useMemo(() => {
    const startFloor = new Date(day); startFloor.setHours(DEFAULT_START_HOUR, 0, 0, 0);
    const endCeil = new Date(day); endCeil.setHours(DEFAULT_END_HOUR, 0, 0, 0);
    let ws = startFloor.getTime();
    let we = endCeil.getTime();
    for (const e of placedEntries) {
      const s = new Date(e.timeStart!).getTime();
      const t = new Date(e.timeStop!).getTime();
      if (s < ws) ws = new Date(s).setMinutes(0, 0, 0);
      if (t > we) we = new Date(t).setMinutes(0, 0, 0) + 60 * 60 * 1000;
    }
    return { windowStart: new Date(ws), windowEnd: new Date(we) };
  }, [day, placedEntries]);

  const rangeMin = (windowEnd.getTime() - windowStart.getTime()) / 60000;
  const trackHeight = (rangeMin / 60) * HOUR_PX;
  const minToPx = (m: number) => (m / 60) * HOUR_PX;
  const topFor = (d: Date) => minToPx((d.getTime() - windowStart.getTime()) / 60000);

  // Greedy lane packing so overlapping entries sit side by side instead of hiding.
  const blocks: PlacedBlock[] = useMemo(() => {
    const sorted = placedEntries
      .map((e) => ({ entry: e, start: new Date(e.timeStart!), stop: new Date(e.timeStop!) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const laneEnds: number[] = [];
    return sorted.map((b) => {
      let lane = laneEnds.findIndex((end) => end <= b.start.getTime());
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.stop.getTime()); }
      else laneEnds[lane] = b.stop.getTime();
      return { ...b, lane };
    });
  }, [placedEntries]);

  const laneCount = blocks.reduce((m, b) => Math.max(m, b.lane + 1), 1);

  // Interior gaps: merge logged intervals, then the holes between first and last
  // activity are the unlogged spans worth flagging.
  const gaps = useMemo(() => {
    if (blocks.length < 2) return [] as { start: Date; end: Date; minutes: number }[];
    const intervals = blocks
      .map((b) => ({ s: b.start.getTime(), e: b.stop.getTime() }))
      .sort((a, b) => a.s - b.s);
    const merged: { s: number; e: number }[] = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
      else merged.push({ ...iv });
    }
    const out: { start: Date; end: Date; minutes: number }[] = [];
    for (let i = 1; i < merged.length; i++) {
      const minutes = (merged[i].s - merged[i - 1].e) / 60000;
      if (minutes >= GAP_MIN) out.push({ start: new Date(merged[i - 1].e), end: new Date(merged[i].s), minutes });
    }
    return out;
  }, [blocks]);

  const totalGapMin = gaps.reduce((s, g) => s + g.minutes, 0);

  const hourMarks = useMemo(() => {
    const marks: Date[] = [];
    const h = new Date(windowStart);
    while (h.getTime() <= windowEnd.getTime()) {
      marks.push(new Date(h));
      h.setHours(h.getHours() + 1);
    }
    return marks;
  }, [windowStart, windowEnd]);

  const shiftDay = (delta: number) => setDay((d) => new Date(d.getTime() + delta * 24 * 60 * 60 * 1000));
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setDay(d); };

  const now = new Date();
  const showNowLine = isToday && now.getTime() >= windowStart.getTime() && now.getTime() <= windowEnd.getTime();

  return (
    <Stack spacing={2}>
      {/* Header: date nav + summary */}
      <Paper variant="outlined" sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Stack direction="row" spacing={0.5} sx={{
          alignItems: "center"
        }}>
          <Tooltip title="Previous day"><IconButton size="small" onClick={() => shiftDay(-1)}><ChevronLeftIcon /></IconButton></Tooltip>
          <Tooltip title="Next day"><IconButton size="small" onClick={() => shiftDay(1)}><ChevronRightIcon /></IconButton></Tooltip>
          <Button size="small" variant={isToday ? "contained" : "outlined"} onClick={goToday} sx={{ ml: 0.5 }}>Today</Button>
        </Stack>
        <Typography variant="h6" sx={{ ml: 1 }}>
          {day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Stack direction="row" spacing={1} sx={{
          alignItems: "center"
        }}>
          <Chip icon={<AccessTimeIcon />} color="primary" variant="outlined"
            label={`${fmtMins(data?.summary.loggedMinutes ?? 0)} logged`} />
          {totalGapMin > 0 && (
            <Chip color="warning" variant="outlined" label={`${fmtMins(totalGapMin)} in gaps`} />
          )}
          {data?.summary.firstStart && data?.summary.lastStop && (
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {fmtClock(new Date(data.summary.firstStart))} – {fmtClock(new Date(data.summary.lastStop))}
            </Typography>
          )}
        </Stack>
      </Paper>
      {loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>
      ) : (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{
          alignItems: "flex-start"
        }}>
          {/* The day spread */}
          <Paper variant="outlined" sx={{ p: 2, flexGrow: 1, width: "100%", minWidth: 0 }}>
            {placedEntries.length === 0 ? (
              <Box sx={{ py: 6, textAlign: "center", color: "text.secondary" }}>
                <Typography variant="body2">No time placed on the clock for this day.</Typography>
                <Typography variant="caption">Log time with a start &amp; stop on a ticket to see it spread here.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: "flex", position: "relative" }}>
                {/* Hour gutter */}
                <Box sx={{ width: 56, flexShrink: 0, position: "relative", height: trackHeight }}>
                  {hourMarks.map((h) => (
                    <Typography
                      key={h.getTime()}
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        position: "absolute",
                        top: topFor(h) - 8,
                        right: 8
                      }}>
                      {h.toLocaleTimeString([], { hour: "numeric" })}
                    </Typography>
                  ))}
                </Box>

                {/* Track */}
                <Box sx={{ position: "relative", flexGrow: 1, height: trackHeight, borderLeft: 1, borderColor: "divider" }}>
                  {/* Hour gridlines */}
                  {hourMarks.map((h) => (
                    <Box key={h.getTime()} sx={{ position: "absolute", left: 0, right: 0, top: topFor(h), borderTop: 1, borderColor: "divider", opacity: 0.5 }} />
                  ))}

                  {/* Gap bands (behind blocks). The tint lives on a backing layer
                      so the label keeps full contrast instead of being faded. */}
                  {gaps.map((g, i) => (
                    <Box key={`gap-${i}`} sx={{
                      position: "absolute", left: 4, right: 4,
                      top: topFor(g.start), height: minToPx(g.minutes),
                      border: "1px dashed", borderColor: "warning.main", borderRadius: 1,
                      display: "grid", placeItems: "center", overflow: "hidden",
                    }}>
                      <Box sx={{ position: "absolute", inset: 0, bgcolor: "warning.light", opacity: 0.25 }} />
                      <Typography variant="caption" sx={{ color: "warning.dark", fontWeight: 700, zIndex: 1 }}>
                        {fmtMins(g.minutes)} gap
                      </Typography>
                    </Box>
                  ))}

                  {/* Now line */}
                  {showNowLine && (
                    <Box sx={{ position: "absolute", left: 0, right: 0, top: topFor(now), borderTop: 2, borderColor: "error.main", zIndex: 3 }}>
                      <Box sx={{ position: "absolute", left: -4, top: -4, width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main" }} />
                    </Box>
                  )}

                  {/* Placed entry blocks */}
                  {blocks.map((b) => {
                    const mins = (b.stop.getTime() - b.start.getTime()) / 60000;
                    const laneW = 100 / laneCount;
                    return (
                      <Box
                        key={b.entry.id}
                        onClick={() => onOpenTicket?.(b.entry.ticketId)}
                        sx={{
                          position: "absolute",
                          top: topFor(b.start) + 1,
                          height: Math.max(minToPx(mins) - 2, 16),
                          left: `calc(${b.lane * laneW}% + 4px)`,
                          width: `calc(${laneW}% - 8px)`,
                          bgcolor: "primary.main", color: "primary.contrastText",
                          borderRadius: 1, px: 1, py: 0.25, overflow: "hidden",
                          cursor: onOpenTicket ? "pointer" : "default", zIndex: 2,
                          boxShadow: 1, "&:hover": { bgcolor: "primary.dark" },
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 600, display: "block", lineHeight: 1.2 }} noWrap>
                          {b.entry.ticketNumber ? `#${b.entry.ticketNumber}` : "Ticket"} · {fmtMins(mins)}
                        </Typography>
                        {minToPx(mins) > 30 && (
                          <Typography variant="caption" sx={{ display: "block", opacity: 0.85, lineHeight: 1.2 }} noWrap>
                            {b.entry.ticketTitle || b.entry.content}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
          </Paper>

          {/* Unplaced (duration-only) tray */}
          {unplacedEntries.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, width: { xs: "100%", md: 280 }, flexShrink: 0 }}>
              <Typography variant="subtitle2" gutterBottom>Duration-only</Typography>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                Logged without a start/stop, so they can't sit on the clock — but they still count toward the day.
              </Typography>
              <Divider sx={{ my: 1 }} />
              <Stack spacing={1}>
                {unplacedEntries.map((e) => (
                  <Box key={e.id} onClick={() => onOpenTicket?.(e.ticketId)}
                    sx={{ p: 1, borderRadius: 1, border: 1, borderColor: "divider", cursor: onOpenTicket ? "pointer" : "default", "&:hover": { borderColor: "primary.main" } }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {e.ticketNumber ? `#${e.ticketNumber}` : "Ticket"} · {fmtMins(e.minutes)}
                    </Typography>
                    <Typography variant="body2" noWrap>{e.ticketTitle || e.content}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}
        </Stack>
      )}
    </Stack>
  );
}
