/**
 * Real-Postgres relevance/security proof.
 *
 * The default Jest run remains unit-only, matching this repository's test
 * policy. After `prisma db push`, opt in with KB_POSTGRES_TESTS=1. This suite
 * uses the real FTS/pg_trgm expressions and cannot be satisfied by mocks.
 */
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma';
import { ensurePgExtras } from '../db/pgExtras';
import {
  create,
  getPublishedPortalBySlug,
  listForAuthors,
  listPublishedForStaff,
  searchPublishedPortal,
} from './kbArticleRepository';

const describePostgres =
  process.env.KB_POSTGRES_TESTS === '1' ? describe : describe.skip;

describePostgres('KB ranked search against PostgreSQL', () => {
  const ids: number[] = [];

  beforeAll(async () => {
    const warn = jest.fn();
    const log = {
      info: jest.fn(),
      warn,
    } as unknown as FastifyBaseLogger;
    await ensurePgExtras(log);
    const kbWarnings = warn.mock.calls.filter(([details]) =>
      String((details as { sql?: unknown })?.sql ?? '').includes('idx_kb_articles'),
    );
    expect(kbWarnings).toEqual([]);
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_catalog.pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'idx_kb_articles_fts',
          'idx_kb_articles_trgm',
          'idx_kb_articles_title_trgm'
        )
    `;
    expect(new Set(indexes.map((row) => row.indexname))).toEqual(new Set([
      'idx_kb_articles_fts',
      'idx_kb_articles_trgm',
      'idx_kb_articles_title_trgm',
    ]));
  });

  afterAll(async () => {
    if (ids.length) {
      await prisma.$transaction([
        prisma.auditLog.deleteMany({
          where: { entityType: 'kb_article', entityId: { in: ids } },
        }),
        prisma.kbArticle.deleteMany({ where: { id: { in: ids } } }),
      ]);
    }
    await prisma.$disconnect();
  });

  it('ranks the obvious answer first and excludes internal and draft matches', async () => {
    const unique = `quasar${Date.now()}`;
    const query = `${unique} Microsoft 365 password reset`;
    const exactPortal = await create({
      title: `Reset a forgotten Microsoft 365 password (${unique})`,
      category: 'Microsoft 365',
      visibility: 'portal',
      published: true,
      bodyHtml:
        '<h2>Reset access</h2><p>Open Entra ID, verify the requester, ' +
        'then start the Microsoft 365 password reset flow.</p>',
    }, 'postgres-test');
    ids.push(exactPortal.id);
    const incidentalPortal = await create({
      title: `New employee onboarding (${unique})`,
      category: 'Onboarding',
      visibility: 'portal',
      published: true,
      bodyHtml:
        `<p>${'Prepare licensing, equipment, and group membership. '.repeat(20)}` +
        `The ${unique} checklist may include a Microsoft 365 password reset.</p>`,
    }, 'postgres-test');
    ids.push(incidentalPortal.id);
    const strongerInternal = await create({
      title: query,
      category: 'Internal security',
      visibility: 'internal',
      published: true,
      bodyHtml: '<p>Internal-only escalation and identity verification steps.</p>',
    }, 'postgres-test');
    ids.push(strongerInternal.id);
    const draftPortal = await create({
      title: query,
      category: 'Drafts',
      visibility: 'portal',
      published: false,
      bodyHtml: '<p>This portal answer has not been approved.</p>',
    }, 'postgres-test');
    ids.push(draftPortal.id);

    const results = await searchPublishedPortal(query, 10);
    expect(results[0]?.id).toBe(exactPortal.id);
    expect(results.some((row) => row.id === incidentalPortal.id)).toBe(true);
    expect(results.some((row) => row.id === strongerInternal.id)).toBe(false);
    expect(results.some((row) => row.id === draftPortal.id)).toBe(false);
    for (let index = 1; index < results.length; index++) {
      expect(Number.isFinite(results[index].score)).toBe(true);
      expect(results[index - 1].score).toBeGreaterThanOrEqual(
        results[index].score,
      );
    }

    await expect(
      getPublishedPortalBySlug(strongerInternal.slug),
    ).resolves.toBeNull();
    await expect(getPublishedPortalBySlug(draftPortal.slug)).resolves.toBeNull();
  });

  /**
   * Regression: both list endpoints returned 42883 in 2.7.0/2.7.1 —
   * `function left(text, bigint) does not exist`. Prisma binds a JS number as
   * int8 and Postgres defines only `left(text, integer)`, so the statement
   * failed at plan time and the whole knowledge base 500'd for every caller.
   *
   * The unit suite could not catch it: it mocks `$queryRaw`, which accepts any
   * string as SQL, so asserting the query text was composed proved only that we
   * built it — never that Postgres would run it. That is the gap these cases
   * close, so they must execute the real statements rather than inspect them.
   */
  it('executes both list statements against Postgres', async () => {
    const unique = `pulsar${Date.now()}`;
    const publishedInternal = await create({
      title: `${unique} published internal`,
      category: 'Lists',
      visibility: 'internal',
      published: true,
      bodyHtml: `<p>${'body text '.repeat(60)}</p>`,
    }, 'postgres-test');
    ids.push(publishedInternal.id);
    const draftInternal = await create({
      title: `${unique} draft internal`,
      category: 'Lists',
      visibility: 'internal',
      published: false,
      bodyHtml: '<p>Not approved yet.</p>',
    }, 'postgres-test');
    ids.push(draftInternal.id);

    const staffRows = await listPublishedForStaff({ limit: 200 });
    const staffIds = staffRows.map((row) => row.id);
    expect(staffIds).toContain(publishedInternal.id);
    expect(staffIds).not.toContain(draftInternal.id);

    const authorRows = await listForAuthors({ limit: 200 });
    const authorIds = authorRows.map((row) => row.id);
    expect(authorIds).toContain(publishedInternal.id);
    expect(authorIds).toContain(draftInternal.id);

    // `published: false` is what the draft counter asks for; it must reach the
    // database rather than being dropped on the way through.
    const draftRows = await listForAuthors({ published: false, limit: 200 });
    const draftIds = draftRows.map((row) => row.id);
    expect(draftIds).toContain(draftInternal.id);
    expect(draftIds).not.toContain(publishedInternal.id);

    // The LEFT() bound is the reason the cast exists: prove it still truncates.
    const summary = staffRows.find((row) => row.id === publishedInternal.id);
    expect(summary?.excerpt.length).toBeLessThanOrEqual(221);
    expect(summary).not.toHaveProperty('bodyHtml');
  });
});
