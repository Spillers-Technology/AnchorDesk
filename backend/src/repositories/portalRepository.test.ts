jest.mock('../db/prisma', () => ({
  prisma: {
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    attachment: {
      findFirst: jest.fn(),
    },
    contact: {
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

jest.mock('./portalGrantRepository', () => ({
  findActive: jest.fn(),
}));

jest.mock('./ticketFeedbackRepository', () => ({ create: jest.fn() }));
jest.mock('./auditRepository', () => ({ record: jest.fn() }));
jest.mock('../services/merge/mergeService', () => ({ resolveMergeTarget: jest.fn() }));
jest.mock('../services/realtime/eventBus', () => ({ publish: jest.fn() }));
jest.mock('../services/twoWaySync', () => ({ reconcileTicket: jest.fn() }));

jest.mock('../services/settingsService', () => ({
  getPortal: jest.fn(),
}));

import { prisma } from '../db/prisma';
import type { RequesterPrincipal } from '../types/principal';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../services/ticketVocab';
import * as tickets from './ticketRepository';
import * as notes from './noteRepository';
import * as attachments from './attachmentRepository';
import * as portalGrants from './portalGrantRepository';
import * as ticketFeedback from './ticketFeedbackRepository';
import * as audit from './auditRepository';
import { resolveMergeTarget } from '../services/merge/mergeService';
import { publish } from '../services/realtime/eventBus';
import { reconcileTicket } from '../services/twoWaySync';
import { getPortal } from '../services/settingsService';
import {
  addComment,
  createAttachments,
  createTicket,
  getTicket,
  getVisibleAttachment,
  listTickets,
  requesterTicketWhere,
  solveTicket,
  submitFeedback,
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
  ticket: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
};

const ticketFindMany = prisma.ticket.findMany as jest.Mock;
const ticketCount = prisma.ticket.count as jest.Mock;
const ticketFindFirst = prisma.ticket.findFirst as jest.Mock;
const attachmentFindFirst = prisma.attachment.findFirst as jest.Mock;
const contactFindFirst = prisma.contact.findFirst as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;
const ticketCreate = tickets.create as jest.Mock;
const noteCreate = notes.create as jest.Mock;
const publishCreatedNote = notes.publishCreatedNote as jest.Mock;
const attachmentCreate = attachments.create as jest.Mock;
const findActiveGrant = portalGrants.findActive as jest.Mock;
const mockedGetPortal = getPortal as jest.Mock;
const feedbackCreate = ticketFeedback.create as jest.Mock;
const recordAudit = audit.record as jest.Mock;
const resolveTarget = resolveMergeTarget as jest.Mock;
const publishEvent = publish as jest.Mock;
const mockedReconcileTicket = reconcileTicket as jest.Mock;

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
  // Default: requester identity re-validates, and portal.ticketScope is the
  // default 'own' — resolveTicketWhere then falls back to
  // requesterTicketWhere's own predicate byte-for-byte, so every pre-existing
  // assertion in this file keeps its exact expected shape.
  contactFindFirst.mockResolvedValue({ id: principal.contactId });
  mockedGetPortal.mockResolvedValue({ enabled: true, ticketScope: 'own', technicianIdentity: 'anonymous', allowAttachments: true, allowSelfSolve: true });
  findActiveGrant.mockResolvedValue(null);
  resolveTarget.mockImplementation(async (id: number) => id);
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

  it('submits feedback only inside the ownership lock, then publishes after commit', async () => {
    feedbackCreate.mockResolvedValue({ id: 12, ticketId: 42, rating: 'positive' });

    await expect(submitFeedback(principal, 42, { rating: 'positive', comment: 'Fast' }, 'requester:9 (portal)'))
      .resolves.toEqual({ id: 12, ticketId: 42, rating: 'positive' });

    expect(feedbackCreate).toHaveBeenCalledWith(
      { ticketId: 42, rating: 'positive', comment: 'Fast', contactId: 9 },
      'requester:9 (portal)',
      tx,
    );
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'feedback.submitted',
      ticketId: 42,
      feedback: { id: 12, ticketId: 42, rating: 'positive' },
      actor: 'requester:9 (portal)',
    });
  });

  it('resolves merge tombstones before taking the owned solve lock and writes canonical Resolved', async () => {
    resolveTarget.mockResolvedValue(51);
    const before = {
      id: 51,
      status: 'In Progress',
      externalId: null,
      externalProvider: null,
    };
    const solved = {
      ...before,
      status: TICKET_STATUSES[4],
      companyId: 7,
      teamId: null,
      assigneeId: null,
      priority: 'Medium',
      updatedAt: new Date('2026-08-06T12:00:00.000Z'),
    };
    tx.ticket.findUniqueOrThrow.mockResolvedValue(before);
    tx.ticket.update.mockResolvedValue(solved);
    recordAudit.mockResolvedValue({ id: 99n });

    await expect(solveTicket(principal, 42, 'requester:9 (portal)')).resolves.toEqual(solved);

    expect(resolveTarget).toHaveBeenCalledWith(42);
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: 51 },
      data: { status: 'Resolved' },
    });
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ticket.updated',
      ticketId: 51,
      metric: expect.objectContaining({ status: { from: 'In Progress', to: 'Resolved' } }),
    }));
    expect(mockedReconcileTicket).not.toHaveBeenCalled();
  });

  it('kicks a fire-and-forget reconcile after solving an externally-synced ticket', async () => {
    resolveTarget.mockResolvedValue(51);
    const before = {
      id: 51,
      status: 'In Progress',
      externalId: 'HELP-1',
      externalProvider: 'jira',
      syncState: 'synced',
    };
    const solved = {
      ...before,
      status: TICKET_STATUSES[4],
      syncState: 'pending',
      syncRevision: 2,
      companyId: 7,
      teamId: null,
      assigneeId: null,
      priority: 'Medium',
      updatedAt: new Date('2026-08-06T12:00:00.000Z'),
    };
    tx.ticket.findUniqueOrThrow.mockResolvedValue(before);
    tx.ticket.update.mockResolvedValue(solved);
    recordAudit.mockResolvedValue({ id: 100n });
    mockedReconcileTicket.mockResolvedValue(undefined);

    await solveTicket(principal, 42, 'requester:9 (portal)');

    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: 51 },
      data: { status: 'Resolved', syncRevision: { increment: 1 }, syncState: 'pending' },
    });
    expect(mockedReconcileTicket).toHaveBeenCalledWith(51, { actor: 'requester:9 (portal)' });
  });

  it('does not let a failed reconcile dispatch surface as a solve error', async () => {
    resolveTarget.mockResolvedValue(51);
    const before = { id: 51, status: 'In Progress', externalId: 'HELP-1', externalProvider: 'jira' };
    tx.ticket.findUniqueOrThrow.mockResolvedValue(before);
    tx.ticket.update.mockResolvedValue({ ...before, status: TICKET_STATUSES[4] });
    recordAudit.mockResolvedValue({ id: 101n });
    mockedReconcileTicket.mockRejectedValue(new Error('remote unreachable'));

    await expect(solveTicket(principal, 42, 'requester:9 (portal)')).resolves.toMatchObject({
      status: TICKET_STATUSES[4],
    });
  });
});

