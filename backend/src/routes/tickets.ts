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

interface IdParam { id: string }
interface NoteIdParam { id: string; noteId: string }

/** The ticket fields two-way sync fingerprints and can push/pull (see
 *  twoWaySync remoteHash + pushLocal); assigneeId is included because it
 *  re-denormalizes the synced assignee string. */
const SYNCED_TICKET_FIELDS = ['status', 'priority', 'assignee', 'assigneeId', 'title', 'description'] as const;

function positiveInteger(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function validateTicketInput(value: unknown, creating: boolean): string | null {
  if (!isPlainRecord(value)) return 'request body must be an object';
  if (creating && (typeof value.title !== 'string' || !value.title.trim())) return 'title is required';
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
    if (requestedPageSize === null || page === null) return reply.status(400).send({ error: 'page and pageSize must be positive integers' });
    if (query.labelId !== undefined && labelId === null) return reply.status(400).send({ error: 'labelId must be a positive integer' });
    if (query.teamId !== undefined && teamId === null) return reply.status(400).send({ error: 'teamId must be a positive integer' });
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
    normalizeDueAt(req.body as Record<string, unknown>);
    const body = req.body as ticketRepo.CreateTicketInput;

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
      await ticketRepo.markPending(id);
      void twoWaySync
        .reconcileTicket(id, { actor: req.actorSub })
        .catch((err) => req.log.warn({ err, ticketId: id }, 'two-way reconcile after edit failed'));
    }
    return reply.send(ticket);
  });

  // Reconcile an external ticket with its source now (pull/push/flag conflict).
  server.post('/tickets/:id/sync', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const result = await twoWaySync.reconcileTicket(id, { actor: req.actorSub });
    return reply.send(result);
  });

  // Resolve a held conflict by choosing the winning side.
  server.post('/tickets/:id/resolve-conflict', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const resolution = (req.body as { resolution?: string })?.resolution;
    if (resolution !== 'local' && resolution !== 'remote') {
      return reply.status(400).send({ error: "resolution must be 'local' or 'remote'" });
    }
    const result = await twoWaySync.resolveConflict(id, resolution, req.actorSub);
    return reply.send(result);
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
    const body = req.body as noteRepo.CreateNoteInput;
    const htmlContent = body?.htmlContent ? sanitizeEmailHtml(body.htmlContent) : undefined;
    const content = body?.content?.trim() || (htmlContent ? htmlToText(htmlContent) : '');
    if (!content) return reply.status(400).send({ error: 'content is required' });

    const note = await noteRepo.create(
      id,
      { ...body, content, htmlContent, author: body.author ?? req.user?.displayName ?? req.actorSub },
      req.actorSub
    );

    // Push locally-authored notes out to the source system (best-effort). Notes
    // pulled from the remote already carry an externalId and are skipped inside.
    if (!body.externalId) {
      void twoWaySync
        .pushNoteOut(id, note.id)
        .catch((err) => req.log.warn({ err, ticketId: id, noteId: note.id }, 'note push-out failed'));
    }
    return reply.status(201).send(note);
  });

  // Update a note
  server.patch('/tickets/:id/notes/:noteId', async (req: FastifyRequest<{ Params: NoteIdParam }>, reply: FastifyReply) => {
    const ticketId = parseId(req.params.id);
    const noteId = parseId(req.params.noteId);
    if (ticketId === null) return reply.status(400).send({ error: 'invalid ticket id' });
    if (noteId === null) return reply.status(400).send({ error: 'invalid note id' });
    const body = req.body as noteRepo.UpdateNoteInput;
    const data: noteRepo.UpdateNoteInput = { ...body };
    if (typeof body.htmlContent === 'string') {
      data.htmlContent = sanitizeEmailHtml(body.htmlContent);
      data.content = body.content?.trim() || htmlToText(data.htmlContent);
    }
    const note = await noteRepo.update(
      noteId,
      data,
      req.actorSub
    );
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    return reply.send(note);
  });

  // Delete a note
  server.delete('/tickets/:id/notes/:noteId', async (req: FastifyRequest<{ Params: NoteIdParam }>, reply: FastifyReply) => {
    const ticketId = parseId(req.params.id);
    const noteId = parseId(req.params.noteId);
    if (ticketId === null) return reply.status(400).send({ error: 'invalid ticket id' });
    if (noteId === null) return reply.status(400).send({ error: 'invalid note id' });
    const note = await noteRepo.remove(noteId, req.actorSub);
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    return reply.status(204).send();
  });

  // ─── Time tracking ───────────────────────────────────────────────────────────
  // Total logged minutes for a ticket.
  server.get('/tickets/:id/time', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const minutes = await noteRepo.timeTotalForTicket(id);
    return reply.send({ minutes });
  });

  // Log time: a time_entry note carrying a duration (minutes) + optional note.
  // Two entry modes, both end up as canonical `minutes`:
  //  - duration: pass `minutes` directly (quick presets / manual minutes)
  //  - start/stop: pass `start` + `stop` ISO timestamps; minutes is derived and
  //    the raw window is preserved in timeStart/timeStop.
  server.post('/tickets/:id/time', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const body = (req.body ?? {}) as { minutes?: number; note?: string; start?: string; stop?: string };

    let minutes = Math.round(Number(body.minutes));
    let timeStart: Date | undefined;
    let timeStop: Date | undefined;

    if (body.start && body.stop) {
      timeStart = new Date(body.start);
      timeStop = new Date(body.stop);
      if (isNaN(timeStart.getTime()) || isNaN(timeStop.getTime())) {
        return reply.status(400).send({ error: 'start and stop must be valid timestamps' });
      }
      if (timeStop <= timeStart) return reply.status(400).send({ error: 'stop must be after start' });
      minutes = Math.round((timeStop.getTime() - timeStart.getTime()) / 60000);
    }

    if (!minutes || minutes <= 0) return reply.status(400).send({ error: 'provide a positive duration (minutes or start/stop)' });

    const author = req.user?.displayName ?? req.actorSub;
    const content = body.note?.trim() || `Logged ${minutes} min`;
    const note = await noteRepo.create(
      id,
      { content, author, authorId: req.user?.id || undefined, noteType: 'time_entry', minutes, timeStart, timeStop },
      req.actorSub
    );
    return reply.status(201).send(note);
  });
}
