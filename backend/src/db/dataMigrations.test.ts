jest.mock('./prisma', () => ({
  prisma: {
    $executeRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    connection: { findMany: jest.fn() },
    setting: { findUnique: jest.fn() },
  },
}));

import { prisma } from './prisma';
import {
  backfillTicketEvents,
  backfillWorkedAt,
  legacyJiraScope,
  runDataMigrations,
  TICKET_EVENT_BACKFILL_SQL,
} from './dataMigrations';

const db = prisma as unknown as {
  $executeRaw: jest.Mock;
  $executeRawUnsafe: jest.Mock;
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

describe('2.7 reporting-spine data backfills', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is idempotent across repeated TicketEvent reconstruction passes', async () => {
    const durableSourceRows = new Set<string>();
    db.$executeRawUnsafe.mockImplementation(async (sql: string) => {
      expect(sql).toBe(TICKET_EVENT_BACKFILL_SQL);
      const before = durableSourceRows.size;
      for (const key of ['101:created', '102:resolved', '103:first_response']) {
        durableSourceRows.add(key);
      }
      return durableSourceRows.size - before;
    });

    await expect(backfillTicketEvents()).resolves.toBe(3);
    const idsAfterFirstRun = [...durableSourceRows];
    await expect(backfillTicketEvents()).resolves.toBe(0);

    expect([...durableSourceRows]).toEqual(idsAfterFirstRun);
    expect(TICKET_EVENT_BACKFILL_SQL).toContain('source_audit_id');
    expect(TICKET_EVENT_BACKFILL_SQL).toContain("'backfill'");
    expect(TICKET_EVENT_BACKFILL_SQL).toContain('ON CONFLICT DO NOTHING');
  });

  it('records legacy work dates once from time_start then created_at', async () => {
    db.$executeRaw.mockResolvedValueOnce(4).mockResolvedValueOnce(0);
    await expect(backfillWorkedAt()).resolves.toBe(4);
    await expect(backfillWorkedAt()).resolves.toBe(0);
    const sql = (db.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(sql).toContain('worked_at = coalesce(time_start, created_at)');
    expect(sql).toContain('worked_at IS NULL');
  });
});

describe('2.5 connection data migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$executeRaw.mockResolvedValue(0);
    db.$executeRawUnsafe.mockResolvedValue(0);
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
