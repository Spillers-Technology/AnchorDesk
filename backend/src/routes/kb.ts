/**
 * Knowledge-base REST surface.
 *
 * Staff browse published articles; technicians and admins author. Portal reads
 * use repository methods whose signatures cannot express internal visibility
 * or drafts. Portal routes additionally require the Contact-backed requester
 * principal resolved by the global authentication hook.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/auth';
import { authorizePortalKbRead } from '../middleware/kbPortalAccess';
import * as kb from '../repositories/kbArticleRepository';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';

interface IdParam {
  id: string;
}

interface SlugParam {
  slug: string;
}

const MAX_BODY_HTML_LENGTH = 1_000_000;
const ARTICLE_FIELDS = new Set([
  'title',
  'bodyHtml',
  'category',
  'visibility',
  'published',
]);

function canAuthor(request: FastifyRequest): boolean {
  return request.user?.role === 'admin' || request.user?.role === 'technician';
}

function isStaff(request: FastifyRequest): boolean {
  return (
    request.user?.role === 'admin' ||
    request.user?.role === 'technician' ||
    request.user?.role === 'readonly'
  );
}

function queryUrl(request: FastifyRequest): URL {
  return new URL(request.url, 'http://anchordesk.local');
}

function singleQueryValue(
  request: FastifyRequest,
  key: string,
): { value: string | undefined; error?: string } {
  const values = queryUrl(request).searchParams.getAll(key);
  if (values.length > 1) return { value: undefined, error: `${key} may only be provided once` };
  return { value: values[0] };
}

function parseLimit(
  request: FastifyRequest,
  fallback: number,
): { value: number; error?: string } {
  const raw = singleQueryValue(request, 'limit');
  if (raw.error) return { value: fallback, error: raw.error };
  if (raw.value === undefined) return { value: fallback };
  if (!/^\d+$/.test(raw.value)) {
    return { value: fallback, error: 'limit must be an integer between 1 and 100' };
  }
  const value = Number(raw.value);
  if (value < 1 || value > 100) {
    return { value: fallback, error: 'limit must be an integer between 1 and 100' };
  }
  return { value };
}

function parseVisibility(
  request: FastifyRequest,
): { value: 'internal' | 'portal' | undefined; error?: string } {
  const raw = singleQueryValue(request, 'visibility');
  if (raw.error) return { value: undefined, error: raw.error };
  if (raw.value === undefined || raw.value === '') return { value: undefined };
  if (!kb.isKbVisibility(raw.value)) {
    return { value: undefined, error: 'visibility must be internal or portal' };
  }
  return { value: raw.value };
}

function validateArticleInput(value: unknown, creating: boolean): string | null {
  if (!isPlainRecord(value)) return 'request body must be an object';
  const unknown = Object.keys(value).filter((key) => !ARTICLE_FIELDS.has(key));
  if (unknown.length) return `unknown or server-owned field: ${unknown.join(', ')}`;
  if (!creating && Object.keys(value).length === 0) return 'provide at least one article field';

  if (creating && value.title === undefined) return 'title is required';
  if (
    value.title !== undefined &&
    (typeof value.title !== 'string' ||
      !value.title.trim() ||
      value.title.length > 255)
  ) {
    return 'title must be a non-empty string up to 255 characters';
  }

  if (creating && value.category === undefined) return 'category is required';
  if (
    value.category !== undefined &&
    (typeof value.category !== 'string' ||
      !value.category.trim() ||
      value.category.length > 100)
  ) {
    return 'category must be a non-empty string up to 100 characters';
  }

  if (creating && value.bodyHtml === undefined) return 'bodyHtml is required';
  if (
    value.bodyHtml !== undefined &&
    (typeof value.bodyHtml !== 'string' ||
      !value.bodyHtml.trim() ||
      value.bodyHtml.length > MAX_BODY_HTML_LENGTH)
  ) {
    return `bodyHtml must be a non-empty string up to ${MAX_BODY_HTML_LENGTH} characters`;
  }

  if (value.visibility !== undefined && !kb.isKbVisibility(value.visibility)) {
    return 'visibility must be internal or portal';
  }
  if (value.published !== undefined && typeof value.published !== 'boolean') {
    return 'published must be a boolean';
  }
  return null;
}

function sendRepositoryError(error: unknown, reply: FastifyReply) {
  if (error instanceof kb.KbArticleValidationError) {
    return reply.status(400).send({ error: error.message });
  }
  throw error;
}

export async function kbRoutes(server: FastifyInstance) {
  const authorOnly = { preHandler: requireRole('admin', 'technician') };
  const staffOnly = {
    preHandler: requireRole('admin', 'technician', 'readonly'),
  };

  /**
   * Shared portal contract. Requester sessions reach this handler only through
   * the exact positive auth allowlist; this handler rechecks the requester
   * principal before selecting the portal-safe repository function.
   */
  server.get(
    '/kb/search',
    {
      // Search is more expensive than a simple read. Keep a route-local bound
      // in addition to requester-session authorization.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = singleQueryValue(request, 'q');
      if (q.error) return reply.status(400).send({ error: q.error });
      if (!q.value?.trim()) return reply.status(400).send({ error: 'q is required' });
      if (q.value.trim().length > 500) {
        return reply.status(400).send({ error: 'q must be at most 500 characters' });
      }
      const visibility = parseVisibility(request);
      if (visibility.error) return reply.status(400).send({ error: visibility.error });
      const limit = parseLimit(request, 20);
      if (limit.error) return reply.status(400).send({ error: limit.error });

      // Never select a staff-capable function for an anonymous/requester
      // principal, regardless of query parsing or future caller behavior.
      if (!isStaff(request)) {
        if (!(await authorizePortalKbRead(request))) {
          return reply.status(401).send({ error: 'Authentication required' });
        }
        return reply.send({
          items: await kb.searchPublishedPortal(q.value, limit.value),
        });
      }

      // Preserve the portal contract for staff callers too: asking for portal
      // visibility always goes through the same non-widenable repository path.
      if (visibility.value === 'portal') {
        return reply.send({
          items: await kb.searchPublishedPortal(q.value, limit.value),
        });
      }
      return reply.send({
        items: await kb.searchPublishedStaff(q.value, {
          visibility: visibility.value,
          limit: limit.value,
        }),
      });
    },
  );

  server.get('/kb/articles', staffOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const visibility = parseVisibility(request);
    if (visibility.error) return reply.status(400).send({ error: visibility.error });
    const limit = parseLimit(request, 100);
    if (limit.error) return reply.status(400).send({ error: limit.error });
    const include = singleQueryValue(request, 'includeUnpublished');
    if (include.error) return reply.status(400).send({ error: include.error });
    if (
      include.value !== undefined &&
      include.value !== 'true' &&
      include.value !== 'false'
    ) {
      return reply.status(400).send({ error: 'includeUnpublished must be true or false' });
    }
    const includeUnpublished = include.value === 'true';
    if (includeUnpublished && !canAuthor(request)) {
      return reply.status(403).send({ error: 'Requires role: admin or technician' });
    }
    const items = includeUnpublished
      ? await kb.listForAuthors({ visibility: visibility.value, limit: limit.value })
      : await kb.listPublishedForStaff({ visibility: visibility.value, limit: limit.value });
    return reply.send({ items });
  });

  server.get<{ Params: IdParam }>(
    '/kb/articles/:id',
    staffOnly,
    async (request, reply) => {
      const id = parseId(request.params.id);
      if (id === null) return reply.status(400).send({ error: 'invalid article id' });
      const article = canAuthor(request)
        ? await kb.getForAuthorById(id)
        : await kb.getPublishedForStaffById(id);
      if (!article) return reply.status(404).send({ error: 'Article not found' });
      return reply.send(article);
    },
  );

  server.get<{ Params: SlugParam }>(
    '/kb/portal/:slug',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!isStaff(request) && !(await authorizePortalKbRead(request))) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
      const slug = request.params.slug;
      if (
        slug.length > 200 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
      ) {
        return reply.status(400).send({ error: 'invalid article slug' });
      }
      const article = await kb.getPublishedPortalBySlug(slug);
      if (!article) return reply.status(404).send({ error: 'Article not found' });
      return reply.send(article);
    },
  );

  server.post(
    '/kb/articles',
    authorOnly,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const error = validateArticleInput(request.body, true);
      if (error) return reply.status(400).send({ error });
      try {
        const article = await kb.create(
          request.body as unknown as kb.KbArticleInput,
          request.actorSub,
        );
        return reply.status(201).send(article);
      } catch (repoError) {
        return sendRepositoryError(repoError, reply);
      }
    },
  );

  server.patch<{ Params: IdParam }>(
    '/kb/articles/:id',
    authorOnly,
    async (request, reply) => {
      const id = parseId(request.params.id);
      if (id === null) return reply.status(400).send({ error: 'invalid article id' });
      const error = validateArticleInput(request.body, false);
      if (error) return reply.status(400).send({ error });
      try {
        const article = await kb.update(
          id,
          request.body as unknown as kb.KbArticleUpdate,
          request.actorSub,
        );
        if (!article) return reply.status(404).send({ error: 'Article not found' });
        return reply.send(article);
      } catch (repoError) {
        return sendRepositoryError(repoError, reply);
      }
    },
  );

  server.delete<{ Params: IdParam }>(
    '/kb/articles/:id',
    authorOnly,
    async (request, reply) => {
      const id = parseId(request.params.id);
      if (id === null) return reply.status(400).send({ error: 'invalid article id' });
      if (!(await kb.remove(id, request.actorSub))) {
        return reply.status(404).send({ error: 'Article not found' });
      }
      return reply.status(204).send();
    },
  );
}
