/**
 * IMAP email-to-ticket. Polls a mailbox, and for each new message either opens
 * a ticket (new thread) or appends a note (reply to a known thread).
 *
 * Threading: we tag every ingested message's note with the email Message-ID in
 * note.externalId, and the root ticket with externalId = root Message-ID. A
 * reply's In-Reply-To / References are matched against those, so replies land on
 * the original ticket instead of spawning duplicates.
 *
 * Dedup: mailbox.lastUid tracks the highest processed IMAP UID, so a message
 * becomes at most one ticket/note even across restarts.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { Mailbox } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as mailboxRepo from '../repositories/mailboxRepository';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import * as attachmentRepo from '../repositories/attachmentRepository';
import * as labelRepo from '../repositories/labelRepository';
import { currentStorage, buildKey } from './storage';
import { sanitizeEmailHtml } from './mail/sanitizeHtml';
import { ticketNumberFromSubject } from './mail/threading';
import { clamp } from '../util/strings';
import { findOrCreateCompanyForEmail } from './companyResolution';

export interface PollResult {
  mailbox: string;
  processed: number;
  created: number;
  appended: number;
  /** Messages skipped as already-ingested duplicates (same Message-ID). */
  skipped: number;
  error?: string;
}

function refsOf(parsed: ParsedMail): string[] {
  const refs: string[] = [];
  if (parsed.inReplyTo) refs.push(parsed.inReplyTo);
  if (parsed.references) {
    refs.push(...(Array.isArray(parsed.references) ? parsed.references : [parsed.references]));
  }
  return refs.filter(Boolean).map((id) => clamp(id, 255));
}

function bodyOf(parsed: ParsedMail): string {
  if (parsed.text && parsed.text.trim()) return parsed.text.trim();
  if (parsed.html) return parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return '(no body)';
}

async function ingest(parsed: ParsedMail, mb: Mailbox, uid: number): Promise<'created' | 'appended' | 'duplicate'> {
  const messageId = clamp(parsed.messageId || `<imap-${mb.id}-${uid}@local>`, 255);

  // Idempotency on the message's OWN Message-ID. The same email is routinely
  // delivered to two monitored mailboxes (e.g. help@ + a personal alias) under a
  // single Message-ID, and a re-poll can replay a UID. We store that Message-ID
  // as the ingested note's externalId (and the root ticket's external_id), so if a
  // note already carries it the message is fully ingested — skip it. Without this
  // guard the second delivery collides on the (external_id, external_provider)
  // unique index, 500s the whole poll (Prisma P2002), and — because lastUid never
  // advances past it — wedges the mailbox on that "poison" message forever.
  const seen = await prisma.note.findFirst({ where: { externalId: messageId }, select: { id: true } });
  if (seen) return 'duplicate';

  const fromText = parsed.from?.text || 'unknown sender';
  const body = bodyOf(parsed);
  const subject = parsed.subject || '(no subject)';
  const toText = parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((a) => a.text).join(', ') : parsed.to.text) : undefined;

  // Resolve the thread (reply to a known ticket) or open a new one. We need the
  // ticketId BEFORE storing attachments so inline images can be keyed to it and
  // their cid: references rewritten in the HTML.
  const refs = refsOf(parsed);
  let ticketId: number | null = null;
  if (refs.length) {
    const note = await prisma.note.findFirst({ where: { externalId: { in: refs } }, select: { ticketId: true } });
    ticketId = note?.ticketId ?? null;
    if (!ticketId) {
      const t = await prisma.ticket.findFirst({
        where: { externalId: { in: refs }, externalProvider: 'imap' },
        select: { id: true },
      });
      ticketId = t?.id ?? null;
    }
  }
  // Fallback threading: a `[#NNNNN]` token in the subject re-attaches a reply to
  // its ticket even when References/In-Reply-To were stripped en route.
  if (!ticketId) {
    const num = ticketNumberFromSubject(subject);
    if (num) {
      const t = await ticketRepo.findByNumber(num);
      ticketId = t?.id ?? null;
    }
  }

  let outcome: 'created' | 'appended';
  if (ticketId) {
    outcome = 'appended';
  } else {
    try {
      const senderAddress = parsed.from?.value.find((entry) => entry.address)?.address;
      const senderCompany = mb.companyName
        ? null
        : await findOrCreateCompanyForEmail(senderAddress ?? '', 'imap');
      const ticket = await ticketRepo.create(
        {
          title: clamp(subject, 255),
          summary: clamp(body, 200),
          description: body,
          companyId: senderCompany?.id,
          companyName: mb.companyName ?? senderCompany?.name,
          source: 'imap',
          externalId: messageId,
          externalProvider: 'imap',
        },
        'imap'
      );
      ticketId = ticket.id;
      // Tag the new ticket with this mailbox's label (catchall vs help@ vs personal).
      if (mb.labelId) await labelRepo.applyToTicket(ticket.id, mb.labelId, 'imap').catch(() => {});
      outcome = 'created';
    } catch (err) {
      // Belt-and-suspenders for the (external_id, external_provider) unique index:
      // a concurrent/earlier ingest created this root ticket but left no matching
      // note for the idempotency check above to catch. Recover by appending to the
      // existing ticket rather than failing the whole poll.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const existing = await prisma.ticket.findFirst({
        where: { externalId: messageId, externalProvider: 'imap' },
        select: { id: true },
      });
      if (!existing) throw err;
      ticketId = existing.id;
      outcome = 'appended';
    }
  }

  // Store attachments (incl. inline images), then rewrite cid: refs in the HTML
  // to the stored attachment URLs so inline images render from our store.
  const stored = await storeInboundAttachments(ticketId, parsed);
  const html = parsed.html ? sanitizeEmailHtml(rewriteCidRefs(parsed.html, stored)) : undefined;

  // Email correspondence is recorded as an `email` note so the UI renders it as a
  // conversation (with from/to/subject + sanitized HTML), distinct from internal notes.
  const note = await noteRepo.create(
    ticketId,
    {
      noteType: 'email',
      direction: 'inbound',
      content: body,
      htmlContent: html,
      author: fromText,
      emailFrom: fromText,
      emailTo: toText,
      subject,
      externalId: messageId,
      inReplyTo: clamp(parsed.inReplyTo, 255),
    },
    'imap'
  );
  if (stored.length) await attachmentRepo.attachToNote(stored.map((s) => s.id), note.id);
  return outcome;
}