describe('company-wide portal ticket scope (portal.ticketScope = company)', () => {
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    mockedGetPortal.mockResolvedValue({ enabled: true, ticketScope: 'company', technicianIdentity: 'anonymous', allowAttachments: true, allowSelfSolve: true });
    findActiveGrant.mockResolvedValue({ id: 1, contactId: 9, companyId: 7, effectiveFrom, revokedAt: null });
  });

  it('widens list reads to company plus the grant effectiveFrom, or personally-requested tickets of any age', async () => {
    ticketFindMany.mockResolvedValue([]);
    ticketCount.mockResolvedValue(0);

    await listTickets(principal, {});

    expect(ticketFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        companyId: 7,
        status: { not: 'Deleted' },
        portalAccessRevokedAt: null,
        mergedIntoId: null,
        mergesAsTarget: { none: { unmergedAt: null } },
        OR: [
          { contactId: 9 },
          { createdAt: { gte: effectiveFrom } },
        ],
      },
    }));
  });

  it('falls back to own-only scope when the setting is company but the requester has no active grant', async () => {
    findActiveGrant.mockResolvedValue(null);
    ticketFindMany.mockResolvedValue([]);
    ticketCount.mockResolvedValue(0);

    await listTickets(principal, {});

    expect(ticketFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedRequesterScope(),
    }));
  });

  it('fails closed to nothing (not merely own-only) when the requester identity no longer re-validates', async () => {
    contactFindFirst.mockResolvedValue(null);

    await expect(listTickets(principal, {})).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(ticketFindMany).not.toHaveBeenCalled();

    await expect(getTicket(principal, 42)).resolves.toBeNull();
    await expect(getVisibleAttachment(principal, 88)).resolves.toBeNull();
  });

  it('widens the comment lock predicate to the company/grant window, still requiring FOR UPDATE', async () => {
    noteCreate.mockResolvedValue({ id: 5 });

    await expect(addComment(principal, 42, 'Any update?', 'requester:9 (portal)')).resolves.toEqual({ id: 5 });

    const lockSql = tx.$queryRaw.mock.calls[1][0];
    const sql = lockSql.strings.join(' ');
    expect(sql).toContain('ticket.company_id');
    expect(sql).toContain('ticket.created_at >=');
    expect(sql).toContain('FOR UPDATE');
  });

  it('still allows commenting on a personally-requested ticket older than the grant window', async () => {
    noteCreate.mockResolvedValue({ id: 6 });
    await expect(addComment(principal, 42, 'Old ticket, still mine', 'requester:9 (portal)')).resolves.toEqual({ id: 6 });
    expect(noteCreate).toHaveBeenCalled();
  });
});
