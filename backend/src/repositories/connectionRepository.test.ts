jest.mock('../db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    connection: { findUnique: jest.fn() },
    syncProvider: { count: jest.fn() },
    ticket: { count: jest.fn() },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
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

import { prisma } from '../db/prisma';
import {
  ConnectionBusyError,
  ConnectionIdentityConflictError,
  ConnectionValidationError,
  isConfigured,
  mergeConfig,
  remove,
  toPublic,
  update,
} from './connectionRepository';
import type { ConnectionRow } from './connectionRepository';

const db = prisma as unknown as {
  $transaction: jest.Mock;
  connection: { findUnique: jest.Mock };
  syncProvider: { count: jest.Mock };
  ticket: { count: jest.Mock };
};

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: 1,
  name: 'Jira (default)',
  type: 'jira',
  config: { baseUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 'secret' },
  enabled: true,
  configRevision: 1,
  lastTestAt: null,
  lastTestOk: null,
  lastTestMessage: null,
  ...over,
});

describe('toPublic', () => {
  it('never serializes a secret, only whether one exists', () => {
    const out = toPublic(row());
    expect(out.config).toEqual({
      baseUrl: 'https://x.atlassian.net',
      email: 'a@b.c',
      hasApiToken: true,
    });
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('reports hasApiToken false when the token is blank', () => {
    const out = toPublic(row({ config: { baseUrl: 'u', email: 'e', apiToken: '' } }));
    expect(out.config).toMatchObject({ hasApiToken: false });
  });

  it('hides both ConnectWise secrets', () => {
    const out = toPublic(
      row({
        type: 'connectwise',
        config: { server: 's', company: 'c', publicKey: 'p', privateKey: 'PRIV', clientId: 'CID' },
      })
    );
    expect(out.config).toMatchObject({ hasPrivateKey: true, hasClientId: true });
    expect(JSON.stringify(out)).not.toContain('PRIV');
    expect(JSON.stringify(out)).not.toContain('CID');
  });

  it('drops unknown stored keys instead of treating secret names as a denylist', () => {
    const out = toPublic(
      row({
        config: {
          baseUrl: 'https://x.atlassian.net',
          email: 'a@b.c',
          apiToken: 'known-secret',
          password: 'legacy-secret',
          authorization: 'Bearer leaked',
        },
      })
    );
    expect(out.config).toEqual({
      baseUrl: 'https://x.atlassian.net',
      email: 'a@b.c',
      hasApiToken: true,
    });
    expect(JSON.stringify(out)).not.toContain('legacy-secret');
    expect(JSON.stringify(out)).not.toContain('Bearer leaked');
  });

  it('does not report a malformed non-string secret as configured', () => {
    const out = toPublic(
      row({ config: { baseUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: { value: 'secret' } } })
    );
    expect(out.config).toMatchObject({ hasApiToken: false });
    expect(out.configured).toBe(false);
  });
});

describe('isConfigured', () => {
  // The Admin card used to call Jira "configured" with a site URL and an email
  // and no API token at all, which is how a completely broken setup looked
  // healthy and produced the failure that opened this work.
  it('requires the secret, not just the visible fields', () => {
    expect(isConfigured('jira', { baseUrl: 'u', email: 'e' })).toBe(false);
    expect(isConfigured('jira', { baseUrl: 'u', email: 'e', apiToken: '' })).toBe(false);
    expect(isConfigured('jira', { baseUrl: 'u', email: 'e', apiToken: '   ' })).toBe(false);
    expect(isConfigured('jira', { baseUrl: 'u', email: 'e', apiToken: 't' })).toBe(true);
  });

  it('requires every ConnectWise credential field', () => {
    const full = { server: 's', company: 'c', publicKey: 'p', privateKey: 'k', clientId: 'i' };
    expect(isConfigured('connectwise', full)).toBe(true);
    expect(isConfigured('connectwise', { ...full, clientId: '' })).toBe(false);
  });

  it('is false for a type with no known credential shape', () => {
    expect(isConfigured('tactical_rmm', { anything: 'x' })).toBe(false);
  });
});

describe('mergeConfig', () => {
  it('keeps an existing secret when the patch sends a blank one', () => {
    // The UI never receives the secret back, so it echoes an empty string for
    // "unchanged". Treating that as a clear would silently break the connection.
    const next = mergeConfig('jira', { baseUrl: 'u', email: 'e', apiToken: 'keep' }, { email: 'new@x.y', apiToken: '' });
    expect(next).toEqual({ baseUrl: 'u', email: 'new@x.y', apiToken: 'keep' });
  });

  it('replaces a secret when a real value is supplied', () => {
    const next = mergeConfig('jira', { apiToken: 'old' }, { apiToken: 'fresh' });
    expect(next.apiToken).toBe('fresh');
  });

  it('trims values and normalizes trailing slashes on URLs', () => {
    const next = mergeConfig('jira', {}, { baseUrl: '  https://x.atlassian.net//  ' });
    expect(next.baseUrl).toBe('https://x.atlassian.net');
  });

  it('rejects unknown fields rather than storing them', () => {
    expect(() => mergeConfig('jira', {}, { apiKey: 'x' })).toThrow(ConnectionValidationError);
    expect(() => mergeConfig('jira', {}, { apiKey: 'x' })).toThrow(/unknown field "apiKey"/);
  });

  it('rejects an unsupported connection type', () => {
    expect(() => mergeConfig('netviz', {}, {})).toThrow(/unsupported connection type/);
  });

  it('drops unknown existing keys when merging an allowed patch', () => {
    const next = mergeConfig(
      'jira',
      { baseUrl: 'https://x.atlassian.net', email: 'old@x.y', apiToken: 'keep', password: 'drop-me' },
      { email: 'new@x.y' }
    );
    expect(next).toEqual({
      baseUrl: 'https://x.atlassian.net',
      email: 'new@x.y',
      apiToken: 'keep',
    });
  });

  it.each([
    ['baseUrl', 42],
    ['email', { address: 'a@b.c' }],
    ['apiToken', ['not', 'a', 'string']],
  ])('rejects a non-string %s value', (field, value) => {
    expect(() => mergeConfig('jira', {}, { [field]: value })).toThrow(
      new RegExp(`config\\.${field} must be a string`)
    );
  });
});

describe('remove', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [1, 0, '1 sync job'],
    [0, 1, '1 ticket'],
    [2, 3, '2 sync jobs and 3 tickets'],
  ])('blocks deletion when referenced by %i job(s) and %i ticket(s)', async (jobs, tickets, expected) => {
    db.syncProvider.count.mockResolvedValue(jobs);
    db.ticket.count.mockResolvedValue(tickets);

    await expect(remove(7, 'admin')).rejects.toThrow(expected);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('update tenant identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects repointing an existing Jira connection at another tenant', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      syncRun: { count: jest.fn() },
      syncProvider: { updateMany: jest.fn() },
      connection: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
        update: jest.fn(),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(
      update(
        1,
        { config: { baseUrl: 'https://another-tenant.atlassian.net', email: 'new@example.com' } },
        'admin'
      )
    ).rejects.toThrow(ConnectionIdentityConflictError);
    await expect(
      update(1, { config: { baseUrl: 'https://another-tenant.atlassian.net' } }, 'admin')
    ).rejects.toThrow(/create a new connection for a different Jira tenant/);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.connection.update).not.toHaveBeenCalled();
  });

  it('allows resaving the same normalized Jira URL while rotating credentials', async () => {
    const updated = row({
      config: {
        baseUrl: 'https://x.atlassian.net',
        email: 'new@example.com',
        apiToken: 'rotated',
      },
    });
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ id: 4 }, { id: 9 }]),
      syncRun: { count: jest.fn().mockResolvedValue(0) },
      syncProvider: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      connection: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(
      update(
        1,
        {
          config: {
            baseUrl: ' https://x.atlassian.net/// ',
            email: 'new@example.com',
            apiToken: 'rotated',
          },
        },
        'admin'
      )
    ).resolves.toEqual(updated);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.syncRun.count).toHaveBeenCalledWith({
      where: { providerId: { in: [4, 9] }, status: 'running' },
    });
    expect(tx.syncProvider.updateMany).toHaveBeenCalledWith({
      where: { connectionId: 1 },
      data: {
        lastSyncedAt: null,
        configRevision: { increment: 1 },
      },
    });
  });

  it('refuses to rotate credentials while a linked account run is active', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ id: 4 }]),
      syncRun: { count: jest.fn().mockResolvedValue(1) },
      syncProvider: { updateMany: jest.fn() },
      connection: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
        update: jest.fn(),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(
      update(1, { config: { apiToken: 'rotated' } }, 'admin')
    ).rejects.toBeInstanceOf(ConnectionBusyError);
    expect(tx.connection.update).not.toHaveBeenCalled();
    expect(tx.syncProvider.updateMany).not.toHaveBeenCalled();
  });

  it('does not reset watermarks for a normalized no-op credential save', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      syncRun: { count: jest.fn() },
      syncProvider: { updateMany: jest.fn() },
      connection: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
        update: jest.fn().mockResolvedValue(row()),
      },
    };
    db.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await update(
      1,
      {
        config: {
          baseUrl: ' https://x.atlassian.net/// ',
          email: 'a@b.c',
          apiToken: '',
        },
      },
      'admin'
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.syncProvider.updateMany).not.toHaveBeenCalled();
  });
});
