/**
 * Knowledge-base persistence, ranked search, and the portal visibility
 * boundary.
 *
 * The two portal-facing functions deliberately accept no visibility or
 * publication options. Their SQL/where clauses hard-code `portal + published`,
 * and their result mapping checks the same boundary again before serialization.
 * A caller therefore cannot accidentally widen a portal response by passing a
 * forgotten flag.
 */
import { createHash } from 'crypto';
import { KbVisibility, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  KB_ARTICLE_TITLE_TRGM,
  KB_ARTICLE_TRGM,
  KB_ARTICLE_TSV,
} from '../db/pgExtras';
import { htmlToText, sanitizeEmailHtml } from '../services/mail/sanitizeHtml';
import { hasPrismaCode } from '../util/prismaErrors';
import * as audit from './auditRepository';

const MAX_SLUG_LENGTH = 200;
const MAX_SLUG_ATTEMPTS = 1_000;
const MAX_SEARCH_TERM_LENGTH = 500;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const EXCERPT_LENGTH = 220;
/**
 * `LEFT(text, ...)` length, cast to `int` at the call site.
 *
 * Prisma binds a JS number as `int8`, and Postgres defines only
 * `left(text, integer)` — no `left(text, bigint)` overload exists, so an
 * uncast parameter fails the whole statement with `42883` at plan time,
 * regardless of how many rows it would have matched. That took out both KB
 * list endpoints in 2.7.0/2.7.1.
 */
const EXCERPT_SQL_LENGTH = Prisma.sql`${EXCERPT_LENGTH + 1}::int`;

export interface KbArticleInput {
  title: string;
  bodyHtml: string;
  category: string;
  visibility?: KbVisibility;
  published?: boolean;
}

export interface KbArticleUpdate {
  title?: string;
  bodyHtml?: string;
  category?: string;
  visibility?: KbVisibility;
  published?: boolean;
}

export interface KbArticleDto {
  id: number;
  slug: string;
  title: string;
  bodyHtml: string;
  category: string;
  visibility: KbVisibility;
  published: boolean;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Body-free browse/list shape. Full HTML is fetched only when an article opens. */
export interface KbArticleSummaryDto {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  visibility: KbVisibility;
  published: boolean;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KbSearchItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  score: number;
}

interface SearchRow {
  id: number;
  slug: string;
  title: string;
  bodyText: string;
  visibility: KbVisibility;
  published: boolean;
  deletedAt: Date | null;
  score: number;
}

export class KbArticleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KbArticleValidationError';
  }
}

export class KbSlugExhaustedError extends Error {
  constructor() {
    super('Could not allocate a unique article slug');
    this.name = 'KbSlugExhaustedError';
  }
}

export function isKbVisibility(value: unknown): value is KbVisibility {
  return value === 'internal' || value === 'portal';
}

/** Deterministic, URL-safe base. The numeric suffix is allocated separately. */
export function slugifyKbTitle(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (normalized || 'article').slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '') || 'article';
}

function slugCandidate(base: string, attempt: number): string {
  if (attempt === 1) return base;
  const suffix = `-${attempt}`;
  const stem = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '') || 'article';
  return `${stem}${suffix}`;
}

function isSlugUniqueConflict(error: unknown): boolean {
  if (!hasPrismaCode(error, 'P2002') || !error || typeof error !== 'object') return false;
  const meta = 'meta' in error ? (error as { meta?: { target?: unknown } }).meta : undefined;
  const target = meta?.target;
  const parts = Array.isArray(target) ? target.map(String) : target == null ? [] : [String(target)];
  return parts.some((part) => part === 'slug' || part.includes('kb_articles_slug'));
}

/** The shared mail sanitizer is the single server-side HTML policy. */
export function prepareKbBody(value: string): { bodyHtml: string; bodyText: string } {
  const bodyHtml = sanitizeEmailHtml(value);
  const bodyText = htmlToText(bodyHtml);
  // Images and tables can be meaningful without text. Everything else that
  // sanitizes to no readable content is an empty article, so reject it.
  if (!bodyText && !/<(?:img|table|hr)\b/i.test(bodyHtml)) {
    throw new KbArticleValidationError('bodyHtml must contain article content after sanitization');
  }
  return { bodyHtml, bodyText };
}

function cleanRequired(value: string, field: 'title' | 'category', max: number): string {
  const cleaned = value.trim();
  if (!cleaned) throw new KbArticleValidationError(`${field} is required`);
  if (cleaned.length > max) {
    throw new KbArticleValidationError(`${field} must be at most ${max} characters`);
  }
  return cleaned;
}

