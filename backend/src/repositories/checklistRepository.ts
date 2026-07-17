/**
 * A ticket's working checklist. Every mutation is audited against the TICKET
 * (so items show up in ticket history) and published as ticket.updated with a
 * checklist change tag, so open modals and lists live-update. Item dueAt is an
 * independent per-item deadline — it never feeds the ticket's SLA/manual
 * clocks.
 */
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish } from '../services/realtime/eventBus';

export interface ChecklistItemInput {
  text: string;
  dueAt?: Date | null;
}

export interface ChecklistItemUpdate {
  text?: string;
  done?: boolean;
  dueAt?: Date | null;
  sortOrder?: number;
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

async function notifyTicket(ticketId: number, actorSub: string, change: Record<string, unknown>) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (ticket) {
    publish({ type: 'ticket.updated', ticketId, ticket, actor: actorSub, changes: { checklist: change } });
  }
}

export function listForTicket(ticketId: number) {
  return prisma.checklistItem.findMany({
    where: { ticketId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

export async function add(ticketId: number, input: ChecklistItemInput, actorSub: string) {
  const last = await prisma.checklistItem.findFirst({
    where: { ticketId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  const item = await prisma.checklistItem.create({
    data: {
      ticketId,
      text: clamp(input.text.trim(), 500),
      dueAt: input.dueAt ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  await audit.record({
    entityType: 'ticket',
    entityId: ticketId,
    action: 'update',
    changedBy: actorSub,
    newValue: { checklistItemAdded: item.text },
  });
  await notifyTicket(ticketId, actorSub, { added: item.id });
  return item;
}

export async function update(ticketId: number, itemId: number, input: ChecklistItemUpdate, actorSub: string) {
  const before = await prisma.checklistItem.findFirst({ where: { id: itemId, ticketId } });
  if (!before) return null;
  // Toggling done stamps who/when; un-toggling clears both.
  const doneFields =
    input.done === undefined || input.done === before.done
      ? {}
      : input.done
        ? { doneBy: actorSub, doneAt: new Date() }
        : { doneBy: null, doneAt: null };
  const item = await prisma.checklistItem.update({
    where: { id: itemId },
    data: {
      text: input.text !== undefined ? clamp(input.text.trim(), 500) : undefined,
      done: input.done,
      dueAt: input.dueAt,
      sortOrder: input.sortOrder,
      ...doneFields,
    },
  });
  await audit.record({
    entityType: 'ticket',
    entityId: ticketId,
    action: 'update',
    changedBy: actorSub,
    oldValue: { checklistItem: itemId, text: before.text, done: before.done, dueAt: before.dueAt },
    newValue: { checklistItem: itemId, text: item.text, done: item.done, dueAt: item.dueAt },
  });
  await notifyTicket(ticketId, actorSub, { updated: itemId });
  return item;
}

export async function remove(ticketId: number, itemId: number, actorSub: string) {
  const before = await prisma.checklistItem.findFirst({ where: { id: itemId, ticketId } });
  if (!before) return false;
  await prisma.checklistItem.delete({ where: { id: itemId } });
  await audit.record({
    entityType: 'ticket',
    entityId: ticketId,
    action: 'update',
    changedBy: actorSub,
    oldValue: { checklistItemRemoved: before.text },
  });
  await notifyTicket(ticketId, actorSub, { removed: itemId });
  return true;
}

/**
 * Copy a template's items onto a ticket, in template order, appended after any
 * existing items. Each item's dueAt = now + its dueOffsetMinutes (no offset =
 * no deadline). Returns null when the template is missing/inactive.
 */
export async function applyTemplate(ticketId: number, templateId: number, actorSub: string) {
  const template = await prisma.checklistTemplate.findFirst({
    where: { id: templateId, active: true },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!template) return null;
  const last = await prisma.checklistItem.findFirst({
    where: { ticketId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  const base = (last?.sortOrder ?? -1) + 1;
  const now = Date.now();
  await prisma.checklistItem.createMany({
    data: template.items.map((item, index) => ({
      ticketId,
      text: item.text,
      sortOrder: base + index,
      dueAt: item.dueOffsetMinutes != null ? new Date(now + item.dueOffsetMinutes * 60_000) : null,
      templateId: template.id,
    })),
  });
  await audit.record({
    entityType: 'ticket',
    entityId: ticketId,
    action: 'update',
    changedBy: actorSub,
    newValue: { checklistTemplateApplied: template.name, items: template.items.length },
  });
  await notifyTicket(ticketId, actorSub, { templateApplied: template.id });
  return listForTicket(ticketId);
}
