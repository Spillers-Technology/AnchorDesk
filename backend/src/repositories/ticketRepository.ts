import { Prisma, Ticket, TicketSource, SyncState } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish, TicketMetricContext } from '../services/realtime/eventBus';
import { computeSlaFields } from '../services/sla';
import { getTickets } from '../services/settingsService';
import { sanitizeEmailHtml } from '../services/mail/sanitizeHtml';
import { clamp } from '../util/strings';
import { resolveTicketCompany } from '../services/companyResolution';
import { mergeCustomFields } from '../services/customFields';
import { TERMINAL_TICKET_STATUSES } from '../services/ticketVocab';

const reportingTerminalStatuses = new Set<string>([
  ...TERMINAL_TICKET_STATUSES,
  'Deleted',
]);

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
  /** Children of one ticket. */
  parentId?: number | null;
  /** Split top-level tickets from subtasks without naming a specific parent. */
  hasParent?: boolean;
  /** Include merged-away tombstones. When explicitly false they are hidden even
   *  in closed-inclusive views. */
  includeMerged?: boolean;
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

  // Hierarchy filters (2.6). `parentId` lists one ticket's children; `hasParent`
  // separates top-level work from subtasks without naming a parent.
  if (filters.parentId !== undefined) where.parentId = filters.parentId;
  if (filters.hasParent !== undefined) {
    where.parentId = filters.hasParent ? { not: null } : null;
  }
  // Merged tickets are tombstones — their conversation lives on the survivor, so
  // they stay out of working lists unless asked for explicitly. They are already
  // `Closed`, so this only matters once closed tickets are being shown.
  if (filters.includeMerged === false) where.mergedIntoId = null;

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
  /** Which Connection this ticket was ingested from, so two-way reconcile later
   *  authenticates against the same tenant. Null for legacy single-account
   *  installs and for locally created tickets. */
  syncConnectionId?: number | null;
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

export interface UpdateTicketOptions {
  /** Local is the safe default for web, MCP, and automation. Only provider
   * reconciliation may opt into remote mode. */
  origin?: 'local' | 'remote';
  /** Remote writes are compare-and-set against the revision read before HTTP. */
  expectedSyncRevision?: number;
  /** Internal compare-and-set guards for bulk dimension maintenance. They keep
   * an admin delete/backfill from overwriting a concurrent reassignment. */
  expectedCompanyId?: number | null;
  expectedTeamId?: number | null;
  /** Bookkeeping committed atomically with a successful remote-field apply. */
  syncResult?: {
    state: SyncState;
    remoteHash?: string;
    remoteUpdatedAt?: Date | null;
    syncedAt?: Date;
  };
}

export class TicketSyncRevisionConflictError extends Error {
  constructor(readonly ticketId: number) {
    super('ticket changed locally while reconciliation was in progress');
    this.name = 'TicketSyncRevisionConflictError';
  }
}

const SYNC_RELEVANT_UPDATE_FIELDS: ReadonlyArray<keyof UpdateTicketInput> = [
  'status',
  'priority',
  'assignee',
  'assigneeId',
  'title',
  'description',
];

const HTML_TAG_RE = /<\/?[a-z][\s\S]*>/i;

function sanitizeTicketDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return HTML_TAG_RE.test(value) ? sanitizeEmailHtml(value) : value;
}

