import { sanitizeEmailHtml } from './mail/sanitizeHtml';

export interface PortalNoteDto {
  id: number;
  content: string;
  htmlContent: string | null;
  direction: string | null;
  createdAt: string;
  authorKind: 'you' | 'support';
}

export interface PortalAttachmentDto {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  downloadUrl: string;
}

export interface PortalTicketDto {
  id: number;
  ticketNumber: string | null;
  title: string;
  summary: string;
  description: string | null;
  status: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  notes: PortalNoteDto[];
  attachments: PortalAttachmentDto[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

function iso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return '';
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  const valueAsIso = iso(value);
  return valueAsIso || null;
}

function isPortalVisibleNote(value: unknown): boolean {
  const note = record(value);
  return (
    note.visibility === 'public' &&
    (note.noteType === 'note' || note.noteType === 'email')
  );
}

function isPortalVisibleAttachment(value: unknown): boolean {
  const attachment = record(value);
  if (attachment.portalVisible !== true) return false;
  if (attachment.noteId == null) return true;
  const note = record(attachment.note);
  return (
    note.visibility === 'public' &&
    (note.noteType === 'note' || note.noteType === 'email')
  );
}

/**
 * Stored mail HTML points at the staff attachment tree. Portal sessions must
 * never be admitted there, so public-note HTML uses the requester-owned download
 * tree instead. The download handler still re-checks ownership and visibility.
 */
function portalAttachmentUrls(html: string): string {
  return html.replace(
    /\/api\/attachments\/(\d+)\/download\b/g,
    '/api/portal/attachments/$1/download',
  );
}

export function serializePortalNote(value: unknown): PortalNoteDto {
  const note = record(value);
  const via = text(note.via) || (note.noteType === 'email' ? 'email' : 'staff');
  const direction = text(note.direction);
  const authorKind: PortalNoteDto['authorKind'] =
    via === 'portal' || (note.noteType === 'email' && direction === 'inbound')
      ? 'you'
      : 'support';
  const rawHtml = nullableText(note.htmlContent);

  return {
    id: integer(note.id),
    content: text(note.content),
    htmlContent: rawHtml ? sanitizeEmailHtml(portalAttachmentUrls(rawHtml)) : null,
    direction: nullableText(note.direction),
    createdAt: iso(note.createdAt),
    authorKind,
  };
}

export function serializePortalAttachment(value: unknown): PortalAttachmentDto {
  const attachment = record(value);
  const id = integer(attachment.id);
  return {
    id,
    filename: text(attachment.filename),
    contentType: text(attachment.contentType, 'application/octet-stream'),
    size: integer(attachment.size),
    createdAt: iso(attachment.createdAt),
    downloadUrl: `/api/portal/attachments/${id}/download`,
  };
}

/**
 * This is the security boundary: an explicit object literal, never a spread of a
 * Prisma Ticket. New Ticket fields therefore remain private by default.
 */
export function serializePortalTicket(value: unknown): PortalTicketDto {
  const ticket = record(value);
  const notes = Array.isArray(ticket.notes)
    ? ticket.notes.filter(isPortalVisibleNote).map(serializePortalNote)
    : [];
  const attachments = Array.isArray(ticket.attachments)
    ? ticket.attachments
      .filter(isPortalVisibleAttachment)
      .map(serializePortalAttachment)
    : [];

  return {
    id: integer(ticket.id),
    ticketNumber: nullableText(ticket.ticketNumber),
    title: text(ticket.title),
    summary: text(ticket.summary) || text(ticket.title),
    description: nullableText(ticket.description),
    status: text(ticket.status),
    priority: nullableText(ticket.priority),
    createdAt: iso(ticket.createdAt),
    updatedAt: iso(ticket.updatedAt),
    closedAt: nullableIso(ticket.closedAt),
    notes,
    attachments,
  };
}
