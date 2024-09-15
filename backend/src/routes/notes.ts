// src/routes/notes.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TicketParams } from '../types';
import { getTicketNotes } from '../controllers/noteController';

export async function notesRoutes(server: FastifyInstance) {
  server.get('/Tickets/:ticketId/Notes', async (request: FastifyRequest<{ Params: TicketParams }>, reply: FastifyReply) => {
    const { ticketId } = request.params;
    try {
      const notes = await getTicketNotes(parseInt(ticketId));
      return reply.send(notes);
    } catch (error) {
      server.log.error('Error fetching ticket notes:', error);
      return reply.status(500).send({ error: 'Unable to fetch ticket notes' });
    }
  });
}
