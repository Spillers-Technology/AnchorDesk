/**
 * Factory for TicketProviders, keyed by the sync_providers.type / ticket source.
 * Shared by the batch sync service and the two-way reconcile service so both
 * instantiate providers the same way.
 *
 * GoF pattern: Factory over the TicketProvider Strategy family.
 */

import { TicketProvider } from './TicketProvider';
import { ConnectWiseProvider } from './ConnectWiseProvider';
import { JiraProvider } from './JiraProvider';

export function createTicketProvider(type: string, cfg: Record<string, unknown> = {}): TicketProvider {
  switch (type) {
    case 'connectwise':
      return new ConnectWiseProvider((cfg.board as string) ?? undefined);
    case 'jira':
      return new JiraProvider((cfg.jql as string) ?? undefined);
    default:
      throw new Error(`Unknown ticket provider type: ${type}`);
  }
}

/** Best-effort provider for a ticket's stored external provider; null if unknown. */
export function tryCreateTicketProvider(type: string | null): TicketProvider | null {
  if (!type) return null;
  try {
    return createTicketProvider(type);
  } catch {
    return null;
  }
}
