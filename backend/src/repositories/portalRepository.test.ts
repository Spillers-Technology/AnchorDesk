jest.mock('../db/prisma', () => ({
  prisma: {
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    attachment: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('./ticketRepository', () => ({
  create: jest.fn(),
}));

jest.mock('./noteRepository', () => ({
  create: jest.fn(),
  publishCreatedNote: jest.fn(),
}));

jest.mock('./attachmentRepository', () => ({
  create: jest.fn(),
}));

import { prisma } from '../db/prisma';
import type { RequesterPrincipal } from '../types/principal';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../services/ticketVocab';
import * as tickets from './ticketRepository';
import * as notes from './noteRepository';
import * as attachments from './attachmentRepository';
import {
  addComment,
  createAttachments,
  createTicket,
  getTicket,
  getVisibleAttachment,
  listTickets,
  requesterTicketWhere,
} from './portalRepository';

const principal: RequesterPrincipal = {
  kind: 'requester',
  contactId: 9,
  companyId: 7,
  name: 'Casey Customer',
  email: 'casey@example.test',
};

const tx = {
  $queryRaw: jest.fn(),
};

const ticketFindMany = prisma.ticket.findMany as jest.Mock;
const ticketCount = prisma.ticket.count as jest.Mock;
const ticketFindFirst = prisma.ticket.findFirst as jest.Mock;
const attachmentFindFirst = prisma.attachment.findFirst as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;
const ticketCreate = tickets.create as jest.Mock;
const noteCreate = notes.create as jest.Mock;
const publishCreatedNote = notes.publishCreatedNote as jest.Mock;
const attachmentCreate = attachments.create as jest.Mock;

function expectedRequesterScope(id?: number) {
  return {
    ...(id === undefined ? {} : { id }),
    contactId: 9,
    companyId: 7,
    contact: {
      is: {
        id: 9,
        companyId: 7,
        email: {
          equals: 'casey@example.test',
          mode: 'insensitive',
        },
      },
    },
    status: { not: 'Deleted' },
    portalAccessRevokedAt: null,
    mergedIntoId: null,
    mergesAsTarget: { none: { unmergedAt: null } },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  transaction.mockImplementation(
    async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx),
  );
  tx.$queryRaw.mockResolvedValue([{ id: 42 }]);
});

describe('portal ticket ownership scope', () => {
  it('always includes contact, company, deletion, tombstone, and merge-ledger predicates', () => {
    expect(requesterTicketWhere(principal, 42)).toStrictEqual(
      expectedRequesterScope(42),
    );
  });

  it('uses the same dual-owner scope for list rows and the count', async () => {
    ticketFindMany.mockResolvedValue([]);
    ticketCount.mockResolvedValue(0);

    await listTickets(principal, { page: 3, pageSize: 999 });

    expect(ticketFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedRequesterScope(),
      skip: 100,
      take: 50,
    }));
    expect(ticketCount).toHaveBeenCalledWith({
      where: expectedRequesterScope(),
    });
  });

  it.each([
    ['another contact', { ...principal, contactId: 10 }],
    ['another company', { ...principal, companyId: 8 }],
  ])('cannot read a ticket owned by %s', async (_label, attemptedPrincipal) => {
    ticketFindFirst.mockImplementation(({ where }) =>
      where.contactId === principal.contactId &&
      where.companyId === principal.companyId
        ? Promise.resolve({ id: 42 })
        : Promise.resolve(null),
    );

    await expect(getTicket(attemptedPrincipal, 42)).resolves.toBeNull();
    expect(ticketFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 42,
        contactId: attemptedPrincipal.contactId,
        companyId: attemptedPrincipal.companyId,
        mergesAsTarget: { none: { unmergedAt: null } },
      }),
    }));
  });

  it('fetches only explicitly public conversation and attachment candidates', async () => {
    ticketFindFirst.mockResolvedValue(null);
    await getTicket(principal, 42);
    const query = ticketFindFirst.mock.calls[0][0];

    expect(query.where).toStrictEqual(expectedRequesterScope(42));
    expect(query.select.notes.where).toStrictEqual({
      visibility: 'public',
      noteType: { in: ['note', 'email'] },
    });
    expect(query.select.attachments.where).toStrictEqual({
      portalVisible: true,
      OR: [
        { noteId: null },
        {
          note: {
            is: {
              visibility: 'public',
              noteType: { in: ['note', 'email'] },
            },
          },
        },
      ],
    });
  });
});

