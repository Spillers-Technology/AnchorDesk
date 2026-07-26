jest.mock('../db/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as auditRepository from './auditRepository';
import {
  findUniqueContactByEmail,
  updateContact,
} from './companyRepository';

const queryRaw = prisma.$queryRaw as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;
const auditRecord = auditRepository.record as jest.Mock;
const tx = {
  $queryRaw: jest.fn(),
  contact: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  session: { deleteMany: jest.fn() },
  portalMagicLink: { deleteMany: jest.fn() },
};

beforeEach(() => {
  jest.clearAllMocks();
  transaction.mockImplementation(
    async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx),
  );
  tx.contact.findUnique.mockResolvedValue({
    id: 9,
    companyId: 7,
    name: 'Casey',
    email: 'casey@example.test',
    isPrimary: false,
  });
  tx.contact.update.mockImplementation(({ data }) => Promise.resolve({
    id: 9,
    companyId: 7,
    name: 'Casey',
    email: 'casey@example.test',
    isPrimary: false,
    ...data,
  }));
  tx.$queryRaw
    .mockResolvedValueOnce([{ locked: 1 }])
    .mockResolvedValue([]);
});

describe('findUniqueContactByEmail', () => {
  it('performs a bounded case-insensitive lookup', async () => {
    const contact = {
      id: 9,
      companyId: 7,
      name: 'Casey',
      email: 'Casey@Example.Test',
    };
    queryRaw.mockResolvedValue([contact]);

    await expect(
      findUniqueContactByEmail('  casey@example.test  '),
    ).resolves.toBe(contact);
    const sql = queryRaw.mock.calls[0][0];
    expect(sql.strings.join(' ')).toContain('lower(btrim(email))');
  });

  it.each([
    ['no matching contact', []],
    ['an ambiguous duplicate address', [{ id: 1 }, { id: 2 }]],
  ])('fails closed for %s', async (_label, rows) => {
    queryRaw.mockResolvedValue(rows);
    await expect(
      findUniqueContactByEmail('casey@example.test'),
    ).resolves.toBeNull();
  });
});

describe('portal credential revocation on Contact identity edits', () => {
  it.each([
    ['email', { email: 'new-address@example.test' }],
    ['email removal', { email: null }],
    ['company', { companyId: 8 }],
  ])('revokes sessions and unused links atomically when %s changes', async (
    _label,
    input,
  ) => {
    await updateContact(9, input, 'admin');

    expect(
      tx.$queryRaw.mock.calls.some((call) => {
        const query = call[0] as {
          strings?: readonly string[];
          join?: (separator: string) => string;
        };
        const sql = query.strings
          ? query.strings.join(' ')
          : typeof query.join === 'function'
            ? query.join(' ')
            : String(query);
        return sql.includes('pg_advisory_xact_lock');
      }),
    ).toBe(true);
    expect(tx.portalMagicLink.deleteMany).toHaveBeenCalledWith({
      where: { contactId: { in: [9] } },
    });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { contactId: { in: [9] }, scope: 'portal' },
    });
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: input,
    });
    expect(auditRecord).toHaveBeenCalled();
  });

  it.each([
    ['a cosmetic name edit', { name: 'Casey Updated' }],
    ['email casing and whitespace only', { email: ' CASEY@EXAMPLE.TEST ' }],
  ])('does not revoke for %s', async (_label, input) => {
    await updateContact(9, input, 'admin');

    expect(tx.session.deleteMany).not.toHaveBeenCalled();
    expect(tx.portalMagicLink.deleteMany).not.toHaveBeenCalled();
    if ('email' in input) {
      expect(tx.contact.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { email: 'casey@example.test' },
      });
    }
  });
});
