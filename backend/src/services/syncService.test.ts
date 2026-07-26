jest.mock('../db/prisma', () => ({
  prisma: {
    syncLog: { create: jest.fn() },
    syncProvider: { updateMany: jest.fn(), findMany: jest.fn() },
    ticket: { findFirst: jest.fn(), findMany: jest.fn() },
    note: { findFirst: jest.fn() },
  },
}));

jest.mock('../providers/ticketProviderFactory', () => ({
  createTicketProvider: jest.fn(),
  resolveCredentials: jest.fn(),
}));

jest.mock('../repositories/ticketRepository', () => ({
  create: jest.fn(),
  upsertExternal: jest.fn(),
}));

jest.mock('../repositories/noteRepository', () => ({
  create: jest.fn(),
}));

jest.mock('./twoWaySync', () => ({
  reconcileTicketWithinAccountLock: jest.fn(),
}));

jest.mock('./syncAccountLock', () => ({
  syncAccountKeyForProvider: jest.fn(
    (type: string, connectionId: number | null, providerId: number) =>
      type === 'jira' && connectionId != null
        ? `jira:connection:${connectionId}`
        : `${type}:job:${providerId}`
  ),
  withSyncAccountLock: jest.fn(
    async (_accountKey: string, operation: () => Promise<unknown>) => operation()
  ),
}));

jest.mock('../repositories/syncRunRepository', () => {
  const actual = jest.requireActual('../repositories/syncRunRepository');
  return {
    ...actual,
    start: jest.fn(),
    finish: jest.fn(),
  };
});

import { prisma } from '../db/prisma';
import {
  createTicketProvider,
  resolveCredentials,
} from '../providers/ticketProviderFactory';
import * as noteRepo from '../repositories/noteRepository';
import * as syncRunRepo from '../repositories/syncRunRepository';
import * as ticketRepo from '../repositories/ticketRepository';
import * as twoWaySync from './twoWaySync';
import {
  runSync,
  SyncAlreadyRunningError,
  SyncRunFinalizationError,
} from './syncService';

const db = prisma as unknown as {
  syncLog: { create: jest.Mock };
  syncProvider: { updateMany: jest.Mock; findMany: jest.Mock };
  ticket: { findFirst: jest.Mock; findMany: jest.Mock };
  note: { findFirst: jest.Mock };
};
const mockedCreateProvider = jest.mocked(createTicketProvider);
const mockedNotes = jest.mocked(noteRepo);
const mockedResolveCredentials = jest.mocked(resolveCredentials);
const mockedRuns = jest.mocked(syncRunRepo);
const mockedTickets = jest.mocked(ticketRepo);
const mockedTwoWay = jest.mocked(twoWaySync);

const providerRow = {
  id: 7,
  name: 'Contoso Jira',
  type: 'jira',
  config: {},
  lastSyncedAt: null,
  configRevision: 1,
  connectionId: 3,
};

function provider(over: Record<string, unknown> = {}) {
  return {
    name: 'jira',
    canWriteBack: false,
    fetchTickets: jest.fn().mockResolvedValue([]),
    fetchNotes: jest.fn().mockResolvedValue([]),
    ...over,
  };
}

