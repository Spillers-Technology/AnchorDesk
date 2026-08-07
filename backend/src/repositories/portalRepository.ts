import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { RequesterPrincipal } from '../types/principal';
import * as ticketRepository from './ticketRepository';
import * as noteRepository from './noteRepository';
import * as attachmentRepository from './attachmentRepository';
import * as portalGrantRepository from './portalGrantRepository';
import * as ticketFeedbackRepository from './ticketFeedbackRepository';
import { getPortal } from '../services/settingsService';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../services/ticketVocab';
import * as audit from './auditRepository';
import { resolveMergeTarget } from '../services/merge/mergeService';
import { publish } from '../services/realtime/eventBus';
import * as twoWaySync from '../services/twoWaySync';

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

export interface PortalTicketScope {
  ticketScope: 'own' | 'company';
  activeGrant: { effectiveFrom: Date } | null;
}

/**
 * Re-validate the requester's own identity (same defense mutateOwnedTicket's
 * raw-SQL lock performs before trusting session-carried company/email — a
 * stale session must not survive a Contact record moving underneath it), then
 * resolve whether company-wide reads apply. `null` means the requester's
 * identity no longer checks out and every caller must fail closed to nothing,
 * not fall back to "own tickets" (a corrupted session should see zero
 * tickets, not merely a narrower set).
 */
