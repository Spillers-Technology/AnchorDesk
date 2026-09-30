import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DevicesOutlined from "@mui/icons-material/DevicesOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteIcon from "@mui/icons-material/Delete";
import SyncOutlined from "@mui/icons-material/SyncOutlined";
import SearchOffOutlined from "@mui/icons-material/SearchOffOutlined";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";
import PanelSearch, { rowMatches } from "./PanelSearch";
import { AdminPage, EmptyRow, PanelError, PanelLoading, StatusChip, When, errText, hideOnPhone, monoSx, useAdminToast, useAsync } from "./kit";
import type { AdminSection } from "./nav";

export default function DevicesPanel({ onNavigate }: { onNavigate: (s: AdminSection) => void }) {
  const { data, loading, error, reload } = useAsync(() => api.listDevices({ pageSize: 200 }));
  const toast = useAdminToast();
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [rmms, setRmms] = useState<api.RmmProviderStatus[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<api.Device | null>(null);

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
    api.getRmmStatus().then((s) => setRmms(s.providers)).catch(() => setRmms([]));
  }, []);

  // Resolve an Autocomplete value (known Company or free-typed string) into the
  // {companyId, companyName} the API expects — mirrors the probe panel so a
  // device's company can be set/cleared inline, scoping ticket device pickers.
  const resolveCompany = (value: api.Company | string | null) => {
    if (!value) return { companyId: null, companyName: null };
    if (typeof value === "string") {
      const match = companies.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
      return match ? { companyId: match.id, companyName: match.name } : { companyId: null, companyName: value.trim() };
    }
    return { companyId: value.id, companyName: value.name };
  };

  const syncFrom = async (provider: string) => {
    setSyncing(provider);
    try {
      const r = await api.syncDevices(provider);
      const errors = r.errors?.length ?? 0;
      toast.notify(errors === 0, `Synced from ${r.provider}: ${r.created} created, ${r.updated} updated` + (errors ? `, ${errors} errors` : ""));
      reload();
    } catch (e) {
      toast.notify(false, errText(e));
    } finally {
      setSyncing(null);
    }
  };

  if (loading && !data) return <PanelLoading rows={6} />;
  if (error) return <PanelError message={error} onRetry={reload} />;

  const configuredRmms = rmms.filter((r) => r.configured);
  const devices = data ?? [];
  const shown = devices.filter((d) => rowMatches(q, [d.displayName, d.hostname, d.ipAddress, d.macAddress, d.assetTag, d.serialNumber, d.deviceType, d.companyName]));
  const online = devices.filter((d) => d.status === "online").length;

  return (
    <AdminPage
      icon={DevicesOutlined}
      title="Devices"
      subtitle="Every device probes discovered or RMMs reported, merged into one record per physical machine. Asset details you enter here survive re-syncs."
      status={devices.length > 0 ? <Chip size="small" label={`${online} of ${devices.length} online`} /> : undefined}
      actions={configuredRmms.length > 0
        ? configuredRmms.map((r) => (
          <Button key={r.key} variant="outlined" onClick={() => void syncFrom(r.key)} disabled={!!syncing}
            startIcon={syncing === r.key ? <CircularProgress size={16} /> : <SyncOutlined />}>
            Sync from {r.label}
          </Button>
        ))
        : <Button variant="outlined" startIcon={<SyncOutlined />} onClick={() => onNavigate("integrations")}>Connect an RMM</Button>}
    >
      <PanelSearch value={q} onChange={setQ} placeholder="Filter devices…" />
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Device</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Company</TableCell>
              <TableCell sx={hideOnPhone}>Asset</TableCell>
              <TableCell sx={hideOnPhone}>Last seen</TableCell>
              <TableCell sx={hideOnPhone}>Sources</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((d) => {
              const name = d.displayName || d.hostname || "—";
              const refs = (d.externalRefs ?? []).map((ref) => ref.provider);
              if (refs.length === 0 && d.externalProvider) refs.push(d.externalProvider);
              return (
                <TableRow key={d.id}>
                  <TableCell sx={{ minWidth: 180 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
                    <Typography variant="caption" component="div" sx={{ ...monoSx, color: "text.secondary" }}>
                      {[d.ipAddress, d.macAddress].filter(Boolean).join(" · ") || "No address"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {d.status === "online"
                      ? <StatusChip tone="success" label="Online" />
                      : <StatusChip tone="neutral" label={d.status ? d.status[0].toUpperCase() + d.status.slice(1) : "Unknown"} />}
                  </TableCell>
                  <TableCell sx={{ minWidth: 180 }}>
                    <Autocomplete
                      freeSolo
                      size="small"
                      options={companies}
                      getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
                      value={companies.find((c) => c.id === d.companyId) ?? d.companyName ?? null}
                      onChange={(_e, v) => void toast.run(() => api.updateDevice(d.id, resolveCompany(v as api.Company | string | null)), `${name} updated`).then((ok) => ok && reload())}
                      renderInput={(params) => <TextField {...params} variant="standard" placeholder="—" slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": `Company for ${name}` } }} />}
                    />
                  </TableCell>
                  <TableCell sx={hideOnPhone}>
                    <Typography variant="body2">{d.assetTag || d.serialNumber || "—"}</Typography>
                    {d.deviceType && <Typography variant="caption" sx={{ color: "text.secondary" }}>{d.deviceType}</Typography>}
                  </TableCell>
                  <TableCell sx={hideOnPhone}><When iso={d.lastSeenAt} /></TableCell>
                  <TableCell sx={hideOnPhone}>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                      <Chip size="small" label={d.source} />
                      {refs.map((provider, i) => <Chip key={`${provider}-${i}`} size="small" variant="outlined" color="primary" label={provider} />)}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Asset details">
                      <IconButton aria-label={`Edit ${d.displayName || d.hostname || "device"}`} onClick={() => setEditingDevice(d)}><EditOutlined fontSize="small" /></IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {devices.length === 0 && (
              <EmptyRow colSpan={7} icon={DevicesOutlined} title="No devices yet">
                Register a probe, sync from an RMM, or add one manually.
              </EmptyRow>
            )}
            {devices.length > 0 && shown.length === 0 && (
              <EmptyRow colSpan={7} icon={SearchOffOutlined} title={`No devices match “${q}”`} action={<Button onClick={() => setQ("")}>Clear filter</Button>} />
            )}
          </TableBody>
        </Table>
      </Paper>
      <DeviceEditorDialog
        open={!!editingDevice}
        device={editingDevice}
        onClose={() => setEditingDevice(null)}
        onSaved={() => { setEditingDevice(null); toast.notify(true, "Asset record saved"); reload(); }}
      />
    </AdminPage>
  );
}

function DeviceEditorDialog({
  open,
  device,
  onClose,
  onSaved,
}: {
  open: boolean;
  device: api.Device | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isPhone = useIsPhone();
  const emptyForm = {
    assetTag: "", serialNumber: "", manufacturer: "", model: "", vendor: "", location: "",
    purchaseDate: "", warrantyExpiresAt: "", notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [refs, setRefs] = useState<api.DeviceExternalRef[]>([]);
  const [provider, setProvider] = useState("tactical_rmm");
  const [externalId, setExternalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !device) return;
    const dateOnly = (value: string | null) => value ? value.slice(0, 10) : "";
    setForm({
      assetTag: device.assetTag ?? "",
      serialNumber: device.serialNumber ?? "",
      manufacturer: device.manufacturer ?? "",
      model: device.model ?? "",
      vendor: device.vendor ?? "",
      location: device.location ?? "",
      purchaseDate: dateOnly(device.purchaseDate),
      warrantyExpiresAt: dateOnly(device.warrantyExpiresAt),
      notes: device.notes ?? "",
    });
    setRefs(device.externalRefs ?? []);
    setExternalId("");
    setError(null);
    api.listDeviceExternalRefs(device.id).then(setRefs).catch(() => {});
  }, [open, device]);

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateDevice(device.id, Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value.trim() || null])
      ) as Partial<api.Device>);
      onSaved();
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  };
  const addRef = async () => {
    if (!device || !externalId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addDeviceExternalRef(device.id, { provider, externalId: externalId.trim() });
      setRefs(await api.listDeviceExternalRefs(device.id));
      setExternalId("");
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  };
  const removeRef = async (refId: number) => {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteDeviceExternalRef(device.id, refId);
      setRefs((current) => current.filter((ref) => ref.id !== refId));
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" fullScreen={isPhone}>
      <DialogTitle>Device details · {device?.displayName || device?.hostname || `#${device?.id ?? ""}`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="subtitle2">Asset record</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Asset tag" value={form.assetTag} onChange={(event) => set("assetTag", event.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Serial number" value={form.serialNumber} onChange={(event) => set("serialNumber", event.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Manufacturer" value={form.manufacturer} onChange={(event) => set("manufacturer", event.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Model" value={form.model} onChange={(event) => set("model", event.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Vendor" value={form.vendor} onChange={(event) => set("vendor", event.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Location" value={form.location} onChange={(event) => set("location", event.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth type="date" label="Purchase date" value={form.purchaseDate} onChange={(event) => set("purchaseDate", event.target.value)} slotProps={{
              inputLabel: { shrink: true }
            }} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth type="date" label="Warranty expires" value={form.warrantyExpiresAt} onChange={(event) => set("warrantyExpiresAt", event.target.value)} slotProps={{
              inputLabel: { shrink: true }
            }} /></Grid>
            <Grid size={12}><TextField fullWidth multiline minRows={3} label="Asset notes" value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Grid>
          </Grid>
          <Divider />
          <Typography variant="subtitle2">External RMM references</Typography>
          <Stack spacing={1}>
            {refs.map((ref) => (
              <Paper key={ref.id} variant="outlined" sx={{ p: 1, display: "flex", alignItems: "center", gap: 1 }}>
                <Chip size="small" color="primary" variant="outlined" label={ref.provider} />
                <Typography variant="body2" sx={{ flexGrow: 1, overflowWrap: "anywhere" }}>{ref.externalId}</Typography>
                <IconButton color="error" aria-label={`Remove ${ref.provider} reference`} disabled={busy} onClick={() => void removeRef(ref.id)}><DeleteIcon fontSize="small" /></IconButton>
              </Paper>
            ))}
            {refs.length === 0 && <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>No external references.</Typography>}
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField select label="Provider" value={provider} onChange={(event) => setProvider(event.target.value)} sx={{ minWidth: 170 }}>
              <MenuItem value="tactical_rmm">Tactical RMM</MenuItem>
              <MenuItem value="ninjaone">NinjaOne</MenuItem>
              <MenuItem value="datto_rmm">Datto RMM</MenuItem>
            </TextField>
            <TextField label="External device ID" value={externalId} onChange={(event) => setExternalId(event.target.value)} sx={{ flexGrow: 1 }} />
            <Button variant="outlined" disabled={busy || !externalId.trim()} onClick={() => void addRef()}>Add reference</Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save asset"}</Button></DialogActions>
    </Dialog>
  );
}