describe('durable sync run recording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRuns.start.mockResolvedValue({ id: 44 } as never);
    mockedRuns.finish.mockResolvedValue({ id: 44 } as never);
    mockedResolveCredentials.mockResolvedValue({ connectionId: 3, credentials: {} as never });
    mockedCreateProvider.mockReturnValue(provider() as never);
    db.syncLog.create.mockResolvedValue({});
    db.syncProvider.updateMany.mockResolvedValue({ count: 1 });
    db.ticket.findMany.mockResolvedValue([]);
  });

  it('records a successful zero-ticket manual run', async () => {
    const result = await runSync(providerRow, { trigger: 'manual', actor: 'admin' });

    expect(mockedRuns.start).toHaveBeenCalledWith(
      7,
      1,
      'manual',
      'admin',
      'jira:connection:3'
    );
    expect(result).toMatchObject({
      runId: 44,
      status: 'success',
      ticketsCreated: 0,
      ticketsUpdated: 0,
      errors: [],
    });
    expect(mockedRuns.finish).toHaveBeenCalledWith(
      44,
      'success',
      expect.objectContaining({ runId: 44, status: 'success' })
    );
    expect(db.syncProvider.updateMany).toHaveBeenCalledWith({
      where: { id: 7, configRevision: 1 },
      data: { lastSyncedAt: expect.any(Date) },
    });
  });

  it('preserves inbound time-entry timestamps and fails portal visibility closed', async () => {
    const timeStart = new Date('2026-07-24T13:00:00.000Z');
    const timeStop = new Date('2026-07-24T13:45:00.000Z');
    const createdAt = new Date('2026-07-25T09:00:00.000Z');
    mockedCreateProvider.mockReturnValue(provider({
      fetchTickets: jest.fn().mockResolvedValue([{
        externalId: 'HELP-77',
        title: 'Printer maintenance',
        status: 'Closed',
        priority: 'Medium',
      }]),
      fetchNotes: jest.fn().mockResolvedValue([{
        externalId: 'work-77',
        content: 'Remote labor',
        author: 'Remote technician',
        noteType: 'time_entry',
        // A stale or faulty adapter cannot make a time entry requester-visible.
        visibility: 'public',
        timeStart,
        timeStop,
        createdAt,
      }]),
    }) as never);
    mockedTickets.upsertExternal.mockResolvedValue({
      created: true,
      merged: false,
    } as never);
    db.ticket.findFirst.mockResolvedValue({ id: 99 });
    db.note.findFirst.mockResolvedValue(null);
    mockedNotes.create.mockResolvedValue({ id: 77 } as never);

    const result = await runSync(providerRow, { trigger: 'manual', actor: 'admin' });

    expect(result).toMatchObject({ status: 'success', notesUpserted: 1 });
    expect(mockedNotes.create).toHaveBeenCalledWith(
      99,
      {
        content: 'Remote labor',
        author: 'Remote technician',
        noteType: 'time_entry',
        timeStart,
        timeStop,
        createdAt,
        externalId: 'work-77',
        visibility: 'internal',
        via: 'sync',
      },
      'system',
    );
    // noteRepository derives persisted workedAt from timeStart. Supplying both
    // would conflict with its guard and create two authorities for the work date.
    expect(mockedNotes.create.mock.calls[0][1]).not.toHaveProperty('workedAt');
  });

  it('records a fetch failure as an error run and links its log row', async () => {
    mockedCreateProvider.mockReturnValue(
      provider({ fetchTickets: jest.fn().mockRejectedValue(new Error('401 rejected')) }) as never
    );

    const result = await runSync(providerRow, { trigger: 'scheduled', actor: 'system' });

    expect(result.status).toBe('error');
    expect(result.errors[0]).toMatch(/Failed to fetch tickets/);
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ providerId: 7, runId: 44, status: 'error' }),
    });
    expect(mockedRuns.finish).toHaveBeenCalledWith(44, 'error', expect.any(Object));
    expect(db.syncProvider.updateMany).not.toHaveBeenCalled();
  });

  it('classifies held conflicts as degraded and persists their counts', async () => {
    mockedCreateProvider.mockReturnValue(
      provider({
        canWriteBack: true,
        fetchTickets: jest.fn().mockResolvedValue([
          {
            externalId: 'HELP-1',
            title: 'Conflict',
            status: 'In Progress',
            priority: 'High',
          },
        ]),
      }) as never
    );
    db.ticket.findFirst.mockResolvedValue({ id: 99 });
    // The same pending ticket was snapshotted before the remote fetch. It must
    // not be reconciled a second time in the backlog pass.
    db.ticket.findMany.mockResolvedValue([{ id: 99, externalId: 'HELP-1' }]);
    mockedTwoWay.reconcileTicketWithinAccountLock.mockResolvedValue({
      ticketId: 99,
      outcome: 'conflict',
      message: 'held for manual resolution',
      notesUpserted: 2,
    });

    const result = await runSync(providerRow, { trigger: 'manual', actor: 'admin' });

    expect(result).toMatchObject({
      status: 'degraded',
      ticketsConflicted: 1,
      ticketsSkipped: 0,
      notesUpserted: 2,
    });
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: 7,
        runId: 44,
        externalId: 'HELP-1',
        status: 'skipped',
      }),
    });
    expect(mockedRuns.finish).toHaveBeenCalledWith(
      44,
      'degraded',
      expect.objectContaining({ ticketsConflicted: 1 })
    );
    expect(mockedTwoWay.reconcileTicketWithinAccountLock).toHaveBeenCalledTimes(1);
  });

  it('still finishes the run when provider construction throws unexpectedly', async () => {
    mockedCreateProvider.mockImplementation(() => {
      throw new Error('bad provider config');
    });

    const result = await runSync(providerRow, { trigger: 'manual', actor: 'admin' });

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(['Sync run failed: bad provider config']);
    expect(mockedRuns.finish).toHaveBeenCalledWith(44, 'error', expect.any(Object));
  });

  it('retries an idempotent terminal write after a lost database response', async () => {
    mockedRuns.finish
      .mockRejectedValueOnce(new Error('connection reset after commit'))
      .mockResolvedValueOnce({ id: 44 } as never);

    await expect(
      runSync(providerRow, { trigger: 'manual', actor: 'admin' })
    ).resolves.toMatchObject({ runId: 44, status: 'success' });
    expect(mockedRuns.finish).toHaveBeenCalledTimes(2);
  });

  it('preserves the durable run id when terminalization fails twice', async () => {
    mockedRuns.finish.mockRejectedValue(new Error('database unavailable'));

    await expect(
      runSync(providerRow, { trigger: 'manual', actor: 'admin' })
    ).rejects.toMatchObject<Partial<SyncRunFinalizationError>>({
      runId: 44,
    });
    expect(mockedRuns.finish).toHaveBeenCalledTimes(2);
  });

  it('rejects an overlapping run for the same job in this process', async () => {
    let releaseFetch!: () => void;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchTickets = jest.fn(
      () =>
        new Promise<never[]>((resolve) => {
          markFetchStarted();
          releaseFetch = () => resolve([]);
        })
    );
    mockedCreateProvider.mockReturnValue(provider({ fetchTickets }) as never);

    const first = runSync(providerRow, { trigger: 'manual', actor: 'admin' });
    await Promise.race([
      fetchStarted,
      first.then(() => {
        throw new Error('the first sync completed before reaching the held fetch');
      }),
    ]);

    await expect(
      runSync(providerRow, { trigger: 'manual', actor: 'admin' })
    ).rejects.toBeInstanceOf(SyncAlreadyRunningError);

    releaseFetch();
    await expect(first).resolves.toMatchObject({ status: 'success' });
  });

  it('keeps exact error counts while bounding returned issue samples', async () => {
    const externalTickets = Array.from({ length: 25 }, (_, index) => ({
      externalId: `HELP-${index + 1}`,
      title: `Ticket ${index + 1}`,
      status: 'In Progress',
      priority: 'High',
    }));
    mockedCreateProvider.mockReturnValue(
      provider({
        canWriteBack: true,
        fetchTickets: jest.fn().mockResolvedValue(externalTickets),
      }) as never
    );
    db.ticket.findFirst.mockResolvedValue({ id: 99 });
    mockedTwoWay.reconcileTicketWithinAccountLock.mockResolvedValue({
      ticketId: 99,
      outcome: 'error',
      message: 'remote rejected update',
    });

    const result = await runSync(providerRow, { trigger: 'manual', actor: 'admin' });

    expect(result.errorCount).toBe(25);
    expect(result.errors).toHaveLength(20);
    expect(result.errors.at(-1)).toContain('HELP-25');
    expect(result.errors[0]).toContain('HELP-6');
  });
});
