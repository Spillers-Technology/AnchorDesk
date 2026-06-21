/**
 * ticketMail — sends an email on behalf of a ticket and records it on the
 * timeline as an `email` note, with correct RFC 5322 threading so the
 * recipient's reply lands back on the same ticket.
 *
 * This is the orchestration seam between the ticket domain and the MailTransport
 * strategy: the route validates input and delegates here, keeping HTTP concerns
 * out of the mail/threading logic (SRP).
 *
 * Threading model:
 *  - Every outbound message gets a generated Message-ID, stored in note.externalId.
 *  - References = the full chain of known Message-IDs in the thread (ticket root
 *    + every prior email note), so multi-round replies stay glued together.
 *  - In-Reply-To = the most recent message in the thread.
 *  - replyTo = the polled IMAP mailbox for the ticket, so customer replies return
 *    to an inbox we actually ingest (imapService then matches In-Reply-To against
 *    the Message-ID we stored here).
 */
import { prisma } from '../../db/prisma';
import * as ticketRepo from '../../repositories/ticketRepository';
import * as noteRepo from '../../repositories/noteRepository';
import * as mailboxRepo from '../../repositories/mailboxRepository';
import * as attachmentRepo from '../../repositories/attachmentRepository';
import * as mailIdentityRepo from '../../repositories/mailIdentityRepository';
import { getSmtp } from '../settingsService';
import { readToBuffer } from '../storage';
import { mailTransport } from './SmtpMailTransport';
import { OutboundAttachment } from './MailTransport';
import { sanitizeEmailHtml, htmlToText } from './sanitizeHtml';
import { buildReferenceChain, generateMessageId } from './threading';

export interface SendTicketEmailInput {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Raw HTML from the composer (sanitized here before send + store). */
  html?: string;
  /** Optional plain-text body; derived from html when omitted. */
  text?: string;
  /** Display name of the technician sending (for the note author). */
  author: string;
  /** IDs of attachments already uploaded to this ticket to include + link. */
  attachmentIds?: number[];
  /** Send-from identity (a shared box or the tech's alias). Falls back to default. */
  fromIdentityId?: number;
  /** Sanitized signature HTML to append to the body (the sender's signature). */
  signatureHtml?: string;
}

/** Build the References chain + In-Reply-To for a ticket's existing thread. */
async function buildThread(ticketId: number, ticketExternalId: string | null) {
  const priorIds = await prisma.note.findMany({
    where: { ticketId, externalId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { externalId: true },
  });
  return buildReferenceChain(ticketExternalId, priorIds.map((n) => n.externalId));
}

/** Resolve the inbox replies should go to: a mailbox matching the ticket's
 *  company, else the first enabled mailbox. Null when none is configured. */
async function resolveReplyTo(companyName: string | null): Promise<string | null> {
  const boxes = await mailboxRepo.enabled();
  if (!boxes.length) return null;
  const match = companyName
    ? boxes.find((b) => b.companyName && b.companyName.toLowerCase() === companyName.toLowerCase())
    : undefined;
  return (match ?? boxes[0]).username || null;
}

export async function sendTicketEmail(ticketId: number, input: SendTicketEmailInput) {
  const ticket = await ticketRepo.getById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { statusCode: 404 });

  const smtp = await getSmtp();
  // Compose the body, then append the sender's signature (already sanitized on
  // save) so the outgoing HTML carries it without re-sanitizing it away.
  let html = input.html ? sanitizeEmailHtml(input.html) : undefined;
  if (input.signatureHtml) {
    const sig = `<br><br>${input.signatureHtml}`;
    html = (html ?? '') + sig;
  }
  const text = input.text ?? (html ? htmlToText(html) : undefined);

  // Resolve the send-from identity (header From only; envelope stays the relay).
  const identity = input.fromIdentityId ? await mailIdentityRepo.getById(input.fromIdentityId) : null;
  const from = identity?.enabled
    ? { address: identity.address, name: identity.displayName ?? undefined }
    : undefined;

  const thread = await buildThread(ticketId, ticket.externalId ?? null);
  const messageId = generateMessageId(from?.address ?? smtp.from);
  const replyTo = (await resolveReplyTo(ticket.companyName ?? null)) ?? undefined;

  // Pull bytes for any ticket attachments the composer selected, scoped to this
  // ticket so a caller can't exfiltrate another ticket's files by id.
  const attachmentIds = input.attachmentIds ?? [];
  const attachmentRows = attachmentIds.length ? await attachmentRepo.listByIds(ticketId, attachmentIds) : [];
  const attachments: OutboundAttachment[] = await Promise.all(
    attachmentRows.map(async (a) => ({
      filename: a.filename,
      content: await readToBuffer(a.storageBackend, a.storageKey),
      contentType: a.contentType,
    })),
  );

  const { messageId: sentId } = await mailTransport.send({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    from,
    subject: input.subject,
    text,
    html,
    replyTo,
    messageId,
    inReplyTo: thread.inReplyTo,
    references: thread.references,
    attachments: attachments.length ? attachments : undefined,
  });

  // Persist the message-id the transport actually used (nodemailer may keep ours
  // or substitute its own) so future replies thread against the real header.
  const storedId = sentId || messageId;
  const toStr = Array.isArray(input.to) ? input.to.join(', ') : input.to;

  const note = await noteRepo.create(
    ticketId,
    {
      noteType: 'email',
      direction: 'outbound',
      content: text ?? '(no body)',
      htmlContent: html,
      author: input.author,
      emailFrom: from?.address ?? smtp.from,
      emailTo: toStr,
      emailCc: input.cc?.join(', '),
      emailBcc: input.bcc?.join(', '),
      subject: input.subject,
      externalId: storedId,
      inReplyTo: thread.inReplyTo,
    },
    input.author
  );

  // Link the included attachments to the email note so they render in-context.
  if (attachmentRows.length) {
    await attachmentRepo.attachToNote(attachmentRows.map((a) => a.id), note.id);
  }

  return { messageId: storedId, note };
}
