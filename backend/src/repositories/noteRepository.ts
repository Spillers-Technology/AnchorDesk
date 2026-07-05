import { NoteType } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish } from '../services/realtime/eventBus';
import { clamp } from '../util/strings';

export interface CreateNoteInput {
  content: string;
  author: string;
  authorId?: number;
  noteType?: NoteType;
  timeStart?: Date;
  timeStop?: Date;
  minutes?: number;
  externalId?: string;
  // Email correspondence metadata (noteType = 'email').
  direction?: 'inbound' | 'outbound';
  htmlContent?: string;
  emailFrom?: string;
  emailTo?: string;
  emailCc?: string;
  emailBcc?: string;
  subject?: string;
  inReplyTo?: string;
}

export interface UpdateNoteInput {
  content?: string;
  htmlContent?: string | null;
  timeStart?: Date | null;
  timeStop?: Date | null;
  minutes?: number | null;
}

/** Sum of logged minutes (time_entry notes) on a ticket. */
export async function timeTotalForTicket(ticketId: number): Promise<number> {
  const r = await prisma.note.aggregate({ where: { ticketId, noteType: 'time_entry' }, _sum: { minutes: true } });
  return r._sum.minutes ?? 0;
}

/**
 * A user's time entries that fall within [from, to) — the data behind the "My
 * Day" spread. An entry's position on the day is its `timeStart` when it has a
 * logged window; duration-only entries (no window) are anchored by `createdAt`
 * so they still count toward the day even though they can't be placed on the
 * clock. The ticket is included so each block can label which ticket it's for.
 */
export function listTimeEntriesForUser(userId: number, from: Date, to: Date) {
  return prisma.note.findMany({
    where: {
      authorId: userId,
      noteType: 'time_entry',
      OR: [
        { timeStart: { gte: from, lt: to } },
        { timeStart: null, createdAt: { gte: from, lt: to } },
      ],
    },
    orderBy: [{ timeStart: 'asc' }, { createdAt: 'asc' }],
    include: { ticket: { select: { id: true, ticketNumber: true, title: true } } },
  });
}

export async function listForTicket(ticketId: number) {
  return prisma.note.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'asc' },
    include: { authorUser: true },
  });
}

export async function create(ticketId: number, input: CreateNoteInput, actorSub: string) {
  const note = await prisma.note.create({
    data: {
      ticketId,
      content: input.content,
      author: clamp(input.author, 150),
      authorId: input.authorId,
      noteType: input.noteType ?? 'note',
      timeStart: input.timeStart,
      timeStop: input.timeStop,
      minutes: input.minutes,
      // Clamp the bounded VarChar columns so a long Message-ID / subject from the
      // wild can't overflow and 500 the insert (columns are 255/320; see schema).
      externalId: clamp(input.externalId, 255),
      direction: input.direction,
      htmlContent: input.htmlContent,
      emailFrom: clamp(input.emailFrom, 320),
      emailTo: input.emailTo,
      emailCc: input.emailCc,
      emailBcc: input.emailBcc,
      subject: clamp(input.subject, 255),
      inReplyTo: clamp(input.inReplyTo, 255),
    },
  });

  await audit.record({
    entityType: 'note',
    entityId: note.id,
    action: 'create',
    changedBy: actorSub,
    newValue: note as unknown as Record<string, unknown>,
  });

  // First outbound email is the customer-facing "first response" — stop the SLA
  // response clock once. Guarded on null so later replies don't move it.
  if (note.noteType === 'email' && note.direction === 'outbound') {
    await prisma.ticket.updateMany({
      where: { id: ticketId, firstRespondedAt: null },
      data: { firstRespondedAt: note.createdAt },
    });
  }

  publish({ type: 'note.added', ticketId, note, actor: actorSub });
  return note;
}

export async function update(id: number, input: UpdateNoteInput, actorSub: string) {
  const before = await prisma.note.findUnique({ where: { id } });
  if (!before) return null;

  const note = await prisma.note.update({
    where: { id },
    data: { ...input },
  });

  await audit.record({
    entityType: 'note',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: before as unknown as Record<string, unknown>,
    newValue: note as unknown as Record<string, unknown>,
  });

  return note;
}

export async function remove(id: number, actorSub: string) {
  const before = await prisma.note.findUnique({ where: { id } });
  if (!before) return null;

  await prisma.note.delete({ where: { id } });

  await audit.record({
    entityType: 'note',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: before as unknown as Record<string, unknown>,
  });

  return before;
}
