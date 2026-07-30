jest.mock('../db/prisma', () => ({
  prisma: {
    kbArticle: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock('./auditRepository', () => ({ record: jest.fn() }));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import {
  create,
  excerptAroundMatch,
  getPublishedPortalBySlug,
  listForAuthors,
  listPublishedForStaff,
  remove,
  searchPublishedPortal,
  slugifyKbTitle,
  update,
} from './kbArticleRepository';

const mockTx = {
  kbArticle: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $queryRaw: jest.fn(),
};
const mockPrisma = prisma as unknown as {
  kbArticle: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedAudit = audit.record as jest.Mock;
const now = new Date('2026-07-26T12:00:00.000Z');

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: 'reset-a-password',
    title: 'Reset a password',
    bodyHtml: '<p>Reset the password safely.</p>',
    bodyText: 'Reset the password safely.',
    category: 'Accounts',
    visibility: 'internal' as const,
    published: true,
    author: 'alice',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx),
  );
  mockedAudit.mockResolvedValue({ id: 1n });
  mockTx.$queryRaw.mockResolvedValue([{ id: 1 }]);
});

describe('KB article writes', () => {
  it('stores HTML sanitized through the shared mail policy and derives plain search text', async () => {
    mockTx.kbArticle.create.mockImplementation(async ({ data }) => article({
      ...data,
      id: 8,
    }));

    const saved = await create({
      title: 'Reset a password',
      category: 'Accounts',
      visibility: 'portal',
      published: true,
      bodyHtml:
        '<p>Hello <strong>world</strong></p>' +
        '<script>alert(1)</script>' +
        '<img src="javascript:alert(2)" onerror="steal()">',
    }, 'alice (api)');

    const stored = mockTx.kbArticle.create.mock.calls[0][0].data;
    expect(stored.bodyHtml).toContain('<strong>world</strong>');
    expect(stored.bodyHtml).not.toMatch(/script|onerror|javascript:/i);
    expect(stored.bodyText).toBe('Hello world');
    expect(stored.author).toBe('alice');
    expect(saved.bodyHtml).toBe(stored.bodyHtml);
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'kb_article',
        entityId: 8,
        action: 'create',
        changedBy: 'alice (api)',
      }),
      mockTx,
    );
  });

  it('allocates deterministic numeric suffixes when the unique slug collides', async () => {
    mockTx.kbArticle.create
      .mockRejectedValueOnce(Object.assign(new Error('duplicate slug'), {
        code: 'P2002',
        meta: { target: ['slug'] },
      }))
      .mockImplementationOnce(async ({ data }) => article({
        ...data,
        id: 2,
      }));

    const saved = await create({
      title: 'Résumé & Password Reset',
      category: 'Accounts',
      bodyHtml: '<p>Steps</p>',
    }, 'alice');

    expect(slugifyKbTitle('Résumé & Password Reset')).toBe(
      'resume-and-password-reset',
    );
    expect(mockTx.kbArticle.create.mock.calls.map(([args]) => args.data.slug)).toEqual([
      'resume-and-password-reset',
      'resume-and-password-reset-2',
    ]);
    expect(saved.slug).toBe('resume-and-password-reset-2');
  });

  it('does not disguise an unrelated unique failure as a slug collision', async () => {
    mockedAudit.mockRejectedValueOnce(Object.assign(new Error('audit identity'), {
      code: 'P2002',
      meta: { target: ['audit_log_pkey'] },
    }));
    mockTx.kbArticle.create.mockImplementation(async ({ data }) => article(data));

    await expect(create({
      title: 'Audit failure',
      category: 'Operations',
      bodyHtml: '<p>Body</p>',
    }, 'alice')).rejects.toThrow('audit identity');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps the slug stable across a title edit', async () => {
    const before = article({ slug: 'stable-public-url' });
    mockTx.kbArticle.findUnique.mockResolvedValue(before);
    mockTx.kbArticle.update.mockImplementation(async ({ data }) => ({
      ...before,
      ...Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ),
      updatedAt: new Date('2026-07-26T13:00:00.000Z'),
    }));

    const saved = await update(1, { title: 'A completely different title' }, 'bob');

    const updateData = mockTx.kbArticle.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('slug');
    expect(saved?.slug).toBe('stable-public-url');
    expect(saved?.title).toBe('A completely different title');
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', changedBy: 'bob' }),
      mockTx,
    );
  });

  it('records compact before/after body evidence for body-only edits', async () => {
    const before = article({ bodyHtml: '<p>Old recovery steps.</p>' });
    mockTx.kbArticle.findUnique.mockResolvedValue(before);
    mockTx.kbArticle.update.mockImplementation(async ({ data }) => ({
      ...before,
      ...Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ),
    }));

    await update(
      1,
      { bodyHtml: '<p>Use the new recovery workflow.</p><script>bad()</script>' },
      'bob',
    );

    const auditInput = mockedAudit.mock.calls[0][0];
    expect(auditInput.oldValue.body).toEqual({
      length: before.bodyHtml.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(auditInput.newValue.body).toEqual({
      length: '<p>Use the new recovery workflow.</p>'.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(auditInput.oldValue.body.sha256).not.toBe(
      auditInput.newValue.body.sha256,
    );
    expect(JSON.stringify(auditInput)).not.toContain('new recovery workflow');
  });

  it('soft-deletes while reserving the slug and treats a repeated delete as missing', async () => {
    const before = article({ slug: 'never-reassign-this-url' });
    mockTx.$queryRaw
      .mockResolvedValueOnce([{ id: before.id }])
      .mockResolvedValueOnce([]);
    mockTx.kbArticle.findUnique.mockResolvedValue(before);
    mockTx.kbArticle.update.mockResolvedValue({
      ...before,
      published: false,
      deletedAt: now,
    });

    await expect(remove(before.id, 'alice')).resolves.toBe(true);
    expect(mockTx.kbArticle.update).toHaveBeenCalledWith({
      where: { id: before.id },
      data: { deletedAt: expect.any(Date), published: false },
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        newValue: {
          deleted: true,
          slugReserved: 'never-reassign-this-url',
        },
      }),
      mockTx,
    );

    await expect(remove(before.id, 'alice')).resolves.toBe(false);
    expect(mockTx.kbArticle.update).toHaveBeenCalledTimes(1);
  });
});

