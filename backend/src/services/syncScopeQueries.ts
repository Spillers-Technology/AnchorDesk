/**
 * Read-only questions the sync job editor asks a remote before a job is saved:
 * "who can I filter by?" and "how much would this import?". Neither writes
 * anything, locally or remotely. See docs/roadmap-sync-scope.md §2 and §7.
 */

import { createTicketProvider, resolveCredentials } from '../providers/ticketProviderFactory';
import * as jira from './jiraService';
import { createCwm } from './connectwiseService';
import { parseSyncFilter } from './syncFilter';

export interface Person {
  /** What the filter stores: Jira accountId, or ConnectWise member identifier. */
  id: string;
  name: string;
  detail?: string;
}

const cwLike = (q: string) => q.replace(/["\\%]/g, '');

export async function searchPeople(type: string, connectionId: number | null, query: string): Promise<Person[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { credentials } = await resolveCredentials(type, connectionId);

  if (type === 'jira') {
    const people = await jira.searchPeople(jira.credentialsFrom(credentials), q);
    return people.map((p) => ({ id: p.accountId, name: p.displayName, detail: p.emailAddress }));
  }

  if (type === 'connectwise') {
    const safe = cwLike(q);
    const members = await createCwm(credentials).SystemAPI.getSystemMembers({
      conditions:
        `inactiveFlag = false AND (identifier like "%${safe}%" OR firstName like "%${safe}%" OR lastName like "%${safe}%")`,
      orderBy: 'identifier asc',
      pageSize: 25,
    });
    return (Array.isArray(members) ? members : [])
      .filter((m) => m?.identifier)
      .map((m) => ({
        id: String(m.identifier),
        name: [m.firstName, m.lastName].filter(Boolean).join(' ') || String(m.identifier),
        detail: (m as { officeEmail?: string }).officeEmail ?? String(m.identifier),
      }));
  }

  throw new Error(`${type} has no people to search`);
}

export interface Preview {
  count: number;
  /** Jira's count is approximate by definition. */
  approximate: boolean;
  /** Filter clauses checked only after fetching, which make `count` an upper bound. */
  localOnly: string[];
}

/** What a job with this (possibly unsaved) configuration would import on its first run. */
export async function previewJob(type: string, connectionId: number | null, config: Record<string, unknown>): Promise<Preview> {
  // Validate before counting: a malformed filter must fail here, loudly, not
  // produce a count for a different (unfiltered) scope.
  parseSyncFilter(config.filter);
  const { credentials } = await resolveCredentials(type, connectionId);
  const provider = createTicketProvider(type, config, credentials);
  if (!provider.previewFirstRun) throw new Error(`${type} jobs can't be previewed`);
  return provider.previewFirstRun();
}
