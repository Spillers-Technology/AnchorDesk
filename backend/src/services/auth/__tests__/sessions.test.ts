jest.mock('../../../db/prisma', () => ({
  prisma: {
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from '../../../db/prisma';
import {
  createSession,
  resolveScopedSession,
  resolveSession,
} from '../sessions';

const db = prisma as unknown as {
  session: {
    create: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
};

const staffUser = {
  id: 7,
  username: 'alice',
  displayName: 'Alice',
  email: 'alice@example.com',
  role: 'technician',
  authProvider: 'local',
  subject: null,
  passwordHash: null,
  isActive: true,
  totpSecret: null,
  totpEnabled: false,
  totpRecovery: null,
  signatureHtml: null,
  themePref: null,
  kanbanColumns: null,
  lastSeenAt: null,
  passwordChangedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    scope: 'staff',
    userId: staffUser.id,
    contactId: null,
    tokenHash: 'a'.repeat(64),
    userAgent: null,
    ip: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    user: staffUser,
    contact: null,
    ...overrides,
  };
}

describe('scoped server sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.session.delete.mockResolvedValue({});
    db.session.create.mockResolvedValue({});
  });

  it('resolves a structurally-valid staff row to only a staff principal', async () => {
    db.session.findUnique.mockResolvedValue(sessionRow());
    await expect(resolveScopedSession('staff-token')).resolves.toEqual({
      kind: 'staff',
      user: staffUser,
    });
  });

  it('resolves a structurally-valid portal row to a Contact requester with no role', async () => {
    db.session.findUnique.mockResolvedValue(
      sessionRow({
        scope: 'portal',
        userId: null,
        contactId: 22,
        user: null,
        contact: {
          id: 22,
          companyId: 9,
          name: 'Rita Requester',
          email: 'rita@example.com',
        },
      }),
    );

    const resolved = await resolveScopedSession('portal-token');
    expect(resolved).toEqual({
      kind: 'requester',
      contactId: 22,
      companyId: 9,
      name: 'Rita Requester',
      email: 'rita@example.com',
    });
    expect(resolved).not.toHaveProperty('role');
    expect(resolved).not.toHaveProperty('user');
  });

  it('keeps resolveSession staff-only for MFA and OAuth callers', async () => {
    db.session.findUnique.mockResolvedValue(
      sessionRow({
        scope: 'portal',
        userId: null,
        contactId: 22,
        user: null,
        contact: {
          id: 22,
          companyId: 9,
          name: 'Rita Requester',
          email: 'rita@example.com',
        },
      }),
    );
    await expect(resolveSession('portal-token')).resolves.toBeNull();
  });

  it.each([
    [
      'staff scope with a Contact too',
      { contactId: 22, contact: { id: 22, companyId: 9, name: 'Rita', email: 'rita@example.com' } },
    ],
    [
      'portal scope with a User too',
      {
        scope: 'portal',
        contactId: 22,
        contact: { id: 22, companyId: 9, name: 'Rita', email: 'rita@example.com' },
      },
    ],
    [
      'portal scope without a Contact',
      { scope: 'portal', userId: null, user: null },
    ],
    [
      'portal Contact without an email credential',
      {
        scope: 'portal',
        userId: null,
        contactId: 22,
        user: null,
        contact: { id: 22, companyId: 9, name: 'Rita', email: null },
      },
    ],
  ])('fails closed and removes a malformed row: %s', async (_case, overrides) => {
    db.session.findUnique.mockResolvedValue(sessionRow(overrides));
    await expect(resolveScopedSession('bad-token')).resolves.toBeNull();
    expect(db.session.delete).toHaveBeenCalledWith({
      where: { id: 'session-1' },
    });
  });

  it('lazily removes an expired row', async () => {
    db.session.findUnique.mockResolvedValue(
      sessionRow({ expiresAt: new Date(Date.now() - 1) }),
    );
    await expect(resolveScopedSession('expired')).resolves.toBeNull();
    expect(db.session.delete).toHaveBeenCalled();
  });

  it('writes all staff principal fields explicitly on ordinary login', async () => {
    const reply = {
      setCookie: jest.fn(),
    };
    const request = {
      headers: { 'user-agent': 'test-browser' },
      ip: '127.0.0.1',
    };

    await createSession(reply as never, request as never, staffUser as never);
    expect(db.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: 'staff',
        userId: 7,
        contactId: null,
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(reply.setCookie).toHaveBeenCalledWith(
      'mt_session',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });
});
