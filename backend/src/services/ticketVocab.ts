/**
 * Backend source of truth for ticket status/priority vocabulary, mirroring
 * web-client/src/ticketVocab.ts. Local write paths (REST, MCP) normalize
 * against this so "open" or "medium" can't mint tickets that fall outside
 * every board column, status filter, and SLA policy match. External sync
 * (ConnectWise/Jira/IMAP) writes through the repositories directly and is
 * deliberately NOT normalized — provider statuses are their own vocabulary.
 */
export const TICKET_STATUSES = ['New', 'Assigned', 'In Progress', 'Waiting', 'Resolved', 'Closed'] as const;
export const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

const STATUS_BY_LOWER = new Map(TICKET_STATUSES.map((s) => [s.toLowerCase(), s]));
const PRIORITY_BY_LOWER = new Map(TICKET_PRIORITIES.map((p) => [p.toLowerCase(), p]));

/** Case-insensitive match to the canonical status; null when unknown. */
export function normalizeStatus(value: string): string | null {
  return STATUS_BY_LOWER.get(value.trim().toLowerCase()) ?? null;
}

/** Case-insensitive match to the canonical priority; null when unknown. */
export function normalizePriority(value: string): string | null {
  return PRIORITY_BY_LOWER.get(value.trim().toLowerCase()) ?? null;
}

export const STATUS_LIST_TEXT = TICKET_STATUSES.join(', ');
export const PRIORITY_LIST_TEXT = TICKET_PRIORITIES.join(', ');
