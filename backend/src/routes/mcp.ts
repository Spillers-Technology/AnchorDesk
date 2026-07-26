import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { UserRole } from '@prisma/client';
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
import * as checklist from '../repositories/checklistRepository';
import * as checklistTemplates from '../repositories/checklistTemplateRepository';
import { CustomFieldValidationError, coerceCustomFieldFilters } from '../services/customFields';
import { PRIORITY_LIST_TEXT, STATUS_LIST_TEXT, normalizePriority, normalizeStatus } from '../services/ticketVocab';
import { hasPrismaCode } from '../util/prismaErrors';
import * as ticketMail from '../services/mail/ticketMail';
import * as mergeService from '../services/merge/mergeService';
import { MergeLedgerFormatError } from '../services/merge/mergeLedger';
import { mailTransport } from '../services/mail/SmtpMailTransport';
import { actorFor } from '../middleware/auth';
import { buildMcpProtectedResourceMetadata } from '../services/auth/mcpOAuth';
import { registerKbTools } from './mcpKb';

const MAX_TEMPLATE_ITEMS = 100;
const MAX_DUE_OFFSET_MINUTES = 60 * 24 * 365;

function readPackageVersion(): string {
  // tsx resolves from src/routes; compiled production resolves from
  // dist/src/routes. Keep both layouts valid, as well as either common cwd.
  const candidates = [
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(process.cwd(), 'backend/package.json'),
    path.resolve(__dirname, '../../../package.json'),
    path.resolve(__dirname, '../../package.json'),
  ];
  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) continue;
    const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: unknown; version?: unknown };
    if (manifest.name === 'anchordesk-backend' && typeof manifest.version === 'string' && manifest.version) {
      return manifest.version;
    }
  }
  throw new Error('Unable to resolve AnchorDesk backend package version');
}

export const MCP_SERVER_VERSION = readPackageVersion();

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

function requireAdmin(role: UserRole) {
  return role === 'admin' ? null : textResult('Requires role: admin', true);
}

const checklistText = z.string().trim().min(1).max(500);
const checklistDueAt = z.string().datetime({ offset: true });
const checklistTemplateItems = z.array(z.object({
  text: checklistText,
  dueOffsetMinutes: z.number().int().min(0).max(MAX_DUE_OFFSET_MINUTES).nullable().optional(),
})).max(MAX_TEMPLATE_ITEMS);

/**
 * Build a server bound to one connection's identity. `actor` is the audit string
 * for every mutation made over this session — the authenticated user, tagged
 * with the `mcp` channel — so MCP actions are attributed to the real person who
 * issued the personal access token, not a shared placeholder.
 */
