import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
import EmailOutlined from "@mui/icons-material/EmailOutlined";
import AddOutlined from "@mui/icons-material/AddOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import DownloadingOutlined from "@mui/icons-material/DownloadingOutlined";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";
import ConfirmDialog from "./ConfirmDialog";
import { LabelChip } from "./LabelsPanel";
import { AdminPage, EmptyRow, PanelError, PanelLoading, StatusChip, errText, hideOnPhone, monoSx, relativeTime, useAdminToast, useAsync } from "./kit";

type MailboxRow = api.Mailbox & { labelId?: number | null };
const EMPTY_FORM = { name: "", host: "", port: 993, secure: true, username: "", password: "", folder: "INBOX", companyName: "", labelId: "" as number | "", identityId: "" as number | "" };

export default function MailboxesPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listMailboxes());
  const toast = useAdminToast();
  const [labels, setLabels] = useState<api.Label[]>([]);
  const [identities, setIdentities] = useState<api.MailIdentity[]>([]);
  const [adding, setAdding] = useState(false);
  const [polling, setPolling] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<MailboxRow | null>(null);

  useEffect(() => {
    api.listLabels().then(setLabels).catch(() => setLabels([]));
    api.listAllMailIdentities().then(setIdentities).catch(() => setIdentities([]));
  }, []);

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    if (await toast.run(fn, okText)) reload();
  };
  const poll = async (m: MailboxRow) => {
    setPolling(m.id);
    try {
      const r = await api.pollMailbox(m.id);
      toast.notify(!r.error, r.error ?? `${m.name}: ${r.created} new ticket${r.created === 1 ? "" : "s"}, ${r.appended} repl${r.appended === 1 ? "y" : "ies"}`);
      reload();
    } catch (e) {
      toast.notify(false, errText(e));
    } finally {
      setPolling(null);
    }
  };

  if (loading && !data) return <PanelLoading />;
  if (error) return <PanelError message={error} onRetry={reload} />;

  const mailboxes = (data ?? []) as MailboxRow[];
  const failing = mailboxes.filter((m) => m.enabled && m.lastError).length;

  return (
    <AdminPage
      icon={EmailOutlined}
      title="Mailboxes"
      subtitle="Email-to-ticket. Each IMAP mailbox is polled: a new message opens a ticket, a reply threads into its original ticket as a note. Passwords are stored encrypted."
      status={mailboxes.length === 0 ? undefined : failing ? <StatusChip tone="error" label={`${failing} failing`} /> : <StatusChip tone="success" label="All healthy" />}
      actions={<Button variant="contained" startIcon={<AddOutlined />} onClick={() => setAdding(true)}>Add mailbox</Button>}
    >
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Mailbox</TableCell><TableCell sx={hideOnPhone}>Company</TableCell><TableCell sx={hideOnPhone}>Auto-label</TableCell>
              <TableCell>Health</TableCell><TableCell>Enabled</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mailboxes.map((m) => {
              const label = m.labelId ? labels.find((l) => l.id === m.labelId) : undefined;
              return (
                <TableRow key={m.id} sx={{ opacity: m.enabled ? 1 : 0.6 }}>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.name}</Typography>
                    <Typography variant="caption" component="div" noWrap title={m.username} sx={{ ...monoSx, color: "text.secondary", maxWidth: { xs: 170, sm: 320 } }}>{m.username}</Typography>
                    <Typography variant="caption" component="div" noWrap title={`${m.host}:${m.port}`} sx={{ ...monoSx, color: "text.secondary", maxWidth: { xs: 170, sm: 320 } }}>{m.host}:{m.port}</Typography>
                  </TableCell>
                  <TableCell sx={hideOnPhone}>{m.companyName ?? <Box component="span" sx={{ color: "text.secondary" }}>By sender domain</Box>}</TableCell>
                  <TableCell sx={hideOnPhone}>{label ? <LabelChip name={label.name} color={label.color} /> : <Box component="span" sx={{ color: "text.secondary" }}>—</Box>}</TableCell>
                  <TableCell>
                    {!m.enabled
                      ? <StatusChip tone="neutral" label="Paused" />
                      : m.lastError
                        ? (
                          // The reason is printed, not tooltip-only: it has to be readable on touch.
                          <Box sx={{ maxWidth: 260 }}>
                            <StatusChip tone="error" label="Failing" />
                            <Typography variant="caption" component="div" sx={{ color: "error.main", mt: 0.5, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {m.lastError}
                            </Typography>
                          </Box>
                        )
                        : m.lastPolledAt
                          ? <StatusChip tone="success" label={`Polled ${relativeTime(m.lastPolledAt)}`} title={new Date(m.lastPolledAt).toLocaleString()} />
                          : <StatusChip tone="info" label="Waiting for first poll" />}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={m.enabled}
                      onChange={(e) => void act(() => api.updateMailbox(m.id, { enabled: e.target.checked }), `${m.name} ${e.target.checked ? "resumed" : "paused"}`)}
                      slotProps={{ input: { "aria-label": `${m.enabled ? "Pause" : "Resume"} ${m.name}` } }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Button
                      size="small"
                      startIcon={polling === m.id ? <CircularProgress size={14} /> : <DownloadingOutlined />}
                      disabled={polling !== null}
                      onClick={() => void poll(m)}
                    >
                      Poll now
                    </Button>
                    <Tooltip title="Delete mailbox"><IconButton color="error" aria-label={`Delete ${m.name}`} onClick={() => setDeleting(m)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {mailboxes.length === 0 && (
              <EmptyRow colSpan={6} icon={EmailOutlined} title="No mailboxes yet" action={<Button variant="outlined" onClick={() => setAdding(true)}>Add a mailbox</Button>}>
                Add one to turn inbound email into tickets. Each mailbox can auto-apply a label so different inboxes land tagged.
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <AddMailboxDialog
        open={adding}
        labels={labels}
        identities={identities}
        onClose={() => setAdding(false)}
        onCreate={async (form) => {
          await api.createMailbox({
            ...form,
            labelId: form.labelId === "" ? null : form.labelId,
            identityId: form.identityId === "" ? null : form.identityId,
          });
          setAdding(false);
          toast.notify(true, `${form.name} added — it's polled on the next cycle`);
          reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete mailbox “${deleting?.name}”?`}
        body="AnchorDesk stops polling it. Tickets it already created, and their email threads, are kept. Nothing is deleted from the mail server."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void act(() => api.deleteMailbox(target.id), `${target.name} deleted`);
        }}
      />
    </AdminPage>
  );
}

function AddMailboxDialog({
  open,
  labels,
  identities,
  onClose,
  onCreate,
}: {
  open: boolean;
  labels: api.Label[];
  identities: api.MailIdentity[];
  onClose: () => void;
  onCreate: (form: typeof EMPTY_FORM) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm(EMPTY_FORM); setError(null); } }, [open]);
  const set = <K extends keyof typeof EMPTY_FORM>(k: K, v: (typeof EMPTY_FORM)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await onCreate(form); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>Add mailbox</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField required autoFocus label="Name" placeholder="Helpdesk inbox" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>IMAP server</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField required fullWidth label="Host" placeholder="imap.example.com" value={form.host} onChange={(e) => set("host", e.target.value)} />
            <TextField label="Port" type="number" value={form.port} sx={{ width: { sm: 110 } }} onChange={(e) => set("port", Number(e.target.value))} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField required fullWidth label="Username" value={form.username} onChange={(e) => set("username", e.target.value)} />
            <TextField fullWidth label="Password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
            <TextField fullWidth label="Folder" value={form.folder} onChange={(e) => set("folder", e.target.value)} />
            <FormControlLabel sx={{ flexShrink: 0 }} control={<Switch checked={form.secure} onChange={(e) => set("secure", e.target.checked)} />} label="TLS" />
          </Stack>
          <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1 }}>Where tickets land</Typography>
          <TextField label="Company" value={form.companyName} helperText="A known contact's company always wins. Otherwise tickets go here, or to the sender's domain if blank." onChange={(e) => set("companyName", e.target.value)} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select fullWidth label="Auto-apply label" value={form.labelId} onChange={(e) => set("labelId", e.target.value === "" ? "" : Number(e.target.value))} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">No label</MenuItem>
              {labels.map((l) => <MenuItem key={l.id} value={l.id}><LabelChip name={l.name} color={l.color} /></MenuItem>)}
            </TextField>
            <TextField select fullWidth label="Send-from identity" value={form.identityId} onChange={(e) => set("identityId", e.target.value === "" ? "" : Number(e.target.value))} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">Default From</MenuItem>
              {identities.map((i) => <MenuItem key={i.id} value={i.id}>{i.address}</MenuItem>)}
            </TextField>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={busy || !form.name.trim() || !form.host.trim() || !form.username.trim()} onClick={() => void submit()}>
          {busy ? "Adding…" : "Add mailbox"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
