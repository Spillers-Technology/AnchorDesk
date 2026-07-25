jest.mock('./prisma', () => ({
  prisma: {
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
    connection: { findMany: jest.fn() },
    setting: { findUnique: jest.fn() },
  },
}));

import { prisma } from './prisma';
import { legacyJiraScope, runDataMigrations } from './dataMigrations';

const db = prisma as unknown as {
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
  connection: { findMany: jest.Mock };
  setting: { findUnique: jest.Mock };
};

describe('legacyJiraScope', () => {
  it('reads projectKey and jql off a pre-2.5 settings row', () => {
    expect(legacyJiraScope({ projectKey: 'HELP', jql: 'assignee = x' })).toEqual({
      projectKey: 'HELP',
      jql: 'assignee = x',
    });
  });

  it('trims values and omits blank/whitespace-only fields', () => {
    expect(legacyJiraScope({ projectKey: '  HELP  ', jql: '   ' })).toEqual({ projectKey: 'HELP' });
  });

  it('returns an empty object when neither was ever set', () => {
    expect(legacyJiraScope({ baseUrl: 'https://x.atlassian.net' })).toEqual({});
  });

  it('ignores non-string values rather than throwing', () => {
    expect(legacyJiraScope({ projectKey: 42, jql: null })).toEqual({});
  });
});

describe('2.5 connection data migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$executeRaw.mockResolvedValue(0);
    db.setting.findUnique.mockResolvedValue(null);
  });

  it('unlinks jobs and tickets in the same transaction before deleting an illegal ConnectWise connection', async () => {
    db.connection.findMany.mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === 'jira'
        ? []
        : [{ id: 41, name: 'ConnectWise (default)', type: 'connectwise', config: {}, enabled: true }]
    );
    const tx = {
      syncProvider: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ticket: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      connection: { delete: jest.fn().mockResolvedValue({ id: 41 }) },
    };
    db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const log = { info: jest.fn(), warn: jest.fn() };

    await runDataMigrations(log as never);

    expect(tx.syncProvider.updateMany).toHaveBeenCalledWith({
      where: { connectionId: 41 },
      data: { connectionId: null },
    });
    expect(tx.ticket.updateMany).toHaveBeenCalledWith({
      where: { syncConnectionId: 41 },
      data: { syncConnectionId: null },
    });
    expect(tx.connection.delete).toHaveBeenCalledWith({ where: { id: 41 } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('disables legacy ConnectWise jobs whose board came from a hidden adapter default', async () => {
    db.connection.findMany.mockResolvedValue([]);
    db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join('').includes('UPDATE sync_providers') ? 2 : 0
    );
    const log = { info: jest.fn(), warn: jest.fn() };

    await runDataMigrations(log as never);

    const migrationCall = db.$executeRaw.mock.calls.find((call) =>
      String((call[0] as TemplateStringsArray).join('')).includes('UPDATE sync_providers')
    );
    expect(migrationCall).toBeDefined();
    expect(String((migrationCall?.[0] as TemplateStringsArray).join(''))).toContain(
      "config ->> 'board'"
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Disabled 2 ConnectWise sync job(s)')
    );
  });
});
