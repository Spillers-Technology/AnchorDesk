const tx = {
  $queryRaw: jest.fn(),
  ticket: { create: jest.fn() },
};

jest.mock('../db/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

jest.mock('../services/realtime/eventBus', () => ({
  publish: jest.fn(),
}));

jest.mock('../services/companyResolution', () => ({
  resolveTicketCompany: jest.fn(),
}));

jest.mock('../services/sla', () => ({
  computeSlaFields: jest.fn(),
  effectiveResolutionDueAt: jest.fn(),
}));

jest.mock('../services/settingsService', () => ({
  getTickets: jest.fn(),
}));

jest.mock('../services/customFields', () => ({
  mergeCustomFields: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish } from '../services/realtime/eventBus';
import { resolveTicketCompany } from '../services/companyResolution';
import { computeSlaFields } from '../services/sla';
import { getTickets } from '../services/settingsService';
import { mergeCustomFields } from '../services/customFields';
import { create } from './ticketRepository';

const transaction = prisma.$transaction as jest.Mock;
const nextNumber = prisma.$queryRaw as jest.Mock;
const auditRecord = audit.record as jest.Mock;
const publishEvent = publish as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (resolveTicketCompany as jest.Mock).mockResolvedValue({
    id: 7,
    name: 'Example Co',
  });
  (computeSlaFields as jest.Mock).mockResolvedValue({
    slaPolicyId: null,
    responseDueAt: null,
    resolutionDueAt: null,
  });
  (getTickets as jest.Mock).mockResolvedValue({ numberDigits: 5 });
  (mergeCustomFields as jest.Mock).mockResolvedValue(null);
  nextNumber.mockResolvedValue([{ nextval: 10042n }]);
  tx.$queryRaw.mockResolvedValue([{ id: 9 }]);
  tx.ticket.create.mockResolvedValue({
    id: 42,
    title: 'Printer offline',
    companyId: 7,
    contactId: 9,
    source: 'portal',
  });
  auditRecord.mockResolvedValue(undefined);
  transaction.mockImplementation(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
});

describe('ticket creation transaction boundary', () => {
  it('locks a requester identity and commits the insert with its audit', async () => {
    await create(
      {
        title: 'Printer offline',
        companyId: 7,
        contactId: 9,
        source: 'portal',
      },
      'requester:9 (portal)',
      {
        requester: {
          contactId: 9,
          companyId: 7,
          email: 'casey@example.test',
        },
      },
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.ticket.create).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ticket',
        entityId: 42,
        changedBy: 'requester:9 (portal)',
      }),
      tx,
    );
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.created', ticketId: 42 }),
    );
  });

  it('does not publish when the in-transaction audit fails', async () => {
    auditRecord.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      create({ title: 'Printer offline', companyId: 7 }, 'alice'),
    ).rejects.toThrow('audit unavailable');
    expect(publishEvent).not.toHaveBeenCalled();
  });
});
