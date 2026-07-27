import { describe, expect, it } from "vitest";
import {
  calculateWorkdayCoverage,
  formatMinutes,
  localDayBounds,
  shiftLocalDay,
} from "./timeCalendarModel";

function onDay(day: Date, hour: number, minute = 0): Date {
  const value = new Date(day);
  value.setHours(hour, minute, 0, 0);
  return value;
}

describe("TIME calendar model", () => {
  it("makes leading, interior, and trailing workday gaps first-class", () => {
    const day = new Date(2026, 6, 24);
    const coverage = calculateWorkdayCoverage(
      [
        { start: onDay(day, 10), end: onDay(day, 12) },
        { start: onDay(day, 13), end: onDay(day, 15) },
      ],
      day,
    );

    expect(coverage.coveredMinutes).toBe(240);
    expect(coverage.gaps.map((gap) => gap.minutes)).toEqual([60, 60, 120]);
    expect(coverage.gaps[0].start.getHours()).toBe(9);
    expect(coverage.gaps[2].end.getHours()).toBe(17);
  });

  it("unions overlap and clips off-hours work before measuring gaps", () => {
    const day = new Date(2026, 6, 24);
    const coverage = calculateWorkdayCoverage(
      [
        { start: onDay(day, 8), end: onDay(day, 11) },
        { start: onDay(day, 10, 30), end: onDay(day, 12) },
        { start: onDay(day, 16), end: onDay(day, 19) },
      ],
      day,
    );

    expect(coverage.coveredMinutes).toBe(240);
    expect(coverage.merged).toHaveLength(2);
    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps[0].minutes).toBe(240);
  });

  it("builds local next-midnight bounds instead of assuming a 24-hour day", () => {
    const selected = new Date(2026, 2, 8, 13, 30);
    const { from, to } = localDayBounds(selected);

    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(0);
    expect(to.getDate()).toBe(9);
    expect(shiftLocalDay(selected, 1).getDate()).toBe(9);
    expect(shiftLocalDay(selected, -1).getDate()).toBe(7);
  });

  it("formats the eight-hour target without decimal-hour ambiguity", () => {
    expect(formatMinutes(480)).toBe("8h");
    expect(formatMinutes(255)).toBe("4h 15m");
    expect(formatMinutes(45)).toBe("45m");
  });
});
