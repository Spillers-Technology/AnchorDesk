export interface TicketSyncSource {
  source?: string;
  externalProvider?: string;
}

export const SYNC_PROVIDER_LABELS: Record<string, string> = {
  connectwise: "ConnectWise",
  imap: "IMAP",
  tactical_rmm: "Tactical",
  ninjaone: "NinjaOne",
  datto_rmm: "Datto RMM",
  meshcentral: "MeshCentral",
  netviz: "NetViz",
  api: "API",
};

export function syncProvidersForTicket(ticket: TicketSyncSource): string[] {
  return Array.from(
    new Set([ticket.externalProvider, ticket.source].filter((p): p is string => !!p && p !== "local"))
  );
}
