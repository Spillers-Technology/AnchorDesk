import Fastify from 'fastify';

jest.mock('../repositories/kbArticleRepository', () => ({
  KbArticleValidationError: class KbArticleValidationError extends Error {},
  isKbVisibility: (value: unknown) => value === 'internal' || value === 'portal',
  searchPublishedPortal: jest.fn(),
  searchPublishedStaff: jest.fn(),
  listForAuthors: jest.fn(),
  listPublishedForStaff: jest.fn(),
  getForAuthorById: jest.fn(),
  getPublishedForStaffById: jest.fn(),
  getPublishedPortalBySlug: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  requireRole: (...roles: string[]) => async (request: any, reply: any) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: `Requires role: ${roles.join(' or ')}` });
    }
  },
}));

import * as kb from '../repositories/kbArticleRepository';
import { kbRoutes } from './kb';

const mockedKb = kb as jest.Mocked<typeof kb>;

async function appFor(role?: 'admin' | 'technician' | 'readonly' | 'portal') {
  const app = Fastify();
  if (role) {
    app.addHook('onRequest', async (request) => {
      request.user = {
        id: 7,
        username: 'alice',
        displayName: 'Alice',
        email: null,
        role: role as 'admin' | 'technician' | 'readonly',
        authProvider: 'local',
        themePref: null,
        kanbanColumns: null,
      };
      request.actorSub = 'alice';
      request.authChannel = 'web';
    });
  }
  await app.register(kbRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedKb.searchPublishedPortal.mockResolvedValue([]);
  mockedKb.searchPublishedStaff.mockResolvedValue([]);
  mockedKb.listForAuthors.mockResolvedValue([]);
  mockedKb.listPublishedForStaff.mockResolvedValue([]);
});

describe('KB search principal boundary', () => {
  it('routes an anonymous portal contract request only to the portal-safe repository function', async () => {
    const app = await appFor();
    mockedKb.searchPublishedPortal.mockResolvedValue([
      {
        id: 4,
        slug: 'reset-password',
        title: 'Reset password',
        excerpt: 'Reset it from the account page.',
        score: 0.91,
      },
    ]);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kb/search?q=password&visibility=portal&limit=5',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [{
          id: 4,
          slug: 'reset-password',
          title: 'Reset password',
          excerpt: 'Reset it from the account page.',
          score: 0.91,
        }],
      });
      expect(mockedKb.searchPublishedPortal).toHaveBeenCalledWith('password', 5);
      expect(mockedKb.searchPublishedStaff).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('never widens an anonymous request to internal search', async () => {
    const app = await appFor();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kb/search?q=password&visibility=internal',
      });
      expect(response.statusCode).toBe(401);
      expect(mockedKb.searchPublishedPortal).not.toHaveBeenCalled();
      expect(mockedKb.searchPublishedStaff).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does not mistake a future portal principal on request.user for staff', async () => {
    const app = await appFor('portal');
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kb/search?q=password&visibility=internal',
      });
      expect(response.statusCode).toBe(401);
      expect(mockedKb.searchPublishedStaff).not.toHaveBeenCalled();
      expect(mockedKb.searchPublishedPortal).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects ambiguous repeated visibility instead of trusting parser order', async () => {
    const app = await appFor();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kb/search?q=password&visibility=portal&visibility=internal',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/only be provided once/);
      expect(mockedKb.searchPublishedPortal).not.toHaveBeenCalled();
      expect(mockedKb.searchPublishedStaff).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('lets authenticated staff distinguish internal search', async () => {
    const app = await appFor('readonly');
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kb/search?q=password&visibility=internal&limit=7',
      });
      expect(response.statusCode).toBe(200);
      expect(mockedKb.searchPublishedStaff).toHaveBeenCalledWith('password', {
        visibility: 'internal',
        limit: 7,
      });
      expect(mockedKb.searchPublishedPortal).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('KB authoring access and validation', () => {
  it.each(['admin', 'technician'] as const)(
    'allows a %s to create an article and preserves audit actor attribution',
    async (role) => {
      const app = await appFor(role);
      const saved = {
        id: 9,
        slug: 'printer-reset',
        title: 'Printer reset',
        bodyHtml: '<p>Restart it.</p>',
        category: 'Printing',
        visibility: 'internal' as const,
        published: false,
        author: 'alice',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedKb.create.mockResolvedValue(saved);
      const body = {
        title: 'Printer reset',
        bodyHtml: '<p>Restart it.</p>',
        category: 'Printing',
        visibility: 'internal',
        published: false,
      };
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/kb/articles',
          payload: body,
        });
        expect(response.statusCode).toBe(201);
        expect(mockedKb.create).toHaveBeenCalledWith(body, 'alice');
      } finally {
        await app.close();
      }
    },
  );

  it('denies readonly authoring before the repository is called', async () => {
    const app = await appFor('readonly');
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/kb/articles',
        payload: {
          title: 'Blocked',
          bodyHtml: '<p>Body</p>',
          category: 'Test',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(mockedKb.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects attempts to control the stable slug or author', async () => {
    const app = await appFor('technician');
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/kb/articles',
        payload: {
          title: 'Unsafe shape',
          bodyHtml: '<p>Body</p>',
          category: 'Test',
          slug: 'client-chosen',
          author: 'somebody else',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/server-owned field/);
      expect(mockedKb.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
