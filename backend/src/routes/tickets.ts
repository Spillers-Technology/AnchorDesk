// src/routes/tickets.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TicketParams, ResourceParams } from '../types';
import { getTicketById, getOpenTickets, getTicketsByResource, getTicketNotes } from '../controllers/ticketController';

export async function ticketRoutes(server: FastifyInstance) {
  server.get('/Tickets/:ticketId', async (request: FastifyRequest<{ Params: TicketParams }>, reply: FastifyReply) => {
    const { ticketId } = request.params;
    try {
      const ticket = await getTicketById(parseInt(ticketId));
      return reply.send(ticket);
    } catch (error) {
      server.log.error('Error fetching ticket:', error);
      return reply.status(500).send({ error: 'Unable to fetch ticket' });
    }
  });

  server.get('/Tickets/Open', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tickets = await getOpenTickets();
      return reply.send(tickets);
    } catch (error) {
      server.log.error('Error fetching open tickets:', error);
      return reply.status(500).send({ error: 'Unable to fetch open tickets' });
    }
  });

  server.get('/Tickets/ByResource/:resource', async (request: FastifyRequest<{ Params: ResourceParams }>, reply: FastifyReply) => {
    const { resource } = request.params;
    try {
      const tickets = await getTicketsByResource(resource);
      return reply.send(tickets);
    } catch (error) {
      server.log.error(`Error fetching tickets for resource ${resource}:`, error);
      return reply.status(500).send({ error: `Unable to fetch tickets for resource ${resource}` });
    }
  });

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