export function buildMcpServer(actor: string, userId: number, role: UserRole): McpServer {
  const server = new McpServer({ name: 'anchordesk', version: MCP_SERVER_VERSION });
  registerKbTools(server, actor, role);

  server.tool(
    'list_tickets',
    'List tickets with optional filters. Returns { items, total, page, pageSize } so you can page through large result sets.',
    {
      status: z.string().optional().describe(`Filter by exact status. Local statuses: ${STATUS_LIST_TEXT}. Synced external tickets may carry provider-specific statuses.`),
      assignee: z.string().optional().describe('Filter by assignee name'),
      companyName: z.string().optional().describe('Filter by company name'),
      q: z.string().optional().describe('Free-text search across title, summary, company, ticket number'),
      regex: z.string().max(500).optional().describe('Case-insensitive POSIX regular expression across ticket text'),
      labelId: z.number().int().optional().describe('Filter to tickets carrying this label id (see list_labels)'),
      teamId: z.number().int().optional().describe('Filter to tickets routed to this team/queue (see list_teams)'),
      customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
        .describe('Exact-match custom field filters keyed by field key (see list_custom_fields); combine with other filters or replay a saved view'),
      includeClosed: z.boolean().optional().default(false).describe('Include Closed tickets when no explicit status is selected'),
      includeDeleted: z.boolean().optional().default(false).describe('Include soft-deleted tickets'),
      parentId: z.number().int().optional().describe('List only the child tickets of this parent'),
      hasParent: z.boolean().optional().describe('true = only subtasks, false = only top-level tickets'),
      // Defaulted false to match GET /tickets. Tombstones are noise in an
      // agent's working list, and a merged ticket's conversation now lives on
      // the survivor — an agent reading the tombstone would answer from a
      // conversation that has moved.
      includeMerged: z.boolean().optional().default(false)
        .describe('Include tickets that were merged into another ticket (tombstones)'),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ customFields: cfFilters, ...args }) => {
      let customFieldEquals;
      if (cfFilters && Object.keys(cfFilters).length) {
        const defs = await customFields.list({ includeArchived: true });
        try {
          customFieldEquals = coerceCustomFieldFilters(defs, cfFilters);
        } catch (err) {
          if (err instanceof CustomFieldValidationError) {
            return { content: [{ type: 'text', text: err.message }], isError: true };
          }
          throw err;
        }
      }
      const result = await tickets.listPaged({ ...args, customFieldEquals });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_ticket',
    'Get full details of a single ticket including its notes, checklist, parent/children, and — if it was merged away — the ticket it was merged into.',
    { id: z.number().int().describe('Local database ticket ID') },
    async ({ id }) => {
      const ticket = await tickets.getById(id);
      if (!ticket) return { content: [{ type: 'text', text: `Ticket ${id} not found` }], isError: true };
      const [ticketNotes, checklistItems] = await Promise.all([
        notes.listForTicket(id),
        checklist.listForTicket(id),
      ]);
      return { content: [{ type: 'text', text: JSON.stringify({ ticket, notes: ticketNotes, checklist: checklistItems }, null, 2) }] };
    },
  );

  server.tool(
    'create_ticket',
    'Create a new ticket in the local database.',
    {
      title: z.string().describe('Short title for the ticket'),
      summary: z.string().optional().describe('One-line summary'),
      description: z.string().optional().describe('Full description'),
      status: z.string().optional().default('New').describe(`One of: ${STATUS_LIST_TEXT} (case-insensitive)`),
      priority: z.string().optional().default('Medium').describe(`One of: ${PRIORITY_LIST_TEXT} (case-insensitive)`),
      companyName: z.string().optional(),
      assignee: z.string().optional(),
      teamId: z.number().int().optional().describe('Route the ticket to a team/queue (see list_teams)'),
      customFields: z.record(z.string(), z.unknown()).optional().describe('Custom field values keyed by field key (see list_custom_fields)'),
      dueAt: z.string().datetime({ offset: true }).optional().describe('Manual deadline (ISO 8601) — overrides the SLA resolution target while set'),
    },
    async (args) => {
      const changedBy = actor;
      const status = normalizeStatus(args.status);
      if (!status) return { content: [{ type: 'text', text: `Unknown status "${args.status}" — use one of: ${STATUS_LIST_TEXT}` }], isError: true };
      const priority = normalizePriority(args.priority);
      if (!priority) return { content: [{ type: 'text', text: `Unknown priority "${args.priority}" — use one of: ${PRIORITY_LIST_TEXT}` }], isError: true };
      try {
        const ticket = await tickets.create(
          { ...args, status, priority, dueAt: args.dueAt === undefined ? undefined : new Date(args.dueAt) },
          changedBy,
        );
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
      status: z.string().optional().describe(`One of: ${STATUS_LIST_TEXT} (case-insensitive)`),
      priority: z.string().optional().describe(`One of: ${PRIORITY_LIST_TEXT} (case-insensitive)`),
      assignee: z.string().optional(),
      companyName: z.string().optional(),
      teamId: z.number().int().nullable().optional().describe('Route to a team/queue; null clears it (see list_teams)'),
      customFields: z.record(z.string(), z.unknown()).optional().describe('Partial custom field values to merge; null clears a key (see list_custom_fields)'),
      dueAt: z.string().datetime({ offset: true }).nullable().optional().describe('Manual deadline (ISO 8601) — overrides the SLA resolution target; null clears it (falls back to SLA)'),
    },
    async ({ id, dueAt, ...fields }) => {
      const changedBy = actor;
      if (fields.status !== undefined) {
        const status = normalizeStatus(fields.status);
        if (!status) return { content: [{ type: 'text', text: `Unknown status "${fields.status}" — use one of: ${STATUS_LIST_TEXT}` }], isError: true };
        fields.status = status;
      }
      if (fields.priority !== undefined) {
        const priority = normalizePriority(fields.priority);
        if (!priority) return { content: [{ type: 'text', text: `Unknown priority "${fields.priority}" — use one of: ${PRIORITY_LIST_TEXT}` }], isError: true };
        fields.priority = priority;
      }
      try {
        const updated = await tickets.update(
          id,
          { ...fields, dueAt: dueAt === undefined ? undefined : dueAt === null ? null : new Date(dueAt) },
          changedBy,
        );
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
    },
    async ({ ticketId, content }) => {
      const changedBy = actor;
      const note = await notes.create(
        ticketId,
        {
          content,
          author: actor,
          noteType: 'note',
          queueForTicketSync: true,
          visibility: 'public',
          via: 'mcp',
        },
        changedBy
      );
      return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] };
    },
  );

  // ─── Merge + hierarchy (2.6) ────────────────────────────────────────────────
  // MCP parity is a release invariant, so these ship with the REST routes rather
  // than after them. The acknowledgement contract is preserved verbatim for
  // agents: an agent must not be able to merge past a warning a human would have
  // had to read and tick.

  server.tool(
    'preview_ticket_merge',
    'Dry-run a ticket merge: what would move, which warnings must be acknowledged, and what blocks it outright. Always call this before merge_tickets.',
    {
      sourceId: z.number().int().describe('Ticket to merge away (becomes a tombstone)'),
      targetId: z.number().int().describe('Ticket to keep'),
    },
    { title: 'Preview ticket merge', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ sourceId, targetId }) => {
      try {
        return jsonResult(await mergeService.previewMerge(sourceId, targetId));
      } catch (err) {
        if (err instanceof mergeService.MergeBlockedError) {
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
        throw err;
      }
    },
  );

  server.tool(
    'merge_tickets',
    'Merge a duplicate ticket into the one being kept. Notes, attachments, checklist items, children, and labels move to the target; the source becomes a closed tombstone that still resolves. This is a LOCAL record operation — it makes no change in Jira/ConnectWise, and a merged ticket stops syncing. Warnings from preview_ticket_merge must be echoed in `acknowledge` or the call is refused.',
    {
      sourceId: z.number().int().describe('Ticket to merge away'),
      targetId: z.number().int().describe('Ticket to keep'),
      acknowledge: z.array(z.string()).optional()
        .describe('Warning codes from preview_ticket_merge that you are explicitly accepting (e.g. "sync-stop", "cross-company")'),
    },
    { title: 'Merge tickets', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ sourceId, targetId, acknowledge }) => {
      try {
        return jsonResult(await mergeService.mergeTickets(sourceId, targetId, actor, { acknowledge }));
      } catch (err) {
        if (err instanceof mergeService.MergeAcknowledgementRequiredError) {
          return {
            content: [{
              type: 'text',
              text:
                `${err.message}\n\nCall preview_ticket_merge to read each warning, then repeat ` +
                `merge_tickets with acknowledge: ${JSON.stringify(err.requiresAcknowledgement)}.`,
            }],
            isError: true,
          };
        }
        if (err instanceof mergeService.MergeBlockedError) {
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
        throw err;
      }
    },
  );

  server.tool(
    'unmerge_ticket',
    'Reverse a merge, restoring exactly the notes, attachments, checklist items, children, and labels that the merge moved. Anything added to the surviving ticket afterwards stays there.',
    { sourceId: z.number().int().describe('The merged-away ticket to restore') },
    { title: 'Unmerge ticket', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ sourceId }) => {
      try {
        return jsonResult(await mergeService.unmergeTicket(sourceId, actor));
      } catch (err) {
        if (err instanceof mergeService.MergeBlockedError || err instanceof MergeLedgerFormatError) {
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
        throw err;
      }
    },
  );

  server.tool(
    'set_ticket_parent',
    'Attach a ticket to a parent ticket, or pass parentId null to detach it. AnchorDesk supports exactly one level of hierarchy: a ticket that has a parent cannot itself be a parent. Hierarchy is local only — it is never pushed to or pulled from Jira/ConnectWise.',
    {
      id: z.number().int().describe('Ticket that becomes the child'),
      parentId: z.number().int().nullable().describe('Parent ticket id, or null to detach'),
    },
    { title: 'Set ticket parent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ id, parentId }) => {
      try {
        const ticket = await tickets.setParent(id, parentId, actor);
        if (!ticket) return { content: [{ type: 'text', text: `Ticket ${id} not found` }], isError: true };
        return jsonResult(ticket);
      } catch (err) {
        if (err instanceof tickets.TicketHierarchyError) {
          return { content: [{ type: 'text', text: err.message }], isError: true };
        }
        throw err;
      }
    },
  );

  server.tool(
    'list_ticket_children',
    'List the child tickets of a parent ticket.',
    { id: z.number().int().describe('Parent ticket id') },
    { title: 'List ticket children', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ id }) => jsonResult(await tickets.listChildren(id)),
  );

  server.tool(
    'list_checklist_templates',
    'List reusable checklist templates and their ordered items. Pass includeInactive only when administering retired templates.',
    {
      includeInactive: z.boolean().optional().default(false)
        .describe('Include inactive templates; inactive templates cannot be applied to tickets'),
    },
    { title: 'List checklist templates', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ includeInactive }) => {
      return jsonResult(await checklistTemplates.list({ includeInactive }));
    },
  );

  server.tool(
    'create_checklist_template',
    'Create a reusable checklist template. This is an AnchorDesk administrator action; item deadlines are offsets from future application time.',
    {
      name: z.string().trim().min(1).max(150),
      description: z.string().max(500).nullable().optional(),
      active: z.boolean().optional().describe('Whether technicians may apply the template; defaults to true'),
      items: checklistTemplateItems.optional(),
    },
    { title: 'Create checklist template', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ name, description, active, items }) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      try {
        return jsonResult(await checklistTemplates.create({ name, description, active, items }, actor));
      } catch (err) {
        if (hasPrismaCode(err, 'P2002')) return textResult('A template with that name already exists', true);
        throw err;
      }
    },
  );

  server.tool(
    'update_checklist_template',
    'Update a reusable checklist template by id. Supplying items replaces the template item list but never changes checklist items already copied onto tickets. Administrator only.',
    {
      templateId: z.number().int().positive().describe('Template id from list_checklist_templates'),
      name: z.string().trim().min(1).max(150).optional(),
      description: z.string().max(500).nullable().optional(),
      active: z.boolean().optional(),
      items: checklistTemplateItems.optional().describe('Complete replacement item list; omit to keep existing items'),
    },
    { title: 'Update checklist template', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ templateId, ...fields }) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      try {
        const template = await checklistTemplates.update(templateId, fields, actor);
        if (!template) return textResult(`Checklist template ${templateId} not found`, true);
        return jsonResult(template);
      } catch (err) {
        if (hasPrismaCode(err, 'P2002')) return textResult('A template with that name already exists', true);
        throw err;
      }
    },
  );

  server.tool(
    'delete_checklist_template',
    'Delete a reusable checklist template by id. Checklist items previously copied onto tickets are preserved. Administrator only.',
    {
      templateId: z.number().int().positive().describe('Template id from list_checklist_templates'),
    },
    { title: 'Delete checklist template', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ templateId }) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      const removed = await checklistTemplates.remove(templateId, actor);
      if (!removed) return textResult(`Checklist template ${templateId} not found`, true);
      return jsonResult({ ok: true, templateId });
    },
  );

  server.tool(
    'list_ticket_checklist',
    'List the ordered working checklist for one ticket, including completion attribution and independent per-item deadlines.',
    {
      ticketId: z.number().int().positive().describe('Local database ticket ID'),
    },
    { title: 'List ticket checklist', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ ticketId }) => {
      if (!(await tickets.getById(ticketId))) return textResult(`Ticket ${ticketId} not found`, true);
      return jsonResult(await checklist.listForTicket(ticketId));
    },
  );

  server.tool(
    'apply_checklist_template',
    'Copy a checklist template\'s items onto a ticket. Item deadlines are computed from each item\'s relative offset at apply time. Returns the ticket\'s full checklist.',
    {
      ticketId: z.number().int().positive().describe('Local database ticket ID'),
      templateId: z.number().int().positive().describe('Template id from list_checklist_templates'),
    },
    { title: 'Apply checklist template', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ ticketId, templateId }) => {
      if (!(await tickets.getById(ticketId))) {
        return textResult(`Ticket ${ticketId} not found`, true);
      }
      const items = await checklist.applyTemplate(ticketId, templateId, actor);
      if (!items) return textResult(`Template ${templateId} not found or inactive`, true);
      return jsonResult(items);
    },
  );

  server.tool(
    'add_checklist_item',
    'Add a single checklist item to a ticket, optionally with its own independent deadline.',
    {
      ticketId: z.number().int().positive().describe('Local database ticket ID'),
      text: checklistText,
      dueAt: checklistDueAt.nullable().optional()
        .describe('Per-item deadline (ISO 8601); null means no deadline; independent of the ticket clocks'),
    },
    { title: 'Add checklist item', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ ticketId, text, dueAt }) => {
      if (!(await tickets.getById(ticketId))) {
        return textResult(`Ticket ${ticketId} not found`, true);
      }
      const item = await checklist.add(ticketId, { text, dueAt: dueAt ? new Date(dueAt) : null }, actor);
      return jsonResult(item);
    },
  );

  server.tool(
    'update_checklist_item',
    'Update any editable field on one ticket checklist item: its text, completion state, independent deadline, or ordering value.',
    {
      ticketId: z.number().int().positive().describe('Local database ticket ID'),
      itemId: z.number().int().positive().describe('Checklist item id from list_ticket_checklist or get_ticket'),
      text: checklistText.optional(),
      done: z.boolean().optional().describe('true marks done with actor/time attribution; false reopens it'),
      dueAt: checklistDueAt.nullable().optional().describe('ISO 8601 deadline; null clears the item deadline'),
      sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    },
    { title: 'Update checklist item', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ ticketId, itemId, text, done, dueAt, sortOrder }) => {
      const item = await checklist.update(ticketId, itemId, {
        text,
        done,
        dueAt: dueAt === undefined ? undefined : dueAt === null ? null : new Date(dueAt),
        sortOrder,
      }, actor);
      if (!item) return textResult(`Checklist item ${itemId} not found on ticket ${ticketId}`, true);
      return jsonResult(item);
    },
  );

  server.tool(
    'toggle_checklist_item',
    'Mark a ticket checklist item done or not done (done items record who and when).',
    {
      ticketId: z.number().int().positive().describe('Local database ticket ID'),
      itemId: z.number().int().positive().describe('Checklist item id from list_ticket_checklist or get_ticket'),
      done: z.boolean(),
    },
    { title: 'Toggle checklist item', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ ticketId, itemId, done }) => {
      const item = await checklist.update(ticketId, itemId, { done }, actor);
      if (!item) return textResult(`Checklist item ${itemId} not found on ticket ${ticketId}`, true);
      return jsonResult(item);
    },
  );

  server.tool(
    'delete_checklist_item',
    'Permanently remove one checklist item from a ticket.',
    {
      ticketId: z.number().int().positive().describe('Local database ticket ID'),
      itemId: z.number().int().positive().describe('Checklist item id from list_ticket_checklist or get_ticket'),
    },
    { title: 'Delete checklist item', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ ticketId, itemId }) => {
      const removed = await checklist.remove(ticketId, itemId, actor);
      if (!removed) return textResult(`Checklist item ${itemId} not found on ticket ${ticketId}`, true);
      return jsonResult({ ok: true, ticketId, itemId });
    },
  );

  server.tool(
    'log_time',
    'Log billable time on a ticket, either as a duration (minutes) or a start/stop window. workedAt records when the work happened, so past work can be entered later.',
    {
      ticketId: z.number().int(),
      minutes: z.number().int().positive().optional().describe('Duration in minutes (omit if using start/stop)'),
      start: z.string().optional().describe('ISO timestamp; with `stop`, duration is derived'),
      stop: z.string().optional().describe('ISO timestamp'),
      workedAt: z.string().datetime({ offset: true }).optional().describe('ISO timestamp for when duration-only work occurred; a start/stop window uses start'),
      note: z.string().optional().describe('Optional note for the entry'),
      author: z.string().optional().default('MCP Agent'),
    },
    async ({ ticketId, minutes, start, stop, workedAt, note, author }) => {
      const changedBy = actor;
      let mins = minutes ?? 0;
      let timeStart: Date | undefined;
      let timeStop: Date | undefined;
      const recordedWorkedAt = workedAt ? new Date(workedAt) : undefined;
      if (Boolean(start) !== Boolean(stop)) {
        return {
          content: [{ type: 'text', text: 'start and stop must be provided together' }],
          isError: true,
        };
      }
      if (minutes !== undefined && start) {
        return {
          content: [{ type: 'text', text: 'Provide minutes or start/stop, not both' }],
          isError: true,
        };
      }
      if (workedAt && start) {
        return {
          content: [{
            type: 'text',
            text: 'workedAt is only accepted for duration-only entries; start is the work date for a window',
          }],
          isError: true,
        };
      }
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
        {
          content: note?.trim() || `Logged ${mins} min`,
          author,
          authorId: userId,
          noteType: 'time_entry',
          minutes: mins,
          timeStart,
          timeStop,
          workedAt: recordedWorkedAt,
          // Time entries are never customer-visible, whatever the channel.
          visibility: 'internal',
          via: 'mcp',
        },
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
        const { messageId } = await ticketMail.sendTicketEmail(
          ticketId,
          { to, cc, subject, html, text, author, actorSub: actor },
        );
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
    const mcpServer = buildMcpServer(actor, req.user.id, req.user.role);
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
