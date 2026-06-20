import { useEffect, useState } from "react";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Switch,
  Button,
  Chip,
  TextField,
  Stack,
  Alert,
  CircularProgress,
  IconButton,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Divider from "@mui/material/Divider";
import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Card,
  CardContent,
  Grid,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PeopleIcon from "@mui/icons-material/People";
import SecurityIcon from "@mui/icons-material/Security";
import CableIcon from "@mui/icons-material/Cable";
import EmailIcon from "@mui/icons-material/Email";
import SyncIcon from "@mui/icons-material/Sync";
import RouterIcon from "@mui/icons-material/Router";
import DevicesIcon from "@mui/icons-material/Devices";
import HistoryIcon from "@mui/icons-material/History";
import * as api from "../api/client";

type AdminSection =
  | "overview" | "users" | "auth" | "integrations" | "mailboxes"
  | "providers" | "probes" | "devices" | "audit";

const NAV: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <DashboardIcon /> },
  { id: "users", label: "Users & Roles", icon: <PeopleIcon /> },
  { id: "auth", label: "Authentication", icon: <SecurityIcon /> },
  { id: "integrations", label: "Integrations", icon: <CableIcon /> },
  { id: "mailboxes", label: "Mailboxes", icon: <EmailIcon /> },
  { id: "providers", label: "Sync Providers", icon: <SyncIcon /> },
  { id: "probes", label: "Probes", icon: <RouterIcon /> },
  { id: "devices", label: "Devices", icon: <DevicesIcon /> },
  { id: "audit", label: "Audit Log", icon: <HistoryIcon /> },
];

const ROLES = ["admin", "technician", "readonly"];

