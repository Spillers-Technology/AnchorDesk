export interface TicketSyncSource {
  source?: string;
  externalProvider?: string;
}

export const SYNC_PROVIDER_LABELS: Record<string, string> = {
  connectwise: "ConnectWise",
  jira: "Jira",
  imap: "IMAP",
  tactical_rmm: "Tactical",
  meshcentral: "MeshCentral",
  netviz: "NetViz",
  api: "API",
};

export function syncProvidersForTicket(ticket: TicketSyncSource): string[] {
  return Array.from(
    new Set([ticket.externalProvider, ticket.source].filter((p): p is string => !!p && p !== "local"))
  );
}

export type SyncState = "synced" | "pending" | "conflict" | "error";

/** Presentation for the two-way sync-state chip (label + MUI Chip color). */
export const SYNC_STATE_META: Record<SyncState, { label: string; color: "success" | "warning" | "error" | "info" }> = {
  synced: { label: "Synced", color: "success" },
  pending: { label: "Pending sync", color: "info" },
  conflict: { label: "Conflict", color: "error" },
  error: { label: "Sync error", color: "warning" },
};
