import { useEffect, useState } from "react";
import {
  Box,
  Tab,
  Tabs,
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
import * as api from "../api/client";

type AdminTab = "users" | "auth" | "providers" | "probes" | "devices" | "mail";

const ROLES = ["admin", "technician", "readonly"];

/** Admin surface: users + auth, then sync providers, netviz probes, devices, mail. */
export default function AdminView() {
  const [tab, setTab] = useState<AdminTab>("users");

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1 }}>Admin</Typography>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
        <Tab label="Users" value="users" />
        <Tab label="Authentication" value="auth" />
        <Tab label="Sync Providers" value="providers" />
        <Tab label="Probes" value="probes" />
        <Tab label="Devices" value="devices" />
        <Tab label="Mail" value="mail" />
      </Tabs>

      {tab === "users" && <UsersPanel />}
      {tab === "auth" && <AuthSettingsPanel />}
      {tab === "providers" && <ProvidersPanel />}
      {tab === "probes" && <ProbesPanel />}
      {tab === "devices" && <DevicesPanel />}
      {tab === "mail" && <MailPanel />}
    </Box>
  );
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

function MailPanel() {
  const { data, loading, error } = useAsync(() => api.getMailStatus());

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Box>
          {data?.configured ? (
            <Chip color="success" label="SMTP configured" />
          ) : (
            <Chip color="warning" label="SMTP not configured" />
          )}
        </Box>
        <Typography variant="body2">Host: {data?.host ?? "—"}</Typography>
        <Typography variant="body2">Port: {data?.port}{data?.secure ? " (TLS)" : ""}</Typography>
        <Typography variant="body2">From: {data?.from}</Typography>
        <Alert severity="info" sx={{ mt: 1 }}>
          SMTP is configured via backend env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
          Once set, tickets can send email and outbound messages are recorded on the ticket timeline.
        </Alert>
      </Stack>
    </Paper>
  );
}
