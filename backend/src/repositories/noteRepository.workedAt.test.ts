jest.mock('../db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    ticket: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    note: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

jest.mock('../services/realtime/eventBus', () => ({
  publish: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import {
  create,
  InvalidTimeEntryMutationError,
  listTimeEntriesForUser,
  update,
} from './noteRepository';

const transaction = prisma.$transaction as jest.Mock;
const queryRaw = prisma.$queryRaw as jest.Mock;
const ticketFindUnique = prisma.ticket.findUnique as jest.Mock;
const ticketUpdateMany = prisma.ticket.updateMany as jest.Mock;
const noteCreate = prisma.note.create as jest.Mock;
const noteFindMany = prisma.note.findMany as jest.Mock;
const noteFindFirst = prisma.note.findFirst as jest.Mock;
const noteUpdate = prisma.note.update as jest.Mock;
const auditRecord = audit.record as jest.Mock;

const ticketContext = {
  externalId: null,
  externalProvider: null,
  companyId: 3,
  teamId: 4,
  assigneeId: 5,
  priority: 'Medium',
  status: 'In Progress',
};

beforeEach(() => {
  jest.clearAllMocks();
  transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
  );
  queryRaw.mockResolvedValue([{ id: 7 }]);
  ticketFindUnique.mockResolvedValue(ticketContext);
  ticketUpdateMany.mockResolvedValue({ count: 0 });
  noteCreate.mockImplementation(({ data }) =>
    Promise.resolve({
      id: 101,
      ...data,
      direction: data.direction ?? null,
    }),
  );
  auditRecord.mockResolvedValue({ id: 501n });
});

describe('noteRepository workedAt recording', () => {
  it('rejects an explicit workedAt beside a window so timeStart stays authoritative', async () => {
    const createdAt = new Date('2026-07-20T12:00:00.000Z');
    const timeStart = new Date('2026-07-18T09:00:00.000Z');
    const workedAt = new Date('2026-07-17T15:30:00.000Z');

    await expect(
      create(
        7,
        {
          content: 'Worked the escalation',
          author: 'Alice',
          noteType: 'time_entry',
          minutes: 45,
          createdAt,
          timeStart,
          workedAt,
        },
        'alice',
      ),
    ).rejects.toThrow('workedAt is only accepted for duration-only entries');
    expect(noteCreate).not.toHaveBeenCalled();
  });

  it('prefers timeStart over the note createdAt fallback', async () => {
    const createdAt = new Date('2026-07-20T12:00:00.000Z');
    const timeStart = new Date('2026-07-18T09:00:00.000Z');

    await create(
      7,
      {
        content: 'Worked the incident',
        author: 'Alice',
        noteType: 'time_entry',
        timeStart,
        timeStop: new Date('2026-07-18T10:00:00.000Z'),
        createdAt,
      },
      'alice',
    );

    const data = noteCreate.mock.calls[0][0].data;
    expect(data.createdAt).toBe(createdAt);
    expect(data.workedAt).toBe(timeStart);
  });

  it("records a duration-only entry's workedAt as its exact createdAt", async () => {
    const recordedAt = new Date('2026-07-20T12:34:56.789Z');

    await create(
      7,
      {
        content: 'Thirty minutes of follow-up',
        author: 'Alice',
        noteType: 'time_entry',
        minutes: 30,
        createdAt: recordedAt,
      },
      'alice',
    );

    const data = noteCreate.mock.calls[0][0].data;
    expect(data.createdAt).toBe(recordedAt);
    expect(data.workedAt).toBe(data.createdAt);
  });
});

describe('noteRepository workedAt queries and mutation guards', () => {
  it('filters and orders a user day by recorded workedAt, never timeStart or createdAt', async () => {
    const from = new Date('2026-07-18T00:00:00.000Z');
    const to = new Date('2026-07-19T00:00:00.000Z');
    noteFindMany.mockResolvedValue([]);

    await listTimeEntriesForUser(22, from, to);

    expect(noteFindMany).toHaveBeenCalledWith({
      where: {
        authorId: 22,
        noteType: 'time_entry',
        workedAt: { gte: from, lt: to },
      },
      orderBy: [{ workedAt: 'asc' }, { id: 'asc' }],
      include: {
        ticket: {
          select: { id: true, ticketNumber: true, title: true },
        },
      },
    });
  });

  it.each([
    ['timeStart', { timeStart: new Date('2026-07-18T09:00:00.000Z') }],
    ['timeStop', { timeStop: new Date('2026-07-18T10:00:00.000Z') }],
    ['workedAt', { workedAt: new Date('2026-07-18T09:00:00.000Z') }],
    ['minutes', { minutes: 30 }],
  ])('rejects a %s mutation on a non-time note', async (_field, input) => {
    noteFindFirst.mockResolvedValue({
      id: 101,
      ticketId: 7,
      noteType: 'note',
      syncPending: false,
      externalId: null,
    });

    await expect(update(101, 7, input, 'alice')).rejects.toBeInstanceOf(
      InvalidTimeEntryMutationError,
    );
    expect(noteUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });
});