export async function resolvePortalTicketScope(
  principal: Pick<RequesterPrincipal, 'contactId' | 'companyId' | 'email'>,
): Promise<PortalTicketScope | null> {
  const contact = await prisma.contact.findFirst({
    where: {
      id: principal.contactId,
      companyId: principal.companyId,
      email: { equals: principal.email, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (!contact) return null;

  const portalConfig = await getPortal();
  if (portalConfig.ticketScope !== 'company') return { ticketScope: 'own', activeGrant: null };

  const grant = await portalGrantRepository.findActive(principal.contactId);
  // No active grant should be structurally impossible post-login (Phase 2
  // gates the magic link itself on one), but fail closed to "own" rather than
  // trust an absent grant to still mean company-wide.
  return grant
    ? { ticketScope: 'company', activeGrant: { effectiveFrom: grant.effectiveFrom } }
    : { ticketScope: 'own', activeGrant: null };
}

/**
 * Widen `requesterTicketWhere` to the requester's whole company when
 * `portal.ticketScope` is 'company' — company-scope tickets are reachable
 * from the grant's `effectiveFrom` onward, plus (unconditionally) any ticket
 * where the requester was personally the requester, regardless of age. Falls
 * back to `requesterTicketWhere`'s own-only predicate for the default scope,
 * with byte-for-byte identical output (no behavior change for the vast
 * majority of installs that never touch this setting).
 */
export function resolveTicketWhere(
  principal: Pick<RequesterPrincipal, 'contactId' | 'companyId' | 'email'>,
  scope: PortalTicketScope,
  id?: number,
): Prisma.TicketWhereInput {
  if (scope.ticketScope !== 'company' || !scope.activeGrant) {
    return requesterTicketWhere(principal, id);
  }
  return {
    ...(id === undefined ? {} : { id }),
    companyId: principal.companyId,
    status: { not: 'Deleted' },
    portalAccessRevokedAt: null,
    mergedIntoId: null,
    mergesAsTarget: { none: { unmergedAt: null } },
    OR: [
      { contactId: principal.contactId },
      { createdAt: { gte: scope.activeGrant.effectiveFrom } },
    ],
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
  // A portal serializer gets this explicitly selected, consent-gated identity
  // source rather than a whole User record. It never needs login email or any
  // other staff fields.
  authorUser: {
    select: {
      id: true,
      displayName: true,
      portalProfile: {
        select: {
          displayName: true,
          avatarStorageKey: true,
          optedIn: true,
        },
      },
    },
  },
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
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return { items: [], total: 0, page, pageSize };
  const where = resolveTicketWhere(principal, scope);
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

export async function getTicket(principal: RequesterPrincipal, ticketId: number) {
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return null;
  return prisma.ticket.findFirst({
    where: resolveTicketWhere(principal, scope, ticketId),
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
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return false;
  const row = await prisma.ticket.findFirst({
    where: resolveTicketWhere(principal, scope, ticketId),
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
  scope: PortalTicketScope,
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
    // Company-wide scope (see resolveTicketWhere) widens the same way reads
    // do: personally the requester (any age), or any company ticket from the
    // active grant's effectiveFrom onward.
    const companyWide = scope.ticketScope === 'company' && scope.activeGrant;
    const owned = await transaction.$queryRaw<Array<{ id: number }>>(
      companyWide
        ? Prisma.sql`
          SELECT ticket.id
          FROM tickets AS ticket
          WHERE ticket.id = ${ticketId}
            AND ticket.company_id = ${principal.companyId}
            AND (
              ticket.contact_id = ${principal.contactId}
              OR ticket.created_at >= ${scope.activeGrant!.effectiveFrom}
            )
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
        `
        : Prisma.sql`
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
        `,
    );
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
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return null;
  const note = await mutateOwnedTicket(
    principal,
    ticketId,
    scope,
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
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return null;
  return mutateOwnedTicket(
    principal,
    ticketId,
    scope,
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

/**
 * Submit one immutable feedback response after taking the same requester and
 * ticket ownership locks used for comments and attachments. The event is
 * intentionally published only after that transaction commits.
 */
export async function submitFeedback(
  principal: RequesterPrincipal,
  ticketId: number,
  input: { rating: string; comment?: string },
  actor: string,
) {
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return null;
  const feedback = await mutateOwnedTicket(
    principal,
    ticketId,
    scope,
    (transaction) => ticketFeedbackRepository.create(
      { ticketId, rating: input.rating, comment: input.comment, contactId: principal.contactId },
      actor,
      transaction,
    ),
  );
  if (feedback) {
    publish({ type: 'feedback.submitted', ticketId, feedback, actor });
  }
  return feedback;
}

/**
 * Resolve the supplied id before entering the requester-owned mutation path:
 * a ticket can be merged between the portal page loading and this POST, and a
 * self-solve must never write a merge tombstone. The target is then subjected
 * to the normal scope-aware row lock, so resolution never widens access.
 */
export async function solveTicket(
  principal: RequesterPrincipal,
  ticketId: number,
  actor: string,
) {
  const targetId = await resolveMergeTarget(ticketId);
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return null;
  const result = await mutateOwnedTicket(
    principal,
    targetId,
    scope,
    async (transaction) => {
      const before = await transaction.ticket.findUniqueOrThrow({ where: { id: targetId } });
      const data: Prisma.TicketUncheckedUpdateInput = {
        status: TICKET_STATUSES[4],
      };
      // A portal solve is still a local status change to an externally-backed
      // ticket. Preserve the ordinary ticket-update sync semantics without
      // attempting a nested transaction while the ownership lock is held.
      if (before.externalId && before.externalProvider) {
        data.syncRevision = { increment: 1 };
        if (before.syncState !== 'conflict') data.syncState = 'pending';
      }
      const ticket = await transaction.ticket.update({ where: { id: targetId }, data });
      const auditRow = await audit.record({
        entityType: 'ticket',
        entityId: targetId,
        action: 'update',
        changedBy: actor,
        oldValue: before as unknown as Record<string, unknown>,
        newValue: ticket as unknown as Record<string, unknown>,
      }, transaction);
      return { ticket, before, auditId: auditRow?.id.toString() };
    },
  );
  if (!result) return null;

  publish({
    type: 'ticket.updated',
    ticketId: targetId,
    ticket: result.ticket,
    actor,
    auditId: result.auditId,
    metric: {
      context: {
        companyId: result.ticket.companyId,
        teamId: result.ticket.teamId,
        assigneeId: result.ticket.assigneeId,
        priority: result.ticket.priority,
        status: result.ticket.status,
        occurredAt: result.ticket.updatedAt,
      },
      status: { from: result.before.status, to: result.ticket.status },
    },
  });
  // Same fire-and-forget push the staff PATCH route makes after a synced-field
  // edit: the scheduler would eventually reconcile a 'pending' ticket on its
  // own (syncService's stranded-pending fallback), but a customer-visible
  // solve deserves the same snappy remote reflection a staff edit gets, not a
  // silent wait for the next tick.
  if (result.ticket.externalId && result.ticket.externalProvider) {
    void twoWaySync.reconcileTicket(targetId, { actor }).catch(() => {});
  }
  return result.ticket;
}

export async function getVisibleAttachment(
  principal: RequesterPrincipal,
  attachmentId: number,
) {
  const scope = await resolvePortalTicketScope(principal);
  if (!scope) return null;
  return prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      ticket: resolveTicketWhere(principal, scope),
      ...visibleAttachmentWhere,
    },
  });
}
