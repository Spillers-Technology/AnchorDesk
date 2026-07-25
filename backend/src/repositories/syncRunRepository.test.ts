jest.mock('../db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    syncRun: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock('../services/syncAccountLock', () => {
  const actual = jest.requireActual('../services/syncAccountLock');
  return {
    ...actual,
    withSyncAccountLock: jest.fn(
      async (_accountKey: string, operation: () => Promise<unknown>) => operation()
    ),
  };
});

import { SyncRun } from '@prisma/client';
import { prisma } from '../db/prisma';
import { withSyncAccountLock } from '../services/syncAccountLock';
import {
  finish,
  healthForProviders,
  recoverInterruptedRuns,
  sanitizeSyncError,
  start,
} from './syncRunRepository';

const db = prisma as unknown as {
  $transaction: jest.Mock;
  syncRun: {
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    count: jest.Mock;
  };
};
const mockedWithSyncAccountLock = jest.mocked(withSyncAccountLock);

function run(over: Partial<SyncRun> = {}): SyncRun {
  return {
    id: 1,
    providerId: 7,
    configRevision: 1,
    lockProtocol: 1,
    trigger: 'scheduled',
    status: 'success',
    initiatedBy: 'system',
    startedAt: new Date('2026-07-25T12:00:00Z'),
    completedAt: new Date('2026-07-25T12:00:01Z'),
    durationMs: 1000,
    ticketsCreated: 1,
    ticketsUpdated: 2,
    notesUpserted: 3,
    ticketsFiltered: 4,
    ticketsSkipped: 0,
    ticketsConflicted: 0,
    errorCount: 0,
    latestError: null,
    ...over,
  };
}