interface StoredAttachment { id: number; cid?: string }

/**
 * Persist a parsed email's attachments (regular files AND inline cid: images)
 * into the configured storage backend, linked to the ticket. Returns the new
 * attachment ids plus each inline part's content-id so the HTML can be rewritten.
 * Failures are swallowed per-file so one bad part doesn't abort ticket ingest.
 */
async function storeInboundAttachments(ticketId: number, parsed: ParsedMail): Promise<StoredAttachment[]> {
  const files = (parsed.attachments ?? []).filter((a) => a.content);
  if (!files.length) return [];
  const storage = await currentStorage();
  const out: StoredAttachment[] = [];
  for (const file of files) {
    const filename = file.filename || `attachment-${file.checksum?.slice(0, 8) || 'file'}`;
    try {
      const key = buildKey(ticketId, filename);
      const contentType = file.contentType || 'application/octet-stream';
      await storage.put(key, file.content, contentType);
      const row = await attachmentRepo.create(
        {
          ticketId,
          filename,
          contentType,
          size: file.size ?? file.content.length,
          storageBackend: storage.backend,
          storageKey: key,
          createdBy: 'imap',
        },
        'imap',
      );
      out.push({ id: row.id, cid: file.cid });
    } catch {
      /* skip a single failed attachment; the ticket/note already exist */
    }
  }
  return out;
}

/** Replace `cid:<content-id>` image sources with their stored attachment URLs. */
function rewriteCidRefs(html: string, stored: StoredAttachment[]): string {
  let out = html;
  for (const s of stored) {
    if (!s.cid) continue;
    const url = `/api/attachments/${s.id}/download`;
    // Match cid:CID inside src="" / src='' regardless of surrounding quotes.
    const pattern = new RegExp(`cid:${s.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    out = out.replace(pattern, url);
  }
  return out;
}

/**
 * Turn an ImapFlow error into something actionable. ImapFlow's `.message` for a
 * rejected command is just "Command failed" — the real reason lives in
 * `.responseText` / `.serverResponseCode` / `.authenticationFailed`. Surfacing
 * those is the difference between "Command failed" and "Authentication failed —
 * check the app-specific password / IMAP access" in the mailbox's last error.
 */
function describeImapError(err: unknown): string {
  const e = err as {
    message?: string;
    responseText?: string;
    serverResponseCode?: string;
    authenticationFailed?: boolean;
    code?: string;
  };
  const parts: string[] = [];
  if (e.authenticationFailed) parts.push('Authentication failed');
  if (e.responseText) parts.push(e.responseText);
  else if (e.message) parts.push(e.message);
  if (e.serverResponseCode) parts.push(`[${e.serverResponseCode}]`);
  else if (e.code && e.code !== e.serverResponseCode) parts.push(`[${e.code}]`);
  const msg = parts.join(' ').trim();
  return msg || 'Unknown IMAP error';
}

/** Poll one mailbox for new mail. Connection errors are captured, not thrown. */
export async function pollMailbox(mb: Mailbox): Promise<PollResult> {
  const result: PollResult = { mailbox: mb.name, processed: 0, created: 0, appended: 0, skipped: 0 };
  const password = mailboxRepo.password(mb);
  if (!password) {
    result.error = 'No password configured';
    await mailboxRepo.recordPoll(mb.id, undefined, result.error);
    return result;
  }

  const client = new ImapFlow({
    host: mb.host,
    port: mb.port,
    secure: mb.secure,
    auth: { user: mb.username, pass: password },
    logger: false,
  });

  let highest = mb.lastUid ?? 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mb.folder);
    try {
      const start = highest + 1;
      for await (const msg of client.fetch(`${start}:*`, { uid: true, source: true }, { uid: true })) {
        // A UID range with no matches still returns the last message — skip it.
        if (highest > 0 && msg.uid <= highest) continue;
        if (msg.source) {
          const parsed = await simpleParser(msg.source);
          const outcome = await ingest(parsed, mb, msg.uid);
          result.processed++;
          if (outcome === 'created') result.created++;
          else if (outcome === 'appended') result.appended++;
          else result.skipped++;
        }
        if (msg.uid > highest) highest = msg.uid;
      }
    } finally {
      lock.release();
    }
    await client.logout();
    await mailboxRepo.recordPoll(mb.id, highest, null);
  } catch (err) {
    result.error = describeImapError(err);
    await mailboxRepo.recordPoll(mb.id, highest > (mb.lastUid ?? 0) ? highest : undefined, result.error);
    try {
      await client.close();
    } catch {
      /* already closed */
    }
  }
  return result;
}

/** Poll every enabled mailbox. */
export async function pollAll(): Promise<PollResult[]> {
  const boxes = await mailboxRepo.enabled();
  const results: PollResult[] = [];
  for (const mb of boxes) {
    results.push(await pollMailbox(mb));
  }
  return results;
}