function metricContext(ticket: Pick<
  Ticket,
  'companyId' | 'teamId' | 'assigneeId' | 'priority' | 'status' | 'updatedAt'
>, occurredAt = ticket.updatedAt): TicketMetricContext {
  return {
    companyId: ticket.companyId,
    teamId: ticket.teamId,
    assigneeId: ticket.assigneeId,
    priority: ticket.priority,
    status: ticket.status,
    occurredAt,
  };
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return a?.getTime() === b?.getTime();
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
      parent: { select: { id: true, ticketNumber: true, title: true, status: true } },
      children: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, ticketNumber: true, title: true, status: true, priority: true },
      },
      mergedInto: { select: { id: true, ticketNumber: true, title: true, status: true } },
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
  const establishedAt = new Date();
  const effectivePriority = input.priority ?? 'Medium';
  // Score the value that is actually persisted. Previously an omitted priority
  // stored Medium but resolved an SLA as null, making the live deadline and the
  // frozen promise disagree from birth.
  const sla = await computeSlaFields(effectivePriority, company.id, establishedAt);
  // Externally-sourced tickets keep their provider's number; everything else
  // gets a generated, human-friendly number from the sequence.
  const ticketNumber = input.ticketNumber ?? (await nextTicketNumber());
  const customFields = input.customFields !== undefined
    ? await mergeCustomFields(null, input.customFields)
    : null;
  const { ticket, auditId } = await prisma.$transaction(async (tx) => {
    const row = await tx.ticket.create({
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
        priority: effectivePriority,
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
        syncConnectionId: input.syncConnectionId ?? null,
        slaPolicyId: sla.slaPolicyId ?? undefined,
        responseDueAt: sla.responseDueAt,
        resolutionDueAt: sla.resolutionDueAt,
        dueAt: input.dueAt ?? undefined,
        createdAt: establishedAt,
      },
    });

    if (sla.snapshot) {
      await tx.ticketSlaSnapshot.create({
        data: {
          ticketId: row.id,
          ...sla.snapshot,
          establishedAt,
        },
      });
    }

    const auditRow = await audit.record({
      entityType: 'ticket',
      entityId: row.id,
      action: 'create',
      changedBy: actorSub,
      newValue: row as unknown as Record<string, unknown>,
    }, tx);
    return { ticket: row, auditId: auditRow?.id.toString() };
  });

  publish({
    type: 'ticket.created',
    ticketId: ticket.id,
    ticket,
    actor: actorSub,
    auditId,
    metric: { context: metricContext(ticket, ticket.createdAt) },
  });
  return ticket;
}

