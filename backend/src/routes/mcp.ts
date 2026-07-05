import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import * as tickets from '../repositories/ticketRepository';
import * as notes from '../repositories/noteRepository';
import * as audit from '../repositories/auditRepository';
import * as ticketMail from '../services/mail/ticketMail';
import { mailTransport } from '../services/mail/SmtpMailTransport';
import { actorFor } from '../middleware/auth';
import { getAuthSettings } from '../services/auth/authConfig';
import { buildMcpProtectedResourceMetadata } from '../services/auth/mcpOAuth';

/**
 * Build a server bound to one connection's identity. `actor` is the audit string
 * for every mutation made over this session — the authenticated user, tagged
 * with the `mcp` channel — so MCP actions are attributed to the real person who
 * issued the personal access token, not a shared placeholder.
 */
function buildMcpServer(actor: string): McpServer {
  const server = new McpServer({ name: 'anchordesk', version: '1.0.0' });

  server.tool(
    'list_tickets',
    'List tickets with optional filters. Returns { items, total, page, pageSize } so you can page through large result sets.',
    {
      status: z.string().optional().describe('Filter by status, e.g. "Open", "Closed"'),
      assignee: z.string().optional().describe('Filter by assignee name'),
      companyName: z.string().optional().describe('Filter by company name'),
      q: z.string().optional().describe('Free-text search across title, summary, company, ticket number'),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(20),
    },
    async (args) => {
      const result = await tickets.listPaged(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_ticket',
    'Get full details of a single ticket including its notes.',
    { id: z.number().int().describe('Local database ticket ID') },
    async ({ id }) => {
      const ticket = await tickets.getById(id);
      if (!ticket) return { content: [{ type: 'text', text: `Ticket ${id} not found` }], isError: true };
      const ticketNotes = await notes.listForTicket(id);
      return { content: [{ type: 'text', text: JSON.stringify({ ticket, notes: ticketNotes }, null, 2) }] };
    },
  );

  server.tool(
    'create_ticket',
    'Create a new ticket in the local database.',
    {
      title: z.string().describe('Short title for the ticket'),
      summary: z.string().optional().describe('One-line summary'),
      description: z.string().optional().describe('Full description'),
      status: z.string().optional().default('New'),
      priority: z.string().optional().default('3'),
      companyName: z.string().optional(),
      assignee: z.string().optional(),
    },
    async (args) => {
      const changedBy = actor;
      const ticket = await tickets.create(args, changedBy);
      return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
    },
  );

  server.tool(
    'update_ticket',
    'Update fields on an existing ticket.',
    {
      id: z.number().int().describe('Ticket ID to update'),
      title: z.string().optional(),
      summary: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      assignee: z.string().optional(),
      companyName: z.string().optional(),
    },
    async ({ id, ...fields }) => {
      const changedBy = actor;
      const updated = await tickets.update(id, fields, changedBy);
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.tool(
    'add_note',
    'Add a note to a ticket.',
    {
      ticketId: z.number().int(),
      content: z.string().describe('Note text'),
      author: z.string().optional().default('MCP Agent'),
    },
    async ({ ticketId, content, author }) => {
      const changedBy = actor;
      const note = await notes.create(ticketId, { content, author, noteType: 'note' }, changedBy);
      return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] };
    },
  );

  server.tool(
    'log_time',
    'Log billable time on a ticket, either as a duration (minutes) or a start/stop window.',
    {
      ticketId: z.number().int(),
      minutes: z.number().int().positive().optional().describe('Duration in minutes (omit if using start/stop)'),
      start: z.string().optional().describe('ISO timestamp; with `stop`, duration is derived'),
      stop: z.string().optional().describe('ISO timestamp'),
      note: z.string().optional().describe('Optional note for the entry'),
      author: z.string().optional().default('MCP Agent'),
    },
    async ({ ticketId, minutes, start, stop, note, author }) => {
      const changedBy = actor;
      let mins = minutes ?? 0;
      let timeStart: Date | undefined;
      let timeStop: Date | undefined;
      if (start && stop) {
        timeStart = new Date(start);
        timeStop = new Date(stop);
        if (isNaN(timeStart.getTime()) || isNaN(timeStop.getTime()) || timeStop <= timeStart) {
          return { content: [{ type: 'text', text: 'Invalid start/stop window' }], isError: true };
        }
        mins = Math.round((timeStop.getTime() - timeStart.getTime()) / 60000);
      }
      if (!mins || mins <= 0) {
        return { content: [{ type: 'text', text: 'Provide a positive duration (minutes or start/stop)' }], isError: true };
      }
      const entry = await notes.create(
        ticketId,
        { content: note?.trim() || `Logged ${mins} min`, author, noteType: 'time_entry', minutes: mins, timeStart, timeStop },
        changedBy,
      );
      return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
    },
  );

  server.tool(
    'send_ticket_email',
    'Send an HTML/plain email from a ticket. The message is threaded and recorded on the ticket timeline as an email note.',
    {
      ticketId: z.number().int(),
      to: z.union([z.string(), z.array(z.string())]).describe('Recipient address(es)'),
      cc: z.array(z.string()).optional(),
      subject: z.string(),
      html: z.string().optional().describe('HTML body (sanitized server-side)'),
      text: z.string().optional().describe('Plain-text body; derived from html when omitted'),
      author: z.string().optional().default('MCP Agent'),
    },
    async ({ ticketId, to, cc, subject, html, text, author }) => {
      if (!html && !text) {
        return { content: [{ type: 'text', text: 'Provide an html or text body' }], isError: true };
      }
      if (!(await mailTransport.isConfigured())) {
        return { content: [{ type: 'text', text: 'SMTP is not configured' }], isError: true };
      }
      try {
        const { messageId } = await ticketMail.sendTicketEmail(ticketId, { to, cc, subject, html, text, author });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, messageId }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'get_ticket_history',
    'Get the full audit log for a ticket showing every field change.',
    { ticketId: z.number().int() },
    async ({ ticketId }) => {
      const history = await audit.getHistory('ticket', ticketId);
      return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
    },
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance) {
  const transports = new Map<string, SSEServerTransport>();

  async function sendProtectedResourceMetadata(_req: FastifyRequest, reply: FastifyReply) {
    const settings = await getAuthSettings();
    try {
      return reply.send(buildMcpProtectedResourceMetadata(settings));
    } catch (err) {
      return reply.status(503).send({ error: (err as Error).message });
    }
  }

  app.get('/.well-known/oauth-protected-resource', sendProtectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/*', sendProtectedResourceMetadata);

  // SSE endpoint — MCP client connects here to receive events. The auth hook has
  // already resolved req.user from the personal access token on the upgrade, so
  // the whole session acts as that user and audits under them (mcp channel).
  app.get('/mcp/sse', async (req, reply) => {
    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    transports.set(transport.sessionId, transport);

    reply.raw.on('close', () => transports.delete(transport.sessionId));

    const actor = actorFor(req.user.username, 'mcp');
    const mcpServer = buildMcpServer(actor);
    await mcpServer.connect(transport);
  });

  // POST endpoint — MCP client sends messages here
  app.post('/mcp/messages', async (req, reply) => {
    const sessionId = (req.query as Record<string, string>).sessionId;
    const transport = transports.get(sessionId);
    if (!transport) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    await transport.handlePostMessage(req.raw, reply.raw, req.body);
  });
}
