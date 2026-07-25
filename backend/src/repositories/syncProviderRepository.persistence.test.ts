jest.mock('../db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    syncProvider: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as auditRepo from './auditRepository';
import {
  SyncProviderValidationError,
  SyncProviderBusyError,
  create,
  remove,
  update,
} from './syncProviderRepository';

const db = prisma as unknown as {
  $transaction: jest.Mock;
  syncProvider: { findUnique: jest.Mock };
};
const mockedAudit = jest.mocked(auditRepo);

const existing = {
  id: 7,
  name: 'Contoso Jira',
  type: 'jira' as const,
  config: { projectKey: 'HELP' },
  enabled: true,
  lastSyncedAt: new Date('2026-07-25T10:00:00Z'),
  configRevision: 4,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  connectionId: 3,
};

describe('sync provider scope revision persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.syncProvider.findUnique.mockResolvedValue(existing);
  });

  it('clears the watermark and compare-and-set increments the revision on a scope edit', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      syncRun: { count: jest.fn().mockResolvedValue(0) },
      syncProvider: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...existing,
          config: { projectKey: 'OPS' },
          lastSyncedAt: null,
          configRevision: 5,
        }),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(
      update(7, { config: { projectKey: 'OPS' } }, 'admin')
    ).resolves.toMatchObject({ configRevision: 5, lastSyncedAt: null });

    expect(tx.syncProvider.updateMany).toHaveBeenCalledWith({
      where: { id: 7, configRevision: 4 },
      data: {
        config: { projectKey: 'OPS' },
        lastSyncedAt: null,
        configRevision: { increment: 1 },
      },
    });
    expect(mockedAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'sync_provider',
        entityId: 7,
        newValue: expect.objectContaining({ watermarkReset: true }),
      }),
      tx
    );
  });

  it('fails closed when another scope edit wins the revision race', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      syncRun: { count: jest.fn().mockResolvedValue(0) },
      syncProvider: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(
      update(7, { config: { projectKey: 'OPS' } }, 'admin')
    ).rejects.toThrow(SyncProviderValidationError);
    expect(tx.syncProvider.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mockedAudit.record).not.toHaveBeenCalled();
  });

  it('refuses to change scope while a run is active on another replica', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      syncRun: { count: jest.fn().mockResolvedValue(1) },
      syncProvider: {
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(
      update(7, { config: { projectKey: 'OPS' } }, 'admin')
    ).rejects.toThrow(SyncProviderBusyError);
    expect(tx.syncProvider.updateMany).not.toHaveBeenCalled();
    expect(mockedAudit.record).not.toHaveBeenCalled();
  });

  it('does not reset or increment the revision for a name-only edit', async () => {
    const tx = {
      syncProvider: {
        update: jest.fn().mockResolvedValue({ ...existing, name: 'Renamed' }),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await update(7, { name: 'Renamed' }, 'admin');

    expect(tx.syncProvider.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { name: 'Renamed' },
    });
  });
});

describe('sync provider account binding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses to create a Jira job without an explicit connection', async () => {
    await expect(
      create(
        {
          name: 'Unbound Jira',
          type: 'jira',
          config: { projectKey: 'HELP' },
          connectionId: null,
        },
        'admin'
      )
    ).rejects.toThrow('a Jira connection is required');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: true }, 'enabling'],
    [{ config: { projectKey: 'OPS' } }, 'editing'],
    [{ name: 'Still unbound' }, 'editing'],
  ])('refuses %s an existing unbound Jira job', async (patch, _action) => {
    db.syncProvider.findUnique.mockResolvedValue({ ...existing, connectionId: null });
    await expect(update(7, patch, 'admin')).rejects.toThrow(
      'choose the exact Jira account'
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('allows an invalid legacy Jira job to be disabled while it is repaired', async () => {
    db.syncProvider.findUnique.mockResolvedValue({
      ...existing,
      connectionId: null,
      enabled: true,
    });
    const tx = {
      syncProvider: {
        update: jest.fn().mockResolvedValue({
          ...existing,
          connectionId: null,
          enabled: false,
        }),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(update(7, { enabled: false }, 'admin')).resolves.toMatchObject({
      connectionId: null,
      enabled: false,
    });
  });

  it('refuses to create a ConnectWise job without an explicit board', async () => {
    await expect(
      create(
        {
          name: 'Unscoped ConnectWise',
          type: 'connectwise',
          config: {},
          connectionId: null,
        },
        'admin'
      )
    ).rejects.toThrow('a ConnectWise board is required');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('allows a legacy unscoped ConnectWise job to be disabled while it is repaired', async () => {
    db.syncProvider.findUnique.mockResolvedValue({
      ...existing,
      type: 'connectwise',
      config: {},
      connectionId: null,
      enabled: true,
    });
    const tx = {
      syncProvider: {
        update: jest.fn().mockResolvedValue({
          ...existing,
          type: 'connectwise',
          config: {},
          connectionId: null,
          enabled: false,
        }),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(update(7, { enabled: false }, 'admin')).resolves.toMatchObject({
      enabled: false,
    });
  });

  it('requires a board before editing or enabling a legacy ConnectWise job', async () => {
    db.syncProvider.findUnique.mockResolvedValue({
      ...existing,
      type: 'connectwise',
      config: {},
      connectionId: null,
      enabled: false,
    });

    await expect(update(7, { enabled: true }, 'admin')).rejects.toThrow(
      'a ConnectWise board is required'
    );
    await expect(update(7, { name: 'Still unscoped' }, 'admin')).rejects.toThrow(
      'a ConnectWise board is required'
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('sync provider deletion versus active runs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('locks the provider row and refuses to cascade an active run', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      syncRun: { count: jest.fn().mockResolvedValue(1) },
      syncProvider: {
        findUniqueOrThrow: jest.fn(),
        delete: jest.fn(),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(remove(7, 'admin')).rejects.toThrow(SyncProviderBusyError);
    expect(tx.syncProvider.delete).not.toHaveBeenCalled();
    expect(mockedAudit.record).not.toHaveBeenCalled();
  });

  it('deletes and audits atomically after proving no run is active', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      syncRun: { count: jest.fn().mockResolvedValue(0) },
      syncProvider: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(existing),
        delete: jest.fn().mockResolvedValue(existing),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(remove(7, 'admin')).resolves.toBe(true);
    expect(tx.syncProvider.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(mockedAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'sync_provider', action: 'delete' }),
      tx
    );
  });
});