/** Admin console — persistent left sub-nav with a content area per section. */
export default function AdminView() {
  const [section, setSection] = useState<AdminSection>("overview");

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
      <Paper variant="outlined" sx={{ width: { xs: "100%", md: 230 }, flexShrink: 0, position: { md: "sticky" }, top: { md: 88 } }}>
        <List dense disablePadding>
          {NAV.map((n) => (
            <ListItemButton key={n.id} selected={section === n.id} onClick={() => setSection(n.id)}>
              <ListItemIcon sx={{ minWidth: 38 }}>{n.icon}</ListItemIcon>
              <ListItemText primary={n.label} />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Box sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
        {section === "overview" && <OverviewPanel onNavigate={setSection} />}
        {section === "users" && <UsersPanel />}
        {section === "auth" && <AuthSettingsPanel />}
        {section === "integrations" && <IntegrationsPanel />}
        {section === "mailboxes" && <MailboxesPanel />}
        {section === "providers" && <ProvidersPanel />}
        {section === "probes" && <ProbesPanel />}
        {section === "devices" && <DevicesPanel />}
        {section === "audit" && <AuditPanel />}
      </Box>
    </Stack>
  );
}

function OverviewPanel({ onNavigate }: { onNavigate: (s: AdminSection) => void }) {
  const { data, loading, error } = useAsync(() => api.getAdminOverview());
  if (loading) return <CircularProgress />;
  if (error || !data) return <Alert severity="error">{error ?? "Failed to load"}</Alert>;

  const stats: { label: string; value: string; sub?: string; go: AdminSection }[] = [
    { label: "Open tickets", value: String(data.tickets.open), sub: `${data.tickets.total} total`, go: "overview" },
    { label: "Devices online", value: `${data.devices.online}/${data.devices.total}`, go: "devices" },
    { label: "Probes online", value: `${data.probes.online}/${data.probes.total}`, go: "probes" },
    { label: "Active users", value: String(data.users), go: "users" },
    { label: "Mailboxes", value: String(data.mailboxes), go: "mailboxes" },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Overview</Typography>
      <Grid container spacing={2}>
        {stats.map((s) => (
          <Grid item xs={6} sm={4} md={2.4} key={s.label}>
            <Card variant="outlined" sx={{ cursor: "pointer", "&:hover": { borderColor: "primary.main" } }} onClick={() => onNavigate(s.go)}>
              <CardContent>
                <Typography variant="h4">{s.value}</Typography>
                <Typography variant="body2" color="text.secondary">{s.label}</Typography>
                {s.sub && <Typography variant="caption" color="text.secondary">{s.sub}</Typography>}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Recent activity</Typography>
          <Button size="small" onClick={() => onNavigate("audit")}>View all</Button>
        </Stack>
        <Stack spacing={0.5}>
          {data.recentAudit.length === 0 && <Typography variant="body2" color="text.secondary">No activity yet.</Typography>}
          {data.recentAudit.map((a) => (
            <Box key={a.id} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Chip size="small" label={a.action} color={auditColor(a.action)} />
              <Typography variant="body2">
                {a.entityType} #{a.entityId} {a.changedBy ? `· ${a.changedBy}` : ""}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                {new Date(a.occurredAt).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}

function auditColor(action: string): "success" | "info" | "error" | "default" {
  return action === "create" ? "success" : action === "delete" ? "error" : action === "update" ? "info" : "default";
}

function UsersPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listUsers());
  const [form, setForm] = useState({ username: "", password: "", displayName: "", email: "", role: "technician" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ ok: true, text: okText });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };

  const create = () =>
    act(async () => {
      await api.createUser(form);
      setForm({ username: "", password: "", displayName: "", email: "", role: "technician" });
    }, "User created");

  const resetPw = async (id: number) => {
    const pw = window.prompt("New password (min 10 chars):");
    if (pw) act(() => api.setUserPassword(id, pw), "Password reset");
  };

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Create local account</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap" useFlexGap>
          <TextField size="small" label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextField size="small" label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <TextField size="small" label="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <TextField size="small" label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select size="small" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
          <Button variant="contained" disabled={!form.username || form.password.length < 10} onClick={create}>Create</Button>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>MFA</TableCell>
              <TableCell>Active</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.username}</TableCell>
                <TableCell>{u.displayName ?? "—"}</TableCell>
                <TableCell><Chip size="small" label={u.authProvider} /></TableCell>
                <TableCell>
                  <Select size="small" value={u.role} onChange={(e) => act(() => api.updateUser(u.id, { role: e.target.value }))}>
                    {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell>
                  <Chip size="small" color={u.mfaEnabled ? "success" : "default"} label={u.mfaEnabled ? "on" : "off"} />
                </TableCell>
                <TableCell>
                  <Switch checked={u.isActive} onChange={(e) => act(() => api.updateUser(u.id, { isActive: e.target.checked }))} />
                </TableCell>
                <TableCell align="right">
                  {u.authProvider === "local" && (
                    <Button size="small" onClick={() => resetPw(u.id)}>Reset PW</Button>
                  )}
                  <IconButton size="small" onClick={() => act(() => api.deleteUser(u.id))}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7}>No users.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function AuthSettingsPanel() {
  const { data, loading, error, reload } = useAsync(() => api.getAuthSettings());
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (loading) return <CircularProgress />;
  if (error || !data) return <Alert severity="error">{error ?? "Failed to load"}</Alert>;

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setMsg(null);
    try {
      await api.updateAuthSettings(draft);
      setDraft({});
      setMsg({ ok: true, text: "Auth settings saved" });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };
  const val = <T,>(k: string, current: T): T => (k in draft ? (draft[k] as T) : current);

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Alert severity="info">
        These settings are seeded from environment variables on first boot and become editable here. Secrets are write-only — leave blank to keep the current value.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">Local accounts & MFA</Typography>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 1 }} flexWrap="wrap">
          <label><Switch checked={val("localEnabled", data.localEnabled)} onChange={(e) => set("localEnabled", e.target.checked)} /> Username/password login</label>
          <label><Switch checked={val("mfaRequired", data.mfa.required)} onChange={(e) => set("mfaRequired", e.target.checked)} /> Require MFA (TOTP)</label>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">OIDC SSO {data.oidc.hasClientSecret && <Chip size="small" label="secret set" sx={{ ml: 1 }} />}</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <label><Switch checked={val("oidcEnabled", data.oidc.enabled)} onChange={(e) => set("oidcEnabled", e.target.checked)} /> Enabled</label>
          <TextField size="small" label="Issuer URL" defaultValue={data.oidc.issuerUrl ?? ""} onChange={(e) => set("oidcIssuerUrl", e.target.value)} />
          <TextField size="small" label="Client ID" defaultValue={data.oidc.clientId ?? ""} onChange={(e) => set("oidcClientId", e.target.value)} />
          <TextField size="small" label="Client secret (write-only)" type="password" placeholder="leave blank to keep" onChange={(e) => set("oidcClientSecret", e.target.value)} />
          <TextField size="small" label="Redirect URI (register with IdP)" value={data.oidc.redirectUri} InputProps={{ readOnly: true }} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">SAML SSO {data.saml.hasIdpCert && <Chip size="small" label="cert set" sx={{ ml: 1 }} />}</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <label><Switch checked={val("samlEnabled", data.saml.enabled)} onChange={(e) => set("samlEnabled", e.target.checked)} /> Enabled</label>
          <TextField size="small" label="IdP entry point (SSO URL)" defaultValue={data.saml.entryPoint ?? ""} onChange={(e) => set("samlEntryPoint", e.target.value)} />
          <TextField size="small" label="SP issuer / entity ID" defaultValue={data.saml.issuer ?? ""} onChange={(e) => set("samlIssuer", e.target.value)} />
          <TextField size="small" label="IdP signing certificate (PEM, write-only)" placeholder="leave blank to keep" multiline minRows={3} onChange={(e) => set("samlIdpCert", e.target.value)} />
          <TextField size="small" label="ACS / callback URL (register with IdP)" value={data.saml.callbackUrl} InputProps={{ readOnly: true }} />
        </Stack>
      </Paper>

      <Divider />
      <Box>
        <Button variant="contained" disabled={Object.keys(draft).length === 0} onClick={save}>Save changes</Button>
      </Box>
    </Stack>
  );
}

function errText(e: unknown): string {
  if (e instanceof api.ApiError) {
    try { const p = JSON.parse(e.body); if (p?.error) return p.error; } catch { /* ignore */ }
  }
  return (e as Error).message;
}

function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    loader()
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, loading, error, reload };
}

function ProvidersPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listSyncProviders() as Promise<any[]>);

  const toggle = async (id: number, enabled: boolean) => {
    await api.toggleSyncProvider(id, enabled);
    reload();
  };
  const run = async (name: string) => {
    await api.runSync(name);
    reload();
  };

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Paper variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Last Synced</TableCell>
            <TableCell>Enabled</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(data ?? []).map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.name}</TableCell>
              <TableCell><Chip size="small" label={p.type} /></TableCell>
              <TableCell>{p.lastSyncedAt ? new Date(p.lastSyncedAt).toLocaleString() : "never"}</TableCell>
              <TableCell>
                <Switch checked={!!p.enabled} onChange={(e) => toggle(p.id, e.target.checked)} />
              </TableCell>
              <TableCell align="right">
                <Button size="small" disabled={!p.enabled} onClick={() => run(p.name)}>Sync now</Button>
              </TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && (
            <TableRow><TableCell colSpan={5}>No sync providers configured.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}

function ProbesPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listProbes() as Promise<any[]>);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [cidr, setCidr] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const create = async () => {
    if (!name) return;
    const probe = await api.createProbe({ name, companyName: company || undefined, cidr: cidr || undefined });
    setNewKey(probe.apiKey);
    setName(""); setCompany(""); setCidr("");
    reload();
  };

  const statusColor = (s: string) => (s === "online" ? "success" : s === "error" ? "error" : "default");

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      {newKey && (
        <Alert severity="success" onClose={() => setNewKey(null)}>
          Probe API key (copy now — shown only once):{" "}
          <code style={{ wordBreak: "break-all" }}>{newKey}</code>
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Register a netviz probe</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField size="small" label="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
          <TextField size="small" label="CIDR" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="192.168.1.0/24" />
          <Button variant="contained" onClick={create} disabled={!name}>Register</Button>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Company</TableCell>
              <TableCell>CIDR</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last Seen</TableCell>
              <TableCell align="right"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.companyName ?? "—"}</TableCell>
                <TableCell>{p.cidr ?? "—"}</TableCell>
                <TableCell><Chip size="small" color={statusColor(p.status) as any} label={p.status} /></TableCell>
                <TableCell>{p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString() : "never"}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={async () => { await api.deleteProbe(p.id); reload(); }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6}>No probes registered.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function DevicesPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listDevices({ pageSize: 200 }) as Promise<any[]>);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const syncTactical = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.syncDevices();
      setSyncMsg(`Synced from ${r.provider}: ${r.created} created, ${r.updated} updated` + (r.errors?.length ? `, ${r.errors.length} errors` : ""));
      reload();
    } catch (e) {
      setSyncMsg((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <Box>
        <Button variant="contained" onClick={syncTactical} disabled={syncing}
          startIcon={syncing ? <CircularProgress size={16} /> : undefined}>
          Sync from Tactical RMM
        </Button>
        {syncMsg && <Alert severity="info" sx={{ mt: 1 }}>{syncMsg}</Alert>}
      </Box>
      <Paper variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Host / Name</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>MAC</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Source</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Last Seen</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(data ?? []).map((d) => (
            <TableRow key={d.id}>
              <TableCell>{d.displayName || d.hostname || "—"}</TableCell>
              <TableCell>{d.ipAddress ?? "—"}</TableCell>
              <TableCell>{d.macAddress ?? "—"}</TableCell>
              <TableCell>{d.deviceType ?? "—"}</TableCell>
              <TableCell><Chip size="small" label={d.source} /></TableCell>
              <TableCell>
                <Chip size="small" color={d.status === "online" ? "success" : "default"} label={d.status} />
              </TableCell>
              <TableCell>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "—"}</TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && (
            <TableRow><TableCell colSpan={7}>No devices yet — register a probe, sync from Tactical, or add one manually.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      </Paper>
    </Stack>
  );
}

function IntegrationsPanel() {
  const { data, loading, error, reload } = useAsync(() => api.getIntegrations());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (key: "smtp" | "connectwise" | "tactical", patch: Record<string, unknown>) => {
    setMsg(null);
    try {
      await api.updateIntegration(key, patch);
      setMsg({ ok: true, text: `${key} saved` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };

  if (loading) return <CircularProgress />;
  if (error || !data) return <Alert severity="error">{error ?? "Failed to load"}</Alert>;

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Typography variant="h5">Integrations</Typography>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Alert severity="info">Seeded from environment variables; edits here take effect immediately and override the env defaults. Secrets are write-only — leave blank to keep the current value.</Alert>

      <IntegrationCard
        title="SMTP (outbound email)"
        configured={!!data.smtp.host}
        fields={[
          { k: "host", label: "Host", value: data.smtp.host },
          { k: "port", label: "Port", value: data.smtp.port, type: "number" },
          { k: "user", label: "Username", value: data.smtp.user },
          { k: "pass", label: "Password", secret: true, has: data.smtp.hasPass },
          { k: "from", label: "From address", value: data.smtp.from },
          { k: "secure", label: "Implicit TLS (465)", value: data.smtp.secure, type: "bool" },
        ]}
        onSave={(patch) => save("smtp", patch)}
      />

      <IntegrationCard
        title="ConnectWise Manage"
        configured={!!data.connectwise.server}
        fields={[
          { k: "server", label: "Server", value: data.connectwise.server },
          { k: "company", label: "Company", value: data.connectwise.company },
          { k: "publicKey", label: "Public key", value: data.connectwise.publicKey },
          { k: "privateKey", label: "Private key", secret: true, has: data.connectwise.hasPrivateKey },
          { k: "clientId", label: "Client ID", secret: true, has: data.connectwise.hasClientId },
        ]}
        onSave={(patch) => save("connectwise", patch)}
      />

      <IntegrationCard
        title="Tactical RMM"
        configured={!!data.tactical.apiUrl}
        fields={[
          { k: "apiUrl", label: "API URL", value: data.tactical.apiUrl },
          { k: "apiKey", label: "API key", secret: true, has: data.tactical.hasApiKey },
        ]}
        onSave={(patch) => save("tactical", patch)}
      />
    </Stack>
  );
}

interface IField { k: string; label: string; value?: unknown; secret?: boolean; has?: boolean; type?: "number" | "bool" }

function IntegrationCard({ title, configured, fields, onSave }: { title: string; configured: boolean; fields: IField[]; onSave: (patch: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1">{title}</Typography>
        <Chip size="small" color={configured ? "success" : "default"} label={configured ? "configured" : "not set"} />
      </Stack>
      <Stack spacing={1.5}>
        {fields.map((f) =>
          f.type === "bool" ? (
            <label key={f.k}>
              <Switch checked={f.k in draft ? !!draft[f.k] : !!f.value} onChange={(e) => set(f.k, e.target.checked)} /> {f.label}
            </label>
          ) : (
            <TextField
              key={f.k}
              size="small"
              label={f.label}
              type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
              defaultValue={f.secret ? "" : (f.value ?? "")}
              placeholder={f.secret ? (f.has ? "•••••• (set — blank keeps)" : "not set") : undefined}
              onChange={(e) => set(f.k, f.type === "number" ? Number(e.target.value) : e.target.value)}
            />
          )
        )}
      </Stack>
      <Box sx={{ mt: 1.5 }}>
        <Button variant="contained" disabled={Object.keys(draft).length === 0} onClick={() => { onSave(draft); setDraft({}); }}>Save</Button>
      </Box>
    </Paper>
  );
}

function MailboxesPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listMailboxes());
  const [form, setForm] = useState({ name: "", host: "", port: 993, secure: true, username: "", password: "", folder: "INBOX", companyName: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); reload(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const create = () => act(async () => {
    await api.createMailbox(form);
    setForm({ name: "", host: "", port: 993, secure: true, username: "", password: "", folder: "INBOX", companyName: "" });
  }, "Mailbox added");
  const poll = (id: number) => act(async () => {
    const r = await api.pollMailbox(id);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `Polled: ${r.created} new tickets, ${r.appended} replies` });
  });

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Mailboxes (email-to-ticket)</Typography>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Alert severity="info">Each IMAP mailbox is polled for new mail: a new message opens a ticket; a reply threads into the original ticket as a note. Passwords are stored encrypted.</Alert>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Add mailbox</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} flexWrap="wrap" useFlexGap>
          <TextField size="small" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField size="small" label="IMAP host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          <TextField size="small" label="Port" type="number" value={form.port} sx={{ width: 90 }} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
          <TextField size="small" label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextField size="small" label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <TextField size="small" label="Company" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <Button variant="contained" disabled={!form.name || !form.host || !form.username} onClick={create}>Add</Button>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>Host</TableCell><TableCell>User</TableCell>
              <TableCell>Company</TableCell><TableCell>Enabled</TableCell><TableCell>Last poll</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data ?? []).map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.name}</TableCell>
                <TableCell>{m.host}:{m.port}</TableCell>
                <TableCell>{m.username}</TableCell>
                <TableCell>{m.companyName ?? "—"}</TableCell>
                <TableCell><Switch checked={m.enabled} onChange={(e) => act(() => api.updateMailbox(m.id, { enabled: e.target.checked }))} /></TableCell>
                <TableCell>
                  {m.lastError ? <Chip size="small" color="error" label="error" title={m.lastError} /> : m.lastPolledAt ? new Date(m.lastPolledAt).toLocaleString() : "never"}
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => poll(m.id)}>Poll now</Button>
                  <IconButton size="small" onClick={() => act(() => api.deleteMailbox(m.id))}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7}>No mailboxes configured.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function AuditPanel() {
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const { data, loading, error } = useAsync(
    () => api.getAuditLog({ entityType: entityType || undefined, action: action || undefined, limit: 200 }),
    [entityType, action]
  );

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Audit Log</Typography>
      <Stack direction="row" spacing={1}>
        <Select size="small" displayEmpty value={entityType} onChange={(e) => setEntityType(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All entities</MenuItem>
          {["ticket", "note", "device", "probe", "user", "mailbox"].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </Select>
        <Select size="small" displayEmpty value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 130 }}>
          <MenuItem value="">All actions</MenuItem>
          {["create", "update", "delete", "sync"].map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
        </Select>
      </Stack>

      {loading ? <CircularProgress /> : error ? <Alert severity="error">{error}</Alert> : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell><TableCell>Action</TableCell><TableCell>Entity</TableCell><TableCell>By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{new Date(a.occurredAt).toLocaleString()}</TableCell>
                  <TableCell><Chip size="small" label={a.action} color={auditColor(a.action)} /></TableCell>
                  <TableCell>{a.entityType} #{a.entityId}</TableCell>
                  <TableCell>{a.changedBy ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(data ?? []).length === 0 && <TableRow><TableCell colSpan={4}>No audit events.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
