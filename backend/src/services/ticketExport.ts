/**
 * Renders a ticket to a self-contained, printable HTML document: header summary,
 * the full activity timeline (notes / emails / time entries / script logs), and
 * attachments — images embedded inline as data URIs so the page stands alone for
 * "Print → Save as PDF". Non-image attachments are listed with their metadata.
 */
import { prisma } from '../db/prisma';
import { readToBuffer } from './storage';
import { sanitizeEmailHtml } from './mail/sanitizeHtml';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderMaybeHtml(value: string | null): string {
  if (!value) return '';
  return /<\/?[a-z][\s\S]*>/i.test(value) ? sanitizeEmailHtml(value) : `<p>${esc(value)}</p>`;
}

export async function renderTicketHtml(ticketId: number): Promise<string | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      notes: { orderBy: { createdAt: 'asc' } },
      attachments: { orderBy: { createdAt: 'asc' } },
      company: true,
      labels: { include: { label: true } },
    },
  });
  if (!ticket) return null;
  const ticketNumber = ticket.ticketNumber ?? String(ticket.id);

  // Inline image attachments as data URIs so the export is self-contained.
  const dataUris = new Map<number, string>();
  for (const a of ticket.attachments) {
    if (!a.contentType.startsWith('image/')) continue;
    try {
      const buf = await readToBuffer(a.storageBackend, a.storageKey);
      dataUris.set(a.id, `data:${a.contentType};base64,${buf.toString('base64')}`);
    } catch {
      /* skip an unreadable image */
    }
  }

  const labelChips = ticket.labels
    .map((l) => `<span class="chip" style="background:${esc(l.label.color)}">${esc(l.label.name)}</span>`)
    .join(' ');

  const timeline = ticket.notes
    .map((n) => {
      const when = new Date(n.createdAt).toLocaleString();
      if (n.noteType === 'email') {
        const dir = n.direction === 'inbound' ? 'Inbound email' : 'Outbound email';
        const meta = [n.emailFrom && `From: ${esc(n.emailFrom)}`, n.emailTo && `To: ${esc(n.emailTo)}`, n.emailCc && `Cc: ${esc(n.emailCc)}`]
          .filter(Boolean)
          .join(' &middot; ');
        return `<div class="entry email"><div class="head"><strong>${dir}</strong> — ${esc(n.subject ?? '')} <span class="when">${when}</span></div><div class="meta">${meta}</div><div class="body">${n.htmlContent ?? esc(n.content)}</div></div>`;
      }
      if (n.noteType === 'time_entry') {
        return `<div class="entry time"><span class="when">${when}</span> ⏱ <strong>${n.minutes ?? 0} min</strong> — ${esc(n.author)} ${n.content ? `· ${esc(n.content)}` : ''}</div>`;
      }
      return `<div class="entry note"><div class="head"><strong>${esc(n.author)}</strong> <span class="when">${when}</span></div><div class="body">${n.htmlContent ?? `<p>${esc(n.content)}</p>`}</div></div>`;
    })
    .join('\n');

  const attachmentList = ticket.attachments
    .map((a) => {
      if (dataUris.has(a.id)) {
        return `<figure><img loading="lazy" src="${dataUris.get(a.id)}" alt="${esc(a.filename)}"><figcaption>${esc(a.filename)} · ${fmtBytes(a.size)}</figcaption></figure>`;
      }
      return `<li>${esc(a.filename)} — ${esc(a.contentType)} · ${fmtBytes(a.size)}</li>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Ticket #${esc(ticketNumber)} — ${esc(ticket.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1c1b1f; margin: 0; padding: 32px; max-width: 900px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #666; margin-bottom: 16px; }
  .chip { display: inline-block; color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 12px; }
  .grid { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0 24px; font-size: 14px; }
  .grid div:nth-child(odd) { color: #666; }
  .entry { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 14px; margin: 10px 0; }
  .entry .when { color: #999; font-size: 12px; float: right; }
  .entry .meta { color: #666; font-size: 12px; margin: 2px 0 8px; }
  .entry.email { border-left: 3px solid #6750A4; }
  .entry.time { background: #f7f6fb; }
  .entry .body img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; background: #f5f5f5; padding: 8px; border-radius: 6px; }
  figure { margin: 8px 0; } figure img { max-width: 100%; border: 1px solid #e0e0e0; border-radius: 6px; }
  figcaption { color: #666; font-size: 12px; }
  .no-print { margin-bottom: 16px; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  <div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>#${esc(ticketNumber)} — ${esc(ticket.title)}</h1>
  <div class="sub">${esc(ticket.company?.name ?? ticket.companyName ?? 'No company')} ${labelChips}</div>
  <div class="grid">
    <div>Status</div><div>${esc(ticket.status)}</div>
    <div>Priority</div><div>${esc(ticket.priority ?? '—')}</div>
    <div>Assignee</div><div>${esc(ticket.assignee ?? 'Unassigned')}</div>
    <div>Created</div><div>${new Date(ticket.createdAt).toLocaleString()}</div>
  </div>
  ${ticket.description ? `<h3>Description</h3><div class="body">${renderMaybeHtml(ticket.description)}</div>` : ''}
  <h3>Activity</h3>
  ${timeline || '<p>No activity.</p>'}
  ${ticket.attachments.length ? `<h3>Attachments</h3><ul>${attachmentList}</ul>` : ''}
</body></html>`;
}
