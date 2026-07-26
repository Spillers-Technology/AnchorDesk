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
});
