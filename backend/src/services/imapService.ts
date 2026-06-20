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

export interface PollResult {
  mailbox: string;
  processed: number;
  created: number;
  appended: number;
  error?: string;
}

function refsOf(parsed: ParsedMail): string[] {
  const refs: string[] = [];
  if (parsed.inReplyTo) refs.push(parsed.inReplyTo);
  if (parsed.references) {
    refs.push(...(Array.isArray(parsed.references) ? parsed.references : [parsed.references]));
  }
  return refs.filter(Boolean);
}

function bodyOf(parsed: ParsedMail): string {
  if (parsed.text && parsed.text.trim()) return parsed.text.trim();
  if (parsed.html) return parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return '(no body)';
}

async function ingest(parsed: ParsedMail, mb: Mailbox, uid: number): Promise<'created' | 'appended'> {
  const messageId = parsed.messageId || `<imap-${mb.id}-${uid}@local>`;
  const fromText = parsed.from?.text || 'unknown sender';
  const body = bodyOf(parsed);
  const content = `From: ${fromText}\n\n${body}`;

  // Is this a reply to a thread we already know?
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

  if (ticketId) {
    await noteRepo.create(ticketId, { content, author: fromText, externalId: messageId }, 'imap');
    return 'appended';
  }

  const ticket = await ticketRepo.create(
    {
      title: (parsed.subject || '(no subject)').slice(0, 255),
      summary: body.slice(0, 200),
      description: body,
      companyName: mb.companyName ?? undefined,
      source: 'imap',
      externalId: messageId,
      externalProvider: 'imap',
    },
    'imap'
  );
  await noteRepo.create(ticket.id, { content, author: fromText, externalId: messageId }, 'imap');
  return 'created';
}

/** Poll one mailbox for new mail. Connection errors are captured, not thrown. */
export async function pollMailbox(mb: Mailbox): Promise<PollResult> {
  const result: PollResult = { mailbox: mb.name, processed: 0, created: 0, appended: 0 };
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
          else result.appended++;
        }
        if (msg.uid > highest) highest = msg.uid;
      }
    } finally {
      lock.release();
    }
    await client.logout();
    await mailboxRepo.recordPoll(mb.id, highest, null);
  } catch (err) {
    result.error = (err as Error).message;
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
