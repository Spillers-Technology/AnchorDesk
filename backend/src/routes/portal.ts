import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import * as portalRepository from '../repositories/portalRepository';
import {
  serializePortalAttachment,
  serializePortalNote,
  serializePortalTicket,
} from '../services/portalSerializer';
import { buildKey, currentStorage, storageForBackend } from '../services/storage';
import {
  requesterPrincipalFor,
  type RequesterPrincipal,
} from '../types/principal';
import { actorFor } from '../middleware/auth';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import * as twoWaySync from '../services/twoWaySync';
import { sanitizeSyncError } from '../repositories/syncRunRepository';
import { RequesterIdentityChangedError } from '../repositories/ticketRepository';

interface IdParam {
  id: string;
}

export const PORTAL_ATTACHMENT_REQUEST_MAX_BYTES = 50 * 1024 * 1024;

function actorForRequester(principal: RequesterPrincipal): string {
  return actorFor(`requester:${principal.contactId}`, 'portal');
}

/**
 * Authentication populates request.principal. This route-local guard keeps a
 * staff session (or a future principal kind) from being treated as a requester
 * merely because it reached the /portal tree.
 */
export const requireRequesterPrincipal: preHandlerHookHandler = async (
  request,
  reply,
) => {
  if (!requesterPrincipalFor(request)) {
    return reply.status(403).send({ error: 'Requester portal session required' });
  }
};

function requester(request: FastifyRequest): RequesterPrincipal {
  const principal = requesterPrincipalFor(request);
  if (!principal) throw Object.assign(new Error('Requester portal session required'), { statusCode: 403 });
  return principal;
}

