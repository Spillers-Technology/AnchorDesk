import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish } from '../services/realtime/eventBus';

export interface LabelInput {
  name: string;
  color?: string;
}

export function list() {
  return prisma.label.findMany({ orderBy: { name: 'asc' } });
}

export function create(input: LabelInput) {
  return prisma.label.create({ data: { name: input.name, color: input.color ?? '#6750A4' } });
}

export function update(id: number, input: Partial<LabelInput>) {
  return prisma.label.update({ where: { id }, data: input });
}

export function remove(id: number) {
  return prisma.label.delete({ where: { id } });
}

/** Idempotently tag a ticket with a label. */
export async function applyToTicket(ticketId: number, labelId: number, actorSub?: string) {
  const link = await prisma.ticketLabel.upsert({
    where: { ticketId_labelId: { ticketId, labelId } },
    create: { ticketId, labelId },
    update: {},
  });
  if (actorSub) {
    await audit.record({
      entityType: 'ticket',
      entityId: ticketId,
      action: 'update',
      changedBy: actorSub,
      newValue: { labelAdded: labelId },
    });
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (ticket) publish({ type: 'ticket.updated', ticketId, ticket, actor: actorSub, changes: { labelAdded: labelId } });
  }
  return link;
}

export async function removeFromTicket(ticketId: number, labelId: number, actorSub?: string) {
  const result = await prisma.ticketLabel.deleteMany({ where: { ticketId, labelId } });
  if (actorSub && result.count > 0) {
    await audit.record({
      entityType: 'ticket',
      entityId: ticketId,
      action: 'update',
      changedBy: actorSub,
      newValue: { labelRemoved: labelId },
    });
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (ticket) publish({ type: 'ticket.updated', ticketId, ticket, actor: actorSub, changes: { labelRemoved: labelId } });
  }
  return result;
}
