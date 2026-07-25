jest.mock('./syncService', () => ({
  runAllSync: jest.fn(),
}));

import { runAllSync } from './syncService';
import {
  runSyncSchedulerTick,
  stopSyncScheduler,
} from './syncScheduler';

const mockedRunAll = jest.mocked(runAllSync);
const log = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as never;

function result(over: Record<string, unknown> = {}) {
  return {
    runId: 1,
    providerId: 7,
    providerName: 'Jira job',
    status: 'success',
    ticketsCreated: 0,
    ticketsUpdated: 0,
    notesUpserted: 0,
    ticketsFiltered: 0,
    ticketsSkipped: 0,
    ticketsConflicted: 0,
    errorCount: 0,
    errors: [],
    durationMs: 10,
    ...over,
  };
}

describe('sync scheduler tick', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopSyncScheduler();
  });

  it('uses the same scheduled run path and reports exact issue counters', async () => {
    mockedRunAll.mockResolvedValue([
      result({
        status: 'degraded',
        ticketsConflicted: 2,
        errorCount: 1,
        errors: ['Ticket HELP-3: update rejected'],
      }),
    ] as never);

    await runSyncSchedulerTick(log);

    expect(mockedRunAll).toHaveBeenCalledWith({
      trigger: 'scheduled',
      actor: 'system',
    });
    expect((log as { warn: jest.Mock }).warn).toHaveBeenCalledWith(
      'sync[Jira job]: degraded, 3 issue(s) — Ticket HELP-3: update rejected'
    );
  });

  it('does not overlap scheduler ticks in one process', async () => {
    let release!: () => void;
    mockedRunAll.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([result()] as never);
        })
    );

    const first = runSyncSchedulerTick(log);
    while (mockedRunAll.mock.calls.length === 0) await Promise.resolve();
    await runSyncSchedulerTick(log);

    expect(mockedRunAll).toHaveBeenCalledTimes(1);
    expect((log as { warn: jest.Mock }).warn).toHaveBeenCalledWith(
      expect.stringContaining('previous run still in progress')
    );
    release();
    await first;
  });
});
