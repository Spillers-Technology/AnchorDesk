import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import * as tickets from '../repositories/ticketRepository';
import * as notes from '../repositories/noteRepository';
import * as audit from '../repositories/auditRepository';
import * as labels from '../repositories/labelRepository';
import * as teams from '../repositories/teamRepository';
import * as customFields from '../repositories/customFieldRepository';
import * as savedViews from '../repositories/savedViewRepository';
import { CustomFieldValidationError } from '../services/customFields';
import * as ticketMail from '../services/mail/ticketMail';
import { mailTransport } from '../services/mail/SmtpMailTransport';
import { actorFor } from '../middleware/auth';
import { buildMcpProtectedResourceMetadata } from '../services/auth/mcpOAuth';

/**
 * Build a server bound to one connection's identity. `actor` is the audit string
 * for every mutation made over this session — the authenticated user, tagged
 * with the `mcp` channel — so MCP actions are attributed to the real person who
 * issued the personal access token, not a shared placeholder.
 */
function buildMcpServer(actor: string, userId: number): McpServer {
  const server = new McpServer({ name: 'anchordesk', version: '1.0.0' });

  server.tool(
    'list_tickets',
    'List tickets with optional filters. Returns { items, total, page, pageSize } so you can page through large result sets.',
    {
      status: z.string().optional().describe('Filter by status, e.g. "Open", "Closed"'),
      assignee: z.string().optional().describe('Filter by assignee name'),
      companyName: z.string().optional().describe('Filter by company name'),
      q: z.string().optional().describe('Free-text search across title, summary, company, ticket number'),
      regex: z.string().max(500).optional().describe('Case-insensitive POSIX regular expression across ticket text'),
      labelId: z.number().int().optional().describe('Filter to tickets carrying this label id (see list_labels)'),
      teamId: z.number().int().optional().describe('Filter to tickets routed to this team/queue (see list_teams)'),
      includeClosed: z.boolean().optional().default(false).describe('Include Closed tickets when no explicit status is selected'),
      includeDeleted: z.boolean().optional().default(false).describe('Include soft-deleted tickets'),
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
      teamId: z.number().int().optional().describe('Route the ticket to a team/queue (see list_teams)'),
      customFields: z.record(z.string(), z.unknown()).optional().describe('Custom field values keyed by field key (see list_custom_fields)'),
    },
    async (args) => {
      const changedBy = actor;
      try {
        const ticket = await tickets.create(args, changedBy);
        return { content: [{ type: 'text', text: JSON.stringify(ticket, null, 2) }] };
      } catch (err) {
        if (err instanceof CustomFieldValidationError) {
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
        throw err;
      }
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
      teamId: z.number().int().nullable().optional().describe('Route to a team/queue; null clears it (see list_teams)'),
      customFields: z.record(z.string(), z.unknown()).optional().describe('Partial custom field values to merge; null clears a key (see list_custom_fields)'),
    },
    async ({ id, ...fields }) => {
      const changedBy = actor;
      try {
        const updated = await tickets.update(id, fields, changedBy);
        return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
      } catch (err) {
        if (err instanceof CustomFieldValidationError) {
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
        throw err;
      }
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

  server.tool(
    'search_tickets',
    'Typo-tolerant ranked search (Postgres full-text + trigram) across ticket text, priority, ticket number, and note bodies. Better than list_tickets\' q filter for finding a specific ticket.',
    {
      q: z.string().describe('Search terms'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ q, limit }) => {
      const results = await tickets.search(q, limit);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    'list_labels',
    'List the managed labels (tags) that can be applied to tickets.',
    {},
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(await labels.list(), null, 2) }] };
    },
  );

  server.tool(
    'set_ticket_label',
    'Apply or remove a label (tag) on a ticket.',
    {
      ticketId: z.number().int(),
      labelId: z.number().int().describe('Label id (see list_labels)'),
      remove: z.boolean().optional().default(false).describe('true removes the label instead of applying it'),
    },
    async ({ ticketId, labelId, remove }) => {
      if (remove) await labels.removeFromTicket(ticketId, labelId, actor);
      else await labels.applyToTicket(ticketId, labelId, actor);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ticketId, labelId, removed: remove }) }] };
    },
  );

  server.tool(
    'list_teams',
    'List teams (queues/groups) with their members. Route a ticket to a team via create_ticket/update_ticket teamId.',
    {},
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(await teams.list(), null, 2) }] };
    },
  );

  server.tool(
    'list_custom_fields',
    'List the admin-defined custom ticket field definitions (key, label, type, options). Set values via create_ticket/update_ticket customFields.',
    {},
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(await customFields.list(), null, 2) }] };
    },
  );

  server.tool(
    'list_saved_views',
    'List your saved ticket views (personal + shared filter sets). Replay one by passing its filters to list_tickets.',
    {},
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(await savedViews.listForUser(userId), null, 2) }] };
    },
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance) {
  const transports = new Map<string, SSEServerTransport>();

  async function sendProtectedResourceMetadata(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(buildMcpProtectedResourceMetadata());
  }

  app.get('/.well-known/oauth-protected-resource', sendProtectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/*', sendProtectedResourceMetadata);

  // SSE endpoint — MCP client connects here to receive events. The auth hook has
  // already resolved req.user from the personal access token on the upgrade, so
  // the whole session acts as that user and audits under them (mcp channel).
  app.get('/mcp/sse', async (req, reply) => {
    // The SSE transport owns the raw response for the life of the stream;
    // hijack so Fastify 5 doesn't also try to manage/serialize the reply.
    reply.hijack();
    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    transports.set(transport.sessionId, transport);

    reply.raw.on('close', () => transports.delete(transport.sessionId));

    const actor = actorFor(req.user.username, 'mcp');
    const mcpServer = buildMcpServer(actor, req.user.id);
    await mcpServer.connect(transport);
  });

  // POST endpoint — MCP client sends messages here
  app.post('/mcp/messages', async (req, reply) => {
    const sessionId = (req.query as Record<string, string>).sessionId;
    const transport = transports.get(sessionId);
    if (!transport) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    // handlePostMessage writes the response to reply.raw directly.
    reply.hijack();
    await transport.handlePostMessage(req.raw, reply.raw, req.body);
  });
}
