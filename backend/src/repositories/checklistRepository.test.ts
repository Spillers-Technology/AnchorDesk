/**
 * Checklist contracts:
 *  - applyTemplate copies items in order, appends after existing items, and
 *    computes each dueAt from the item's relative offset at apply time
 *  - toggling done stamps doneBy/doneAt; un-toggling clears both
 *  - every mutation audits against the ticket and publishes a live event
 */
jest.mock('../db/prisma', () => ({
  prisma: {
    checklistItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    checklistTemplate: {
      findFirst: jest.fn(),
    },
    ticket: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

jest.mock('../services/realtime/eventBus', () => ({
  publish: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish } from '../services/realtime/eventBus';
import { add, applyTemplate, update } from './checklistRepository';

const mocked = prisma as unknown as {
  checklistItem: Record<string, jest.Mock>;
  checklistTemplate: Record<string, jest.Mock>;
  ticket: Record<string, jest.Mock>;
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.ticket.findUnique.mockResolvedValue({ id: 7 });
  mocked.checklistItem.findMany.mockResolvedValue([]);
});

describe('applyTemplate', () => {
  it('copies items in order with offset-derived deadlines, appended after existing items', async () => {
    mocked.checklistTemplate.findFirst.mockResolvedValue({
      id: 3,
      name: 'Onboard workstation',
      items: [
        { text: 'Join domain', sortOrder: 0, dueOffsetMinutes: 60 },
        { text: 'Install agent', sortOrder: 1, dueOffsetMinutes: null },
      ],
    });
    mocked.checklistItem.findFirst.mockResolvedValue({ sortOrder: 4 });
    mocked.checklistItem.createMany.mockResolvedValue({ count: 2 });

    const before = Date.now();
    await applyTemplate(7, 3, 'alice');
    const rows = mocked.checklistItem.createMany.mock.calls[0][0].data;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ticketId: 7, text: 'Join domain', sortOrder: 5, templateId: 3 });
    expect(rows[1]).toMatchObject({ text: 'Install agent', sortOrder: 6, dueAt: null });
    // dueAt = apply time + 60 minutes (allow scheduling slack around `before`).
    const due = rows[0].dueAt.getTime();
    expect(due).toBeGreaterThanOrEqual(before + 59 * 60_000);
    expect(due).toBeLessThanOrEqual(before + 61 * 60_000);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'ticket',
      entityId: 7,
      newValue: { checklistTemplateApplied: 'Onboard workstation', items: 2 },
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'ticket.updated', ticketId: 7 }));
  });

  it('returns null for a missing or inactive template without writing', async () => {
    mocked.checklistTemplate.findFirst.mockResolvedValue(null);
    expect(await applyTemplate(7, 99, 'alice')).toBeNull();
    expect(mocked.checklistItem.createMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('update (done toggling)', () => {
  it('stamps doneBy/doneAt when marking done', async () => {
    mocked.checklistItem.findFirst.mockResolvedValue({ id: 11, ticketId: 7, text: 'x', done: false, dueAt: null });
    mocked.checklistItem.update.mockResolvedValue({ id: 11, done: true });

    await update(7, 11, { done: true }, 'bob');
    const data = mocked.checklistItem.update.mock.calls[0][0].data;
    expect(data.done).toBe(true);
    expect(data.doneBy).toBe('bob');
    expect(data.doneAt).toBeInstanceOf(Date);
  });

  it('clears attribution when un-marking done', async () => {
    mocked.checklistItem.findFirst.mockResolvedValue({ id: 11, ticketId: 7, text: 'x', done: true, dueAt: null });
    mocked.checklistItem.update.mockResolvedValue({ id: 11, done: false });

    await update(7, 11, { done: false }, 'bob');
    const data = mocked.checklistItem.update.mock.calls[0][0].data;
    expect(data.doneBy).toBeNull();
    expect(data.doneAt).toBeNull();
  });

  it('leaves attribution untouched when done is not changing', async () => {
    mocked.checklistItem.findFirst.mockResolvedValue({ id: 11, ticketId: 7, text: 'x', done: true, dueAt: null });
    mocked.checklistItem.update.mockResolvedValue({ id: 11 });

    await update(7, 11, { text: 'renamed', done: true }, 'bob');
    const data = mocked.checklistItem.update.mock.calls[0][0].data;
    expect(data.doneBy).toBeUndefined();
    expect(data.doneAt).toBeUndefined();
  });
});

describe('add', () => {
  it('appends after the highest sortOrder and audits against the ticket', async () => {
    mocked.checklistItem.findFirst.mockResolvedValue({ sortOrder: 2 });
    mocked.checklistItem.create.mockResolvedValue({ id: 20, text: 'Call the customer' });

    await add(7, { text: '  Call the customer  ' }, 'carol');
    expect(mocked.checklistItem.create).toHaveBeenCalledWith({
      data: { ticketId: 7, text: 'Call the customer', dueAt: null, sortOrder: 3 },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityId: 7, changedBy: 'carol' }));
  });
});