export async function update(
  id: number,
  input: UpdateTicketInput,
  actorSub: string,
  options: UpdateTicketOptions = {}
) {
  // Resolve a positive company id before taking the ticket row lock.
  // `undefined` means "leave company alone"; an explicit null is a real clear
  // used when a Company is being removed. Do not feed null through
  // resolveTicketCompany(), whose create-time contract deliberately falls back
  // to the internal company.
  const resolvedCompany = input.companyId != null
    ? await resolveTicketCompany({ companyId: input.companyId }, actorSub)
    : null;

  const result = await prisma.$transaction(async (tx) => {
    // The transition decision and write share a row lock. Without it, two
    // concurrent "New -> Resolved" calls can both read New and emit two facts.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tickets WHERE id = ${id} FOR UPDATE`);
    const before = await tx.ticket.findUnique({ where: { id } });
    if (!before) return null;
    if (
      options.expectedCompanyId !== undefined &&
      before.companyId !== options.expectedCompanyId
    ) {
      return null;
    }
    if (
      options.expectedTeamId !== undefined &&
      before.teamId !== options.expectedTeamId
    ) {
      return null;
    }

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
    if (resolvedCompany) {
      data.companyId = resolvedCompany.id;
      data.companyName = clamp(resolvedCompany.name, 150);
    }

    const priorityChanged = input.priority !== undefined && input.priority !== before.priority;
    const companyCleared = input.companyId === null && before.companyId !== null;
    const companyChanged =
      companyCleared ||
      (resolvedCompany !== null && resolvedCompany.id !== before.companyId);
    const requestedStatus = input.status ?? before.status;
    const reopensTicket =
      reportingTerminalStatuses.has(before.status) &&
      !reportingTerminalStatuses.has(requestedStatus);
    let retarget:
      | {
          policyId: number | null;
          policyName: string | null;
          responseMinutes: number | null;
          resolutionMinutes: number | null;
          responseDueAt: Date | null;
          resolutionDueAt: Date | null;
        }
      | null = null;
    if (priorityChanged || companyChanged || reopensTicket) {
      const sla = await computeSlaFields(
        input.priority ?? before.priority,
        input.companyId === null
          ? null
          : resolvedCompany?.id ?? before.companyId,
        before.createdAt,
      );
      data.slaPolicyId = sla.slaPolicyId;
      data.responseDueAt = sla.responseDueAt;
      data.resolutionDueAt = sla.resolutionDueAt;
      retarget = sla.snapshot
        ? sla.snapshot
        : {
            policyId: null,
            policyName: null,
            responseMinutes: null,
            resolutionMinutes: null,
            responseDueAt: null,
            resolutionDueAt: null,
          };
    }

    const localSyncMutation =
      (options.origin ?? 'local') === 'local' &&
      before.externalId != null &&
      before.externalProvider != null &&
      SYNC_RELEVANT_UPDATE_FIELDS.some((field) => input[field] !== undefined);
    if (localSyncMutation) {
      data.syncRevision = { increment: 1 };
      if (before.syncState !== 'conflict') data.syncState = 'pending';
    }

    if (options.syncResult) {
      data.syncState = options.syncResult.state;
      if (options.syncResult.remoteHash !== undefined) data.remoteHash = options.syncResult.remoteHash;
      if (options.syncResult.remoteUpdatedAt !== undefined) {
        data.remoteUpdatedAt = options.syncResult.remoteUpdatedAt;
      }
      if (options.syncResult.syncedAt !== undefined) data.syncedAt = options.syncResult.syncedAt;
    }

    if (options.expectedSyncRevision !== undefined) {
      const changed = await tx.ticket.updateMany({
        where: { id, syncRevision: options.expectedSyncRevision },
        data,
      });
      if (changed.count !== 1) throw new TicketSyncRevisionConflictError(id);
    } else {
      await tx.ticket.update({ where: { id }, data });
    }
    const row = await tx.ticket.findUniqueOrThrow({ where: { id } });

    // A priority/company edit after completion is bookkeeping, not a new
    // promise. If the same mutation reopens the ticket, row.status is live and
    // a fresh target is legitimate.
    if (retarget && !reportingTerminalStatuses.has(row.status)) {
      const latest = await tx.ticketSlaSnapshot.findFirst({
        where: { ticketId: id },
        orderBy: [{ establishedAt: 'desc' }, { id: 'desc' }],
      });
      const targetChanged =
        !latest ||
        latest.policyId !== retarget.policyId ||
        latest.policyName !== retarget.policyName ||
        latest.responseMinutes !== retarget.responseMinutes ||
        latest.resolutionMinutes !== retarget.resolutionMinutes ||
        !sameDate(latest.responseDueAt, retarget.responseDueAt) ||
        !sameDate(latest.resolutionDueAt, retarget.resolutionDueAt);
      // Do not manufacture a "no SLA" baseline for a ticket that never had one.
      // A null row is only an append-only tombstone superseding a real target.
      const hadTarget = latest && (
        latest.policyId !== null ||
        latest.responseDueAt !== null ||
        latest.resolutionDueAt !== null
      );
      if (targetChanged && (retarget.policyId !== null || hadTarget)) {
        await tx.ticketSlaSnapshot.create({
          data: {
            ticketId: id,
            ...retarget,
            establishedAt: row.updatedAt,
          },
        });
      }
    }

    const auditRow = await audit.record({
      entityType: 'ticket',
      entityId: id,
      action: 'update',
      changedBy: actorSub,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    }, tx);
    return { row, before, auditId: auditRow?.id.toString() };
  });
  if (!result) return null;
  const { row: ticket, before, auditId } = result;

  // Surface assignment changes so the notification service can alert the new
  // assignee; include the previous assignee so it can avoid self-notifying.
  const assigneeChanged =
    ticket.assigneeId !== before.assigneeId || ticket.assignee !== before.assignee;
  const teamChanged = ticket.teamId !== before.teamId;
  const statusChanged = ticket.status !== before.status;
  const contextChanged =
    ticket.companyId !== before.companyId || ticket.priority !== before.priority;
  publish({
    type: 'ticket.updated',
    ticketId: id,
    ticket,
    actor: actorSub,
    changes: assigneeChanged ? { assigneeId: ticket.assigneeId, prevAssigneeId: before.assigneeId } : undefined,
    auditId,
    metric: {
      context: metricContext(ticket),
      ...(statusChanged ? { status: { from: before.status, to: ticket.status } } : {}),
      ...(assigneeChanged || teamChanged
        ? {
            assignment: {
              fromAssigneeId: before.assigneeId,
              toAssigneeId: ticket.assigneeId,
              fromTeamId: before.teamId,
              toTeamId: ticket.teamId,
            },
          }
        : {}),
      ...(contextChanged ? { contextChanged: true } : {}),
    },
  });

  return ticket;
}

