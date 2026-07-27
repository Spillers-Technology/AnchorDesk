import * as noteRepository from '../repositories/noteRepository';
import {
  reportProvenance,
  type ReportFilters,
  type ReportResult,
} from '../repositories/ticketEventRepository';

/** There is no staff-schedule model yet. Keep the v1 assumption explicit in
 * the wire contract so an eight-hour target is never mistaken for configured
 * policy. */
export const DEFAULT_DAY_TARGET_MINUTES = 8 * 60;

export class UnreportableDaySpreadError extends Error {
  constructor(entryId: number) {
    super(`time entry ${entryId} has no truthful duration`);
    this.name = 'UnreportableDaySpreadError';
  }
}

export interface DaySpreadEntry {
  id: number;
  ticketId: number;
  ticketNumber: string | null;
  ticketTitle: string | null;
  content: string;
  minutes: number;
  timeStart: Date | null;
  timeStop: Date | null;
  workedAt: Date;
  placed: boolean;
}

export interface DaySpreadData {
  assigneeId: number;
  entries: DaySpreadEntry[];
  target: {
    minutes: number;
    source: 'default_8h';
    label: string;
    startLocal: '09:00';
    endLocal: '17:00';
  };
  summary: {
    count: number;
    loggedMinutes: number;
    placedMinutes: number;
    /** Union across the requested bounds; UI clips gap geometry to its disclosed
     * local 09:00–17:00 target because the server has no user timezone. */
    placedCoverageMinutes: number;
    unplacedMinutes: number;
    /** Remaining billable-time target, including duration-only work. */
    unloggedMinutes: number;
    firstStart: Date | null;
    lastStop: Date | null;
  };
}

function durationForEntry(entry: {
  id: number;
  minutes: number | null;
  timeStart: Date | null;
  timeStop: Date | null;
}): { minutes: number; placed: boolean } {
  if (
    entry.timeStart &&
    entry.timeStop &&
    entry.timeStop > entry.timeStart
  ) {
    return {
      minutes: Math.max(
        0,
        Math.round(
          (entry.timeStop.getTime() - entry.timeStart.getTime()) / 60_000,
        ),
      ),
      placed: true,
    };
  }
  if (entry.minutes !== null && entry.minutes > 0) {
    return { minutes: entry.minutes, placed: false };
  }
  throw new UnreportableDaySpreadError(entry.id);
}

function coveredMinutes(
  entries: ReadonlyArray<{
    timeStart: Date | null;
    timeStop: Date | null;
    placed: boolean;
  }>,
  from: Date,
  to: Date,
): number {
  const intervals = entries
    .filter(
      (
        entry,
      ): entry is {
        timeStart: Date;
        timeStop: Date;
        placed: true;
      } => Boolean(entry.placed && entry.timeStart && entry.timeStop),
    )
    .map((entry) => ({
      start: Math.max(from.getTime(), entry.timeStart.getTime()),
      stop: Math.min(to.getTime(), entry.timeStop.getTime()),
    }))
    .filter((entry) => entry.stop > entry.start)
    .sort((a, b) => a.start - b.start || a.stop - b.stop);

  let covered = 0;
  let activeStart: number | null = null;
  let activeStop: number | null = null;
  for (const interval of intervals) {
    if (activeStart === null || activeStop === null) {
      activeStart = interval.start;
      activeStop = interval.stop;
      continue;
    }
    if (interval.start <= activeStop) {
      activeStop = Math.max(activeStop, interval.stop);
      continue;
    }
    covered += activeStop - activeStart;
    activeStart = interval.start;
    activeStop = interval.stop;
  }
  if (activeStart !== null && activeStop !== null) {
    covered += activeStop - activeStart;
  }
  return Math.round(covered / 60_000);
}

/** Same day-spread contract for REST and MCP. Rows stay in the note
 * repository; this service only derives presentation-safe coverage summaries. */
export async function daySpread(
  assigneeId: number,
  filters: Pick<ReportFilters, 'from' | 'to'>,
): Promise<ReportResult<DaySpreadData>> {
  const reportFilters: ReportFilters = {
    from: filters.from,
    to: filters.to,
  };
  const [rows, meta] = await Promise.all([
    noteRepository.listTimeEntriesForUser(
      assigneeId,
      reportFilters.from,
      reportFilters.to,
    ),
    reportProvenance(reportFilters),
  ]);

  const entries: DaySpreadEntry[] = rows.map((row) => {
    const duration = durationForEntry(row);
    // workedAt is required for 2.7 time entries and the boot migration fills
    // legacy rows. A null here means the migration invariant is missing.
    if (!row.workedAt) throw new UnreportableDaySpreadError(row.id);
    return {
      id: row.id,
      ticketId: row.ticketId,
      ticketNumber: row.ticket?.ticketNumber ?? null,
      ticketTitle: row.ticket?.title ?? null,
      content: row.content,
      minutes: duration.minutes,
      timeStart: row.timeStart,
      timeStop: row.timeStop,
      workedAt: row.workedAt,
      placed: duration.placed,
    };
  });

  const placed = entries.filter((entry) => entry.placed);
  const loggedMinutes = entries.reduce((total, entry) => total + entry.minutes, 0);
  const placedMinutes = placed.reduce((total, entry) => total + entry.minutes, 0);
  const coverage = coveredMinutes(entries, reportFilters.from, reportFilters.to);

  return {
    data: {
      assigneeId,
      entries,
      target: {
        minutes: DEFAULT_DAY_TARGET_MINUTES,
        source: 'default_8h',
        label: 'Default 09:00–17:00 local day (no staff schedule is configured)',
        startLocal: '09:00',
        endLocal: '17:00',
      },
      summary: {
        count: entries.length,
        loggedMinutes,
        placedMinutes,
        placedCoverageMinutes: coverage,
        unplacedMinutes: loggedMinutes - placedMinutes,
        unloggedMinutes: Math.max(
          0,
          DEFAULT_DAY_TARGET_MINUTES - loggedMinutes,
        ),
        firstStart: placed.length
          ? new Date(
              Math.min(
                ...placed.map((entry) => (entry.timeStart as Date).getTime()),
              ),
            )
          : null,
        lastStop: placed.length
          ? new Date(
              Math.max(
                ...placed.map((entry) => (entry.timeStop as Date).getTime()),
              ),
            )
          : null,
      },
    },
    meta,
  };
}
