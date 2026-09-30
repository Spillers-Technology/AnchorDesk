import { useCallback, useEffect, useState } from "react";
import { Box, Button, Chip, Paper, Stack, TextField, Typography } from "@mui/material";
import CallSplitOutlined from "@mui/icons-material/CallSplitOutlined";
import * as api from "../../api/client";
import { SectionCard, When, useAdminToast } from "./kit";

/**
 * Pending sync bypass requests: tickets that left their sync job's scope and
 * someone wants kept in sync anyway. Any admin may decide. Renders nothing
 * while the queue is empty — it's an inbox, not a feature to advertise.
 */
export default function SyncBypassQueue({ onOpenTicket }: { onOpenTicket?: (ticketId: number) => void }) {
  const toast = useAdminToast();
  const [rows, setRows] = useState<api.SyncBypassQueueItem[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    api.listSyncBypassRequests("pending").then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const decide = async (row: api.SyncBypassQueueItem, decision: "approve" | "reject") => {
    setBusy(row.id);
    const ok = await toast.run(
      () => api.decideSyncBypass(row.id, decision, notes[row.id]?.trim() || undefined),
      decision === "approve" ? `#${row.ticket.ticketNumber ?? row.ticketId} keeps syncing` : "Request rejected",
    );
    setBusy(null);
    if (ok) load();
  };

  if (!rows || rows.length === 0) return null;

  return (
    <SectionCard
      icon={CallSplitOutlined}
      title="Sync bypass requests"
      description="These tickets left their sync job's scope and stopped syncing. Approving keeps one syncing anyway, outside the filter, until an admin removes the bypass."
      status={<Chip size="small" color="warning" label={`${rows.length} waiting`} />}
    >
      <Stack spacing={1.25}>
        {rows.map((row) => (
          <Paper key={row.id} variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={1}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "baseline" } }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    #{row.ticket.ticketNumber ?? row.ticketId} {row.ticket.title}
                  </Typography>
                  <Typography variant="caption" component="div" sx={{ color: "text.secondary" }}>
                    {row.ticket.externalProvider} {row.ticket.externalId}
                    {row.ticket.syncJob ? ` · job “${row.ticket.syncJob.name}”` : ""}
                  </Typography>
                </Box>
                {onOpenTicket && <Button size="small" onClick={() => onOpenTicket(row.ticketId)}>Open ticket</Button>}
              </Stack>
              {row.ticket.syncDetachReason && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: "text.secondary" }}>Stopped because </Box>
                  {row.ticket.syncDetachReason}
                </Typography>
              )}
              <Typography variant="body2">
                <Box component="span" sx={{ color: "text.secondary" }}>{row.requestedBy} asked <When iso={row.requestedAt} />: </Box>
                “{row.reason}”
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
                <TextField
                  size="small"
                  placeholder="Note to the requester (optional)"
                  value={notes[row.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                  sx={{ flexGrow: 1 }}
                  slotProps={{ htmlInput: { "aria-label": `Note for request on ticket ${row.ticketId}` } }}
                />
                <Stack direction="row" spacing={1}>
                  <Button disabled={busy === row.id} onClick={() => void decide(row, "reject")}>Reject</Button>
                  <Button variant="contained" disabled={busy === row.id} onClick={() => void decide(row, "approve")}>Keep syncing</Button>
                </Stack>
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </SectionCard>
  );
}
