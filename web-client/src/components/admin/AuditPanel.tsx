import { useState } from "react";
import {
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";
import SearchOffOutlined from "@mui/icons-material/SearchOffOutlined";
import * as api from "../../api/client";
import PanelSearch, { rowMatches } from "./PanelSearch";
import { AdminPage, EmptyRow, PanelError, StatusChip, When, actorLabel, useAsync, type Tone } from "./kit";

const ENTITY_TYPES = ["ticket", "note", "device", "probe", "user", "mailbox"];
const ACTIONS: Record<string, { tone: Tone; label: string }> = {
  create: { tone: "success", label: "Created" },
  update: { tone: "info", label: "Updated" },
  delete: { tone: "error", label: "Deleted" },
  sync: { tone: "neutral", label: "Synced" },
};

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function AuditPanel() {
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync(
    () => api.getAuditLog({ entityType: entityType || undefined, action: action || undefined, limit: 200 }),
    [entityType, action]
  );

  const events = data ?? [];
  const shown = events.filter((a) => rowMatches(q, [a.changedBy, a.entityType, String(a.entityId), a.action]));
  const filtered = !!(entityType || action || q);

  return (
    <AdminPage
      icon={HistoryOutlined}
      title="Audit Log"
      subtitle="Every change to tickets, users, devices and settings: what changed, who changed it, and when. Newest first, last 200 events."
    >
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField select label="Entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} sx={{ minWidth: 160 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value="">All entities</MenuItem>
          {ENTITY_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
        </TextField>
        <TextField select label="Action" value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 140 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value="">All actions</MenuItem>
          {Object.entries(ACTIONS).map(([id, a]) => <MenuItem key={id} value={id}>{a.label}</MenuItem>)}
        </TextField>
        <PanelSearch value={q} onChange={setQ} placeholder="Filter by actor or entity…" />
      </Stack>

      {error ? <PanelError message={error} onRetry={reload} /> : (
        <Paper variant="outlined" sx={{ overflowX: "auto", opacity: loading ? 0.6 : 1, transition: "opacity 150ms" }} aria-busy={loading}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell><TableCell>Action</TableCell><TableCell>Entity</TableCell><TableCell>By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((a) => {
                const style = ACTIONS[a.action] ?? { tone: "neutral" as Tone, label: humanize(a.action) };
                const automated = a.changedBy?.startsWith("automation:");
                return (
                  <TableRow key={a.id}>
                    <TableCell><When iso={a.occurredAt} /></TableCell>
                    <TableCell><StatusChip tone={style.tone} label={style.label} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>{humanize(a.entityType)}</Typography>
                      <Typography variant="body2" component="span" sx={{ color: "text.secondary" }}> #{a.entityId}</Typography>
                    </TableCell>
                    <TableCell>
                      {automated
                        ? <StatusChip tone="info" label={actorLabel(a.changedBy!)} />
                        : a.changedBy ?? <Box component="span" sx={{ color: "text.secondary" }}>—</Box>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && events.length === 0 && !filtered && (
                <EmptyRow colSpan={4} icon={HistoryOutlined} title="No audit events yet">Changes appear here as soon as anyone edits a ticket, user or setting.</EmptyRow>
              )}
              {!loading && shown.length === 0 && filtered && (
                <EmptyRow
                  colSpan={4}
                  icon={SearchOffOutlined}
                  title="Nothing matches these filters"
                  action={<Button onClick={() => { setEntityType(""); setAction(""); setQ(""); }}>Clear filters</Button>}
                />
              )}
            </TableBody>
          </Table>
        </Paper>
      )}
    </AdminPage>
  );
}