describe('portal mutations and attachment reads', () => {
  it('derives requester ownership, source, and vocabulary on create', async () => {
    ticketCreate.mockResolvedValue({ id: 42 });
    ticketFindFirst.mockResolvedValue({ id: 42 });

    await createTicket(
      principal,
      { summary: 'Printer offline', description: 'Lobby printer' },
      'requester:9 (portal)',
    );

    expect(ticketCreate).toHaveBeenCalledWith({
      title: 'Printer offline',
      summary: 'Printer offline',
      description: 'Lobby printer',
      status: TICKET_STATUSES[0],
      priority: TICKET_PRIORITIES[1],
      companyId: 7,
      contactId: 9,
      source: 'portal',
    }, 'requester:9 (portal)', {
      requester: {
        contactId: 9,
        companyId: 7,
        email: 'casey@example.test',
      },
    });
  });

  it('locks and rechecks both owner predicates before inserting a public comment', async () => {
    noteCreate.mockResolvedValue({ id: 5 });

    await expect(addComment(
      principal,
      42,
      'Any update?',
      'requester:9 (portal)',
    )).resolves.toEqual({ id: 5 });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls[0][0].strings.join(' ')).toContain(
      'lower(btrim(email))',
    );
    const lockSql = tx.$queryRaw.mock.calls[1][0];
    expect(lockSql.strings.join(' ')).toContain('ticket.contact_id');
    expect(lockSql.strings.join(' ')).toContain('ticket.company_id');
    expect(lockSql.strings.join(' ')).toContain('portal_access_revoked_at IS NULL');
    expect(noteCreate).toHaveBeenCalledWith(
      42,
      {
        content: 'Any update?',
        author: 'Casey Customer',
        noteType: 'note',
        visibility: 'public',
        via: 'portal',
        queueForTicketSync: true,
      },
      'requester:9 (portal)',
      tx,
    );
    expect(publishCreatedNote).toHaveBeenCalledWith(
      42,
      { id: 5 },
      'requester:9 (portal)',
    );
  });

  it('fails closed without creating a comment when ownership no longer matches', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(addComment(
      principal,
      42,
      'Should not land',
      'requester:9 (portal)',
    )).resolves.toBeNull();
    expect(noteCreate).not.toHaveBeenCalled();
  });

  it('creates all attachment metadata atomically with portal visibility', async () => {
    attachmentCreate
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });
    const input = [
      {
        filename: 'one.txt',
        contentType: 'text/plain',
        size: 1,
        storageBackend: 'local',
        storageKey: 'one',
      },
      {
        filename: 'two.txt',
        contentType: 'text/plain',
        size: 2,
        storageBackend: 'local',
        storageKey: 'two',
      },
    ];

    await expect(createAttachments(
      principal,
      42,
      input,
      'requester:9 (portal)',
    )).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(attachmentCreate).toHaveBeenCalledTimes(2);
    expect(attachmentCreate).toHaveBeenNthCalledWith(
      1,
      {
        ticketId: 42,
        ...input[0],
        createdBy: 'requester:9 (portal)',
        portalVisible: true,
      },
      'requester:9 (portal)',
      tx,
    );
  });

  it('scopes attachment download to both requester owners and public visibility', async () => {
    attachmentFindFirst.mockResolvedValue(null);
    await getVisibleAttachment(principal, 88);

    expect(attachmentFindFirst).toHaveBeenCalledWith({
      where: {
        id: 88,
        ticket: expectedRequesterScope(),
        portalVisible: true,
        OR: [
          { noteId: null },
          {
            note: {
              is: {
                visibility: 'public',
                noteType: { in: ['note', 'email'] },
              },
            },
          },
        ],
      },
    });
  });
});
