/**
 * JiraProvider — Jira Cloud implementation of TicketProvider (two-way capable).
 *
 * Maps Jira issues onto the generic ExternalTicket/ExternalNote shapes. The issue
 * key (e.g. PROJ-123) is the externalId. Status write-back goes through Jira's
 * transition API (status is not a directly-writable field); priority writes by
 * name. Assignee write-back is skipped unless the value is already an accountId,
 * because Jira assigns by accountId and we hold only a display name — resolving
 * names to accounts is out of scope for this alpha.
 *
 * GoF pattern: Strategy (implements TicketProvider)
 */

import * as jira from '../services/jiraService';
import { TicketProvider, ExternalTicket, ExternalNote, TicketWriteback } from './TicketProvider';
import { SyncFilter } from '../services/syncFilter';

/** Jira accountIds look like `712020:ef842b55-d1f8-404f-ae16-56dea63e2e1b`. */
const JIRA_ACCOUNT_ID = /^[0-9a-f]+:[0-9a-f-]{20,}$/i;

/** Quote a value for JQL, escaping the two characters that can break out. */
function jqlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Split a JQL string into its restriction and its trailing ORDER BY.
 *
 * Scans outside quoted literals, because a plain regex would treat the text of
 * a legitimate value (`summary ~ "ORDER BY spare parts"`) as the clause and
 * truncate the query.
 */
export function splitOrderBy(jql: string): { restriction: string; ordering: string } {
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < jql.length; i++) {
    const ch = jql[i];

    if (inQuote) {
      if (ch === '\\') i++; // skip the escaped character
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }

    // Outside quotes: is an ORDER BY keyword starting here, on a word boundary?
    if ((ch === 'o' || ch === 'O') && (i === 0 || /\s/.test(jql[i - 1]))) {
      const rest = jql.slice(i);
      const m = rest.match(/^ORDER\s+BY\b/i);
      if (m) {
        return { restriction: jql.slice(0, i).trim(), ordering: rest.trim() };
      }
    }
  }

  return { restriction: jql.trim(), ordering: '' };
}

/**
 * Fold the provider-neutral sync filter into JQL so the remote does the work.
 *
 * Only `status`, `priority`, and `companyName` (Jira's project) are pushed down:
 * all three are matched by name in JQL. Assignee is deliberately left out —
 * AnchorDesk holds a display name while JQL wants an accountId, and a wrong
 * guess would silently drop tickets. Anything not pushed down is still enforced
 * by `syncFilter.matches()` after the fetch, so the filter is always correct;
 * push-down only decides how much data crosses the wire.
 */
function appendFilterClauses(jql: string, filter?: SyncFilter | null): string {
  if (!filter) return jql;

  const clauses: string[] = [];
  const push = (jqlField: string, values: string[] | undefined, negate: boolean) => {
    if (!values || values.length === 0) return;
    const list = values.map(jqlQuote).join(', ');
    if (!negate) {
      clauses.push(`${jqlField} IN (${list})`);
      return;
    }
    // JQL's NOT IN does not match issues where the field is empty, but the
    // local predicate does (an unset field is not in the exclusion list, so it
    // passes). Push-down must be a superset of what the local filter accepts —
    // anything dropped remotely can never be recovered — so re-admit empties
    // explicitly. The live SCRUM project has no priority field at all, which
    // makes this the difference between syncing 5 issues and syncing 0.
    clauses.push(`(${jqlField} NOT IN (${list}) OR ${jqlField} IS EMPTY)`);
  };

  push('status', filter.status, false);
  push('priority', filter.priority, false);
  push('project', filter.companyName, false);
  push('status', filter.exclude?.status, true);
  push('priority', filter.exclude?.priority, true);
  push('project', filter.exclude?.companyName, true);

  if (clauses.length === 0) return jql;

  // Preserve any ORDER BY: JQL requires it to stay at the very end.
  const { restriction, ordering } = splitOrderBy(jql);
  return `(${restriction}) AND ${clauses.join(' AND ')}${ordering ? ` ${ordering}` : ''}`;
}

export class JiraProvider implements TicketProvider {
  readonly name = 'jira';
  readonly canWriteBack = true;
  readonly writableFields = ['status', 'priority', 'assignee', 'title', 'description'] as const;

  private readonly baseJql: string;
  private readonly firstRunJql: string;
  private readonly creds: jira.JiraCredentials;

  /**
   * @param creds      credentials for one Jira site. Explicit rather than
   *                   global so several tenants can sync from one install.
   * @param jql        this job's query scope, in full.
   * @param filter     provider-neutral sync filter, partly folded into the JQL.
   * @param projectKey this job's project, used only to build the default query
   *                   when `jql` is not given.
   */
  constructor(creds: jira.JiraCredentials, jql?: string, filter?: SyncFilter | null, projectKey?: string) {
    // Do not hide terminal statuses in an implicit provider default. A ticket
    // that moves to Done must still appear in the next incremental result so
    // AnchorDesk can close it locally. Scope belongs to the job's explicit
    // project/JQL/filter; an unfiltered job is deliberately and honestly all
    // statuses in that scope.
    const base = jql || (projectKey
      ? `project = ${jqlQuote(projectKey)} ORDER BY updated DESC`
      // Jira's enhanced search endpoint rejects a truly empty/unbounded JQL.
      // Epoch zero is a real restriction while remaining an honest all-history
      // default when the admin explicitly acknowledges an unfiltered job.
      : 'updated >= 0 ORDER BY updated DESC');
    this.creds = creds;
    this.baseJql = base;
    this.firstRunJql = appendFilterClauses(base, filter);
  }