function authorSnapshot(actorSub: string): string {
  // Audit attribution carries the channel, while the byline is the human name.
  return actorSub.replace(/ \((?:api|mcp)\)$/, '').slice(0, 255);
}

function toDto(row: {
  id: number;
  slug: string;
  title: string;
  bodyHtml: string;
  category: string;
  visibility: KbVisibility;
  published: boolean;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}): KbArticleDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    // Treat even stored HTML as hostile. The browser's shared HtmlContent
    // component sanitizes again at render time for defense in depth.
    bodyHtml: sanitizeEmailHtml(row.bodyHtml),
    category: row.category,
    visibility: row.visibility,
    published: row.published,
    author: row.author,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSummary(row: {
  id: number;
  slug: string;
  title: string;
  bodyText: string;
  category: string;
  visibility: KbVisibility;
  published: boolean;
  author: string;
  createdAt: Date;
  updatedAt: Date;
}): KbArticleSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: excerptAroundMatch(row.bodyText, ''),
    category: row.category,
    visibility: row.visibility,
    published: row.published,
    author: row.author,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function bodyAuditMetadata(value: string) {
  return {
    length: value.length,
    sha256: createHash('sha256').update(value, 'utf8').digest('hex'),
  };
}

/**
 * Serialize update/delete for one live article. A plain find-then-update lets
 * two concurrent deletes both report success and audit, or lets an edit race a
 * delete. PostgreSQL re-checks the deleted_at predicate after a blocked
 * READ COMMITTED lock wakes, so exactly one mutation can proceed.
 */
async function lockActiveArticle(
  tx: Prisma.TransactionClient,
  id: number,
) {
  const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id
    FROM kb_articles
    WHERE id = ${id} AND deleted_at IS NULL
    FOR UPDATE
  `);
  if (locked.length !== 1) return null;
  return tx.kbArticle.findUnique({ where: { id } });
}

function boundedListLimit(limit?: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
}

function boundedSearchLimit(limit?: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT), 1), MAX_SEARCH_LIMIT);
}

export function excerptAroundMatch(value: string, query: string, maxLength = EXCERPT_LENGTH): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxLength) return text;

  const lower = text.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = normalizedQuery
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .sort((a, b) => b.length - a.length);
  let matchAt = normalizedQuery ? lower.indexOf(normalizedQuery) : -1;
  if (matchAt < 0) {
    for (const token of tokens) {
      matchAt = lower.indexOf(token);
      if (matchAt >= 0) break;
    }
  }
  if (matchAt < 0) matchAt = 0;

  let start = Math.max(0, matchAt - Math.floor(maxLength * 0.32));
  let end = Math.min(text.length, start + maxLength);
  if (end === text.length) start = Math.max(0, end - maxLength);

  if (start > 0) {
    const nextSpace = text.indexOf(' ', start);
    if (nextSpace >= 0 && nextSpace < matchAt) start = nextSpace + 1;
  }
  if (end < text.length) {
    const previousSpace = text.lastIndexOf(' ', end);
    if (previousSpace > start) end = previousSpace;
  }

  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function searchItems(rows: SearchRow[], query: string): KbSearchItem[] {
  return rows.map((row) => {
    const score = Number(row.score);
    if (!Number.isFinite(score)) {
      throw new Error(`Postgres returned a non-finite KB search score for article ${row.id}`);
    }
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: excerptAroundMatch(row.bodyText, query),
      score,
    };
  });
}

async function rankedSearch(
  query: string,
  limit: number,
  boundary: Prisma.Sql,
): Promise<SearchRow[]> {
  const term = query.trim();
  if (!term) return [];
  if (term.length > MAX_SEARCH_TERM_LENGTH) {
    throw new KbArticleValidationError(
      `q must be at most ${MAX_SEARCH_TERM_LENGTH} characters`,
    );
  }
  const lowered = term.toLowerCase();
  // `!` is the explicit LIKE escape character. Escaping %, _, and the escape
  // character itself keeps substring fallback literal (not user-controlled
  // wildcard syntax) while remaining eligible for pg_trgm's LIKE support.
  const like = `%${lowered.replace(/[!%_]/g, '!$&')}%`;
  const take = boundedSearchLimit(limit);

  return prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH article_txt AS (
      SELECT
        id,
        slug,
        title,
        body_text AS "bodyText",
        visibility,
        published,
        deleted_at AS "deletedAt",
        (${Prisma.raw(KB_ARTICLE_TSV)}) AS tsv,
        (${Prisma.raw(KB_ARTICLE_TRGM)}) AS txt,
        (${Prisma.raw(KB_ARTICLE_TITLE_TRGM)}) AS title_txt
      FROM kb_articles
      WHERE ${boundary}
    ),
    ranked AS (
      SELECT
        article_txt.*,
        (
          GREATEST(
            ts_rank_cd(tsv, websearch_to_tsquery('english', ${term}), 32),
            similarity(title_txt, ${lowered}),
            similarity(txt, ${lowered})
          )
          + CASE WHEN title_txt = ${lowered} THEN 1.0 ELSE 0.0 END
        )::double precision AS score
      FROM article_txt
      WHERE tsv @@ websearch_to_tsquery('english', ${term})
         OR title_txt % ${lowered}
         OR txt % ${lowered}
         OR title_txt LIKE ${like} ESCAPE '!'
         OR txt LIKE ${like} ESCAPE '!'
    )
    SELECT id, slug, title, "bodyText", visibility, published, "deletedAt", score
    FROM ranked
    ORDER BY score DESC, id ASC
    LIMIT ${take}
  `);
}

