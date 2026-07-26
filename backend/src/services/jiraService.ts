/**
 * jiraService — thin HTTP client for the Jira Cloud REST API v3.
 *
 * Auth is HTTP Basic with the account email as the username and an API token as
 * the password (Atlassian's documented Cloud auth). Base URL is the site,
 * e.g. https://your-org.atlassian.net. Everything else talks to Jira only through
 * JiraProvider, which calls this module.
 *
 * Bodies (descriptions, comments) are Atlassian Document Format (ADF) — helpers
 * below convert to/from plain text, which is all the two-way sync needs for now.
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 *
 * ALPHA: written against the published API; not yet exercised against a live
 * Cloud site. Endpoint paths are centralized here so they are easy to adjust.
 */

/**
 * Credentials for one Jira site. Passed explicitly rather than read from global
 * config so a single install can talk to several Atlassian tenants — see
 * `Connection` in the schema and docs/roadmap-sync-2.5.md (workstream E).
 */
export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/** Build credentials from a connection's stored config. */
export function credentialsFrom(cfg: Record<string, unknown> | null | undefined): JiraCredentials {
  return {
    baseUrl: String(cfg?.baseUrl ?? '').replace(/\/+$/, ''),
    email: String(cfg?.email ?? ''),
    apiToken: String(cfg?.apiToken ?? ''),
  };
}

export function isConfigured(c: JiraCredentials): boolean {
  return Boolean(c.baseUrl && c.email && c.apiToken);
}

function authHeader(c: JiraCredentials): string {
  const basic = Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
  return `Basic ${basic}`;
}

/** Per-request ceiling. Node's fetch has no default timeout, and a stuck socket
 *  would otherwise hang the sync scheduler's re-entrancy guard forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How much of a remote error body is worth keeping for diagnosis. */
const MAX_ERROR_BODY = 400;

/**
 * Strip anything credential-shaped out of a remote response body before it is
 * allowed into a log, an audit row, or an API response.
 *
 * Covers the realistic leak: a misconfigured or hostile `baseUrl` receives the
 * `Authorization: Basic <base64(email:token)>` header and echoes the request
 * back in its error body.
 */
export function redactRemoteBody(body: string): string {
  return body
    .replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [redacted]')
    .replace(/("?(?:authorization|apiToken|api_token|password|token)"?\s*[:=]\s*)"?[^",}\s]+"?/gi, '$1[redacted]')
    // Bare Atlassian token shapes, in case they appear unlabelled.
    .replace(/AT[AC]TT[A-Za-z0-9+/=_-]{10,}/g, '[redacted]')
    .slice(0, MAX_ERROR_BODY);
}

