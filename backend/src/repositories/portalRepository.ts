import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { RequesterPrincipal } from '../types/principal';
import * as ticketRepository from './ticketRepository';
import * as noteRepository from './noteRepository';
import * as attachmentRepository from './attachmentRepository';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../services/ticketVocab';

export interface PortalListOptions {
  page?: number;
  pageSize?: number;
}

export interface PortalAttachmentCreateInput {
  filename: string;
  contentType: string;
  size: number;
  storageBackend: string;
  storageKey: string;
}

/**
 * A merge target can contain notes/files moved from another requester, including
 * a different company after an acknowledged cross-company merge. Until portal
 * audience membership is represented on the merge ledger, hide both tombstones
 * and every target with a live ledger.
 */
export function requesterTicketWhere(
  principal: Pick<RequesterPrincipal, 'contactId' | 'companyId' | 'email'>,
  id?: number,
): Prisma.TicketWhereInput {
  return {
    ...(id === undefined ? {} : { id }),
    contactId: principal.contactId,
    companyId: principal.companyId,
    contact: {
      is: {
        id: principal.contactId,
        companyId: principal.companyId,
        email: { equals: principal.email, mode: 'insensitive' },
      },
    },
    status: { not: 'Deleted' },
    portalAccessRevokedAt: null,
    mergedIntoId: null,
    mergesAsTarget: { none: { unmergedAt: null } },
  };
}

const portalTicketFields = {
  id: true,
  ticketNumber: true,
  title: true,
  summary: true,
  description: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
} satisfies Prisma.TicketSelect;

const portalNoteFields = {
  id: true,
  content: true,
  htmlContent: true,
  noteType: true,
  direction: true,
  visibility: true,
  via: true,
  createdAt: true,
} satisfies Prisma.NoteSelect;

const portalAttachmentFields = {
  id: true,
  filename: true,
  contentType: true,
  size: true,
  createdAt: true,
  // Classification fields are consumed by the serializer's independent
  // fail-closed check and are never emitted in the portal DTO.
  portalVisible: true,
  noteId: true,
  note: { select: { visibility: true, noteType: true } },
} satisfies Prisma.AttachmentSelect;

const visibleNoteWhere: Prisma.NoteWhereInput = {
  visibility: 'public',
  noteType: { in: ['note', 'email'] },
};

const visibleAttachmentWhere: Prisma.AttachmentWhereInput = {
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
};

export async function listTickets(
  principal: RequesterPrincipal,
  options: PortalListOptions = {},
) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize ?? 20)));
  const where = requesterTicketWhere(principal);
  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: portalTicketFields,
    }),
    prisma.ticket.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export function getTicket(principal: RequesterPrincipal, ticketId: number) {
  return prisma.ticket.findFirst({
    where: requesterTicketWhere(principal, ticketId),
    select: {
      ...portalTicketFields,
      notes: {
        where: visibleNoteWhere,
        orderBy: { createdAt: 'asc' },
        select: portalNoteFields,
      },
      attachments: {
        where: visibleAttachmentWhere,
        orderBy: { createdAt: 'asc' },
        select: portalAttachmentFields,
      },
    },
  });
}

export async function ownsTicket(
  principal: RequesterPrincipal,
  ticketId: number,
): Promise<boolean> {
  const row = await prisma.ticket.findFirst({
    where: requesterTicketWhere(principal, ticketId),
    select: { id: true },
  });
  return row !== null;
}

export async function createTicket(
  principal: RequesterPrincipal,
  input: { summary: string; description?: string },
  actor: string,
) {
  const ticket = await ticketRepository.create(
    {
      title: input.summary,
      summary: input.summary,
      description: input.description,
      status: TICKET_STATUSES[0],
      priority: TICKET_PRIORITIES[1],
      companyId: principal.companyId,
      contactId: principal.contactId,
      source: 'portal' as ticketRepository.CreateTicketInput['source'],
    },
    actor,
    {
      requester: {
        contactId: principal.contactId,
        companyId: principal.companyId,
        email: principal.email,
      },
    },
  );
  // The create transaction just revalidated the requester and inserted this
  // exact row. Return it through the explicit serializer shape with empty child
  // collections; a second read would create a post-commit race and duplicate
  // retries if staff reassigns/merges the new ticket before the response.
  return { ...ticket, notes: [], attachments: [] };
}

async function mutateOwnedTicket<T>(
  principal: RequesterPrincipal,
  ticketId: number,
  mutation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  return prisma.$transaction(async (transaction) => {
    const expectedEmail = principal.email.trim().toLowerCase();
    const currentRequester = await transaction.$queryRaw<
      Array<{ id: number }>
    >(Prisma.sql`
      SELECT id
      FROM contacts
      WHERE id = ${principal.contactId}
        AND company_id = ${principal.companyId}
        AND lower(btrim(email)) = ${expectedEmail}
      FOR SHARE
    `);
    if (currentRequester.length !== 1) return null;

    // Put the full requester predicate in the locking statement. A requester
    // cannot lock or distinguish a foreign row merely by guessing its id.
    const owned = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT ticket.id
      FROM tickets AS ticket
      WHERE ticket.id = ${ticketId}
        AND ticket.contact_id = ${principal.contactId}
        AND ticket.company_id = ${principal.companyId}
        AND ticket.status <> 'Deleted'
        AND ticket.portal_access_revoked_at IS NULL
        AND ticket.merged_into_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ticket_merges AS merge
          WHERE merge.target_id = ticket.id
            AND merge.unmerged_at IS NULL
        )
      FOR UPDATE
    `);
    if (owned.length !== 1) return null;
    return mutation(transaction);
  });
}

export async function addComment(
  principal: RequesterPrincipal,
  ticketId: number,
  content: string,
  actor: string,
) {
  const note = await mutateOwnedTicket(
    principal,
    ticketId,
    (transaction) => noteRepository.create(
      ticketId,
      {
        content,
        author: principal.name,
        noteType: 'note',
        visibility: 'public',
        via: 'portal',
        queueForTicketSync: true,
      },
      actor,
      transaction,
    ),
  );
  if (note) noteRepository.publishCreatedNote(ticketId, note, actor);
  return note;
}

export async function createAttachment(
  principal: RequesterPrincipal,
  ticketId: number,
  input: PortalAttachmentCreateInput,
  actor: string,
) {
  const rows = await createAttachments(principal, ticketId, [input], actor);
  return rows?.[0] ?? null;
}

/**
 * Create all metadata rows in one ownership-checked transaction. Storage bytes
 * are staged by the route first; this makes a multi-file request all-or-nothing
 * at the database boundary so a failed response cannot leave a partial portal
 * mutation behind.
 */
export async function createAttachments(
  principal: RequesterPrincipal,
  ticketId: number,
  inputs: PortalAttachmentCreateInput[],
  actor: string,
) {
  return mutateOwnedTicket(
    principal,
    ticketId,
    async (transaction) => {
      const rows = [];
      for (const input of inputs) {
        rows.push(await attachmentRepository.create(
          {
            ticketId,
            ...input,
            createdBy: actor,
            portalVisible: true,
          },
          actor,
          transaction,
        ));
      }
      return rows;
    },
  );
}

export function getVisibleAttachment(
  principal: RequesterPrincipal,
  attachmentId: number,
) {
  return prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      ticket: requesterTicketWhere(principal),
      ...visibleAttachmentWhere,
    },
  });
}