  async fetchTickets(since?: Date): Promise<ExternalTicket[]> {
    // Provider-neutral filters narrow discovery on the first run. Incremental
    // runs intentionally use the unfiltered base scope: a previously imported
    // issue that changes assignee/status/project out of the include filter must
    // still be returned so AnchorDesk can apply that lifecycle transition.
    // syncService re-applies the filter and retains only already-known records
    // that left it.
    const { restriction } = splitOrderBy(since ? this.baseJql : this.firstRunJql);
    // Deterministic ordering keeps the nextPageToken walk stable while issues
    // are being updated underneath it.
    const ordering = 'ORDER BY updated ASC, key ASC';

    let jql: string;
    if (since) {
      // Epoch milliseconds, unquoted. A quoted "YYYY-MM-DD HH:mm" literal is
      // interpreted in the account's own timezone, not UTC — on an
      // America/Indianapolis account a UTC stamp reads 4-5 hours in the future,
      // so every update inside that window is skipped and never revisited.
      jql = `(${restriction}) AND updated >= ${since.getTime()} ${ordering}`;
    } else {
      jql = `${restriction} ${ordering}`;
    }

    const issues = await jira.searchIssues(this.creds, jql);

    // An empty result from Jira is ambiguous and dangerously so: the search
    // endpoint answers 200 `{"issues":[],"isLast":true}` for an invalid token,
    // a wrong-type token, or no credentials at all, because it silently falls
    // back to anonymous access — which sees nothing in a private project.
    // Verified live against a real tenant. Without this check, bad credentials
    // look exactly like "nothing changed", forever, with nothing in the log.
    if (issues.length === 0) await this.assertAuthenticated();

    return issues.map((i) => this.normalizeIssue(i));
  }

  /** Confirm the credentials actually authenticate. `/myself` does return 401,
   *  unlike search. Only called when a result is empty, so it costs one extra
   *  request on quiet syncs and none on productive ones. */
  private async assertAuthenticated(): Promise<void> {
    try {
      await jira.getMyself(this.creds);
    } catch (err) {
      throw new Error(
        `Jira returned no issues and the credentials failed verification — ${(err as Error).message}`
      );
    }
  }

  async getTicket(externalTicketId: string): Promise<ExternalTicket | null> {
    try {
      const issue = await jira.getIssue(this.creds, externalTicketId);
      return issue ? this.normalizeIssue(issue) : null;
    } catch {
      return null;
    }
  }

  async fetchNotes(externalTicketId: string): Promise<ExternalNote[]> {
    const comments = await jira.listComments(this.creds, externalTicketId);
    return comments.map((c) => ({
      externalId: String(c.id),
      content: jira.fromADF(c.body),
      author: c.author?.displayName ?? 'Unknown',
      noteType: 'note' as const,
      createdAt: c.created ? new Date(c.created) : undefined,
    }));
  }

  /**
   * Push local field changes out.
   *
   * Throws when a requested change cannot be applied. Silently skipping was the
   * root of a data-loss bug: reconcile treated the push as successful, stored a
   * fresh baseline hash from the unchanged remote, and the local edit became
   * invisible to every later sync.
   */
  async updateTicket(externalTicketId: string, changes: TicketWriteback): Promise<void> {
    const fields: Record<string, unknown> = {};

    if (changes.title) fields.summary = changes.title;
    if (changes.description !== undefined) fields.description = jira.toADF(changes.description ?? '');
    if (changes.priority) fields.priority = { name: changes.priority };

    if (changes.assignee !== undefined) {
      const raw = changes.assignee.trim();
      if (!raw) {
        fields.assignee = { accountId: null }; // explicit unassign
      } else if (JIRA_ACCOUNT_ID.test(raw)) {
        fields.assignee = { accountId: raw };
      } else {
        const accountId = await jira.findAssignableAccountId(this.creds, externalTicketId, raw);
        if (!accountId) {
          throw new Error(
            `Jira ${externalTicketId}: cannot resolve assignee "${raw}" to a Jira account ` +
              '(no unique assignable user with that display name)'
          );
        }
        fields.assignee = { accountId };
      }
    }

    await jira.updateFields(this.creds, externalTicketId, fields);
    // Transition last: if it fails we want the field write already applied
    // rather than a status move with no matching content.
    if (changes.status) await jira.transitionToStatus(this.creds, externalTicketId, changes.status);
  }

  async pushNote(externalTicketId: string, note: { content: string; author: string }): Promise<string> {
    return jira.addComment(this.creds, externalTicketId, note.content);
  }

  private normalizeIssue(i: jira.JiraIssue): ExternalTicket {
    const f = i.fields ?? {};
    return {
      externalId: i.key,
      ticketNumber: i.key,
      title: f.summary ?? '',
      summary: f.summary ?? '',
      description: jira.fromADF(f.description),
      status: f.status?.name ?? 'Open',
      priority: f.priority?.name ?? '',
      // Jira has no company concept — the project name is the closest analogue.
      companyName: f.project?.name ?? '',
      assignee: f.assignee?.displayName ?? '',
      updatedAt: f.updated ? new Date(f.updated) : undefined,
    };
  }
}
