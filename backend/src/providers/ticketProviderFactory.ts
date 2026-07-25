/**
 * Factory for TicketProviders, keyed by the sync_providers.type / ticket source.
 * Shared by the batch sync service and the two-way reconcile service so both
 * instantiate providers the same way.
 *
 * Credentials arrive as an argument rather than being read from global config.
 * A single install can hold several `Connection` rows of the same type (one per
 * customer tenant), so "which Jira account" is a property of the sync job or the
 * ticket, never of the process. See docs/roadmap-sync-2.5.md, workstream E.
 *
 * GoF pattern: Factory over the TicketProvider Strategy family.
 */

import { ProviderType } from "@prisma/client";
import { TicketProvider } from "./TicketProvider";
import {
  ConnectWiseProvider,
  requireConnectWiseBoard,
} from "./ConnectWiseProvider";
import { JiraProvider } from "./JiraProvider";
import * as jiraService from "../services/jiraService";
import { parseSyncFilter, SyncFilter } from "../services/syncFilter";
import * as connectionRepo from "../repositories/connectionRepository";
import { getConnectwise } from "../services/settingsService";
import { config } from "../config/config";

/** Credentials for one external account, as stored on a Connection. */
export type ProviderCredentials = Record<string, unknown>;

/** Credentials plus the account they came from, so callers can record on a
 *  ticket which tenant actually served it rather than what the job asked for. */
export interface ResolvedCredentials {
  connectionId: number | null;
  credentials: ProviderCredentials;
}

/**
 * Credentials for a sync job, or for a ticket. Jira must always carry an
 * explicit Connection id: dynamically choosing "the only enabled account"
 * would let the same job and watermark silently move between tenants when an
 * admin enables, disables, or deletes another account. ConnectWise remains on
 * its explicit legacy/global account path until it gains Connection records.
 */
export async function resolveCredentials(
  type: string,
  connectionId: number | null,
): Promise<ResolvedCredentials> {
  // An explicit link is binding. If it is missing or disabled we fail CLOSED:
  // falling through to "some other account of the same type" could authenticate
  // as customer B and push customer A's ticket into B's tenant.
  if (connectionId != null) {
    const row = await connectionRepo.getById(connectionId);
    if (!row) throw new Error(`connection ${connectionId} no longer exists`);
    if (!row.enabled) throw new Error(`connection "${row.name}" is disabled`);
    if (row.type !== type) {
      throw new Error(
        `connection "${row.name}" is a ${row.type} account, not ${type}`,
      );
    }
    return {
      connectionId: row.id,
      credentials: (row.config ?? {}) as ProviderCredentials,
    };
  }

  if (type === "jira") {
    throw new Error(
      "this Jira sync job has no connection selected — choose an explicit Jira account",
    );
  }

  if (type === "connectwise") {
    // ConnectWise is still one legacy/global account, but the credential
    // snapshot must come from Postgres for every account-locked operation. A
    // process-local config/client cache lets another replica keep using an old
    // API member after rotation and advance the newly reset watermark.
    return { connectionId: null, credentials: { ...(await getConnectwise()) } };
  }

  return { connectionId: null, credentials: legacyCredentials(type) };
}

/** Env/settings-seeded credentials, for installs predating the Connection model. */
export function legacyCredentials(type: string): ProviderCredentials {
  switch (type) {
    case "jira":
      return { ...config.jira };
    default:
      return {};
  }
}

export function createTicketProvider(
  type: string,
  cfg: Record<string, unknown> = {},
  credentials: ProviderCredentials = {},
): TicketProvider {
  // A malformed filter is reported by the sync service, which re-parses it and
  // applies it as the authoritative predicate; push-down is best-effort only.
  let filter: SyncFilter | null = null;
  try {
    filter = parseSyncFilter(cfg.filter);
  } catch {
    filter = null;
  }

  switch (type) {
    case "connectwise":
      // Still a single legacy account (not a Connection), but the provider owns
      // the DB-fresh snapshot resolved inside its account lock for the complete
      // operation. Creating CW Connection rows remains blocked until the full
      // multi-account model lands.
      return new ConnectWiseProvider(
        requireConnectWiseBoard(cfg.board),
        credentials,
      );
    case "jira":
      return new JiraProvider(
        jiraService.credentialsFrom(credentials),
        (cfg.jql as string) ?? undefined,
        filter,
        (cfg.projectKey as string) ?? undefined,
      );
    default:
      throw new Error(`Unknown ticket provider type: ${type}`);
  }
}

/**
 * Provider for a ticket's stored external provider, bound to the account the
 * ticket actually came from. Null if the type is unknown.
 */
export async function tryCreateTicketProviderFor(
  type: string | null,
  connectionId: number | null,
): Promise<TicketProvider | null> {
  if (!type) return null;
  try {
    const resolved = await resolveCredentials(type, connectionId);
    return createTicketProvider(type, {}, resolved.credentials);
  } catch {
    // Fails closed: a missing or disabled connection yields no provider, so
    // reconcile skips the ticket instead of using another tenant's account.
    return null;
  }
}