describe('sync run persistence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts a durable running row with trigger and actor attribution', async () => {
    const created = run({ status: 'running', completedAt: null });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([
        { config_revision: 1, type: 'jira', connection_id: 12 },
      ]),
      syncRun: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );
    await start(7, 1, 'manual', 'admin', 'jira:connection:12');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.syncRun.count).toHaveBeenCalledWith({
      where: {
        status: 'running',
        provider: { type: 'jira', connectionId: 12 },
      },
    });
    expect(tx.syncRun.create).toHaveBeenCalledWith({
      data: {
        providerId: 7,
        configRevision: 1,
        lockProtocol: 1,
        trigger: 'manual',
        initiatedBy: 'admin',
        status: 'running',
      },
    });
  });

  it('refuses to start from a stale job revision', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      syncRun: { count: jest.fn(), create: jest.fn() },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(start(7, 1, 'manual', 'admin', 'jira:connection:12')).rejects.toThrow(
      'scope changed before the run started'
    );
    expect(tx.syncRun.create).not.toHaveBeenCalled();
  });

  it('uses the durable running row as a cross-replica mutex', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { config_revision: 1, type: 'jira', connection_id: 12 },
        ])
        .mockResolvedValueOnce([{ locked: null }]),
      syncRun: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(start(7, 1, 'manual', 'admin', 'jira:connection:12')).rejects.toThrow(
      'already running'
    );
    expect(tx.syncRun.create).not.toHaveBeenCalled();
  });

  it('serializes every ConnectWise job against the singleton account', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { config_revision: 1, type: 'connectwise', connection_id: null },
        ])
        .mockResolvedValueOnce([{ locked: null }]),
      syncRun: {
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(start(7, 1, 'scheduled', 'system', 'connectwise:legacy-global')).rejects.toThrow(
      'external account is already running'
    );
    expect(tx.syncRun.count).toHaveBeenCalledWith({
      where: {
        status: 'running',
        provider: { type: 'connectwise' },
      },
    });
  });

  it('finishes with complete counters and redacts a credential-shaped error', async () => {
    db.syncRun.updateMany.mockResolvedValue({ count: 1 });
    db.syncRun.findUniqueOrThrow.mockResolvedValue(run({ status: 'error' }));
    await finish(1, 'error', {
      ticketsCreated: 1,
      ticketsUpdated: 2,
      notesUpserted: 3,
      ticketsFiltered: 4,
      ticketsSkipped: 5,
      ticketsConflicted: 6,
      errorCount: 1,
      errors: [
        'first issue',
        'remote echoed Authorization: Basic dXNlcjpzZWNyZXQ=',
      ],
      durationMs: 125.6,
    });

    const data = db.syncRun.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'error',
      durationMs: 126,
      ticketsCreated: 1,
      ticketsUpdated: 2,
      notesUpserted: 3,
      ticketsFiltered: 4,
      ticketsSkipped: 5,
      ticketsConflicted: 6,
      errorCount: 1,
    });
    expect(data.latestError).toContain('[redacted]');
    expect(data.latestError).not.toContain('dXNlcjpzZWNyZXQ=');
  });

  it('is idempotent when a retry finds the run already terminal', async () => {
    const completed = run({ status: 'degraded' });
    db.syncRun.updateMany.mockResolvedValue({ count: 0 });
    db.syncRun.findUnique.mockResolvedValue(completed);

    await expect(
      finish(1, 'degraded', {
        ticketsCreated: 0,
        ticketsUpdated: 0,
        notesUpserted: 0,
        ticketsFiltered: 0,
        ticketsSkipped: 0,
        ticketsConflicted: 1,
        errorCount: 0,
        errors: ['held conflict'],
        durationMs: 10,
      })
    ).resolves.toBe(completed);
    expect(db.syncRun.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('closes only rows stale beyond the cross-pod recovery grace period', async () => {
    db.syncRun.findMany.mockResolvedValue([
      {
        id: 9,
        providerId: 7,
        startedAt: new Date(Date.now() - 2500),
        provider: { type: 'jira', connectionId: 12 },
      },
      {
        id: 10,
        providerId: 8,
        startedAt: new Date(Date.now() - 1000),
        provider: { type: 'jira', connectionId: 13 },
      },
    ]);
    db.syncRun.updateMany.mockResolvedValue({ count: 1 });

    await expect(recoverInterruptedRuns()).resolves.toBe(2);
    expect(db.syncRun.findMany).toHaveBeenCalledWith({
      where: {
        status: 'running',
        lockProtocol: 1,
        startedAt: { lt: expect.any(Date) },
      },
      select: {
        id: true,
        providerId: true,
        startedAt: true,
        provider: { select: { type: true, connectionId: true } },
      },
    });
    expect(mockedWithSyncAccountLock).toHaveBeenNthCalledWith(
      1,
      'jira:connection:12',
      expect.any(Function),
      { allowRunningRunId: 9 }
    );
    expect(mockedWithSyncAccountLock).toHaveBeenNthCalledWith(
      2,
      'jira:connection:13',
      expect.any(Function),
      { allowRunningRunId: 10 }
    );
    expect(db.syncRun.updateMany).toHaveBeenCalledTimes(2);
    expect(db.syncRun.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 9, status: 'running' },
      data: {
      status: 'error',
      errorCount: 1,
      latestError: 'AnchorDesk restarted before this sync run completed.',
      },
    });
  });
});

