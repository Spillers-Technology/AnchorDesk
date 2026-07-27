jest.mock('../repositories/noteRepository', () => ({
  listTimeEntriesForUser: jest.fn(),
}));
jest.mock('../repositories/ticketEventRepository', () => {
  const actual = jest.requireActual('../repositories/ticketEventRepository');
  return {
    ...actual,
    reportProvenance: jest.fn(),
  };
});

import * as noteRepository from '../repositories/noteRepository';
import * as ticketEvents from '../repositories/ticketEventRepository';
import {
  daySpread,
  DEFAULT_DAY_TARGET_MINUTES,
  UnreportableDaySpreadError,
} from './reporting';

const listTimeEntriesForUser =
  noteRepository.listTimeEntriesForUser as jest.Mock;
const reportProvenance = ticketEvents.reportProvenance as jest.Mock;

const from = new Date('2026-07-24T13:00:00.000Z');
const to = new Date('2026-07-24T21:00:00.000Z');
const meta = {
  from,
  to,
  includesReconstructed: false,
  reconstructedFrom: null,
  reconstructedThrough: null,
};

function entry(overrides: Record<string, unknown>) {
  return {
    id: 1,
    ticketId: 42,
    content: 'Work performed',
    author: 'Alice',
    authorId: 7,
    noteType: 'time_entry',
    minutes: 60,
    timeStart: new Date('2026-07-24T13:00:00.000Z'),
    timeStop: new Date('2026-07-24T14:00:00.000Z'),
    workedAt: new Date('2026-07-24T13:00:00.000Z'),
    ticket: { id: 42, ticketNumber: 'HD-42', title: 'Printer' },
    ...overrides,
  };
}

describe('TIME day spread', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reportProvenance.mockResolvedValue(meta);
  });

  it('makes overlaps and duration-only work explicit without double-counting coverage', async () => {
    listTimeEntriesForUser.mockResolvedValue([
      entry({ id: 1, minutes: 999 }),
      entry({
        id: 2,
        minutes: 90,
        timeStart: new Date('2026-07-24T13:30:00.000Z'),
        timeStop: new Date('2026-07-24T15:00:00.000Z'),
        workedAt: new Date('2026-07-24T13:30:00.000Z'),
      }),
      entry({
        id: 3,
        minutes: 30,
        timeStart: null,
        timeStop: null,
        workedAt: new Date('2026-07-24T16:00:00.000Z'),
      }),
    ]);

    const result = await daySpread(7, { from, to });

    expect(listTimeEntriesForUser).toHaveBeenCalledWith(7, from, to);
    expect(result.meta).toBe(meta);
    expect(result.data.entries.map(({ id, minutes, placed }) => ({
      id,
      minutes,
      placed,
    }))).toEqual([
      { id: 1, minutes: 60, placed: true },
      { id: 2, minutes: 90, placed: true },
      { id: 3, minutes: 30, placed: false },
    ]);
    expect(result.data.summary).toEqual({
      count: 3,
      loggedMinutes: 180,
      placedMinutes: 150,
      placedCoverageMinutes: 120,
      unplacedMinutes: 30,
      unloggedMinutes: 300,
      firstStart: new Date('2026-07-24T13:00:00.000Z'),
      lastStop: new Date('2026-07-24T15:00:00.000Z'),
    });
    expect(result.data.target).toEqual({
      minutes: DEFAULT_DAY_TARGET_MINUTES,
      source: 'default_8h',
      label: 'Default 09:00–17:00 local day (no staff schedule is configured)',
      startLocal: '09:00',
      endLocal: '17:00',
    });
  });

  it('returns a truthful empty data set rather than inventing an entry', async () => {
    listTimeEntriesForUser.mockResolvedValue([]);

    const result = await daySpread(7, { from, to });

    expect(result.data.entries).toEqual([]);
    expect(result.data.summary).toEqual({
      count: 0,
      loggedMinutes: 0,
      placedMinutes: 0,
      placedCoverageMinutes: 0,
      unplacedMinutes: 0,
      unloggedMinutes: DEFAULT_DAY_TARGET_MINUTES,
      firstStart: null,
      lastStop: null,
    });
  });

  it('fails closed when a time entry has no positive duration', async () => {
    listTimeEntriesForUser.mockResolvedValue([
      entry({
        id: 19,
        minutes: null,
        timeStart: null,
        timeStop: null,
      }),
    ]);

    await expect(daySpread(7, { from, to })).rejects.toEqual(
      new UnreportableDaySpreadError(19),
    );
  });
});
