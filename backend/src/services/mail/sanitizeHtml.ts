/**
 * Shared HTML sanitizer for ticket email correspondence.
 *
 * Used on BOTH seams: inbound (IMAP-ingested mail before it's stored) and
 * outbound (composer HTML before it's sent and recorded). Sanitizing on store
 * means the rendered conversation never trusts raw remote HTML, and the client
 * sanitizes again on render (defense in depth).
 *
 * Policy: allow common formatting + links + images, strip scripts/styles/event
 * handlers, and force links to open safely. Inline images reference stored
 * attachments by relative URL (/api/attachments/:id/download) — inbound `cid:`
 * images are rewritten to those URLs before sanitizing (see imapService), so the
 * stored HTML never carries `cid:` or untrusted `data:` payloads.
 */
import sanitizeHtmlLib from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'img', 'hr',
];

const OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    '*': ['style'],
  },
  // Only http(s) and mailto links; drop javascript:/data: URIs. Images may be
  // remote https only (cid: inline images are dropped until attachments land).
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  // Keep inline styling but block expressions/position tricks via the allowlist.
  allowedStyles: {
    '*': {
      color: [/^.*$/],
      'background-color': [/^.*$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^.*$/],
      'font-style': [/^.*$/],
      'text-decoration': [/^.*$/],
    },
  },
  transformTags: {
    // Force external links to open in a new tab without leaking the opener.
    a: sanitizeHtmlLib.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
};

/** Sanitize an HTML email body. Returns safe HTML (never throws on bad input). */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  return sanitizeHtmlLib(html, OPTIONS);
}

/** Strip all tags to a plain-text fallback (for `content`, search, previews). */
export function htmlToText(html: string): string {
  if (!html) return '';
  // sanitize-html decodes entities, so &nbsp; arrives as the U+00A0 character.
  return sanitizeHtmlLib(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/ /g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
