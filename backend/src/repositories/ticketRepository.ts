import { Prisma, TicketSource, SyncState } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish } from '../services/realtime/eventBus';
import { computeSlaFields } from '../services/sla';
import { getTickets } from '../services/settingsService';
import { sanitizeEmailHtml } from '../services/mail/sanitizeHtml';
import { clamp } from '../util/strings';
import { resolveTicketCompany } from '../services/companyResolution';
import { mergeCustomFields } from '../services/customFields';

export interface TicketListOptions {
  status?: string;
  assignee?: string;
  companyName?: string;
  source?: TicketSource;
  /** Free-text filter across title/summary/company (case-insensitive contains). */
  q?: string;
  /** POSIX regex (case-insensitive `~*`) matched across ticket text. */
  regex?: string;
  /** Filter to tickets carrying a given label id. */
  labelId?: number;
  /** Filter to tickets routed to a given team (queue). */
  teamId?: number;
  /** Exclude soft-deleted tickets (status = 'Deleted'). Default true. */
  includeDeleted?: boolean;
  /** Include closed tickets. When explicitly false, status 'Closed' is hidden so
   *  the default working views (board/cards) only show live tickets. */
  includeClosed?: boolean;
  /** Internal: constrain to a pre-resolved id set (e.g. regex-matched ids). */
  idIn?: number[];
  /** Equality filters on Ticket.customFields, keyed by field key. Values must
   *  already be coerced to the definition's type (route layer's job). */
  customFieldEquals?: Record<string, string | number | boolean>;
  page?: number;
  pageSize?: number;
}

/** Build the Prisma where-clause shared by list() and count() so paging totals
 *  always match the rows returned. Exported for direct unit testing. */
export function buildWhere(filters: Omit<TicketListOptions, 'page' | 'pageSize'>): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {};
  if (filters.assignee) where.assignee = { contains: filters.assignee };
  if (filters.companyName) where.companyName = { contains: filters.companyName };
  if (filters.source) where.source = filters.source;
  if (filters.labelId) where.labels = { some: { labelId: filters.labelId } };
  if (filters.teamId) where.teamId = filters.teamId;
  if (filters.customFieldEquals && Object.keys(filters.customFieldEquals).length) {
    // One JSONB path-equality per field; AND so multiple filters all apply.
    where.AND = Object.entries(filters.customFieldEquals).map(([key, value]) => ({
      customFields: { path: [key], equals: value },
    }));
  }
  // A regex filter resolves to a concrete id set upstream (Prisma has no POSIX
  // regex operator); an empty set must match nothing, not everything.
  if (filters.idIn) where.id = { in: filters.idIn.length ? filters.idIn : [-1] };

  // Status: an explicit status wins; otherwise hide soft-deleted and (by default)
  // closed tickets. Exclusions are opt-in (=== false) so MCP/internal callers
  // that pass neither flag keep their previous, unfiltered behavior.
  if (filters.status) {
    where.status = filters.status;
  } else {
    const hidden: string[] = [];
    if (filters.includeDeleted === false) hidden.push('Deleted');
    if (filters.includeClosed === false) hidden.push('Closed');
    if (hidden.length) where.status = { notIn: hidden };
  }

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

/**
 * Resolve a POSIX regex to the ticket ids whose concatenated text matches it.
 * Prisma has no `~*` operator, so regex filtering is a raw pre-pass; the ids then
 * flow into the normal where-clause (composing with status/company/label/paging).
 * An invalid pattern surfaces as a 400 rather than a 500.
 */
