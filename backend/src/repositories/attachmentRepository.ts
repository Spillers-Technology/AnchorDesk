import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export interface CreateAttachmentInput {
  ticketId: number;
  noteId?: number;
  filename: string;
  contentType: string;
  size: number;
  storageBackend: string;
  storageKey: string;
  createdBy?: string;
  portalVisible?: boolean;
}

export function listForTicket(ticketId: number) {
  return prisma.attachment.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });
}

export function getById(id: number) {
  return prisma.attachment.findUnique({ where: { id } });
}

/** Fetch attachments by id, scoped to a ticket (drops ids that don't belong). */
export function listByIds(ticketId: number, ids: number[]) {
  return prisma.attachment.findMany({ where: { id: { in: ids }, ticketId } });
}

/**
 * Link previously-uploaded attachments to the email note that sent them.
 * The note's ticket is the ownership boundary, and the audience change is
 * audited atomically with the update.
 */
export async function attachToNote(
  ids: number[],
  noteId: number,
  portalVisible: boolean,
  actorSub: string,
) {
  if (ids.length === 0) return { count: 0 };
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.findUnique({
      where: { id: noteId },
      select: { ticketId: true },
    });
    if (!note) {
      throw Object.assign(new Error('note not found'), { statusCode: 404 });
    }
    const rows = await tx.attachment.findMany({
      where: { id: { in: ids }, ticketId: note.ticketId },
      select: { id: true, noteId: true, portalVisible: true },
    });
    const rowIds = rows.map((row) => row.id);
    if (rowIds.length === 0) return { count: 0 };

    const updated = await tx.attachment.updateMany({
      where: { id: { in: rowIds }, ticketId: note.ticketId },
      data: {
        noteId,
        ...(portalVisible ? { portalVisible: true } : {}),
      } as Prisma.AttachmentUpdateManyMutationInput,
    });
    for (const row of rows) {
      await audit.record({
        entityType: 'attachment',
        entityId: row.id,
        action: 'update',
        changedBy: actorSub,
        oldValue: {
          noteId: row.noteId,
          portalVisible: row.portalVisible,
        },
        newValue: {
          noteId,
          portalVisible: portalVisible || row.portalVisible,
        },
      }, tx);
    }
    return updated;
  });
}

export async function create(
  input: CreateAttachmentInput,
  actorSub: string,
  transaction?: Prisma.TransactionClient,
) {
  const write = async (db: Prisma.TransactionClient) => {
    const attachment = await db.attachment.create({
      data: input as Prisma.AttachmentUncheckedCreateInput,
    });
    await audit.record({
      entityType: 'attachment',
      entityId: attachment.id,
      action: 'create',
      changedBy: actorSub,
      newValue: { ticketId: attachment.ticketId, filename: attachment.filename, size: attachment.size },
    }, db);
    return attachment;
  };
  const attachment = transaction
    ? await write(transaction)
    : await prisma.$transaction(write);
  return attachment;
}

export async function remove(id: number, actorSub: string) {
  const before = await prisma.attachment.findUnique({ where: { id } });
  if (!before) return null;
  await prisma.attachment.delete({ where: { id } });
  await audit.record({
    entityType: 'attachment',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: { ticketId: before.ticketId, filename: before.filename },
  });
  return before;
}