/**
 * Portal search is safe by construction: no visibility parameter exists and
 * both SQL and result mapping enforce `published + portal`.
 */
export async function searchPublishedPortal(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<KbSearchItem[]> {
  const rows = await rankedSearch(
    query,
    limit,
    Prisma.sql`deleted_at IS NULL AND published = true AND visibility = 'portal'::"KbVisibility"`,
  );
  return searchItems(
    rows.filter(
      (row) =>
        row.deletedAt === null &&
        row.published === true &&
        row.visibility === 'portal',
    ),
    query,
  );
}

/** Ranked search for authenticated staff. Drafts are never answer material. */
export async function searchPublishedStaff(
  query: string,
  opts: { visibility?: KbVisibility; limit?: number } = {},
): Promise<KbSearchItem[]> {
  const visibilityBoundary =
    opts.visibility === 'portal'
      ? Prisma.sql`deleted_at IS NULL AND published = true AND visibility = 'portal'::"KbVisibility"`
      : opts.visibility === 'internal'
        ? Prisma.sql`deleted_at IS NULL AND published = true AND visibility = 'internal'::"KbVisibility"`
        : Prisma.sql`deleted_at IS NULL AND published = true`;
  const rows = await rankedSearch(query, opts.limit ?? DEFAULT_SEARCH_LIMIT, visibilityBoundary);
  return searchItems(
    rows.filter((row) => row.deletedAt === null && row.published === true),
    query,
  );
}

export async function listPublishedForStaff(
  opts: { visibility?: KbVisibility; limit?: number } = {},
): Promise<KbArticleSummaryDto[]> {
  const visibility = opts.visibility
    ? Prisma.sql`AND visibility = ${opts.visibility}::"KbVisibility"`
    : Prisma.sql``;
  const rows = await prisma.$queryRaw<Array<Parameters<typeof toSummary>[0]>>(Prisma.sql`
    SELECT
      id,
      slug,
      title,
      LEFT(body_text, ${EXCERPT_SQL_LENGTH}) AS "bodyText",
      category,
      visibility,
      published,
      author,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM kb_articles
    WHERE deleted_at IS NULL
      AND published = true
      ${visibility}
    ORDER BY updated_at DESC, id DESC
    LIMIT ${boundedListLimit(opts.limit)}
  `);
  return rows.map(toSummary);
}

/** All rows, including drafts. Callers must enforce the author role boundary. */
export async function listForAuthors(
  opts: { visibility?: KbVisibility; published?: boolean; limit?: number } = {},
): Promise<KbArticleSummaryDto[]> {
  const visibility = opts.visibility
    ? Prisma.sql`AND visibility = ${opts.visibility}::"KbVisibility"`
    : Prisma.sql``;
  const publication =
    opts.published === undefined
      ? Prisma.sql``
      : Prisma.sql`AND published = ${opts.published}`;
  const rows = await prisma.$queryRaw<Array<Parameters<typeof toSummary>[0]>>(Prisma.sql`
    SELECT
      id,
      slug,
      title,
      LEFT(body_text, ${EXCERPT_SQL_LENGTH}) AS "bodyText",
      category,
      visibility,
      published,
      author,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM kb_articles
    WHERE deleted_at IS NULL
      ${visibility}
      ${publication}
    ORDER BY updated_at DESC, id DESC
    LIMIT ${boundedListLimit(opts.limit)}
  `);
  return rows.map(toSummary);
}

export async function getPublishedForStaffById(id: number): Promise<KbArticleDto | null> {
  const row = await prisma.kbArticle.findFirst({
    where: { id, deletedAt: null, published: true },
  });
  return row ? toDto(row) : null;
}

export async function getPublishedForStaffBySlug(slug: string): Promise<KbArticleDto | null> {
  const row = await prisma.kbArticle.findFirst({
    where: { slug, deletedAt: null, published: true },
  });
  return row ? toDto(row) : null;
}

export async function getForAuthorById(id: number): Promise<KbArticleDto | null> {
  const row = await prisma.kbArticle.findFirst({ where: { id, deletedAt: null } });
  return row ? toDto(row) : null;
}

export async function getForAuthorBySlug(slug: string): Promise<KbArticleDto | null> {
  const row = await prisma.kbArticle.findFirst({ where: { slug, deletedAt: null } });
  return row ? toDto(row) : null;
}

/**
 * Portal read mirrors portal search: the repository method cannot express an
 * internal or draft lookup, and a hostile/misbehaving DB adapter still cannot
 * make the postcondition serialize an internal row.
 */
export async function getPublishedPortalBySlug(slug: string): Promise<KbArticleDto | null> {
  const row = await prisma.kbArticle.findFirst({
    where: { slug, deletedAt: null, visibility: 'portal', published: true },
  });
  if (
    !row ||
    row.deletedAt !== null ||
    row.visibility !== 'portal' ||
    row.published !== true
  ) return null;
  return toDto(row);
}

export async function create(
  input: KbArticleInput,
  actorSub: string,
): Promise<KbArticleDto> {
  const title = cleanRequired(input.title, 'title', 255);
  const category = cleanRequired(input.category, 'category', 100);
  if (input.visibility !== undefined && !isKbVisibility(input.visibility)) {
    throw new KbArticleValidationError('visibility must be internal or portal');
  }
  const body = prepareKbBody(input.bodyHtml);
  const base = slugifyKbTitle(title);

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = slugCandidate(base, attempt);
    try {
      return await prisma.$transaction(async (tx) => {
        const article = await tx.kbArticle.create({
          data: {
            slug,
            title,
            ...body,
            category,
            visibility: input.visibility ?? 'internal',
            published: input.published ?? false,
            author: authorSnapshot(actorSub),
          },
        });
        await audit.record({
          entityType: 'kb_article',
          entityId: article.id,
          action: 'create',
          changedBy: actorSub,
          newValue: {
            slug: article.slug,
            title: article.title,
            category: article.category,
            visibility: article.visibility,
            published: article.published,
          },
        }, tx);
        return toDto(article);
      });
    } catch (error) {
      // The slug's unique index is the concurrency arbiter. Retrying the next
      // deterministic suffix handles same-title creates racing each other.
      if (isSlugUniqueConflict(error)) continue;
      throw error;
    }
  }
  throw new KbSlugExhaustedError();
}

