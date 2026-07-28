import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import * as audit from '../repositories/auditRepository';
import * as twoWaySync from '../services/twoWaySync';
import { renderTicketHtml } from '../services/ticketExport';
import { sanitizeEmailHtml, htmlToText } from '../services/mail/sanitizeHtml';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import { hasPrismaCode } from '../util/prismaErrors';
import { CustomFieldValidationError, coerceCustomFieldFilters } from '../services/customFields';
import { PRIORITY_LIST_TEXT, STATUS_LIST_TEXT, normalizePriority, normalizeStatus } from '../services/ticketVocab';
import * as customFieldRepo from '../repositories/customFieldRepository';
import { SyncAccountBusyError } from '../services/syncAccountLock';
import { sanitizeSyncError } from '../repositories/syncRunRepository';
import * as mergeService from '../services/merge/mergeService';
import { MergeLedgerFormatError } from '../services/merge/mergeLedger';

interface IdParam { id: string }
interface NoteIdParam { id: string; noteId: string }

/** The ticket fields two-way sync fingerprints and can push/pull (see
 *  twoWaySync remoteHash + pushLocal); assigneeId is included because it
 *  re-denormalizes the synced assignee string. */
const SYNCED_TICKET_FIELDS = ['status', 'priority', 'assignee', 'assigneeId', 'title', 'description'] as const;

/**
 * Fields accepted from the public POST /tickets contract. Sync ingestion calls
 * ticketRepository.create directly because its broader input deliberately
 * includes external identity/provenance. Keeping that internal contract out of
 * this allowlist prevents a normal API caller from manufacturing a remotely
 * writable ticket.
 */
const PUBLIC_TICKET_CREATE_FIELDS = [
  'title',
  'summary',
  'description',
  'status',
  'priority',
  'companyName',
  'companyId',
  'contactId',
  'assignee',
  'assigneeId',
  'teamId',
  'customFields',
  'dueAt',
] as const;
const PUBLIC_TICKET_CREATE_FIELD_SET: ReadonlySet<string> = new Set(PUBLIC_TICKET_CREATE_FIELDS);

/**
 * Public note creation is for locally-authored conversation notes only.
 * Provider ids, author identity, direction, time entries, and email threading
 * are owned by their dedicated ingestion/mail/time paths.
 */
const PUBLIC_NOTE_CREATE_FIELDS = ['content', 'htmlContent', 'noteType', 'visibility'] as const;
const PUBLIC_NOTE_CREATE_FIELD_SET: ReadonlySet<string> = new Set(PUBLIC_NOTE_CREATE_FIELDS);
const PUBLIC_NOTE_UPDATE_FIELDS = ['content', 'htmlContent', 'minutes', 'timeStart', 'timeStop', 'workedAt'] as const;
const PUBLIC_NOTE_UPDATE_FIELD_SET: ReadonlySet<string> = new Set(PUBLIC_NOTE_UPDATE_FIELDS);

interface PublicNoteCreateInput {
  content?: string;
  htmlContent?: string;
  noteType?: 'note' | 'internal';
  visibility?: 'internal' | 'public';
}