async function jira<T>(c: JiraCredentials, path: string, init: RequestInit = {}): Promise<T> {
  if (!isConfigured(c)) {
    throw new Error('Jira connection is missing a site URL, account email, or API token');
  }

  const res = await fetch(`${c.baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: authHeader(c),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Error text flows into sync_log, manual-run responses, and server logs, so
    // it must not carry credentials. A wrong or hostile baseUrl receives the
    // Basic auth header and can echo it straight back in its body.
    throw new Error(`Jira ${init.method ?? 'GET'} ${path} → ${res.status}: ${redactRemoteBody(body)}`);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ─── ADF <-> plain text ────────────────────────────────────────────────────────

/** Wrap plain text as a minimal ADF document (what comment/description writes need). */
export function toADF(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: text.split(/\n{2,}/).map((para) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: para || ' ' }],
    })),
  };
}

/**
 * Flatten an ADF document (or legacy string) down to plain text.
 *
 * Block boundaries become blank lines and hard breaks become newlines, so this
 * round-trips with `toADF`. Concatenating raw text runs instead turned
 * "para one\n\npara two" into "para onepara two", which both mangled every
 * inbound multi-paragraph description and made post-push verification of a
 * description we had just written fail every time.
 */
export function fromADF(adf: unknown): string {
  if (adf == null) return '';
  if (typeof adf === 'string') return adf;

  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const text = current.join('').trim();
    if (text) blocks.push(text);
    current = [];
  };

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    if (n.type === 'text' && typeof n.text === 'string') current.push(n.text);
    if (n.type === 'hardBreak') current.push('\n');

    if (Array.isArray(n.content)) n.content.forEach(walk);

    // Paragraph-level nodes separate with a blank line, matching toADF.
    if (n.type === 'paragraph' || n.type === 'heading') flush();
  };

  walk(adf);
  flush();
  return blocks.join('\n\n').trim();
}

// ─── Issue shapes (subset we use) ──────────────────────────────────────────────

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string; accountId?: string } | null;
    project?: { name?: string; key?: string };
    updated?: string;
  };
}

export interface JiraComment {
  id: string;
  author?: { displayName?: string };
  body?: unknown;
  created?: string;
  visibility?: {
    type?: string;
    value?: string;
    identifier?: string;
  } | null;
}

const ISSUE_FIELDS = 'summary,description,status,priority,assignee,project,updated';

/** Issues requested per page. Atlassian caps this server-side and may change it. */
const SEARCH_PAGE_SIZE = 100;
/**
 * Safety stop on the pagination walk. Reaching it is treated as a failure, not
 * as the end of the results: silently returning a partial page would let the
 * caller advance its sync watermark past issues it never saw.
 */
const MAX_SEARCH_PAGES = 200;

interface JqlSearchPage {
  issues?: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

/**
 * Search issues by JQL, walking every page.
 *
 * Uses `/rest/api/3/search/jql`. The classic `/rest/api/3/search` endpoint was
 * removed from Jira Cloud (Atlassian CHANGE-2046) and answers 410 Gone —
 * verified live. Three behavioural differences drive the shape of this function:
 *
 *  - pagination is by opaque `nextPageToken`; there is no `startAt` or `total`,
 *    so the only way to know you are done is `isLast` / a missing token;
 *  - the response contains only `id` unless `fields` is requested explicitly;
 *  - unbounded JQL is rejected with 400 ("Unbounded JQL queries are not allowed
 *    here"), so callers must pass a restricting clause, not just an ORDER BY.
 *
 * Throws rather than truncating. Callers use the result to decide how far their
 * incremental watermark may advance, so a partial list must never look complete.
 */
/** The account the credentials resolve to. Pure read; used by connection tests. */
export function getMyself(c: JiraCredentials): Promise<{
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
}> {
  return jira(c, '/rest/api/3/myself');
}

/** Project keys visible to these credentials. A pure read, used by connection
 *  tests to prove actual access rather than merely that a query parsed. */
export async function listVisibleProjects(c: JiraCredentials, max = 50): Promise<string[]> {
  const qs = new URLSearchParams({ maxResults: String(max) });
  const res = await jira<{ values?: Array<{ key?: string; name?: string }> }>(
    c,
    `/rest/api/3/project/search?${qs.toString()}`
  );
  return (res.values ?? []).map((p) => p.key ?? p.name ?? '').filter(Boolean);
}

export async function searchIssues(c: JiraCredentials, jql: string): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  const seenKeys = new Set<string>();
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;

  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const qs = new URLSearchParams({
      jql,
      fields: ISSUE_FIELDS,
      maxResults: String(SEARCH_PAGE_SIZE),
    });
    if (nextPageToken) qs.set('nextPageToken', nextPageToken);

    const res = await jira<JqlSearchPage>(c, `/rest/api/3/search/jql?${qs.toString()}`);

    // De-duplicate by key: an issue updated mid-walk can shift between pages.
    for (const issue of res.issues ?? []) {
      if (issue.key && !seenKeys.has(issue.key)) {
        seenKeys.add(issue.key);
        issues.push(issue);
      }
    }

    if (res.isLast === true || !res.nextPageToken) return issues;

    // A token that repeats means the walk is not advancing; stop instead of
    // spinning until the page cap.
    if (seenTokens.has(res.nextPageToken)) {
      throw new Error(`Jira search paging stalled: nextPageToken repeated after ${issues.length} issues`);
    }
    seenTokens.add(res.nextPageToken);
    nextPageToken = res.nextPageToken;
  }

  throw new Error(
    `Jira search exceeded ${MAX_SEARCH_PAGES} pages (${issues.length} issues) without reaching the last page; ` +
      'narrow the JQL filter for this provider'
  );
}

export function getIssue(c: JiraCredentials, key: string): Promise<JiraIssue> {
  const qs = new URLSearchParams({ fields: ISSUE_FIELDS });
  return jira<JiraIssue>(c, `/rest/api/3/issue/${encodeURIComponent(key)}?${qs.toString()}`);
}

/** Fetch every comment on an issue. This endpoint is startAt/total paginated
 *  (default page is 50), so a busy issue silently lost its older comments when
 *  only the first page was read. */
export async function listComments(c: JiraCredentials, key: string): Promise<JiraComment[]> {
  const out: JiraComment[] = [];
  let startAt = 0;

  for (;;) {
    const qs = new URLSearchParams({ startAt: String(startAt), maxResults: '100' });
    const res = await jira<{ comments?: JiraComment[]; total?: number; startAt?: number; maxResults?: number }>(
      c,
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment?${qs.toString()}`
    );
    const batch = res.comments ?? [];
    out.push(...batch);

    // Advance by what Jira actually returned, not by what we asked for — the
    // server may cap maxResults below the request, and stepping by the request
    // size would skip the difference on every page.
    if (batch.length === 0) break;
    startAt += batch.length;
    if (typeof res.total === 'number' && startAt >= res.total) break;
    if (typeof res.total !== 'number') break; // no total to walk toward
  }

  return out;
}