function positiveInteger(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function ticketCreateBody(
  value: unknown,
): { summary: string; description?: string } | string {
  if (!isPlainRecord(value)) return 'request body must be an object';
  const allowed = new Set(['summary', 'description']);
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length) return `unsupported field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`;
  if (typeof value.summary !== 'string' || !value.summary.trim()) return 'summary is required';
  if (value.summary.trim().length > 255) return 'summary must be at most 255 characters';
  if (value.description !== undefined && typeof value.description !== 'string') {
    return 'description must be a string';
  }
  if (typeof value.description === 'string' && value.description.length > 100_000) {
    return 'description must be at most 100000 characters';
  }
  return {
    summary: value.summary.trim(),
    ...(typeof value.description === 'string' && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
  };
}

function commentBody(value: unknown): { content: string } | string {
  if (!isPlainRecord(value)) return 'request body must be an object';
  const unsupported = Object.keys(value).filter((key) => key !== 'content');
  if (unsupported.length) return `unsupported field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`;
  if (typeof value.content !== 'string' || !value.content.trim()) return 'content is required';
  if (value.content.trim().length > 50_000) return 'content must be at most 50000 characters';
  return { content: value.content.trim() };
}

export async function portalRoutes(server: FastifyInstance) {
  // This hook is encapsulated with the registered portal plugin, so every
  // requester business response (including errors and file downloads) is
  // non-cacheable without changing staff/API caching behavior.
  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Pragma', 'no-cache');
    return payload;
  });

  const requesterOnly = { preHandler: requireRequesterPrincipal };
  const requesterAttachmentOnly = {
    preHandler: requireRequesterPrincipal,
    config: {
      rateLimit: {
        max: 12,
        timeWindow: '1 hour',
        hook: 'preHandler' as const,
        keyGenerator: (request: FastifyRequest) => {
          const principal = requesterPrincipalFor(request);
          return principal
            ? `portal-attachment:${principal.contactId}`
            : `portal-attachment:unauthenticated:${request.ip}`;
        },
      },
    },
  };

  server.get('/portal/tickets', requesterOnly, async (req, reply) => {
    const principal = requester(req);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const page = positiveInteger(query.page, 1);
    const requestedPageSize = positiveInteger(query.pageSize, 20);
    if (page === null) return reply.status(400).send({ error: 'page must be a positive integer' });
    if (requestedPageSize === null) {
      return reply.status(400).send({ error: 'pageSize must be a positive integer' });
    }
    const pageSize = Math.min(requestedPageSize, 50);
    const result = await portalRepository.listTickets(principal, { page, pageSize });
    return reply.send({
      items: result.items.map(serializePortalTicket),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  });

  server.post('/portal/tickets', requesterOnly, async (req, reply) => {
    const principal = requester(req);
    const body = ticketCreateBody(req.body);
    if (typeof body === 'string') return reply.status(400).send({ error: body });
    let ticket;
    try {
      ticket = await portalRepository.createTicket(
        principal,
        body,
        actorForRequester(principal),
      );
    } catch (error) {
      if (error instanceof RequesterIdentityChangedError) {
        return reply.status(403).send({
          error: 'Requester identity changed; sign in again',
        });
      }
      throw error;
    }
    // A create that cannot be read through the same requester scope indicates an
    // ownership invariant failure. Do not fall back to returning the raw row.
    if (!ticket) return reply.status(500).send({ error: 'Ticket ownership could not be established' });
    return reply.status(201).send(serializePortalTicket(ticket));
  });

  server.get<{ Params: IdParam }>('/portal/tickets/:id', requesterOnly, async (req, reply) => {
    const ticketId = parseId(req.params.id);
    if (ticketId === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const ticket = await portalRepository.getTicket(requester(req), ticketId);
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
    return reply.send(serializePortalTicket(ticket));
  });

  server.post<{ Params: IdParam }>(
    '/portal/tickets/:id/comments',
    requesterOnly,
    async (req, reply) => {
      const ticketId = parseId(req.params.id);
      if (ticketId === null) return reply.status(400).send({ error: 'invalid ticket id' });
      const body = commentBody(req.body);
      if (typeof body === 'string') return reply.status(400).send({ error: body });
      const principal = requester(req);
      const note = await portalRepository.addComment(
        principal,
        ticketId,
        body.content,
        actorForRequester(principal),
      );
      if (!note) return reply.status(404).send({ error: 'Ticket not found' });
      void twoWaySync.pushNoteOut(ticketId, note.id).catch((error) => {
        req.log.warn(
          {
            message: sanitizeSyncError(
              error instanceof Error ? error.message : 'note push-out failed',
            ),
            ticketId,
            noteId: note.id,
          },
          'portal note push-out failed',
        );
      });
      return reply.status(201).send(serializePortalNote(note));
    },
  );

  server.post<{ Params: IdParam }>(
    '/portal/tickets/:id/attachments',
    requesterAttachmentOnly,
    async (req, reply) => {
      const ticketId = parseId(req.params.id);
      if (ticketId === null) return reply.status(400).send({ error: 'invalid ticket id' });
      const principal = requester(req);
      if (!(await portalRepository.ownsTicket(principal, ticketId))) {
        return reply.status(404).send({ error: 'Ticket not found' });
      }
      if (!req.isMultipart()) {
        return reply.status(400).send({ error: 'Expected multipart/form-data' });
      }

      const storage = await currentStorage();
      const staged: portalRepository.PortalAttachmentCreateInput[] = [];
      const storedKeys: string[] = [];
      let requestBytes = 0;
      const cleanup = async () => {
        await Promise.all(storedKeys.map((key) => storage.delete(key).catch(() => undefined)));
      };
      try {
        for await (const part of req.files()) {
          const buffer = await part.toBuffer();
          requestBytes += buffer.length;
          if (requestBytes > PORTAL_ATTACHMENT_REQUEST_MAX_BYTES) {
            throw Object.assign(
              new Error('Portal attachment request is too large'),
              { statusCode: 413, code: 'PORTAL_REQUEST_TOO_LARGE' },
            );
          }
          const filename = part.filename.slice(0, 500) || 'file';
          const contentType = (part.mimetype || 'application/octet-stream').slice(0, 150);
          const storageKey = buildKey(ticketId, filename);
          await storage.put(storageKey, buffer, contentType);
          storedKeys.push(storageKey);
          staged.push({
            filename,
            contentType,
            size: buffer.length,
            storageBackend: storage.backend,
            storageKey,
          });
        }
        if (staged.length === 0) return reply.status(400).send({ error: 'No files in request' });
        const rows = await portalRepository.createAttachments(
          principal,
          ticketId,
          staged,
          actorForRequester(principal),
        );
        if (!rows) {
          await cleanup();
          return reply.status(404).send({ error: 'Ticket not found' });
        }
        return reply.status(201).send(rows.map(serializePortalAttachment));
      } catch (error) {
        await cleanup();
        req.log.warn({ err: error }, 'Portal attachment upload failed');
        const uploadError = error as { statusCode?: number; code?: string };
        if (
          uploadError.statusCode === 413 ||
          uploadError.code === 'FST_REQ_FILE_TOO_LARGE'
        ) {
          return reply.status(413).send({ error: 'Attachment is too large' });
        }
        return reply.status(500).send({ error: 'Attachment upload failed' });
      }
    },
  );

  server.get<{ Params: IdParam }>(
    '/portal/attachments/:id/download',
    requesterOnly,
    async (req, reply) => {
      const attachmentId = parseId(req.params.id);
      if (attachmentId === null) return reply.status(400).send({ error: 'invalid attachment id' });
      const row = await portalRepository.getVisibleAttachment(requester(req), attachmentId);
      if (!row) return reply.status(404).send({ error: 'Attachment not found' });

      try {
        const storage = await storageForBackend(row.storageBackend);
        const stream = await storage.get(row.storageKey);
        reply.header('Content-Type', row.contentType);
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Cache-Control', 'private, no-store');
        reply.header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        );
        return reply.send(stream);
      } catch (error) {
        req.log.warn({ err: error, attachmentId }, 'Portal attachment fetch failed');
        return reply.status(404).send({ error: 'Attachment not found' });
      }
    },
  );
}