describe('body-free article lists', () => {
  it('returns a short plain-text summary and bounds text in SQL without selecting HTML', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      article({
        bodyText: 'Reset the cached profile and sign in again.',
      }),
    ]);

    const [summary] = await listForAuthors();

    expect(summary).toEqual(expect.objectContaining({
      id: 1,
      slug: 'reset-a-password',
      excerpt: 'Reset the cached profile and sign in again.',
    }));
    expect(summary).not.toHaveProperty('bodyHtml');
    const query = mockPrisma.$queryRaw.mock.calls[0][0] as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain('LEFT(body_text,');
    expect(query.text).not.toContain('body_html');
    expect(query.values).toContain(221);
  });

  // Prisma binds a JS number as int8 and Postgres has no `left(text, bigint)`,
  // so an uncast length fails the whole statement with 42883 at plan time. This
  // asserts the cast is present, but note what it cannot do: a mocked
  // $queryRaw accepts any SQL, valid or not. The proof that Postgres accepts
  // these two statements lives in kbArticleRepository.postgres.test.ts.
  it.each([
    ['listForAuthors', listForAuthors],
    ['listPublishedForStaff', listPublishedForStaff],
  ])('casts the %s excerpt length so Postgres can resolve left()', async (_name, listFn) => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await listFn();

    const query = mockPrisma.$queryRaw.mock.calls[0][0] as { text: string };
    expect(query.text).toMatch(/LEFT\(body_text,\s*\$\d+::int\)/);
  });
});

describe('portal-safe reads', () => {
  it('treats LIKE metacharacters as literal search text', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await searchPublishedPortal('100%_ready!');
    const query = mockPrisma.$queryRaw.mock.calls[0][0] as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain("ESCAPE '!'");
    expect(query.values).toContain('%100!%!_ready!!%');
  });

  it('drops internal, draft, and deleted rows even if a DB adapter returns them', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        ...article({
          id: 1,
          slug: 'internal',
          visibility: 'internal',
          score: 99,
        }),
      },
      {
        ...article({
          id: 2,
          slug: 'draft',
          visibility: 'portal',
          published: false,
          score: 98,
        }),
      },
      {
        ...article({
          id: 3,
          slug: 'deleted',
          visibility: 'portal',
          deletedAt: now,
          score: 97,
        }),
      },
      {
        ...article({
          id: 4,
          slug: 'public',
          visibility: 'portal',
          bodyText: 'Use the self-service password reset screen.',
          score: 0.84,
        }),
      },
    ]);

    await expect(searchPublishedPortal('password reset', 5)).resolves.toEqual([
      {
        id: 4,
        slug: 'public',
        title: 'Reset a password',
        excerpt: 'Use the self-service password reset screen.',
        score: 0.84,
      },
    ]);
  });

  it('uses an explicit portal+published+not-deleted exact-slug lookup and verifies its postcondition', async () => {
    mockPrisma.kbArticle.findFirst.mockResolvedValue(article({
      visibility: 'internal',
    }));
    await expect(getPublishedPortalBySlug('reset-a-password')).resolves.toBeNull();
    expect(mockPrisma.kbArticle.findFirst).toHaveBeenCalledWith({
      where: {
        slug: 'reset-a-password',
        deletedAt: null,
        visibility: 'portal',
        published: true,
      },
    });
  });

  it('preserves descending Postgres relevance and builds a window around the match', async () => {
    const prefix = 'Background context '.repeat(30);
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        ...article({
          id: 10,
          slug: 'm365-reset',
          title: 'Reset a forgotten Microsoft 365 password',
          visibility: 'portal',
          bodyText: `${prefix}Open Entra ID for the Microsoft 365 password reset workflow. Continue with verification.`,
          score: 1.21,
        }),
      },
      {
        ...article({
          id: 11,
          slug: 'onboarding',
          title: 'New employee onboarding',
          visibility: 'portal',
          bodyText: 'Onboarding may include a password reset.',
          score: 0.19,
        }),
      },
    ]);

    const results = await searchPublishedPortal('Microsoft 365 password reset');
    expect(results.map((result) => result.slug)).toEqual([
      'm365-reset',
      'onboarding',
    ]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].excerpt).toContain('Microsoft 365 password reset');
    expect(results[0].excerpt.length).toBeLessThanOrEqual(222);
    expect(excerptAroundMatch('abcdefghijklmnopqrstuvwxyz', 'missing', 20)).toHaveLength(21);
  });
});
