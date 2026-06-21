import { prisma } from '../db/prisma';

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
export function applyToTicket(ticketId: number, labelId: number) {
  return prisma.ticketLabel.upsert({
    where: { ticketId_labelId: { ticketId, labelId } },
    create: { ticketId, labelId },
    update: {},
  });
}

export function removeFromTicket(ticketId: number, labelId: number) {
  return prisma.ticketLabel.deleteMany({ where: { ticketId, labelId } });
}
