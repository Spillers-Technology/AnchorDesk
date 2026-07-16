/**
 * ConnectWise Manage passthrough routes — read directly from CW API.
 *
 * These are legacy/convenience endpoints kept while the CW provider sync is
 * being implemented (Phase 3). Once sync is running, the UI will read from
 * local /tickets endpoints instead. These endpoints require CWM_* env vars.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getCwm } from '../services/connectwiseService';
import { ConditionBuilder } from '../services/conditionBuilder';
import { config } from '../config/config';

interface TicketIdParam { ticketId: string }
interface ResourceParam { resource: string }

function cwConfigured(): boolean {
  return !!(config.cwm.company && config.cwm.publicKey && config.cwm.privateKey);
}

export async function cwRoutes(server: FastifyInstance) {
  if (!cwConfigured()) {
    server.log.info('CWM credentials not set — ConnectWise passthrough routes disabled');
    return;
  }

  server.get('/cw/tickets/open', async (_req: FastifyRequest, reply: FastifyReply) => {
    const conditions = new ConditionBuilder()
      .addCondition('board/name', '=', 'SMB Services - SMB Team 1 Support')
      .addNotInCondition('status/name', ['Closed', 'Admin Closed', 'Complete', 'Canceled', 'Closed/No Response'])
      .addCondition('resources', '=', '')
      .addCondition('parentTicketId', '=', null)
      .build();

    try {
      const tickets = await getCwm().ServiceAPI.getServiceTickets({ conditions, page: 1, pageSize: 100 });
      return reply.send(tickets);
    } catch (err) {
      server.log.error({ err }, 'CW fetch failed');
      return reply.status(502).send({ error: 'ConnectWise API unavailable' });
    }
  });

  server.get('/cw/tickets/:ticketId', async (req: FastifyRequest<{ Params: TicketIdParam }>, reply: FastifyReply) => {
    try {
      const ticket = await getCwm().ServiceAPI.getServiceTicketsById(parseInt(req.params.ticketId));
      return reply.send(ticket);
    } catch (err) {
      server.log.error({ err }, 'CW fetch failed');
      return reply.status(502).send({ error: 'ConnectWise API unavailable' });
    }
  });

  server.get('/cw/tickets/:ticketId/notes', async (req: FastifyRequest<{ Params: TicketIdParam }>, reply: FastifyReply) => {
    try {
      const notes = await getCwm().ServiceAPI.getServiceTicketsByParentIdNotes(parseInt(req.params.ticketId), {
        page: 1,
        pageSize: 100,
      });
      return reply.send(notes);
    } catch (err) {
      server.log.error({ err }, 'CW fetch failed');
      return reply.status(502).send({ error: 'ConnectWise API unavailable' });
    }
  });

  server.get('/cw/tickets/by-resource/:resource', async (req: FastifyRequest<{ Params: ResourceParam }>, reply: FastifyReply) => {
    const conditions = new ConditionBuilder()
      .addCondition('board/name', '=', 'SMB Services - SMB Team 1 Support')
      .addNotInCondition('status/name', ['Closed', 'Complete', 'Canceled'])
      .addLikeCondition('resources', req.params.resource)
      .build();

    try {
      const tickets = await getCwm().ServiceAPI.getServiceTickets({ conditions, page: 1, pageSize: 100 });
      return reply.send(tickets);
    } catch (err) {
      server.log.error({ err }, 'CW fetch failed');
      return reply.status(502).send({ error: 'ConnectWise API unavailable' });
    }
  });
}