async function regexMatchIds(pattern: string, limit = 2000): Promise<number[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id FROM tickets
      WHERE status <> 'Deleted'
        AND (coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' ||
             coalesce(description,'') || ' ' || coalesce(company_name,'') || ' ' ||
             coalesce(ticket_number,'') || ' ' || coalesce(priority,'')) ~* ${pattern}
      ORDER BY id DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => r.id);
  } catch (err) {
    // Postgres raises SQLSTATE 2201B for an invalid regular expression. Prisma
    // wraps raw-query failures (its own code is P2010), so the real PG code lands
    // in `meta.code` and the text in `meta.message` — check all of them.
    const e = err as { code?: string; meta?: { code?: string; message?: string }; message?: string };
    const pgCode = e.meta?.code ?? e.code;
    const text = `${e.meta?.message ?? ''} ${e.message ?? ''}`;
    if (pgCode === '2201B' || /invalid regular expression/i.test(text)) {
      throw Object.assign(new Error('Invalid regular expression'), { statusCode: 400 });
    }
    throw err;
  }
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
  teamId?: number | null;
  /** Partial custom-field value map; validated against CustomFieldDef. */
  customFields?: Record<string, unknown>;
  /** Manual deadline — overrides the SLA resolution target while set. */
  dueAt?: Date | null;
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
  teamId?: number | null;
  /** Partial custom-field value map; merged into the stored map (null clears a key). */
  customFields?: Record<string, unknown>;
  /** Manual deadline — overrides the SLA resolution target; null falls back to SLA. */
  dueAt?: Date | null;
  closedAt?: Date | null;
}

const HTML_TAG_RE = /<\/?[a-z][\s\S]*>/i;

function sanitizeTicketDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return HTML_TAG_RE.test(value) ? sanitizeEmailHtml(value) : value;
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
    include: { assigneeUser: true, team: true, labels: { include: { label: true } } },
  });
}

/** Total rows matching the same filters as list() — for server-side paging. */
export async function count(filters: Omit<TicketListOptions, 'page' | 'pageSize'> = {}) {
  return prisma.ticket.count({ where: buildWhere(filters) });
}

/** One round-trip: a page of tickets plus the total for the same filters. */
export async function listPaged(opts: TicketListOptions = {}) {
  const { page = 1, pageSize = 100, ...filters } = opts;
  // Resolve a regex to ids once, then reuse for both the page and the count so
  // they stay consistent (and we don't run the raw match twice).
  if (filters.regex && filters.regex.trim()) {
    filters.idIn = await regexMatchIds(filters.regex.trim());
  }
  delete filters.regex;
  const [items, total] = await Promise.all([
    list({ ...filters, page, pageSize }),
    count(filters),
  ]);
  return { items, total, page, pageSize };
}

