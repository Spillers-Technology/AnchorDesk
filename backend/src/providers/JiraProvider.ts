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

import { config } from '../config/config';
import * as jira from '../services/jiraService';
import { TicketProvider, ExternalTicket, ExternalNote, TicketWriteback } from './TicketProvider';

export class JiraProvider implements TicketProvider {
  readonly name = 'jira';
  readonly canWriteBack = true;

  private readonly jql: string;

  constructor(jql?: string) {
    // Default: open issues in the configured project, most-recently-updated first.
    const projectClause = config.jira.projectKey ? `project = "${config.jira.projectKey}" AND ` : '';
    this.jql = jql || config.jira.jql || `${projectClause}statusCategory != Done ORDER BY updated DESC`;
  }

  async fetchTickets(since?: Date): Promise<ExternalTicket[]> {
    let jql = this.jql;
    if (since) {
      // JQL wants minute precision in the site's timezone; ISO minutes are accepted.
      const stamp = since.toISOString().slice(0, 16).replace('T', ' ');
      jql = `(${this.jql.replace(/ORDER BY.*/i, '').trim()}) AND updated >= "${stamp}"`;
    }
    const issues = await jira.searchIssues(jql);
    return issues.map((i) => this.normalizeIssue(i));
  }

  async getTicket(externalTicketId: string): Promise<ExternalTicket | null> {
    try {
      const issue = await jira.getIssue(externalTicketId);
      return issue ? this.normalizeIssue(issue) : null;
    } catch {
      return null;
    }
  }

  async fetchNotes(externalTicketId: string): Promise<ExternalNote[]> {
    const comments = await jira.listComments(externalTicketId);
    return comments.map((c) => ({
      externalId: String(c.id),
      content: jira.fromADF(c.body),
      author: c.author?.displayName ?? 'Unknown',
      noteType: 'note' as const,
      createdAt: c.created ? new Date(c.created) : undefined,
    }));
  }

  async updateTicket(externalTicketId: string, changes: TicketWriteback): Promise<void> {
    // Priority is a normal field; status is a transition.
    const fields: Record<string, unknown> = {};
    if (changes.priority) fields.priority = { name: changes.priority };
    // Only set assignee when it already looks like a Jira accountId, since Jira
    // assigns by accountId and we don't resolve display names in this alpha.
    if (changes.assignee && /^[0-9a-f:-]{16,}$/i.test(changes.assignee)) {
      fields.assignee = { accountId: changes.assignee };
    }
    await jira.updateFields(externalTicketId, fields);
    if (changes.status) await jira.transitionToStatus(externalTicketId, changes.status);
  }

  async pushNote(externalTicketId: string, note: { content: string; author: string }): Promise<string> {
    return jira.addComment(externalTicketId, note.content);
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
