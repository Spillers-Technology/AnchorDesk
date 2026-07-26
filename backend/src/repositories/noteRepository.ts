import { NoteType } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { publish, TicketMetricContext } from '../services/realtime/eventBus';
import { clamp } from '../util/strings';

export interface CreateNoteInput {
  content: string;
  author: string;
  authorId?: number;
  noteType?: NoteType;
  timeStart?: Date;
  timeStop?: Date;
  /** Explicit recorded work date for a duration-only entry. A windowed entry
   * always records timeStart as workedAt. */
  workedAt?: Date;
  minutes?: number;
  /** Remote/provider occurrence time. Internal callers only. */
  createdAt?: Date;
  externalId?: string;
  /** Explicit customer-visible outbound comment. Never infer this from
   * noteType: RMM/script notes also use `note` and must remain local. */
  queueForTicketSync?: boolean;
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
  workedAt?: Date;
  minutes?: number | null;
}

export class ExternalNoteImmutableError extends Error {
  constructor() {
    super('queued or externally linked customer notes cannot be edited or deleted');
    this.name = 'ExternalNoteImmutableError';
  }
}

export class InvalidTimeEntryMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTimeEntryMutationError';
  }
}

function isExternallyImmutable(note: { syncPending: boolean; externalId: string | null; noteType: NoteType }) {
  return note.syncPending || (note.noteType === 'note' && note.externalId != null);
}

/** Sum of logged minutes (time_entry notes) on a ticket. */
export async function timeTotalForTicket(ticketId: number): Promise<number> {
  const r = await prisma.note.aggregate({ where: { ticketId, noteType: 'time_entry' }, _sum: { minutes: true } });
  return r._sum.minutes ?? 0;
}

/** Time-entry rows for one ticket, oldest work date first. */
export function listTimeEntriesForTicket(ticketId: number) {
  return prisma.note.findMany({
    where: { ticketId, noteType: 'time_entry' },
    orderBy: [{ workedAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * A user's time entries that fall within [from, to) — the data behind the "My
 * Day" spread. Membership in the day is the recorded `workedAt`; the window is
 * still carried separately for entries that can be positioned on a clock.
 */
export function listTimeEntriesForUser(userId: number, from: Date, to: Date) {
  return prisma.note.findMany({
    where: {
      authorId: userId,
      noteType: 'time_entry',
      workedAt: { gte: from, lt: to },
    },
    orderBy: [{ workedAt: 'asc' }, { id: 'asc' }],
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
  const recordedAt = input.createdAt ?? new Date();
  const isTimeEntry = input.noteType === 'time_entry';
  if (isTimeEntry && input.timeStart && input.workedAt) {
    throw new InvalidTimeEntryMutationError(
      'workedAt is only accepted for duration-only entries; a window uses timeStart',
    );
  }
  const recordedWorkedAt = isTimeEntry
    ? input.timeStart ?? input.workedAt ?? recordedAt
    : undefined;

  const result = await prisma.$transaction(async (tx) => {
    // Serialize with ticket updates before capturing report dimensions. Without
    // this lock, a concurrent company/assignee change could make a note fact
    // describe a state that was never actually in force at its occurrence.
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE
    `;
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: {
        externalId: true,
        externalProvider: true,
        companyId: true,
        teamId: true,
        assigneeId: true,
        priority: true,
        status: true,
      },
    });
    const queuedForSync = Boolean(
      input.queueForTicketSync &&
      ticket?.externalId &&
      (ticket.externalProvider === 'jira' || ticket.externalProvider === 'connectwise')
    );

    const row = await tx.note.create({
      data: {
        ticketId,
        content: input.content,
        author: clamp(input.author, 150),
        authorId: input.authorId,
        noteType: input.noteType ?? 'note',
        timeStart: input.timeStart,
        timeStop: input.timeStop,
        workedAt: recordedWorkedAt,
        minutes: input.minutes,
        createdAt: recordedAt,
        // Clamp the bounded VarChar columns so a long Message-ID / subject from the
        // wild can't overflow and 500 the insert (columns are 255/320; see schema).
        externalId: clamp(input.externalId, 255),
        syncPending: queuedForSync,
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

    const auditRow = await audit.record({
      entityType: 'note',
      entityId: row.id,
      action: 'create',
      changedBy: actorSub,
      newValue: row as unknown as Record<string, unknown>,
    }, tx);

    // First outbound email is the customer-facing "first response" — stop the SLA
    // response clock once. Guarded on null so later replies don't move it.
    let firstResponseRecorded = false;
    if (row.noteType === 'email' && row.direction === 'outbound') {
      const stamped = await tx.ticket.updateMany({
        where: { id: ticketId, firstRespondedAt: null },
        data: { firstRespondedAt: row.createdAt },
      });
      firstResponseRecorded = stamped.count === 1;
    }
    const context: TicketMetricContext | undefined = ticket
      ? {
          companyId: ticket.companyId,
          teamId: ticket.teamId,
          assigneeId: ticket.assigneeId,
          priority: ticket.priority,
          status: ticket.status,
          occurredAt: row.createdAt,
        }
      : undefined;
    return {
      note: row,
      auditId: auditRow?.id.toString(),
      firstResponseRecorded,
      context,
    };
  });
  const { note, auditId, firstResponseRecorded, context } = result;

  publish({
    type: 'note.added',
    ticketId,
    note,
    actor: actorSub,
    auditId,
    firstResponseRecorded,
    metricContext: context,
  });
  return note;
}

export async function update(id: number, ticketId: number, input: UpdateNoteInput, actorSub: string) {
  const before = await prisma.note.findFirst({ where: { id, ticketId } });
  if (!before) return null;
  if (isExternallyImmutable(before)) throw new ExternalNoteImmutableError();
  const touchesTime =
    input.timeStart !== undefined ||
    input.timeStop !== undefined ||
    input.workedAt !== undefined ||
    input.minutes !== undefined;
  if (touchesTime && before.noteType !== 'time_entry') {
    throw new InvalidTimeEntryMutationError('time fields may only be changed on time entries');
  }
  if (input.timeStart instanceof Date && input.workedAt) {
    throw new InvalidTimeEntryMutationError(
      'workedAt is only accepted for duration-only entries; a window uses timeStart',
    );
  }

  const note = await prisma.note.update({
    where: { id },
    // Explicit field projection: runtime request objects must never be able to
    // mutate ticket ownership, remote provenance, author, direction, or type.
    data: {
      content: input.content,
      htmlContent: input.htmlContent,
      timeStart: input.timeStart,
      timeStop: input.timeStop,
      // Explicit work date wins. Moving a start window moves the work date when
      // no explicit override is supplied; clearing the window preserves the
      // already-recorded work date instead of silently moving it to createdAt.
      workedAt:
        input.workedAt !== undefined
          ? input.workedAt
          : input.timeStart instanceof Date
            ? input.timeStart
            : undefined,
      minutes: input.minutes,
    },
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

export async function remove(id: number, ticketId: number, actorSub: string) {
  const before = await prisma.note.findFirst({ where: { id, ticketId } });
  if (!before) return null;
  if (isExternallyImmutable(before)) throw new ExternalNoteImmutableError();

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
