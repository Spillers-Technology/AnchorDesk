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

import { config } from '../config/config';

export function isConfigured(): boolean {
  return Boolean(config.jira.baseUrl && config.jira.email && config.jira.apiToken);
}

function authHeader(): string {
  const basic = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');
  return `Basic ${basic}`;
}

async function jira<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isConfigured()) {
    throw new Error('Jira is not configured (set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)');
  }

  const res = await fetch(`${config.jira.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
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

/** Flatten an ADF document (or legacy string) down to plain text. */
export function fromADF(adf: unknown): string {
  if (adf == null) return '';
  if (typeof adf === 'string') return adf;
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(adf);
  return parts.join('').trim();
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
}

const ISSUE_FIELDS = 'summary,description,status,priority,assignee,project,updated';

/** Search issues by JQL. Uses the classic v3 search endpoint. */
export async function searchIssues(jql: string, maxResults = 100): Promise<JiraIssue[]> {
  const qs = new URLSearchParams({ jql, fields: ISSUE_FIELDS, maxResults: String(maxResults) });
  const res = await jira<{ issues?: JiraIssue[] }>(`/rest/api/3/search?${qs.toString()}`);
  return res.issues ?? [];
}

export function getIssue(key: string): Promise<JiraIssue> {
  const qs = new URLSearchParams({ fields: ISSUE_FIELDS });
  return jira<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}?${qs.toString()}`);
}

export async function listComments(key: string): Promise<JiraComment[]> {
  const res = await jira<{ comments?: JiraComment[] }>(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`);
  return res.comments ?? [];
}

export async function addComment(key: string, text: string): Promise<string> {
  const res = await jira<{ id?: string }>(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body: toADF(text) }),
  });
  return res.id ?? '';
}

/** Update editable fields (priority by name; assignee by accountId when supplied). */
export async function updateFields(key: string, fields: Record<string, unknown>): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  await jira<void>(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });
}

/**
 * Move an issue to the named status via the transitions API (status is not a
 * directly-writable field in Jira). No-op if no transition leads to that status.
 */
export async function transitionToStatus(key: string, statusName: string): Promise<void> {
  const res = await jira<{ transitions?: Array<{ id: string; to?: { name?: string } }> }>(
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
  );
  const target = (res.transitions ?? []).find(
    (t) => t.to?.name?.toLowerCase() === statusName.toLowerCase()
  );
  if (!target) return;
  await jira<void>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: target.id } }),
  });
}
