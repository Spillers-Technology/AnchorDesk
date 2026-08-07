import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export interface TicketFeedbackRow {
  id: number;
  ticketId: number;
  rating: string;
  comment: string | null;
  contactId: number;
  companyId: number | null;
  teamId: number | null;
  assigneeId: number | null;
  submittedAt: Date;
}

export interface TicketFeedbackWithContact extends TicketFeedbackRow {
  contact: { id: number; name: string; email: string | null };
}

/**
 * Record the customer's words as a new immutable row. Deliberately no update
 * or delete function exists here: staff may read feedback, but never rewrite
 * or remove it. The ticket dimensions are copied under the caller's ticket
 * lock, so later reassignment cannot repaint historical feedback.
 */
export async function create(
  input: { ticketId: number; rating: string; comment?: string; contactId: number },
  actorSub: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TicketFeedbackRow> {
  const ticket = await db.ticket.findUnique({
    where: { id: input.ticketId },
    select: { companyId: true, teamId: true, assigneeId: true },
  });
  if (!ticket) throw new Error(`Ticket ${input.ticketId} not found`);

  const row = await db.ticketFeedback.create({
    data: {
      ticketId: input.ticketId,
      rating: input.rating,
      comment: input.comment,
      contactId: input.contactId,
      companyId: ticket.companyId,
      teamId: ticket.teamId,
      assigneeId: ticket.assigneeId,
    },
  });
  await audit.record({
    entityType: 'ticket_feedback',
    entityId: row.id,
    action: 'create',
    changedBy: actorSub,
    newValue: {
      ticketId: row.ticketId,
      rating: row.rating,
      comment: row.comment,
      contactId: row.contactId,
      companyId: row.companyId,
      teamId: row.teamId,
      assigneeId: row.assigneeId,
    },
  }, db);
  return row;
}

/** Staff-only read shape, oldest first so the feedback trail stays legible. */
export function listForTicket(ticketId: number): Promise<TicketFeedbackWithContact[]> {
  return prisma.ticketFeedback.findMany({
    where: { ticketId },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      ticketId: true,
      rating: true,
      comment: true,
      contactId: true,
      companyId: true,
      teamId: true,
      assigneeId: true,
      submittedAt: true,
      contact: { select: { id: true, name: true, email: true } },
    },
  });
}