// ─── Hierarchy (2.6) ──────────────────────────────────────────────────────────

export class TicketHierarchyError extends Error {
  constructor(
    readonly code:
      | 'self-parent'
      | 'parent-missing'
      | 'parent-is-child'
      | 'child-has-children'
      | 'parent-merged'
      | 'child-merged',
    message: string
  ) {
    super(message);
    this.name = 'TicketHierarchyError';
  }
}

/**
 * Attach a ticket to a parent, or detach it with `parentId: null`.
 *
 * The 2.6 invariant is **exactly one level**: a ticket that has a parent may not
 * itself be a parent. That removes cycle detection entirely — every violation is
 * visible in the two rows involved — and matches what JSM subtasks allow.
 * Arbitrary depth with a real cycle check is a 3.0 item.
 *
 * Both rows are locked for the check-then-write, because the check is only
 * meaningful if nobody can reparent either of them in between: two concurrent
 * calls could otherwise each see a legal state and together produce a
 * grandparent. A trigger in db/pgExtras.ts enforces the same rule underneath, so
 * a direct psql edit cannot bypass it either.
 */
export async function setParent(
  id: number,
  parentId: number | null,
  actorSub: string
): Promise<Ticket | null> {
  return prisma.$transaction(async (tx) => {
    const ids = parentId === null ? [id] : [id, parentId];
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM tickets WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
    );

    const before = await tx.ticket.findUnique({ where: { id } });
    if (!before) return null;

    if (parentId !== null) {
      if (parentId === id) {
        throw new TicketHierarchyError('self-parent', 'a ticket cannot be its own parent');
      }
      const parent = await tx.ticket.findUnique({ where: { id: parentId } });
      if (!parent) {
        throw new TicketHierarchyError('parent-missing', `ticket ${parentId} does not exist`);
      }
      if (parent.mergedIntoId) {
        throw new TicketHierarchyError(
          'parent-merged',
          `ticket #${parentId} was merged away; use the ticket it was merged into`
        );
      }
      if (before.mergedIntoId) {
        throw new TicketHierarchyError('child-merged', 'a merged ticket cannot be given a parent');
      }
      if (parent.parentId !== null) {
        throw new TicketHierarchyError(
          'parent-is-child',
          `ticket #${parentId} is already a child of #${parent.parentId}; ` +
            'AnchorDesk supports one level of hierarchy'
        );
      }
      const childCount = await tx.ticket.count({ where: { parentId: id } });
      if (childCount > 0) {
        throw new TicketHierarchyError(
          'child-has-children',
          `ticket #${id} has ${childCount} child ticket(s), so it cannot also become a child`
        );
      }
    }

    await tx.ticket.update({ where: { id }, data: { parentId } });
    const row = await tx.ticket.findUniqueOrThrow({ where: { id } });
    await audit.record(
      {
        entityType: 'ticket',
        entityId: id,
        action: 'update',
        changedBy: actorSub,
        oldValue: before as unknown as Record<string, unknown>,
        newValue: row as unknown as Record<string, unknown>,
      },
      tx
    );
    return row;
  });
}

/** Children of a ticket, in creation order. */
export function listChildren(parentId: number) {
  return prisma.ticket.findMany({
    where: { parentId },
    orderBy: { createdAt: 'asc' },
    include: { assigneeUser: true, labels: { include: { label: true } } },
  });
}

