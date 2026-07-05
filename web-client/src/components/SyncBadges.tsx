import { Chip, Stack } from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import EmailIcon from "@mui/icons-material/Email";
import type { Ticket } from "../interfaces";
import { SYNC_PROVIDER_LABELS, SYNC_STATE_META, SyncState, syncProvidersForTicket } from "../syncBadges";

interface SyncBadgesProps {
  ticket: Pick<Ticket, "source" | "externalProvider" | "externalId" | "syncState">;
  header?: boolean;
}

/**
 * Small decorator for a ticket's external provenance + two-way sync state.
 * Keeping this in one component makes cards, the table, Kanban, and the dialog
 * use the same labels.
 */
export default function SyncBadges({ ticket, header = false }: SyncBadgesProps) {
  const providers = syncProvidersForTicket(ticket);
  if (providers.length === 0) return null;

  const state = ticket.syncState ? SYNC_STATE_META[ticket.syncState as SyncState] : undefined;

  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {providers.map((provider) => (
        <Chip
          key={provider}
          size="small"
          icon={provider === "imap" ? <EmailIcon /> : <SyncIcon />}
          label={SYNC_PROVIDER_LABELS[provider] ?? provider}
          variant={header ? "filled" : "outlined"}
          title={ticket.externalId ? `External ID: ${ticket.externalId}` : undefined}
          sx={
            header
              ? {
                  bgcolor: "rgba(255,255,255,0.18)",
                  color: "#fff",
                  "& .MuiChip-icon": { color: "#fff" },
                }
              : undefined
          }
        />
      ))}
      {state && (
        <Chip
          size="small"
          color={state.color}
          label={state.label}
          variant={header ? "filled" : "outlined"}
        />
      )}
    </Stack>
  );
}
