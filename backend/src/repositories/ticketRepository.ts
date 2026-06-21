import { Prisma, TicketSource } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish } from '../services/realtime/eventBus';
import { computeSlaFields } from '../services/sla';

export interface TicketListOptions {
  status?: string;
  assignee?: string;
  companyName?: string;
  source?: TicketSource;
  /** Free-text filter across title/summary/company (case-insensitive contains). */
  q?: string;
  /** Filter to tickets carrying a given label id. */
  labelId?: number;
  /** Exclude soft-deleted tickets (status = 'Deleted'). Default true. */
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

/** Build the Prisma where-clause shared by list() and count() so paging totals
 *  always match the rows returned. */
function buildWhere(filters: Omit<TicketListOptions, 'page' | 'pageSize'>): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.assignee) where.assignee = { contains: filters.assignee };
  if (filters.companyName) where.companyName = { contains: filters.companyName };
  if (filters.source) where.source = filters.source;
  if (filters.labelId) where.labels = { some: { labelId: filters.labelId } };
  if (filters.includeDeleted === false) where.status = { not: 'Deleted' };
  if (filters.q && filters.q.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { ticketNumber: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

export interface CreateTicketInput {
  title: string;
  summary?: string;
  description?: string;
  status?: string;
  priority?: string;
  companyName?: string;
  companyId?: number | null;
  contactId?: number | null;
  assignee?: string;
  assigneeId?: number;
  source?: TicketSource;
  ticketNumber?: string;
  externalId?: string;
  externalProvider?: string;
}

export interface UpdateTicketInput {
  title?: string;
  summary?: string;
  description?: string;
  status?: string;
  priority?: string;
  companyName?: string;
  companyId?: number | null;
  contactId?: number | null;
  assignee?: string;
  assigneeId?: number | null;
  closedAt?: Date | null;
}

/** Resolve a Company's name so we can keep ticket.companyName denormalized. */
async function companyNameFor(companyId?: number | null): Promise<string | undefined> {
  if (!companyId) return undefined;
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  return c?.name ?? undefined;
}

export async function list(opts: TicketListOptions = {}) {
  const { page = 1, pageSize = 100, ...filters } = opts;
  return prisma.ticket.findMany({
    where: buildWhere(filters),
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { assigneeUser: true, labels: { include: { label: true } } },
  });
}

/** Total rows matching the same filters as list() — for server-side paging. */
export async function count(filters: Omit<TicketListOptions, 'page' | 'pageSize'> = {}) {
  return prisma.ticket.count({ where: buildWhere(filters) });
}

/** One round-trip: a page of tickets plus the total for the same filters. */
export async function listPaged(opts: TicketListOptions = {}) {
  const { page = 1, pageSize = 100, ...filters } = opts;
  const [items, total] = await Promise.all([
    list(opts),
    count(filters),
  ]);
  return { items, total, page, pageSize };
}

export async function getById(id: number) {
  return prisma.ticket.findUnique({
    where: { id },
    include: {
      assigneeUser: true,
      company: true,
      contact: true,
      notes: { orderBy: { createdAt: 'desc' } },
      attachments: { orderBy: { createdAt: 'asc' } },
      slaPolicy: true,
      labels: { include: { label: true } },
    },
  });
}

/** Tickets for a company (by FK), most recent first. */
export function listForCompany(companyId: number) {
  return prisma.ticket.findMany({
    where: { companyId, status: { not: 'Deleted' } },
    orderBy: { createdAt: 'desc' },
    include: { assigneeUser: true, contact: true },
  });
}

/**
 * Fuzzy ticket search (Postgres). Combines three signals so typos, partial
 * words, priority terms, and conversation content all match:
 *  - `websearch_to_tsquery` full-text rank over ticket text (idx_tickets_fts)
 *  - `pg_trgm` similarity over the concatenated ticket text incl. priority +
 *    ticket number (idx_tickets_trgm) — typo-tolerant
 *  - trigram similarity over note bodies (idx_notes_content_trgm) — reaches into
 *    the timeline/email conversation
 * Rank = the greatest of the three. A low trigram floor keeps near-misses.
 */
export async function search(q: string, limit = 50) {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.toLowerCase()}%`;
  const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    WITH ticket_txt AS (
      SELECT id,
        to_tsvector('english',
          coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' ||
          coalesce(description,'') || ' ' || coalesce(company_name,'')) AS tsv,
        lower(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' ||
          coalesce(description,'') || ' ' || coalesce(company_name,'') || ' ' ||
          coalesce(priority,'') || ' ' || coalesce(ticket_number,'')) AS txt
      FROM tickets WHERE status <> 'Deleted'
    ),
    note_sim AS (
      SELECT ticket_id AS id, max(similarity(lower(content), ${term})) AS nsim
      FROM notes GROUP BY ticket_id
    )
    SELECT t.id,
      GREATEST(
        ts_rank(t.tsv, websearch_to_tsquery('english', ${term})),
        similarity(t.txt, ${term}),
        coalesce(n.nsim, 0)
      ) AS rank
    FROM ticket_txt t
    LEFT JOIN note_sim n ON n.id = t.id
    WHERE t.tsv @@ websearch_to_tsquery('english', ${term})
       OR t.txt % ${term}
       OR t.txt LIKE ${like}
       OR coalesce(n.nsim, 0) > 0.2
    ORDER BY rank DESC
    LIMIT ${limit}
  `);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  // Re-hydrate full records, preserving rank order.
  const tickets = await prisma.ticket.findMany({
    where: { id: { in: ids } },
    include: { assigneeUser: true, labels: { include: { label: true } } },
  });
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function create(input: CreateTicketInput, actorSub: string) {
  // If linked to a Company, keep companyName in sync with the Company record.
  const companyName = input.companyId ? await companyNameFor(input.companyId) : input.companyName;
  // Score SLA at creation time; deadlines are anchored to "now" (= createdAt).
  const sla = await computeSlaFields(input.priority, input.companyId, new Date());
  const ticket = await prisma.ticket.create({
    data: {
      title: input.title,
      summary: input.summary,
      description: input.description,
      status: input.status ?? 'New',
      priority: input.priority,
      companyName,
      companyId: input.companyId ?? undefined,
      contactId: input.contactId ?? undefined,
      assignee: input.assignee,
      assigneeId: input.assigneeId,
      source: input.source ?? 'local',
      ticketNumber: input.ticketNumber,
      externalId: input.externalId,
      externalProvider: input.externalProvider,
      slaPolicyId: sla.slaPolicyId ?? undefined,
      responseDueAt: sla.responseDueAt,
      resolutionDueAt: sla.resolutionDueAt,
    },
  });

  await audit.record({
    entityType: 'ticket',
    entityId: ticket.id,
    action: 'create',
    changedBy: actorSub,
    newValue: ticket as unknown as Record<string, unknown>,
  });

  publish({ type: 'ticket.created', ticketId: ticket.id, ticket, actor: actorSub });
  return ticket;
}

export async function update(id: number, input: UpdateTicketInput, actorSub: string) {
  const before = await prisma.ticket.findUnique({ where: { id } });
  if (!before) return null;

  const data: Prisma.TicketUncheckedUpdateInput = { ...input };
  // Re-denormalize companyName when the company link changes.
  if (input.companyId !== undefined) {
    data.companyName = input.companyId ? await companyNameFor(input.companyId) : null;
  }

  // Recompute SLA deadlines when priority or company changes, anchored to the
  // original creation time so the clock isn't reset by an edit.
  const priorityChanged = input.priority !== undefined && input.priority !== before.priority;
  const companyChanged = input.companyId !== undefined && input.companyId !== before.companyId;
  if (priorityChanged || companyChanged) {
    const sla = await computeSlaFields(
      input.priority ?? before.priority,
      input.companyId ?? before.companyId,
      before.createdAt,
    );
    data.slaPolicyId = sla.slaPolicyId;
    data.responseDueAt = sla.responseDueAt;
    data.resolutionDueAt = sla.resolutionDueAt;
  }

  const ticket = await prisma.ticket.update({ where: { id }, data });

  await audit.record({
    entityType: 'ticket',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: before as unknown as Record<string, unknown>,
    newValue: ticket as unknown as Record<string, unknown>,
  });

  // Surface assignment changes so the notification service can alert the new
  // assignee; include the previous assignee so it can avoid self-notifying.
  const assigneeChanged =
    (input.assigneeId !== undefined && input.assigneeId !== before.assigneeId) ||
    (input.assignee !== undefined && input.assignee !== before.assignee);
  publish({
    type: 'ticket.updated',
    ticketId: id,
    ticket,
    actor: actorSub,
    changes: assigneeChanged ? { assigneeId: ticket.assigneeId, prevAssigneeId: before.assigneeId } : undefined,
  });

  return ticket;
}

/** Soft-delete: sets status to 'Deleted' rather than hard-removing the row. */
export async function remove(id: number, actorSub: string) {
  const before = await prisma.ticket.findUnique({ where: { id } });
  if (!before) return null;

  const ticket = await prisma.ticket.update({
    where: { id },
    data: { status: 'Deleted', closedAt: new Date() },
  });

  await audit.record({
    entityType: 'ticket',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: before as unknown as Record<string, unknown>,
  });

  publish({ type: 'ticket.deleted', ticketId: id, actor: actorSub });
  return ticket;
}

/** Upsert a ticket from an external sync source. Returns {ticket, created}. */
export async function upsertExternal(
  externalId: string,
  externalProvider: string,
  input: CreateTicketInput,
  actorSub: string
) {
  const existing = await prisma.ticket.findUnique({
    where: { externalId_externalProvider: { externalId, externalProvider } },
  });

  if (existing) {
    const ticket = await update(existing.id, input as UpdateTicketInput, actorSub);
    return { ticket, created: false };
  }

  const ticket = await create({ ...input, externalId, externalProvider }, actorSub);
  return { ticket, created: true };
}
