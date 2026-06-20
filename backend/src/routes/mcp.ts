import { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import * as tickets from '../repositories/ticketRepository';
import * as notes from '../repositories/noteRepository';
import * as audit from '../repositories/auditRepository';

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'anchordesk', version: '1.0.0' });

  server.tool(
    'list_tickets',
    'List tickets with optional filters. Returns paginated results.',
    {
      status: z.string().optional().describe('Filter by status, e.g. "Open", "Closed"'),
      assignee: z.string().optional().describe('Filter by assignee name'),
      companyName: z.string().optional().describe('Filter by company name'),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(20),
    },
    async (args) => {
      const result = await tickets.list(args);
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
    async (args, extra) => {
      const changedBy = (extra?.authInfo as { sub?: string } | undefined)?.sub ?? 'mcp';
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
    async ({ id, ...fields }, extra) => {
      const changedBy = (extra?.authInfo as { sub?: string } | undefined)?.sub ?? 'mcp';
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
    async ({ ticketId, content, author }, extra) => {
      const changedBy = (extra?.authInfo as { sub?: string } | undefined)?.sub ?? 'mcp';
      const note = await notes.create(ticketId, { content, author, noteType: 'note' }, changedBy);
      return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] };
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

  // SSE endpoint — MCP client connects here to receive events
  app.get('/mcp/sse', async (req, reply) => {
    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    transports.set(transport.sessionId, transport);

    reply.raw.on('close', () => transports.delete(transport.sessionId));

    const mcpServer = buildMcpServer();
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