function positiveInteger(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function validateTicketInput(value: unknown, creating: boolean): string | null {
  if (!isPlainRecord(value)) return 'request body must be an object';
  if (creating && (typeof value.title !== 'string' || !value.title.trim())) return 'title is required';
  if (creating) {
    const unsupported = Object.keys(value).filter((field) => !PUBLIC_TICKET_CREATE_FIELD_SET.has(field));
    if (unsupported.length) {
      return `unsupported ticket create field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`;
    }
  }
  const strings = ['title', 'summary', 'description', 'status', 'priority', 'companyName', 'assignee'] as const;
  for (const field of strings) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return `${field} must be a string`;
  }
  for (const field of ['companyId', 'contactId', 'assigneeId', 'teamId'] as const) {
    const input = value[field];
    if (input !== undefined && input !== null
        && (typeof input !== 'number' || !Number.isInteger(input) || input <= 0)) {
      return `${field} must be a positive integer or null`;
    }
  }
  if (value.customFields !== undefined && !isPlainRecord(value.customFields)) {
    return 'customFields must be an object';
  }
  // Local writes stick to the canonical vocabulary (case-insensitively
  // canonicalized in place); external sync bypasses this route on purpose.
  if (typeof value.status === 'string' && value.status.trim()) {
    const canonical = normalizeStatus(value.status);
    if (!canonical) return `status must be one of: ${STATUS_LIST_TEXT}`;
    value.status = canonical;
  }
  if (typeof value.priority === 'string' && value.priority.trim()) {
    const canonical = normalizePriority(value.priority);
    if (!canonical) return `priority must be one of: ${PRIORITY_LIST_TEXT}`;
    value.priority = canonical;
  }
  if (value.dueAt !== undefined && value.dueAt !== null) {
    if (typeof value.dueAt !== 'string' || Number.isNaN(Date.parse(value.dueAt))) {
      return 'dueAt must be an ISO 8601 datetime string or null';
    }
  }
  return null;
}

/** JSON carries dueAt as an ISO string (or null to clear); the repo wants a Date. */
function normalizeDueAt(value: Record<string, unknown>): void {
  if (typeof value.dueAt === 'string') value.dueAt = new Date(value.dueAt);
}

function publicTicketCreateInput(value: Record<string, unknown>): ticketRepo.CreateTicketInput {
  const input = Object.fromEntries(
    PUBLIC_TICKET_CREATE_FIELDS
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]])
  ) as unknown as ticketRepo.CreateTicketInput;
  normalizeDueAt(input as unknown as Record<string, unknown>);
  // This value is server-owned. A caller-supplied source is rejected above.
  input.source = 'local';
  return input;
}

function validatePublicNoteCreateInput(value: unknown): string | null {
  if (!isPlainRecord(value)) return 'request body must be an object';
  const unsupported = Object.keys(value).filter((field) => !PUBLIC_NOTE_CREATE_FIELD_SET.has(field));
  if (unsupported.length) {
    return `unsupported note create field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`;
  }
  if (value.content !== undefined && typeof value.content !== 'string') {
    return 'content must be a string';
  }
  if (value.htmlContent !== undefined && typeof value.htmlContent !== 'string') {
    return 'htmlContent must be a string';
  }
  if (value.noteType !== undefined && value.noteType !== 'note' && value.noteType !== 'internal') {
    return 'noteType must be note or internal';
  }
  if (value.visibility !== undefined && value.visibility !== 'internal' && value.visibility !== 'public') {
    return 'visibility must be internal or public';
  }
  return null;
}

function publicNoteUpdateInput(value: unknown): noteRepo.UpdateNoteInput | string {
  if (!isPlainRecord(value)) return 'request body must be an object';
  const unsupported = Object.keys(value).filter((field) => !PUBLIC_NOTE_UPDATE_FIELD_SET.has(field));
  if (unsupported.length) {
    return `unsupported note update field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`;
  }
  if (Object.keys(value).length === 0) return 'no note fields to update';
  if (value.content !== undefined && typeof value.content !== 'string') {
    return 'content must be a string';
  }
  if (
    value.htmlContent !== undefined &&
    value.htmlContent !== null &&
    typeof value.htmlContent !== 'string'
  ) {
    return 'htmlContent must be a string or null';
  }
  if (
    value.minutes !== undefined &&
    value.minutes !== null &&
    (typeof value.minutes !== 'number' ||
      !Number.isInteger(value.minutes) ||
      value.minutes <= 0)
  ) {
    return 'minutes must be a positive integer or null';
  }

  const data: noteRepo.UpdateNoteInput = {};
  if (typeof value.content === 'string') data.content = value.content.trim();
  if (value.htmlContent === null) {
    data.htmlContent = null;
  } else if (typeof value.htmlContent === 'string') {
    data.htmlContent = sanitizeEmailHtml(value.htmlContent);
    data.content = data.content || htmlToText(data.htmlContent);
  }
  if (value.minutes !== undefined) data.minutes = value.minutes as number | null;
  for (const field of ['timeStart', 'timeStop'] as const) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (raw === null) {
      data[field] = null;
    } else if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) {
      data[field] = new Date(raw);
    } else {
      return `${field} must be an ISO 8601 datetime string or null`;
    }
  }
  if (value.workedAt !== undefined) {
    if (
      typeof value.workedAt !== 'string' ||
      !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value.workedAt) ||
      Number.isNaN(Date.parse(value.workedAt))
    ) {
      return 'workedAt must be an ISO 8601 datetime string with a timezone';
    }
    data.workedAt = new Date(value.workedAt);
  }
  if (data.content !== undefined && !data.content && !data.htmlContent) {
    return 'content cannot be blank';
  }
  return data;
}

