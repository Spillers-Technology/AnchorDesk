/**
 * connectionTest — verify an external account's credentials without changing
 * anything on the remote.
 *
 * The product previously had no answer to "are these credentials right?"; the
 * only feedback was running a sync and reading a log. The failure that motivated
 * this was an Atlassian *organization* API key used where a per-user API token
 * was required: it authenticates against the admin API and returns 403 from the
 * issue API, so saving it looked fine and every sync quietly returned nothing.
 *
 * Categories are deliberately coarse but actionable — they map to what the admin
 * has to go and change.
 */

import { ProviderType } from '@prisma/client';
import * as jira from './jiraService';

export type TestCategory =
  | 'ok'
  | 'incomplete'
  | 'auth'
  | 'permission'
  | 'unreachable'
  | 'not_found'
  | 'unsupported'
  | 'unknown';

export interface ConnectionTestResult {
  ok: boolean;
  category: TestCategory;
  message: string;
  /** Who/what the credentials resolved to, when the remote will say. */
  identity?: string;
}

/** Map a thrown client error onto a category the admin can act on. */
export function categorize(err: unknown): { category: TestCategory; message: string } {
  const raw = err instanceof Error ? err.message : String(err);

  // The client formats HTTP failures as "Jira GET /path → 403: body".
  const status = Number(raw.match(/→\s*(\d{3})\b/)?.[1] ?? NaN);

  if (status === 401) {
    return { category: 'auth', message: 'Authentication rejected — check the account email and API token.' };
  }
  if (status === 403) {
    return {
      category: 'permission',
      message:
        'Authenticated, but not permitted to read issues. A common cause is an ' +
        'Atlassian organization admin key (ATCTT…) where a per-user API token ' +
        '(ATATT…, from id.atlassian.com → Security) is required.',
    };
  }
  if (status === 404) {
    return { category: 'not_found', message: 'Site reached, but the API path was not found — check the site URL.' };
  }
  if (status === 410) {
    return { category: 'unknown', message: 'The remote reported this API has been removed. AnchorDesk may need an update.' };
  }
  if (Number.isFinite(status) && status >= 500) {
    return { category: 'unreachable', message: `The remote returned a server error (${status}). Try again shortly.` };
  }
  if (/timeout|abort/i.test(raw)) {
    return { category: 'unreachable', message: 'The request timed out before the remote responded.' };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|certificate|TLS|fetch failed/i.test(raw)) {
    return { category: 'unreachable', message: 'Could not reach the site — check the URL, DNS, and TLS.' };
  }
  // Never echo a raw remote body: it can contain request headers.
  return { category: 'unknown', message: 'Unexpected response from the remote system.' };
}

async function testJira(cfg: Record<string, unknown>): Promise<ConnectionTestResult> {
  const creds = jira.credentialsFrom(cfg);
  if (!jira.isConfigured(creds)) {
    return {
      ok: false,
      category: 'incomplete',
      message: 'Site URL, account email, and API token are all required.',
    };
  }

  try {
    // /myself proves authentication. It is a pure read.
    const me = await jira.getMyself(creds);
    const who = me.displayName || me.emailAddress || me.accountId || 'unknown account';

    // Authentication alone is not proof of usefulness: an org admin key
    // authenticates and still cannot read issues. Ask which projects are
    // visible — a pure read that reports actual access rather than merely that
    // a query parsed.
    let projects: string[] = [];
    try {
      projects = await jira.listVisibleProjects(creds);
    } catch (err) {
      const { category, message } = categorize(err);
      // Reaching here means credentials authenticated but cannot browse.
      return { ok: false, category: category === 'unknown' ? 'permission' : category, message, identity: who };
    }

    if (projects.length === 0) {
      return {
        ok: false,
        category: 'permission',
        identity: who,
        message:
          `Connected as ${who}, but no projects are visible to this account. ` +
          'Sync would silently import nothing — grant Browse Projects on the ' +
          'project you intend to sync.',
      };
    }

    return {
      ok: true,
      category: 'ok',
      identity: who,
      message: `Connected as ${who}. ${projects.length} project(s) visible: ${projects.slice(0, 5).join(', ')}.`,
    };
  } catch (err) {
    const { category, message } = categorize(err);
    return { ok: false, category, message };
  }
}

export async function testConnection(
  type: ProviderType,
  cfg: Record<string, unknown>
): Promise<ConnectionTestResult> {
  switch (type) {
    case 'jira':
      return testJira(cfg);
    case 'connectwise':
      // ConnectWise has no live tenant to exercise yet; claiming a verified
      // result would be worse than admitting the gap.
      return {
        ok: false,
        category: 'unsupported',
        message: 'Connection testing is not implemented for ConnectWise yet.',
      };
    default:
      return { ok: false, category: 'unsupported', message: `Cannot test connections of type "${type}".` };
  }
}