describe('health summaries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports never-run without inventing health from the watermark', async () => {
    db.syncRun.findFirst.mockResolvedValue(null);
    const health = await healthForProviders([{ id: 7, configRevision: 1 }]);
    expect(health.get(7)).toEqual({
      status: 'never_run',
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      latestError: null,
      latestRun: null,
    });
    expect(db.syncRun.findFirst.mock.calls[0][0].where).toEqual({
      providerId: 7,
      configRevision: 1,
    });
  });

  it('reports an exact consecutive failure count after the last non-error run', async () => {
    const latest = run({
      id: 12,
      status: 'error',
      startedAt: new Date('2026-07-25T14:00:00Z'),
      completedAt: new Date('2026-07-25T14:00:01Z'),
      errorCount: 1,
      latestError: 'authentication rejected',
    });
    const success = run({
      id: 8,
      status: 'success',
      startedAt: new Date('2026-07-25T10:00:00Z'),
      completedAt: new Date('2026-07-25T10:00:02Z'),
    });
    const degraded = run({
      id: 9,
      status: 'degraded',
      startedAt: new Date('2026-07-25T11:00:00Z'),
    });
    db.syncRun.findFirst
      .mockResolvedValueOnce(latest)
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(degraded);
    db.syncRun.count.mockResolvedValue(3);

    const health = (await healthForProviders([{ id: 7, configRevision: 1 }])).get(7);
    expect(health).toMatchObject({
      status: 'failing',
      lastAttemptAt: latest.startedAt,
      lastSuccessAt: success.completedAt,
      consecutiveFailures: 3,
      latestError: 'authentication rejected',
    });
    expect(db.syncRun.count).toHaveBeenCalledWith({
      where: {
        providerId: 7,
        configRevision: 1,
        status: 'error',
        OR: [
          { startedAt: { gt: degraded.startedAt } },
          { startedAt: degraded.startedAt, id: { gt: degraded.id } },
        ],
      },
    });
  });

  it('maps a mixed-result latest run to degraded without counting it as a consecutive failure', async () => {
    const latest = run({ status: 'degraded', latestError: 'one held conflict', errorCount: 1 });
    db.syncRun.findFirst
      .mockResolvedValueOnce(latest)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(latest);

    const health = (await healthForProviders([{ id: 7, configRevision: 1 }])).get(7);
    expect(health).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 0,
      latestError: 'one held conflict',
    });
    expect(db.syncRun.count).not.toHaveBeenCalled();
  });

  it('keeps the existing failure streak visible while a retry is running', async () => {
    const running = run({ id: 20, status: 'running', completedAt: null, latestError: null });
    const previousError = run({
      id: 19,
      status: 'error',
      latestError: 'site unreachable',
      startedAt: new Date('2026-07-25T11:00:00Z'),
    });
    db.syncRun.findFirst
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(previousError);
    db.syncRun.count.mockResolvedValue(2);

    const health = (await healthForProviders([{ id: 7, configRevision: 1 }])).get(7);
    expect(health).toMatchObject({
      status: 'running',
      consecutiveFailures: 2,
      latestError: 'site unreachable',
    });
  });

  it('keeps the previous degraded issue visible while a retry is running', async () => {
    const running = run({ id: 30, status: 'running', completedAt: null, latestError: null });
    const previousDegraded = run({
      id: 29,
      status: 'degraded',
      latestError: 'one held conflict',
      startedAt: new Date('2026-07-25T11:00:00Z'),
    });
    db.syncRun.findFirst
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(previousDegraded)
      .mockResolvedValueOnce(previousDegraded);
    db.syncRun.count.mockResolvedValue(0);

    const health = (await healthForProviders([{ id: 7, configRevision: 1 }])).get(7);
    expect(health).toMatchObject({
      status: 'running',
      consecutiveFailures: 0,
      latestError: 'one held conflict',
    });
    expect(db.syncRun.findFirst.mock.calls[3][0].where).toMatchObject({
      providerId: 7,
      configRevision: 1,
      status: { in: ['error', 'degraded'] },
    });
  });
});

describe('sanitizeSyncError', () => {
  it('redacts bearer values, labelled secrets, and bare Atlassian tokens', () => {
    const output = sanitizeSyncError(
      'Bearer abc.def token=secret apiToken:"hidden" ATATTabcdefghijklmnopqrstuvwxyz'
    );
    expect(output).not.toContain('abc.def');
    expect(output).not.toContain('secret');
    expect(output).not.toContain('hidden');
    expect(output).not.toContain('ATATTabcdefghijklmnopqrstuvwxyz');
  });
});