export async function getById(id: number) {
  return prisma.ticket.findUnique({
    where: { id },
    include: {
      assigneeUser: true,
      team: true,
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
    include: { assigneeUser: true, team: true, labels: { include: { label: true } } },
  });
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Look up a ticket by its human-friendly ticket number (exact match). */
export async function findByNumber(ticketNumber: string) {
  return prisma.ticket.findFirst({ where: { ticketNumber } });
}

/**
 * Draw the next human-friendly ticket number from the Postgres sequence and
 * left-pad it to the configured width (so a 4-digit setting still yields 0042
 * until the sequence outgrows it). The sequence (created in pgExtras) is the
 * monotonic source of truth; the digit setting only controls min width.
 */
async function nextTicketNumber(): Promise<string> {
  const { numberDigits } = await getTickets();
  const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('ticket_number_seq')`;
  return String(nextval).padStart(numberDigits, '0');
}

export async function create(input: CreateTicketInput, actorSub: string) {
  // Every ticket belongs to a real Company row. Named legacy/sync inputs are
  // promoted, while genuinely unclassified work falls back to the internal
  // company so downstream company views, SLA rules, and contacts stay usable.
  const company = await resolveTicketCompany(input, actorSub);
  // Score SLA at creation time; deadlines are anchored to "now" (= createdAt).
  const sla = await computeSlaFields(input.priority, company.id, new Date());
  // Externally-sourced tickets keep their provider's number; everything else
  // gets a generated, human-friendly number from the sequence.
  const ticketNumber = input.ticketNumber ?? (await nextTicketNumber());
  const customFields = input.customFields !== undefined
    ? await mergeCustomFields(null, input.customFields)
    : null;
  const ticket = await prisma.ticket.create({
    data: {
      // Clamp bounded VarChar columns so wild inbound email subjects/Message-IDs
      // can't overflow and 500 the insert (see schema column widths).
      title: clamp(input.title, 255),
      summary: clamp(input.summary, 500),
      description: sanitizeTicketDescription(input.description),
      status: input.status ?? 'New',
      // Force a priority default here (not just in the create dialog) so tickets
      // arriving from inbound email / API / sync are never left without one —
      // a null priority renders as a blank chip that reads as "unset" everywhere.
      priority: input.priority ?? 'Medium',
      companyName: clamp(company.name, 150),
      companyId: company.id,
      contactId: input.contactId ?? undefined,
      assignee: clamp(input.assignee, 100),
      assigneeId: input.assigneeId,
      teamId: input.teamId ?? undefined,
      customFields: customFields && Object.keys(customFields).length
        ? customFields as Prisma.InputJsonValue
        : undefined,
      source: input.source ?? 'local',
      ticketNumber: clamp(ticketNumber, 50),
      externalId: clamp(input.externalId, 255),
      externalProvider: clamp(input.externalProvider, 50),
      slaPolicyId: sla.slaPolicyId ?? undefined,
      responseDueAt: sla.responseDueAt,
      resolutionDueAt: sla.resolutionDueAt,
      dueAt: input.dueAt ?? undefined,
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

  const data: Prisma.TicketUncheckedUpdateInput = {
    // Explicitly pick writable fields. Request bodies are runtime data, so
    // spreading them here would let unknown Prisma fields bypass the API surface.
    companyId: input.companyId,
    contactId: input.contactId,
    assigneeId: input.assigneeId,
    teamId: input.teamId,
    dueAt: input.dueAt,
    closedAt: input.closedAt,
    // Custom fields merge per-key into the stored map (null clears a key) and
    // are validated against the definitions — never a raw spread.
    customFields:
      input.customFields !== undefined
        ? ((await mergeCustomFields(before.customFields, input.customFields)) as Prisma.InputJsonValue)
        : undefined,
    title: clamp(input.title, 255),
    summary: clamp(input.summary, 500),
    description: sanitizeTicketDescription(input.description),
    status: clamp(input.status, 100),
    priority: clamp(input.priority, 50),
    companyName: clamp(input.companyName, 150),
    assignee: clamp(input.assignee, 100),
  };
  // Re-denormalize companyName when the company link changes. Clearing a
  // company means "move to internal", never "make this ticket an orphan".
  if (input.companyId !== undefined) {
    const company = await resolveTicketCompany({ companyId: input.companyId }, actorSub);
    data.companyId = company.id;
    data.companyName = clamp(company.name, 150);
  }

  // Recompute SLA deadlines when priority or company changes, anchored to the
  // original creation time so the clock isn't reset by an edit.
  const priorityChanged = input.priority !== undefined && input.priority !== before.priority;
  const companyChanged = input.companyId !== undefined && input.companyId !== before.companyId;
  if (priorityChanged || companyChanged) {
    const sla = await computeSlaFields(
      input.priority ?? before.priority,
      (data.companyId as number | undefined) ?? before.companyId,
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

// ─── Two-way sync bookkeeping ──────────────────────────────────────────────────

/** Mark an external ticket dirty (local change awaiting outbound push). No-op for
 *  local tickets or ones already flagged as conflicted (a conflict must be
 *  resolved before it can go back to pending). */
export async function markPending(id: number): Promise<void> {
  const t = await prisma.ticket.findUnique({ where: { id }, select: { externalId: true, syncState: true } });
  if (!t?.externalId || t.syncState === 'conflict') return;
  await prisma.ticket.update({ where: { id }, data: { syncState: 'pending' } });
}

/** Set the sync state and (optionally) the reconcile bookkeeping fields. */
export async function setSyncState(
  id: number,
  state: SyncState,
  extra?: { remoteHash?: string; remoteUpdatedAt?: Date | null; syncedAt?: Date }
): Promise<void> {
  await prisma.ticket.update({
    where: { id },
    data: {
      syncState: state,
      ...(extra?.remoteHash !== undefined ? { remoteHash: extra.remoteHash } : {}),
      ...(extra?.remoteUpdatedAt !== undefined ? { remoteUpdatedAt: extra.remoteUpdatedAt } : {}),
      ...(extra?.syncedAt !== undefined ? { syncedAt: extra.syncedAt } : {}),
    },
  });
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