export async function addComment(c: JiraCredentials, key: string, text: string): Promise<string> {
  const res = await jira<{ id?: string }>(c, `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body: toADF(text) }),
  });
  return res.id ?? '';
}

/**
 * Resolve a display name to a Jira accountId among users assignable to an issue.
 * Jira assigns by accountId only, and AnchorDesk stores a display name, so
 * without this an ordinary local assignee change could never be pushed.
 * Returns null when the name is ambiguous or matches nobody.
 */
export async function findAssignableAccountId(c: JiraCredentials, issueKey: string, displayName: string): Promise<string | null> {
  const qs = new URLSearchParams({ issueKey, query: displayName, maxResults: '10' });
  const users = await jira<Array<{ accountId?: string; displayName?: string }>>(
    c,
    `/rest/api/3/user/assignable/search?${qs.toString()}`
  );
  const wanted = displayName.trim().toLowerCase();
  const exact = (users ?? []).filter((u) => u.displayName?.trim().toLowerCase() === wanted);
  if (exact.length === 1 && exact[0].accountId) return exact[0].accountId;
  if ((users ?? []).length === 1 && users[0].accountId) return users[0].accountId;
  return null;
}

/** Update editable fields (priority by name; assignee by accountId when supplied). */
export async function updateFields(c: JiraCredentials, key: string, fields: Record<string, unknown>): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  await jira<void>(c, `/rest/api/3/issue/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });
}

/**
 * Move an issue to the named status via the transitions API (status is not a
 * directly-writable field in Jira).
 *
 * Throws when no transition leads to that status. The transitions endpoint only
 * lists moves the current user may make from the issue's current state, so a
 * missing target is a real, reportable failure — swallowing it let two-way sync
 * mark a ticket "synced" against a remote that never moved.
 */
export async function transitionToStatus(c: JiraCredentials, key: string, statusName: string): Promise<void> {
  const res = await jira<{ transitions?: Array<{ id: string; name?: string; to?: { name?: string } }> }>(
    c,
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
  );
  const available = res.transitions ?? [];
  const target = available.find((t) => t.to?.name?.toLowerCase() === statusName.toLowerCase());

  if (!target) {
    // Already there is success, not failure. Most workflows offer no transition
    // from a status back to itself, so without this an unrelated edit (a title
    // change, which re-sends the unchanged status) would throw every time.
    const current = await getIssue(c, key).catch(() => null);
    if (current?.fields?.status?.name?.toLowerCase() === statusName.toLowerCase()) return;

    const names = available.map((t) => t.to?.name ?? t.name).filter(Boolean).join(', ');
    throw new Error(
      `Jira ${key}: no transition to status "${statusName}"` +
        (names ? ` (available from here: ${names})` : ' (no transitions available)')
    );
  }

  await jira<void>(c, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: target.id } }),
  });
}
