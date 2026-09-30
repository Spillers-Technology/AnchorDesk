import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import TimerOutlined from "@mui/icons-material/TimerOutlined";
import AddOutlined from "@mui/icons-material/AddOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import ChevronRight from "@mui/icons-material/ChevronRight";
import * as api from "../../api/client";
import { TICKET_PRIORITIES } from "../../ticketVocab";
import ConfirmDialog from "./ConfirmDialog";
import { AdminPage, EmptyRow, PanelError, PanelLoading, SectionCard, StatusChip, formatMinutes, useAdminToast, useAsync } from "./kit";

const EMPTY_FORM = { name: "", priority: "", companyId: "", responseMinutes: 60, resolutionMinutes: 480 };
const PRECEDENCE = ["Company + priority", "Company", "Priority", "Default"];

export default function SlaPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listSlaPolicies());
  const toast = useAdminToast();
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleting, setDeleting] = useState<api.SlaPolicy | null>(null);

  useEffect(() => { api.listCompanies().then(setCompanies).catch(() => setCompanies([])); }, []);

  const companyName = (id: number | null) => companies.find((c) => c.id === id)?.name ?? "Any";

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    if (await toast.run(fn, okText)) { reload(); return true; }
    return false;
  };

  const create = async () => {
    const ok = await act(() => api.createSlaPolicy({
      name: form.name,
      priority: form.priority || null,
      companyId: form.companyId ? Number(form.companyId) : null,
      responseMinutes: Number(form.responseMinutes),
      resolutionMinutes: Number(form.resolutionMinutes),
    }), `SLA policy “${form.name}” created`);
    if (ok) setForm(EMPTY_FORM);
  };

  if (loading && !data) return <PanelLoading />;
  if (error) return <PanelError message={error} onRetry={reload} />;

  const policies = data ?? [];
  const hasDefault = policies.some((p) => p.enabled && p.priority == null && p.companyId == null);
  const scope = (p: api.SlaPolicy) => p.companyId != null && p.priority ? 0 : p.companyId != null ? 1 : p.priority ? 2 : 3;

  return (
    <AdminPage
      icon={TimerOutlined}
      title="SLA Policies"
      subtitle="Response and resolution targets. Tickets are scored when created and whenever their priority or company changes."
      status={policies.length === 0 ? undefined : hasDefault ? <StatusChip tone="success" label="Default in place" /> : <StatusChip tone="warning" label="No catch-all default" />}
    >
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="overline" component="div" sx={{ color: "text.secondary", lineHeight: 1.6 }}>Most specific match wins</Typography>
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mt: 0.5 }}>
          {PRECEDENCE.map((step, i) => (
            <Stack key={step} direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <Chip size="small" label={`${i + 1}. ${step}`} color={i === 0 ? "primary" : "default"} variant={i === 0 ? "filled" : "outlined"} />
              {i < PRECEDENCE.length - 1 && <ChevronRight fontSize="small" sx={{ color: "text.secondary" }} />}
            </Stack>
          ))}
        </Stack>
        <Typography variant="caption" component="div" sx={{ color: "text.secondary", mt: 1 }}>
          Leave both company and priority empty to make a catch-all default. A ticket's manual due date always overrides the resolution target.
        </Typography>
      </Paper>

      <SectionCard icon={AddOutlined} title="Add policy">
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} useFlexGap sx={{ flexWrap: "wrap", alignItems: { sm: "flex-start" } }}>
          <TextField label="Name" value={form.name} placeholder="Standard" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField select label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} sx={{ minWidth: 140 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
            <MenuItem value="">Any priority</MenuItem>
            {TICKET_PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField select label="Company" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} sx={{ minWidth: 170 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
            <MenuItem value="">Any company</MenuItem>
            {companies.map((c) => <MenuItem key={c.id} value={String(c.id)}>{c.name}</MenuItem>)}
          </TextField>
          <TextField label="Response (min)" type="number" sx={{ width: { sm: 140 } }} value={form.responseMinutes} helperText={formatMinutes(form.responseMinutes)} onChange={(e) => setForm({ ...form, responseMinutes: Number(e.target.value) })} />
          <TextField label="Resolution (min)" type="number" sx={{ width: { sm: 150 } }} value={form.resolutionMinutes} helperText={formatMinutes(form.resolutionMinutes)} onChange={(e) => setForm({ ...form, resolutionMinutes: Number(e.target.value) })} />
          <Button variant="contained" disabled={!form.name.trim()} onClick={() => void create()} sx={{ mt: { sm: 0.25 } }}>Add</Button>
        </Stack>
      </SectionCard>

      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Policy</TableCell><TableCell>Applies to</TableCell>
              <TableCell>Response</TableCell><TableCell>Resolution</TableCell><TableCell>Enabled</TableCell><TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {[...policies].sort((a, b) => scope(a) - scope(b)).map((p) => (
              <TableRow key={p.id} sx={{ opacity: p.enabled ? 1 : 0.6 }}>
                <TableCell sx={{ fontWeight: 600 }}>{p.name}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                    {p.companyId == null && !p.priority
                      ? <Chip size="small" color="primary" variant="outlined" label="Everything (default)" />
                      : <>
                        {p.companyId != null && <Chip size="small" variant="outlined" label={companyName(p.companyId)} />}
                        {p.priority && <Chip size="small" variant="outlined" label={p.priority} />}
                      </>}
                  </Stack>
                </TableCell>
                <TableCell><Tooltip title={`${p.responseMinutes} minutes`}><Box component="span" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatMinutes(p.responseMinutes)}</Box></Tooltip></TableCell>
                <TableCell><Tooltip title={`${p.resolutionMinutes} minutes`}><Box component="span" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatMinutes(p.resolutionMinutes)}</Box></Tooltip></TableCell>
                <TableCell>
                  <Switch
                    checked={p.enabled}
                    onChange={(e) => void act(() => api.updateSlaPolicy(p.id, { enabled: e.target.checked }), `${p.name} ${e.target.checked ? "enabled" : "disabled"}`)}
                    slotProps={{ input: { "aria-label": `${p.enabled ? "Disable" : "Enable"} ${p.name}` } }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Delete policy"><IconButton color="error" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {policies.length === 0 && (
              <EmptyRow colSpan={6} icon={TimerOutlined} title="No SLA policies">
                Tickets won't carry response or resolution deadlines until one exists. Start with a catch-all default — no company, no priority — such as 4 h response and 3 d resolution.
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete SLA policy “${deleting?.name}”?`}
        body="Tickets already scored keep their current deadlines. New and re-scored tickets fall through to the next matching policy."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void act(() => api.deleteSlaPolicy(target.id), `${target.name} deleted`);
        }}
      />
    </AdminPage>
  );
}
