import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import * as audit from '../repositories/auditRepository';

interface IdParam { id: string }
interface NoteIdParam { id: string; noteId: string }

export async function ticketRoutes(server: FastifyInstance) {
  // List tickets with optional filtering
  server.get('/tickets', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const tickets = await ticketRepo.list({
      status: query.status,
      assignee: query.assignee,
      companyName: query.company,
      page: query.page ? parseInt(query.page) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize) : 100,
    });
    return reply.send(tickets);
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
    const ticket = await ticketRepo.getById(parseInt(req.params.id));
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
    const ticket = await ticketRepo.update(
      parseInt(req.params.id),
      req.body as ticketRepo.UpdateTicketInput,
      req.actorSub
    );
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
    return reply.send(ticket);
  });

  // Soft-delete ticket
  server.delete('/tickets/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const ticket = await ticketRepo.remove(parseInt(req.params.id), req.actorSub);
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
    return reply.status(204).send();
  });

  // Ticket revision history
  server.get('/tickets/:id/history', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const history = await audit.getHistory('ticket', parseInt(req.params.id));
    return reply.send(history);
  });

  // List notes for a ticket
  server.get('/tickets/:id/notes', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const notes = await noteRepo.listForTicket(parseInt(req.params.id));
    return reply.send(notes);
  });

  // Add a note to a ticket
  server.post('/tickets/:id/notes', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const body = req.body as noteRepo.CreateNoteInput;
    if (!body?.content) return reply.status(400).send({ error: 'content is required' });

    const note = await noteRepo.create(
      parseInt(req.params.id),
      { ...body, author: body.author ?? req.user?.displayName ?? req.actorSub },
      req.actorSub
    );
    return reply.status(201).send(note);
  });

  // Update a note
  server.patch('/tickets/:id/notes/:noteId', async (req: FastifyRequest<{ Params: NoteIdParam }>, reply: FastifyReply) => {
    const note = await noteRepo.update(
      parseInt(req.params.noteId),
      req.body as noteRepo.UpdateNoteInput,
      req.actorSub
    );
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    return reply.send(note);
  });

  // Delete a note
  server.delete('/tickets/:id/notes/:noteId', async (req: FastifyRequest<{ Params: NoteIdParam }>, reply: FastifyReply) => {
    const note = await noteRepo.remove(parseInt(req.params.noteId), req.actorSub);
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    return reply.status(204).send();
  });
}
