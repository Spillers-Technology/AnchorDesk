import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import * as audit from '../repositories/auditRepository';
import * as twoWaySync from '../services/twoWaySync';
import { renderTicketHtml } from '../services/ticketExport';
import { parseId } from '../util/ids';

interface IdParam { id: string }
interface NoteIdParam { id: string; noteId: string }

export async function ticketRoutes(server: FastifyInstance) {
  // List tickets with optional filtering + server-side pagination. Returns
  // { items, total, page, pageSize } so the client can page without loading
  // the whole table. pageSize is capped to keep one request bounded.
  server.get('/tickets', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const pageSize = Math.min(query.pageSize ? parseInt(query.pageSize) : 50, 200);
    const result = await ticketRepo.listPaged({
      status: query.status,
      assignee: query.assignee,
      companyName: query.company,
      q: query.q,
      regex: query.regex,
      labelId: query.labelId ? parseInt(query.labelId) : undefined,
      includeDeleted: query.includeDeleted === 'true',
      // Default working views hide closed tickets; opt in with includeClosed=true
      // (or by selecting a specific status, which always wins).
      includeClosed: query.includeClosed === 'true',
      page: query.page ? parseInt(query.page) : 1,
      pageSize,
    });
    return reply.send(result);
  });

  // Full-text search (Postgres). Static route — registered before /tickets/:id.
  server.get('/tickets/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const q = query.q ?? '';
    const limit = query.limit ? Math.min(parseInt(query.limit), 200) : 50;
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
    const body = req.body as ticketRepo.CreateTicketInput;
    if (!body?.title) return reply.status(400).send({ error: 'title is required' });

    const ticket = await ticketRepo.create(body, req.actorSub);
    return reply.status(201).send(ticket);
  });

  // Update ticket fields
  server.patch('/tickets/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const ticket = await ticketRepo.update(
      id,
      req.body as ticketRepo.UpdateTicketInput,
      req.actorSub
    );
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

    // Two-way sync: a local edit to an external ticket becomes pending, then we
    // kick a reconcile (which pushes, or flags a conflict if the remote also
    // moved). Fire-and-forget so the edit response stays snappy.
    if (ticket.externalId && ticket.externalProvider) {
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
    if (!body?.content) return reply.status(400).send({ error: 'content is required' });

    const note = await noteRepo.create(
      id,
      { ...body, author: body.author ?? req.user?.displayName ?? req.actorSub },
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
    const note = await noteRepo.update(
      noteId,
      req.body as noteRepo.UpdateNoteInput,
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