export async function update(
  id: number,
  input: KbArticleUpdate,
  actorSub: string,
): Promise<KbArticleDto | null> {
  if (input.visibility !== undefined && !isKbVisibility(input.visibility)) {
    throw new KbArticleValidationError('visibility must be internal or portal');
  }
  const title = input.title === undefined ? undefined : cleanRequired(input.title, 'title', 255);
  const category =
    input.category === undefined ? undefined : cleanRequired(input.category, 'category', 100);
  const body = input.bodyHtml === undefined ? undefined : prepareKbBody(input.bodyHtml);

  return prisma.$transaction(async (tx) => {
    const before = await lockActiveArticle(tx, id);
    if (!before) return null;
    const article = await tx.kbArticle.update({
      where: { id },
      data: {
        title,
        category,
        visibility: input.visibility,
        published: input.published,
        bodyHtml: body?.bodyHtml,
        bodyText: body?.bodyText,
        // Slug is intentionally absent: title edits never rotate public URLs.
      },
    });
    await audit.record({
      entityType: 'kb_article',
      entityId: id,
      action: 'update',
      changedBy: actorSub,
      oldValue: {
        slug: before.slug,
        title: before.title,
        category: before.category,
        visibility: before.visibility,
        published: before.published,
        ...(body ? { body: bodyAuditMetadata(before.bodyHtml) } : {}),
      },
      newValue: {
        slug: article.slug,
        title: article.title,
        category: article.category,
        visibility: article.visibility,
        published: article.published,
        ...(body ? { body: bodyAuditMetadata(article.bodyHtml) } : {}),
      },
    }, tx);
    return toDto(article);
  });
}

export async function remove(id: number, actorSub: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const before = await lockActiveArticle(tx, id);
    if (!before) return false;
    await tx.kbArticle.update({
      where: { id },
      data: { deletedAt: new Date(), published: false },
    });
    await audit.record({
      entityType: 'kb_article',
      entityId: id,
      action: 'delete',
      changedBy: actorSub,
      oldValue: {
        slug: before.slug,
        title: before.title,
        category: before.category,
        visibility: before.visibility,
        published: before.published,
      },
      newValue: { deleted: true, slugReserved: before.slug },
    }, tx);
    return true;
  });
}
