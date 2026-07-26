const mockTx = {
  $queryRaw: jest.fn(),
  portalMagicLink: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  contact: {
    findUnique: jest.fn(),
  },
  session: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

jest.mock('../db/prisma', () => ({
  prisma: {
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      callback(mockTx),
    ),
    $queryRaw: jest.fn(),
    portalMagicLink: {
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));
jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import {
  consumeMagicLinkAndCreateSession,
  createMagicLink,
  findUniqueRequesterByEmail,
  revokePortalSession,
} from './portalAuthRepository';

const db = prisma as unknown as {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  portalMagicLink: { findUnique: jest.Mock; deleteMany: jest.Mock };
};
const recordAudit = audit.record as jest.Mock;

const contact = {
  id: 22,
  companyId: 9,
  name: 'Rita Requester',
  email: 'rita@example.com',
};

function consumeInput() {
  const now = new Date('2026-07-26T12:00:00.000Z');
  return {
    linkId: 4,
    contactId: 22,
    now,
    actor: 'requester:22 (portal)',
    session: {
      tokenHash: 'a'.repeat(64),
      userAgent: 'browser',
      ip: '127.0.0.1',
      expiresAt: new Date('2026-07-27T12:00:00.000Z'),
    },
  };
}

describe('portal auth repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$transaction.mockImplementation(
      (callback: (client: unknown) => unknown) => callback(mockTx),
    );
    db.$queryRaw.mockResolvedValue([contact]);
    mockTx.$queryRaw.mockReset();
    mockTx.$queryRaw.mockImplementation((query: {
      strings?: readonly string[];
      join?: (separator: string) => string;
    }) => {
      const sql = query.strings
        ? query.strings.join(' ')
        : typeof query.join === 'function'
          ? query.join(' ')
          : String(query);
      return Promise.resolve(
        sql.includes('pg_advisory_xact_lock')
          ? [{ locked: 1 }]
          : sql.includes('lower(btrim(email))')
          ? [contact]
          : [{ id: contact.id }],
      );
    });
    mockTx.contact.findUnique.mockResolvedValue(contact);
    mockTx.session.create.mockResolvedValue({ id: 'session' });
    recordAudit.mockResolvedValue(undefined);
  });

  it('fails closed when a normalized email matches more than one Contact', async () => {
    db.$queryRaw.mockResolvedValue([contact, { ...contact, id: 23 }]);
    await expect(
      findUniqueRequesterByEmail('rita@example.com'),
    ).resolves.toBeNull();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('stores only selector/verifier hashes in a short-lived row', async () => {
    mockTx.portalMagicLink.create.mockResolvedValue({ id: 4 });
    await createMagicLink({
      contactId: 22,
      expectedCompanyId: 9,
      expectedEmail: 'rita@example.com',
      selectorHash: 'b'.repeat(64),
      verifierHash: 'c'.repeat(64),
      expiresAt: new Date('2026-07-26T12:15:00.000Z'),
    });
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(mockTx.$queryRaw.mock.calls[0][0].strings.join(' ')).toContain(
      'SELECT 1::int AS locked',
    );
    expect(mockTx.$queryRaw.mock.calls[0][0].strings.join(' ')).toContain(
      'FROM pg_advisory_xact_lock',
    );
    expect(mockTx.$queryRaw.mock.calls[2][0].join(' ')).toContain(
      'FOR SHARE',
    );
    expect(mockTx.$queryRaw.mock.calls[2][1]).toBe(22);
    expect(mockTx.portalMagicLink.create).toHaveBeenCalledWith({
      data: {
        contactId: 22,
        selectorHash: 'b'.repeat(64),
        verifierHash: 'c'.repeat(64),
        expiresAt: new Date('2026-07-26T12:15:00.000Z'),
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        changedBy: 'anonymous (portal-auth)',
        newValue: expect.not.objectContaining({
          selectorHash: expect.anything(),
          verifierHash: expect.anything(),
        }),
      }),
      mockTx,
    );
  });

  it.each([
    ['was deleted before it could be locked', [contact], []],
    ['moved companies after email lookup', [{ ...contact, companyId: 10 }], [{ id: 22 }]],
    ['changed email after email lookup', [], [{ id: 22 }]],
    ['became ambiguous after email lookup', [contact, { ...contact, id: 23 }], [{ id: 22 }]],
  ])(
    'issues no credential when the Contact %s',
    async (_case, matches, locked) => {
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ locked: 1 }])
        .mockResolvedValueOnce(matches)
        .mockResolvedValueOnce(locked);

      await expect(
        createMagicLink({
          contactId: 22,
          expectedCompanyId: 9,
          expectedEmail: 'rita@example.com',
          selectorHash: 'b'.repeat(64),
          verifierHash: 'c'.repeat(64),
          expiresAt: new Date('2026-07-26T12:15:00.000Z'),
        }),
      ).resolves.toBeNull();

      expect(mockTx.portalMagicLink.create).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it('uses one compare-and-set for single-use + expiry before creating a session', async () => {
    mockTx.portalMagicLink.updateMany.mockResolvedValue({ count: 1 });
    const input = consumeInput();

    await expect(
      consumeMagicLinkAndCreateSession(input),
    ).resolves.toMatchObject({
      kind: 'requester',
      contactId: 22,
      companyId: 9,
    });
    expect(mockTx.portalMagicLink.updateMany).toHaveBeenCalledWith({
      where: {
        id: 4,
        contactId: 22,
        usedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { usedAt: input.now },
    });
    expect(mockTx.session.create).toHaveBeenCalledWith({
      data: {
        scope: 'portal',
        userId: null,
        contactId: 22,
        tokenHash: input.session.tokenHash,
        userAgent: 'browser',
        ip: '127.0.0.1',
        expiresAt: input.session.expiresAt,
      },
    });
  });

  it('allows exactly one winner when two redeemers race', async () => {
    mockTx.portalMagicLink.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const input = consumeInput();

    const results = await Promise.all([
      consumeMagicLinkAndCreateSession(input),
      consumeMagicLinkAndCreateSession(input),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mockTx.session.create).toHaveBeenCalledTimes(1);
  });

  it('creates no session when the token is expired or already used', async () => {
    mockTx.portalMagicLink.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      consumeMagicLinkAndCreateSession(consumeInput()),
    ).resolves.toBeNull();
    expect(mockTx.session.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('revokes and audits exactly the presented portal session atomically', async () => {
    mockTx.session.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      revokePortalSession({
        contactId: 22,
        tokenHash: 'd'.repeat(64),
        actor: 'requester:22 (portal)',
      }),
    ).resolves.toBe(true);

    expect(mockTx.session.deleteMany).toHaveBeenCalledWith({
      where: {
        scope: 'portal',
        contactId: 22,
        tokenHash: 'd'.repeat(64),
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'portal_session',
        entityId: 22,
        action: 'delete',
        changedBy: 'requester:22 (portal)',
      }),
      mockTx,
    );
  });
});