/** Soft-delete: sets status to 'Deleted' rather than hard-removing the row. */
export async function remove(id: number, actorSub: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tickets WHERE id = ${id} FOR UPDATE`);
    const before = await tx.ticket.findUnique({ where: { id } });
    if (!before) return null;
    const ticket = await tx.ticket.update({
      where: { id },
      data: { status: 'Deleted', closedAt: new Date() },
    });
    const auditRow = await audit.record({
      entityType: 'ticket',
      entityId: id,
      action: 'delete',
      changedBy: actorSub,
      oldValue: before as unknown as Record<string, unknown>,
    }, tx);
    return { ticket, before, auditId: auditRow?.id.toString() };
  });
  if (!result) return null;
  const { ticket, before, auditId } = result;

  publish({
    type: 'ticket.deleted',
    ticketId: id,
    ticket,
    actor: actorSub,
    auditId,
    metric: {
      context: metricContext(ticket),
      status: { from: before.status, to: ticket.status },
    },
  });
  return ticket;
}

// ─── Two-way sync bookkeeping ──────────────────────────────────────────────────

/** Compare-and-set sync bookkeeping after remote I/O. A newer local mutation
 * wins and remains pending instead of being cleared by a stale reconcile. */
export async function setSyncStateIfRevision(
  id: number,
  expectedSyncRevision: number,
  state: SyncState,
  extra?: { remoteHash?: string; remoteUpdatedAt?: Date | null; syncedAt?: Date }
): Promise<boolean> {
  const updated = await prisma.ticket.updateMany({
    where: { id, syncRevision: expectedSyncRevision },
    data: {
      syncState: state,
      ...(extra?.remoteHash !== undefined ? { remoteHash: extra.remoteHash } : {}),
      ...(extra?.remoteUpdatedAt !== undefined ? { remoteUpdatedAt: extra.remoteUpdatedAt } : {}),
      ...(extra?.syncedAt !== undefined ? { syncedAt: extra.syncedAt } : {}),
    },
  });
  return updated.count === 1;
}

/** A stale outbound push may already have landed remotely. Record that verified
 * remote baseline without clearing the newer local pending mutation, so the
 * retry pushes the latest values instead of manufacturing a false conflict. */
export async function advanceRemoteBaselineWhilePending(
  id: number,
  previousSyncRevision: number,
  extra: { remoteHash: string; remoteUpdatedAt?: Date | null; syncedAt?: Date }
): Promise<boolean> {
  const updated = await prisma.ticket.updateMany({
    where: {
      id,
      syncRevision: { gt: previousSyncRevision },
      syncState: { in: ['pending', 'error', 'conflict'] },
    },
    data: {
      remoteHash: extra.remoteHash,
      ...(extra.remoteUpdatedAt !== undefined ? { remoteUpdatedAt: extra.remoteUpdatedAt } : {}),
      ...(extra.syncedAt !== undefined ? { syncedAt: extra.syncedAt } : {}),
    },
  });
  return updated.count === 1;
}

/** Preserve newer local fields while surfacing a genuine simultaneous remote
 * change as a held conflict. */
export async function markConflictAfterConcurrentLocalEdit(
  id: number,
  previousSyncRevision: number,
  remoteUpdatedAt?: Date | null
): Promise<boolean> {
  const updated = await prisma.ticket.updateMany({
    // `mergedIntoId: null` matters as much as the revision test. A merge bumps
    // syncRevision precisely so an in-flight reconcile's compare-and-set fails —
    // which lands here. Without this predicate the losing reconcile would then
    // flag the tombstone as a conflict, putting a ticket that was deliberately
    // taken out of sync into the conflict queue for someone to "resolve".
    where: { id, syncRevision: { gt: previousSyncRevision }, mergedIntoId: null },
    data: {
      syncState: 'conflict',
      ...(remoteUpdatedAt !== undefined ? { remoteUpdatedAt } : {}),
    },
  });
  return updated.count === 1;
}

/** Upsert a ticket from an external sync source. Returns {ticket, created}. */
export async function upsertExternal(
  externalId: string,
  externalProvider: string,
  input: CreateTicketInput,
  actorSub: string
) {
  // Scoped by connection: external ids are only unique within one account, so a
  // second tenant's "HELP-1" must not update the first tenant's ticket.
  const existing = await prisma.ticket.findFirst({
    where: { externalId, externalProvider, syncConnectionId: input.syncConnectionId ?? null },
  });

  if (existing) {
    // A merged ticket is a tombstone whose conversation now lives on the
    // survivor. Blindly applying the remote's fields here would reopen it and
    // rewrite the status the merge set, so the read-only ingest path leaves it
    // alone for exactly the same reason reconcile does. Reported as not-created
    // and unchanged; `merged` lets the caller count it without degrading health.
    if (existing.mergedIntoId) return { ticket: existing, created: false, merged: true };
    const ticket = await update(existing.id, input as UpdateTicketInput, actorSub);
    return { ticket, created: false, merged: false };
  }

  const ticket = await create({ ...input, externalId, externalProvider }, actorSub);
  return { ticket, created: true, merged: false };
}