/**
 * Parse `cf.<key>=value` query params into typed equality filters. Unknown
 * keys and uncoercible values are a 400 (returned as a string error) rather
 * than silently matching nothing. Definitions include archived fields —
 * archiving preserves ticket data, so saved views over it keep working. A
 * repeated param arrives from Fastify as an array and is rejected: equality
 * filters take exactly one value.
 */
async function parseCustomFieldFilters(
  query: Record<string, unknown>,
): Promise<Record<string, string | number | boolean> | string | null> {
  const raw = Object.entries(query).filter(([k]) => k.startsWith('cf.'));
  if (!raw.length) return null;
  const input: Record<string, unknown> = {};
  for (const [param, value] of raw) {
    if (Array.isArray(value)) return `${param} may only be given once`;
    input[param.slice(3)] = value;
  }
  const defs = await customFieldRepo.list({ includeArchived: true });
  try {
    return coerceCustomFieldFilters(defs, input);
  } catch (err) {
    if (err instanceof CustomFieldValidationError) return err.message;
    throw err;
  }
}

export async function ticketRoutes(server: FastifyInstance) {
  // List tickets with optional filtering + server-side pagination. Returns
  // { items, total, page, pageSize } so the client can page without loading
  // the whole table. pageSize is capped to keep one request bounded.
  server.get('/tickets', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const requestedPageSize = positiveInteger(query.pageSize, 50);
    const page = positiveInteger(query.page, 1);
    const labelId = query.labelId === undefined ? undefined : parseId(query.labelId);
    const teamId = query.teamId === undefined ? undefined : parseId(query.teamId);
    const parentId = query.parentId === undefined ? undefined : parseId(query.parentId);
    if (requestedPageSize === null || page === null) return reply.status(400).send({ error: 'page and pageSize must be positive integers' });
    if (query.labelId !== undefined && labelId === null) return reply.status(400).send({ error: 'labelId must be a positive integer' });
    if (query.teamId !== undefined && teamId === null) return reply.status(400).send({ error: 'teamId must be a positive integer' });
    if (query.parentId !== undefined && parentId === null) return reply.status(400).send({ error: 'parentId must be a positive integer' });
    if (query.hasParent !== undefined && query.hasParent !== 'true' && query.hasParent !== 'false') {
      return reply.status(400).send({ error: "hasParent must be 'true' or 'false'" });
    }
    if (query.regex && query.regex.length > 500) return reply.status(400).send({ error: 'regex must be at most 500 characters' });
    const customFieldEquals = await parseCustomFieldFilters(query);
    if (typeof customFieldEquals === 'string') return reply.status(400).send({ error: customFieldEquals });
    const pageSize = Math.min(requestedPageSize, 200);
    const result = await ticketRepo.listPaged({
      status: query.status,
      assignee: query.assignee,
      companyName: query.company,
      q: query.q,
      regex: query.regex,
      labelId: labelId ?? undefined,
      teamId: teamId ?? undefined,
      customFieldEquals: customFieldEquals ?? undefined,
      includeDeleted: query.includeDeleted === 'true',
      // Default working views hide closed tickets; opt in with includeClosed=true
      // (or by selecting a specific status, which always wins).
      includeClosed: query.includeClosed === 'true',
      parentId: parentId ?? undefined,
      hasParent: query.hasParent === undefined ? undefined : query.hasParent === 'true',
      // Tombstones stay out of lists unless explicitly requested — they are
      // already Closed, so this only bites once closed tickets are shown.
      includeMerged: query.includeMerged === 'true',
      page,
      pageSize,
    });
    return reply.send(result);
  });

  // Full-text search (Postgres). Static route — registered before /tickets/:id.
  server.get('/tickets/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const q = query.q ?? '';
    const requestedLimit = positiveInteger(query.limit, 50);
    if (requestedLimit === null) return reply.status(400).send({ error: 'limit must be a positive integer' });
    if (q.length > 500) return reply.status(400).send({ error: 'q must be at most 500 characters' });
    const limit = Math.min(requestedLimit, 200);
    return reply.send(await ticketRepo.search(q, limit));
  });

  // Get a single ticket with notes
  server.get('/tickets/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const ticket = await ticketRepo.getById(id);
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
    return reply.send(ticket);
  });

  // Create ticket
  server.post('/tickets', async (req: FastifyRequest, reply: FastifyReply) => {
    const validationError = validateTicketInput(req.body, true);
    if (validationError) return reply.status(400).send({ error: validationError });
    const body = publicTicketCreateInput(req.body as Record<string, unknown>);

    try {
      const ticket = await ticketRepo.create(body, req.actorSub);
      return reply.status(201).send(ticket);
    } catch (error) {
      if (error instanceof CustomFieldValidationError) return reply.status(400).send({ error: error.message });
      if (hasPrismaCode(error, 'P2003')) return reply.status(400).send({ error: 'A referenced team, user, company, or contact does not exist' });
      throw error;
    }
  });

  // Update ticket fields
  server.patch('/tickets/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const validationError = validateTicketInput(req.body, false);
    if (validationError) return reply.status(400).send({ error: validationError });
    normalizeDueAt(req.body as Record<string, unknown>);

    // parentId is split out of the normal update path: the one-level hierarchy
    // rule spans two rows, so it needs the locked check-then-write in
    // setParent() rather than a field assignment. Applied first, so a rejected
    // reparent doesn't leave the other edits half-applied.
    const body = req.body as Record<string, unknown>;
    if ('parentId' in body) {
      const raw = body.parentId;
      let parentId: number | null;
      if (raw === null) {
        parentId = null;
      } else {
        parentId = parseId(raw === undefined ? undefined : String(raw));
        if (parentId === null) {
          return reply.status(400).send({ error: 'parentId must be a positive integer or null' });
        }
      }
      try {
        const reparented = await ticketRepo.setParent(id, parentId, req.actorSub);
        if (!reparented) return reply.status(404).send({ error: 'Ticket not found' });
      } catch (error) {
        if (error instanceof ticketRepo.TicketHierarchyError) {
          return reply.status(409).send({ error: error.message, code: error.code });
        }
        throw error;
      }
      delete body.parentId;
    }

    let ticket;
    try {
      ticket = await ticketRepo.update(id, req.body as ticketRepo.UpdateTicketInput, req.actorSub);
    } catch (error) {
      if (error instanceof CustomFieldValidationError) return reply.status(400).send({ error: error.message });
      if (hasPrismaCode(error, 'P2003')) return reply.status(400).send({ error: 'A referenced team, user, company, or contact does not exist' });
      throw error;
    }
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

    // Two-way sync: a local edit to an external ticket becomes pending, then we
    // kick a reconcile (which pushes, or flags a conflict if the remote also
    // moved). Fire-and-forget so the edit response stays snappy. Only fields
    // that participate in sync (the remote-hash set) count — a dueAt/team/
    // custom-field edit is local-only and must not manufacture a conflict.
    const touchedSyncedField = SYNCED_TICKET_FIELDS.some(
      (field) => (req.body as Record<string, unknown>)[field] !== undefined,
    );
    if (touchedSyncedField && ticket.externalId && ticket.externalProvider) {
      void twoWaySync
        .reconcileTicket(id, { actor: req.actorSub })
        .catch((err) => req.log.warn(
          {
            message: sanitizeSyncError(err instanceof Error ? err.message : 'two-way reconcile failed'),
            ticketId: id,
          },
          'two-way reconcile after edit failed'
        ));
    }
    return reply.send(ticket);
  });

  // Reconcile an external ticket with its source now (pull/push/flag conflict).
  server.post('/tickets/:id/sync', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    try {
      const result = await twoWaySync.reconcileTicket(id, { actor: req.actorSub });
      return reply.send(result);
    } catch (err) {
      if (err instanceof SyncAccountBusyError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // Resolve a held conflict by choosing the winning side.
  server.post('/tickets/:id/resolve-conflict', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const resolution = (req.body as { resolution?: string })?.resolution;
    if (resolution !== 'local' && resolution !== 'remote') {
      return reply.status(400).send({ error: "resolution must be 'local' or 'remote'" });
    }
    try {
      const result = await twoWaySync.resolveConflict(id, resolution, req.actorSub);
      return reply.send(result);
    } catch (err) {
      if (err instanceof SyncAccountBusyError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // ─── Merge + hierarchy (2.6) ────────────────────────────────────────────────
  // See docs/roadmap-relations-2.6.md. A merge is a local-record operation and
  // never pushes; the acknowledgement contract below is how that stops being a
  // footnote and becomes something the operator actually reads.

  // Dry run: exactly what a merge would move, plus its warnings and blockers.
  server.get(
    '/tickets/:id/merge-preview',
    async (req: FastifyRequest<{ Params: IdParam; Querystring: { targetId?: string } }>, reply: FastifyReply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
      const targetId = parseId(req.query.targetId);
      if (targetId === null) return reply.status(400).send({ error: 'invalid or missing targetId' });
      try {
        return reply.send(await mergeService.previewMerge(id, targetId));
      } catch (err) {
        if (err instanceof mergeService.MergeBlockedError) {
          return reply.status(404).send({ error: err.message, blockers: err.blockers });
        }
        throw err;
      }
    }
  );

  server.post('/tickets/:id/merge', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const body = isPlainRecord(req.body) ? req.body : {};
    const targetId = parseId(body.targetId === undefined ? undefined : String(body.targetId));
    if (targetId === null) return reply.status(400).send({ error: 'invalid or missing targetId' });

    const rawAck = body.acknowledge;
    if (rawAck !== undefined && (!Array.isArray(rawAck) || rawAck.some((v) => typeof v !== 'string'))) {
      return reply.status(400).send({ error: 'acknowledge must be an array of warning codes' });
    }

    try {
      const ticket = await mergeService.mergeTickets(id, targetId, req.actorSub, {
        acknowledge: rawAck as string[] | undefined,
      });
      return reply.send(ticket);
    } catch (err) {
      if (err instanceof mergeService.MergeAcknowledgementRequiredError) {
        // 400 rather than 409: the request is answerable, it is just incomplete.
        // The client re-sends with these codes echoed back.
        return reply
          .status(400)
          .send({ error: err.message, requiresAcknowledgement: err.requiresAcknowledgement });
      }
      if (err instanceof mergeService.MergeBlockedError) {
        return reply.status(409).send({ error: err.message, blockers: err.blockers });
      }
      throw err;
    }
  });

  server.post('/tickets/:id/unmerge', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    try {
      return reply.send(await mergeService.unmergeTicket(id, req.actorSub));
    } catch (err) {
      if (err instanceof mergeService.MergeBlockedError) {
        return reply.status(409).send({ error: err.message, blockers: err.blockers });
      }
      if (err instanceof MergeLedgerFormatError) {
        // The merge happened but its undo record is unreadable. Say so plainly
        // rather than restoring an arbitrary subset of it.
        return reply.status(422).send({ error: err.message });
      }
      throw err;
    }
  });

  server.get('/tickets/:id/children', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    return reply.send(await ticketRepo.listChildren(id));
  });

  // Soft-delete ticket
  server.delete('/tickets/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const ticket = await ticketRepo.remove(id, req.actorSub);
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
    return reply.status(204).send();
  });

  // Printable, self-contained HTML export of the ticket (activity + inline
  // attachments). Served inline so the browser can render + "Print → Save as PDF".
  server.get('/tickets/:id/export', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const html = await renderTicketHtml(id);
    if (!html) return reply.status(404).send({ error: 'Ticket not found' });
    return reply.type('text/html').send(html);
  });

  // Ticket revision history
  server.get('/tickets/:id/history', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const history = await audit.getHistory('ticket', id);
    return reply.send(history);
  });

  // List notes for a ticket
  server.get('/tickets/:id/notes', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const notes = await noteRepo.listForTicket(id);
    return reply.send(notes);
  });

  // Add a note to a ticket
  server.post('/tickets/:id/notes', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const validationError = validatePublicNoteCreateInput(req.body);
    if (validationError) return reply.status(400).send({ error: validationError });
    const body = req.body as PublicNoteCreateInput;
    const htmlContent = body.htmlContent ? sanitizeEmailHtml(body.htmlContent) : undefined;
    const content = body.content?.trim() || (htmlContent ? htmlToText(htmlContent) : '');
    if (!content) return reply.status(400).send({ error: 'content is required' });

    // A note is internal unless someone deliberately publishes it — the
    // failure mode (an unpublish-able note reaching a customer) is
    // unrecoverable, so the default stays safe even for callers that don't
    // know about `visibility` yet (older API/PAT scripts, etc).
    const visibility = body.visibility ?? 'internal';
    const note = await noteRepo.create(
      id,
      {
        content,
        htmlContent,
        noteType: body.noteType ?? 'note',
        author: req.user?.displayName ?? req.actorSub,
        authorId: req.user?.id ?? undefined,
        queueForTicketSync: visibility === 'public',
        visibility,
        via: req.authChannel,
      },
      req.actorSub
    );

    // Only customer-visible notes cross into Jira/ConnectWise — visibility is
    // the real signal now, not noteType (an internal 'note'-type note can
    // contain technician-only context and must stay local).
    if (note.visibility === 'public') {
      void twoWaySync
        .pushNoteOut(id, note.id)
        .catch((err) => req.log.warn(
          {
            message: sanitizeSyncError(err instanceof Error ? err.message : 'note push-out failed'),
            ticketId: id,
            noteId: note.id,
          },
          'note push-out failed'
        ));
    }
    return reply.status(201).send(note);
  });

  // Update a note
  server.patch('/tickets/:id/notes/:noteId', async (req: FastifyRequest<{ Params: NoteIdParam }>, reply: FastifyReply) => {
    const ticketId = parseId(req.params.id);
    const noteId = parseId(req.params.noteId);
    if (ticketId === null) return reply.status(400).send({ error: 'invalid ticket id' });
    if (noteId === null) return reply.status(400).send({ error: 'invalid note id' });
    const parsed = publicNoteUpdateInput(req.body);
    if (typeof parsed === 'string') return reply.status(400).send({ error: parsed });
    let note;
    try {
      note = await noteRepo.update(
        noteId,
        ticketId,
        parsed,
        req.actorSub
      );
    } catch (err) {
      if (err instanceof noteRepo.ExternalNoteImmutableError) {
        return reply.status(409).send({ error: err.message });
      }
      if (err instanceof noteRepo.InvalidTimeEntryMutationError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    return reply.send(note);
  });

  // Delete a note
  server.delete('/tickets/:id/notes/:noteId', async (req: FastifyRequest<{ Params: NoteIdParam }>, reply: FastifyReply) => {
    const ticketId = parseId(req.params.id);
    const noteId = parseId(req.params.noteId);
    if (ticketId === null) return reply.status(400).send({ error: 'invalid ticket id' });
    if (noteId === null) return reply.status(400).send({ error: 'invalid note id' });
    let note;
    try {
      note = await noteRepo.remove(noteId, ticketId, req.actorSub);
    } catch (err) {
      if (err instanceof noteRepo.ExternalNoteImmutableError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    return reply.status(204).send();
  });

  // ─── Time tracking ───────────────────────────────────────────────────────────
  // Total logged minutes for a ticket.
  server.get('/tickets/:id/time', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const [minutes, entries] = await Promise.all([
      noteRepo.timeTotalForTicket(id),
      noteRepo.listTimeEntriesForTicket(id),
    ]);
    return reply.send({ minutes, entries });
  });

  // Log time: a time_entry note carrying a duration (minutes) + optional note.
  // Two entry modes, both end up as canonical `minutes`:
  //  - duration: pass `minutes` directly (quick presets / manual minutes)
  //  - start/stop: pass `start` + `stop` ISO timestamps; minutes is derived and
  //    the raw window is preserved in timeStart/timeStop.
  server.post('/tickets/:id/time', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const body = (req.body ?? {}) as {
      minutes?: number;
      note?: string;
      start?: string;
      stop?: string;
      workedAt?: string;
    };

    const hasMinutes = body.minutes !== undefined;
    const hasStart = body.start !== undefined;
    const hasStop = body.stop !== undefined;
    if (hasStart !== hasStop) {
      return reply.status(400).send({ error: 'start and stop must be provided together' });
    }
    if (hasMinutes && hasStart) {
      return reply.status(400).send({ error: 'provide minutes or start/stop, not both' });
    }
    if (body.workedAt !== undefined && hasStart) {
      return reply.status(400).send({
        error: 'workedAt is only accepted for duration-only entries; start is the work date for a window',
      });
    }

    let minutes = hasMinutes ? Math.round(Number(body.minutes)) : 0;
    let timeStart: Date | undefined;
    let timeStop: Date | undefined;
    let workedAt: Date | undefined;

    if (hasStart && hasStop) {
      timeStart = new Date(body.start!);
      timeStop = new Date(body.stop!);
      if (isNaN(timeStart.getTime()) || isNaN(timeStop.getTime())) {
        return reply.status(400).send({ error: 'start and stop must be valid timestamps' });
      }
      if (timeStop <= timeStart) return reply.status(400).send({ error: 'stop must be after start' });
      minutes = Math.round((timeStop.getTime() - timeStart.getTime()) / 60000);
    }

    if (!minutes || minutes <= 0) return reply.status(400).send({ error: 'provide a positive duration (minutes or start/stop)' });
    if (body.workedAt !== undefined) {
      if (
        typeof body.workedAt !== 'string' ||
        !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(body.workedAt) ||
        Number.isNaN(Date.parse(body.workedAt))
      ) {
        return reply.status(400).send({ error: 'workedAt must be an ISO 8601 datetime string with a timezone' });
      }
      workedAt = new Date(body.workedAt);
    }

    const author = req.user?.displayName ?? req.actorSub;
    const content = body.note?.trim() || `Logged ${minutes} min`;
    const note = await noteRepo.create(
      id,
      {
        content,
        author,
        authorId: req.user?.id || undefined,
        noteType: 'time_entry',
        minutes,
        timeStart,
        timeStop,
        workedAt,
        // Time entries are never customer-visible, whatever the channel.
        visibility: 'internal',
        via: req.authChannel,
      },
      req.actorSub
    );
    return reply.status(201).send(note);
  });
}
