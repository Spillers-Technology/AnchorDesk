import { useEffect, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  IconButton,
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
import RouterOutlined from "@mui/icons-material/RouterOutlined";
import AddOutlined from "@mui/icons-material/AddOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import KeyOutlined from "@mui/icons-material/KeyOutlined";
import * as api from "../../api/client";
import ConfirmDialog from "./ConfirmDialog";
import { AdminPage, CopyField, EmptyRow, PanelError, PanelLoading, SectionCard, StatusChip, When, hideOnPhone, monoSx, useAdminToast, useAsync, type Tone } from "./kit";

type ProbeRow = { id: number; name: string; companyId: number | null; companyName: string | null; cidr: string | null; status: string; lastSeenAt: string | null };

const STATUS: Record<string, { tone: Tone; label: string }> = {
  online: { tone: "success", label: "Online" },
  error: { tone: "error", label: "Error" },
  offline: { tone: "warning", label: "Offline" },
};

export default function ProbesPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listProbes() as Promise<ProbeRow[]>);
  const toast = useAdminToast();
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [name, setName] = useState("");
  const [company, setCompany] = useState<api.Company | string | null>(null);
  const [cidr, setCidr] = useState("");
  const [newKey, setNewKey] = useState<{ probe: string; key: string } | null>(null);
  const [deleting, setDeleting] = useState<ProbeRow | null>(null);

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, []);

  // Resolve an Autocomplete value (known Company object or free-typed string)
  // into the {companyId, companyName} the API expects.
  const resolveCompany = (value: api.Company | string | null) => {
    if (!value) return { companyId: null, companyName: undefined };
    if (typeof value === "string") {
      const match = companies.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
      return match ? { companyId: match.id } : { companyName: value.trim() };
    }
    return { companyId: value.id };
  };

  const create = async () => {
    if (!name.trim()) return;
    const probeName = name.trim();
    await toast.run(async () => {
      const probe = await api.createProbe({ name: probeName, ...resolveCompany(company), cidr: cidr || undefined });
      setNewKey({ probe: probeName, key: probe.apiKey });
      setName(""); setCompany(null); setCidr("");
      reload();
    });
  };

  if (loading && !data) return <PanelLoading />;
  if (error) return <PanelError message={error} onRetry={reload} />;

  const probes = data ?? [];
  const online = probes.filter((p) => p.status === "online").length;

  return (
    <AdminPage
      icon={RouterOutlined}
      title="Probes"
      subtitle="netviz probes scan a network and report what they find. Discovered devices feed the Network map and the device list automatically."
      status={probes.length === 0 ? undefined : online === probes.length ? <StatusChip tone="success" label={`All ${probes.length} online`} /> : <StatusChip tone="warning" label={`${online} of ${probes.length} online`} />}
    >
      {newKey && (
        <SectionCard
          icon={KeyOutlined}
          title={`API key for ${newKey.probe}`}
          status={<StatusChip tone="warning" label="Shown once" />}
          action={<Button onClick={() => setNewKey(null)}>I've copied it</Button>}
        >
          <Stack spacing={1.5}>
            <CopyField label="Probe API key" value={newKey.key} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Paste it into the probe's configuration with this server's <Box component="code" sx={monoSx}>/probe</Box> endpoint. It's never shown again — if it's lost, delete the probe and register it again.
            </Typography>
          </Stack>
        </SectionCard>
      )}

      <SectionCard icon={AddOutlined} title="Register a netviz probe">
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Autocomplete
            freeSolo
            size="small"
            sx={{ minWidth: 220, flexGrow: 1 }}
            options={companies}
            getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
            value={company}
            onChange={(_e, v) => setCompany(v)}
            onInputChange={(_e, v) => setCompany(v)}
            renderInput={(params) => <TextField {...params} label="Company" placeholder="Link to a company" />}
          />
          <TextField label="CIDR" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="192.168.1.0/24" slotProps={{ htmlInput: { style: monoSx } }} />
          <Button variant="contained" onClick={() => void create()} disabled={!name.trim()}>Register</Button>
        </Stack>
      </SectionCard>

      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Probe</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Company</TableCell>
              <TableCell sx={hideOnPhone}>Last seen</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {probes.map((p) => {
              const status = STATUS[p.status] ?? { tone: "neutral" as Tone, label: p.status };
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.name}</Typography>
                    <Typography variant="caption" sx={{ ...monoSx, color: "text.secondary" }}>{p.cidr ?? "No range set"}</Typography>
                  </TableCell>
                  <TableCell><StatusChip tone={status.tone} label={status.label} /></TableCell>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Autocomplete
                      freeSolo
                      size="small"
                      options={companies}
                      getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
                      value={companies.find((c) => c.id === p.companyId) ?? p.companyName ?? null}
                      onChange={(_e, v) => void toast.run(() => api.updateProbe(p.id, resolveCompany(v as api.Company | string | null)), `${p.name} linked`).then((ok) => ok && reload())}
                      renderInput={(params) => <TextField {...params} variant="standard" placeholder="—" slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": `Company for ${p.name}` } }} />}
                    />
                  </TableCell>
                  <TableCell sx={hideOnPhone}><When iso={p.lastSeenAt} /></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Delete probe"><IconButton color="error" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {probes.length === 0 && (
              <EmptyRow colSpan={5} icon={RouterOutlined} title="No probes registered">
                Register one above, then deploy a netviz probe pointed at <Box component="code" sx={monoSx}>/probe</Box> — discovered devices feed the Network map automatically.
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete probe “${deleting?.name}”?`}
        body="Its API key stops working immediately. Devices it already discovered stay in the device list."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void toast.run(() => api.deleteProbe(target.id), `${target.name} deleted`).then((ok) => ok && reload());
        }}
      />
    </AdminPage>
  );
}
