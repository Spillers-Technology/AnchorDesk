export const DEFAULT_WORKDAY_START_HOUR = 9;
export const DEFAULT_WORKDAY_END_HOUR = 17;
export const DEFAULT_WORKDAY_MINUTES =
  (DEFAULT_WORKDAY_END_HOUR - DEFAULT_WORKDAY_START_HOUR) * 60;

export interface ClockInterval {
  start: Date;
  end: Date;
}

export interface CalendarGap extends ClockInterval {
  minutes: number;
}

export interface WorkdayCoverage {
  workdayStart: Date;
  workdayEnd: Date;
  merged: ClockInterval[];
  gaps: CalendarGap[];
  coveredMinutes: number;
}

/** Local calendar bounds, deliberately not `start + 24h`: DST days are not
 * always 24 hours long. */
export function localDayBounds(day: Date): { from: Date; to: Date } {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/** Move by a local calendar date so spring/fall DST transitions do not shift
 * the selected day by an hour. */
export function shiftLocalDay(day: Date, delta: number): Date {
  const shifted = new Date(day);
  shifted.setDate(shifted.getDate() + delta);
  shifted.setHours(0, 0, 0, 0);
  return shifted;
}

export function workdayBounds(
  day: Date,
  startHour = DEFAULT_WORKDAY_START_HOUR,
  endHour = DEFAULT_WORKDAY_END_HOUR,
): { start: Date; end: Date } {
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    endHour > 24 ||
    startHour >= endHour
  ) {
    throw new RangeError("workday hours must be whole hours with start before end");
  }
  const start = new Date(day);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(day);
  end.setHours(endHour, 0, 0, 0);
  return { start, end };
}

/** Union placed windows inside the explicit default workday, then return its
 * full complement. Leading and trailing gaps are intentional: hiding them made
 * a half-recorded day look complete whenever the first/last entry moved inward. */
export function calculateWorkdayCoverage(
  intervals: readonly ClockInterval[],
  day: Date,
  startHour = DEFAULT_WORKDAY_START_HOUR,
  endHour = DEFAULT_WORKDAY_END_HOUR,
): WorkdayCoverage {
  const { start: workdayStart, end: workdayEnd } = workdayBounds(
    day,
    startHour,
    endHour,
  );
  const floor = workdayStart.getTime();
  const ceiling = workdayEnd.getTime();

  const clipped = intervals
    .filter(
      ({ start, end }) =>
        !Number.isNaN(start.getTime()) &&
        !Number.isNaN(end.getTime()) &&
        end > start &&
        end.getTime() > floor &&
        start.getTime() < ceiling,
    )
    .map(({ start, end }) => ({
      start: new Date(Math.max(start.getTime(), floor)),
      end: new Date(Math.min(end.getTime(), ceiling)),
    }))
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  const merged: ClockInterval[] = [];
  for (const interval of clipped) {
    const prior = merged[merged.length - 1];
    if (prior && interval.start <= prior.end) {
      if (interval.end > prior.end) prior.end = interval.end;
    } else {
      merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }
  }

  const gaps: CalendarGap[] = [];
  let cursor = floor;
  for (const interval of merged) {
    if (interval.start.getTime() > cursor) {
      const start = new Date(cursor);
      const end = new Date(interval.start);
      gaps.push({
        start,
        end,
        minutes: (end.getTime() - start.getTime()) / 60_000,
      });
    }
    cursor = Math.max(cursor, interval.end.getTime());
  }
  if (cursor < ceiling) {
    const start = new Date(cursor);
    const end = new Date(ceiling);
    gaps.push({
      start,
      end,
      minutes: (end.getTime() - start.getTime()) / 60_000,
    });
  }

  const coveredMinutes = merged.reduce(
    (total, interval) =>
      total + (interval.end.getTime() - interval.start.getTime()) / 60_000,
    0,
  );
  return {
    workdayStart,
    workdayEnd,
    merged,
    gaps,
    coveredMinutes,
  };
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours && remainder) return `${hours}h ${remainder}m`;
  if (hours) return `${hours}h`;
  return `${remainder}m`;
}
