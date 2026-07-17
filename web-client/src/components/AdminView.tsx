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
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
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
  ListSubheader,
  Card,
  CardContent,
  Grid,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PeopleIcon from "@mui/icons-material/People";
import SecurityIcon from "@mui/icons-material/Security";
import CableIcon from "@mui/icons-material/Cable";
import EmailIcon from "@mui/icons-material/Email";
import RouterIcon from "@mui/icons-material/Router";
import DevicesIcon from "@mui/icons-material/Devices";
import HistoryIcon from "@mui/icons-material/History";
import TimerIcon from "@mui/icons-material/Timer";
import LabelIcon from "@mui/icons-material/Label";
import TuneIcon from "@mui/icons-material/Tune";
import GroupsIcon from "@mui/icons-material/Groups";
import DynamicFormIcon from "@mui/icons-material/DynamicForm";
import BoltIcon from "@mui/icons-material/Bolt";
import ChecklistIcon from "@mui/icons-material/Checklist";
import AlternateEmailIcon from "@mui/icons-material/AlternateEmail";
import EditIcon from "@mui/icons-material/Edit";
import { useSearchParams } from "react-router-dom";
import * as api from "../api/client";
import { TICKET_PRIORITIES } from "../ticketVocab";
import { useIsPhone } from "../theme/useIsPhone";
import ChecklistTemplatesPanel from "./admin/ChecklistTemplatesPanel";
import ConfirmDialog from "./admin/ConfirmDialog";
import PanelSearch, { rowMatches } from "./admin/PanelSearch";
import {
  ActionDraft,
  ActionRowsEditor,
  ConditionDraft,
  ConditionRowsEditor,
  RuleReferences,
  conditionsToDrafts,
  defaultAction,
  draftsToConditions,
  normalizeActions,
} from "./admin/AutomationRuleEditor";

type AdminSection =
  | "overview" | "users" | "auth" | "integrations" | "interface" | "sla" | "mailboxes" | "mail" | "labels"
  | "teams" | "custom-fields" | "checklists" | "automations" | "probes" | "devices" | "audit";

/** Rail sections grouped the way admins think about them. */
const NAV_GROUPS: { heading: string | null; items: { id: AdminSection; label: string; icon: React.ReactNode }[] }[] = [
  {
    heading: null,
    items: [{ id: "overview", label: "Overview", icon: <DashboardIcon /> }],
  },
  {
    heading: "People & Access",
    items: [
      { id: "users", label: "Users & Roles", icon: <PeopleIcon /> },
      { id: "auth", label: "Authentication", icon: <SecurityIcon /> },
      { id: "teams", label: "Teams", icon: <GroupsIcon /> },
    ],
  },
  {
    heading: "Ticketing",
    items: [
      { id: "sla", label: "SLA Policies", icon: <TimerIcon /> },
      { id: "labels", label: "Labels", icon: <LabelIcon /> },
      { id: "custom-fields", label: "Custom Fields", icon: <DynamicFormIcon /> },
      { id: "checklists", label: "Checklists", icon: <ChecklistIcon /> },
      { id: "automations", label: "Automations", icon: <BoltIcon /> },
      { id: "interface", label: "Interface", icon: <TuneIcon /> },
    ],
  },
  {
    heading: "Channels & Integrations",
    items: [
      { id: "mailboxes", label: "Mailboxes", icon: <EmailIcon /> },
      { id: "mail", label: "Mail Identities", icon: <AlternateEmailIcon /> },
      { id: "integrations", label: "Integrations", icon: <CableIcon /> },
    ],
  },
  {
    heading: "Infrastructure",
    items: [
      { id: "probes", label: "Probes", icon: <RouterIcon /> },
      { id: "devices", label: "Devices", icon: <DevicesIcon /> },
      { id: "audit", label: "Audit Log", icon: <HistoryIcon /> },
    ],
  },
];

const NAV_IDS = new Set<AdminSection>(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));

const ROLES = ["admin", "technician", "readonly"];

/**
 * Admin console — persistent left sub-nav with a content area per section.
 * The active section lives in the `?admin=` query param so sections are
 * deep-linkable, survive refresh, and honor the browser back button.
 */
export default function AdminView({ onOpenTickets }: { onOpenTickets?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("admin") as AdminSection | null;
  const section: AdminSection = raw && NAV_IDS.has(raw) ? raw : "overview";
  const setSection = (next: AdminSection) => {
    setSearchParams((params) => {
      params.set("admin", next);
      return params;
    });
  };

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{
      alignItems: "flex-start"
    }}>
      <Paper variant="outlined" sx={{ width: { xs: "100%", md: 230 }, maxWidth: "100%", minWidth: 0, flexShrink: 0, position: { md: "sticky" }, top: { md: 88 }, overflowX: { xs: "auto", md: "hidden" } }}>
        <List dense disablePadding sx={{ display: { xs: "flex", md: "block" }, width: { xs: "max-content", md: "auto" }, minWidth: { xs: "100%", md: 0 }, py: { xs: 0.5, md: 0 } }}>
          {NAV_GROUPS.map((group) => (
            <Box key={group.heading ?? "top"} sx={{ display: { xs: "contents", md: "block" } }}>
              {group.heading && (
                <ListSubheader disableSticky sx={{ lineHeight: "30px", display: { xs: "none", md: "block" } }}>
                  {group.heading}
                </ListSubheader>
              )}
              {group.items.map((n) => (
                <ListItemButton key={n.id} selected={section === n.id} onClick={() => setSection(n.id)} sx={{ flex: { xs: "0 0 auto", md: "initial" }, minWidth: { xs: 155, md: 0 } }}>
                  <ListItemIcon sx={{ minWidth: 38 }}>{n.icon}</ListItemIcon>
                  <ListItemText primary={n.label} />
                </ListItemButton>
              ))}
            </Box>
          ))}
        </List>
      </Paper>
      <Box sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
        {section === "overview" && <OverviewPanel onNavigate={setSection} onOpenTickets={onOpenTickets} />}
        {section === "users" && <UsersPanel />}
        {section === "auth" && <AuthSettingsPanel />}
        {section === "integrations" && <IntegrationsPanel />}
        {section === "interface" && <InterfacePanel />}
        {section === "sla" && <SlaPanel />}
        {section === "mailboxes" && <MailboxesPanel />}
        {section === "mail" && <MailIdentitiesPanel />}
        {section === "labels" && <LabelsPanel />}
        {section === "teams" && <TeamsPanel />}
        {section === "custom-fields" && <CustomFieldsPanel />}
        {section === "checklists" && <ChecklistTemplatesPanel />}
        {section === "automations" && <AutomationsPanel />}
        {section === "probes" && <ProbesPanel />}
        {section === "devices" && <DevicesPanel />}
        {section === "audit" && <AuditPanel />}
      </Box>
    </Stack>
  );
}

function OverviewPanel({ onNavigate, onOpenTickets }: { onNavigate: (s: AdminSection) => void; onOpenTickets?: () => void }) {
  const { data, loading, error } = useAsync(() => api.getAdminOverview());
  if (loading) return <CircularProgress />;
  if (error || !data) return <Alert severity="error">{error ?? "Failed to load"}</Alert>;

  const stats: { label: string; value: string; sub?: string; go?: AdminSection; onClick?: () => void }[] = [
    { label: "Open tickets", value: String(data.tickets.open), sub: `${data.tickets.total} total`, onClick: onOpenTickets },
    { label: "Devices online", value: `${data.devices.online}/${data.devices.total}`, go: "devices" },
    { label: "Probes online", value: `${data.probes.online}/${data.probes.total}`, go: "probes" },
    { label: "Active users", value: String(data.users), go: "users" },
    { label: "Mailboxes", value: String(data.mailboxes), go: "mailboxes" },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Overview</Typography>
      {/* Box wrapper: Stack's child-margin shorthand would zero the Grid
          container's negative margin and overflow the viewport on phones. */}
      <Box>
        <Grid container spacing={2}>
          {stats.map((s) => (
            <Grid size={{ xs: 6, sm: 4, md: 2.4 }} key={s.label}>
              <Card variant="outlined" sx={{ cursor: "pointer", "&:hover": { borderColor: "primary.main" } }} onClick={() => (s.onClick ? s.onClick() : s.go && onNavigate(s.go))}>
                <CardContent>
                  <Typography variant="h4">{s.value}</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>{s.label}</Typography>
                  {s.sub && <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{s.sub}</Typography>}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1
          }}>
          <Typography variant="subtitle2">Recent activity</Typography>
          <Button size="small" onClick={() => onNavigate("audit")}>View all</Button>
        </Stack>
        <Stack spacing={0.5}>
          {data.recentAudit.length === 0 && <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>No activity yet.</Typography>}
          {data.recentAudit.map((a) => (
            <Box key={a.id} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Chip size="small" label={a.action} color={auditColor(a.action)} />
              <Typography variant="body2">
                {a.entityType} #{a.entityId} {a.changedBy ? `· ${a.changedBy}` : ""}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  ml: "auto"
                }}>
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
  const [q, setQ] = useState("");
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
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{
          flexWrap: "wrap"
        }}>
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
      <PanelSearch value={q} onChange={setQ} placeholder="Filter users…" />
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
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
            {(data ?? []).filter((u) => rowMatches(q, [u.username, u.displayName, u.email, u.role])).map((u) => (
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
        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            flexWrap: "wrap",
            mt: 1
          }}>
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
          <TextField size="small" label="Redirect URI (register with IdP)" value={data.oidc.redirectUri} slotProps={{
            input: { readOnly: true }
          }} />
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">SAML SSO {data.saml.hasIdpCert && <Chip size="small" label="cert set" sx={{ ml: 1 }} />}</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <label><Switch checked={val("samlEnabled", data.saml.enabled)} onChange={(e) => set("samlEnabled", e.target.checked)} /> Enabled</label>
          <TextField size="small" label="IdP entry point (SSO URL)" defaultValue={data.saml.entryPoint ?? ""} onChange={(e) => set("samlEntryPoint", e.target.value)} />
          <TextField size="small" label="SP issuer / entity ID" defaultValue={data.saml.issuer ?? ""} onChange={(e) => set("samlIssuer", e.target.value)} />
          <TextField size="small" label="IdP signing certificate (PEM, write-only)" placeholder="leave blank to keep" multiline minRows={3} onChange={(e) => set("samlIdpCert", e.target.value)} />
          <TextField size="small" label="ACS / callback URL (register with IdP)" value={data.saml.callbackUrl} slotProps={{
            input: { readOnly: true }
          }} />
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

function InterfacePanel() {
  const { data, loading, error, reload } = useAsync(() => api.getUiSettings());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const setLegacyTable = async (enabled: boolean) => {
    setSaving(true);
    setMsg(null);
    try {
      await api.updateUiSettings({ legacyTableView: enabled });
      reload();
      setMsg(enabled ? "Legacy table view enabled for everyone." : "Legacy table view hidden.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <CircularProgress />;
  if (error || !data) return <Alert severity="error">{error ?? "Failed to load"}</Alert>;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Interface</Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <Box>
            <Typography variant="subtitle2">Legacy table view</Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                maxWidth: 560
              }}>
              Adds the older DataGrid table to the ticket view switcher (Board · Cards · Table).
              Board and Cards are the primary views — leave this off unless someone relies on the table.
            </Typography>
          </Box>
          <Switch
            checked={data.legacyTableView}
            disabled={saving}
            onChange={(e) => setLegacyTable(e.target.checked)}
          />
        </Stack>
        {msg && <Alert severity="info" sx={{ mt: 2 }}>{msg}</Alert>}
      </Paper>
    </Stack>
  );
}

function ProbesPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listProbes() as Promise<any[]>);
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [name, setName] = useState("");
  const [company, setCompany] = useState<api.Company | string | null>(null);
  const [cidr, setCidr] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

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
    if (!name) return;
    const probe = await api.createProbe({ name, ...resolveCompany(company), cidr: cidr || undefined });
    setNewKey(probe.apiKey);
    setName(""); setCompany(null); setCidr("");
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
          <Autocomplete
            freeSolo
            size="small"
            sx={{ minWidth: 200 }}
            options={companies}
            getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
            value={company}
            onChange={(_e, v) => setCompany(v)}
            onInputChange={(_e, v) => setCompany(v)}
            renderInput={(params) => <TextField {...params} label="Company" placeholder="Link to a company" />}
          />
          <TextField size="small" label="CIDR" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="192.168.1.0/24" />
          <Button variant="contained" onClick={create} disabled={!name}>Register</Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
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
                <TableCell sx={{ minWidth: 200 }}>
                  <Autocomplete
                    freeSolo
                    size="small"
                    options={companies}
                    getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
                    value={companies.find((c) => c.id === p.companyId) ?? p.companyName ?? null}
                    onChange={async (_e, v) => {
                      await api.updateProbe(p.id, resolveCompany(v as api.Company | string | null));
                      reload();
                    }}
                    renderInput={(params) => <TextField {...params} variant="standard" placeholder="—" />}
                  />
                </TableCell>
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
  const { data, loading, error, reload } = useAsync(() => api.listDevices({ pageSize: 200 }));
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [rmms, setRmms] = useState<api.RmmProviderStatus[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
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
    setSyncMsg(null);
    try {
      const r = await api.syncDevices(provider);
      setSyncMsg(`Synced from ${r.provider}: ${r.created} created, ${r.updated} updated` + (r.errors?.length ? `, ${r.errors.length} errors` : ""));
      reload();
    } catch (e) {
      setSyncMsg((e as Error).message);
    } finally {
      setSyncing(null);
    }
  };

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  const configuredRmms = rmms.filter((r) => r.configured);

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{
          flexWrap: "wrap"
        }}>
          {configuredRmms.map((r) => (
            <Button key={r.key} variant="contained" onClick={() => syncFrom(r.key)} disabled={!!syncing}
              startIcon={syncing === r.key ? <CircularProgress size={16} /> : undefined}>
              Sync from {r.label}
            </Button>
          ))}
          {configuredRmms.length === 0 && (
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              No RMM configured — add one under Admin → Integrations to sync devices.
            </Typography>
          )}
        </Stack>
        {syncMsg && <Alert severity="info" sx={{ mt: 1 }}>{syncMsg}</Alert>}
      </Box>
      <PanelSearch value={q} onChange={setQ} placeholder="Filter devices…" />
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Host / Name</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>MAC</TableCell>
            <TableCell>Asset</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Company</TableCell>
            <TableCell>Source</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Last Seen</TableCell>
            <TableCell>RMM refs</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(data ?? []).filter((d) => rowMatches(q, [d.displayName, d.hostname, d.ipAddress, d.macAddress, d.assetTag, d.serialNumber, d.deviceType, d.companyName])).map((d) => (
            <TableRow key={d.id}>
              <TableCell>{d.displayName || d.hostname || "—"}</TableCell>
              <TableCell>{d.ipAddress ?? "—"}</TableCell>
              <TableCell>{d.macAddress ?? "—"}</TableCell>
              <TableCell>{d.assetTag || d.serialNumber || "—"}</TableCell>
              <TableCell>{d.deviceType ?? "—"}</TableCell>
              <TableCell sx={{ minWidth: 180 }}>
                <Autocomplete
                  freeSolo
                  size="small"
                  options={companies}
                  getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
                  value={companies.find((c) => c.id === d.companyId) ?? d.companyName ?? null}
                  onChange={async (_e, v) => {
                    await api.updateDevice(d.id, resolveCompany(v as api.Company | string | null));
                    reload();
                  }}
                  renderInput={(params) => <TextField {...params} variant="standard" placeholder="—" />}
                />
              </TableCell>
              <TableCell><Chip size="small" label={d.source} /></TableCell>
              <TableCell>
                <Chip size="small" color={d.status === "online" ? "success" : "default"} label={d.status} />
              </TableCell>
              <TableCell>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "—"}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5} useFlexGap sx={{
                  flexWrap: "wrap"
                }}>
                  {(d.externalRefs ?? []).map((ref) => <Chip key={ref.id} size="small" variant="outlined" label={ref.provider} />)}
                  {(d.externalRefs ?? []).length === 0 && d.externalProvider && <Chip size="small" variant="outlined" label={d.externalProvider} />}
                  {(d.externalRefs ?? []).length === 0 && !d.externalProvider && "—"}
                </Stack>
              </TableCell>
              <TableCell align="right"><IconButton aria-label={`Edit ${d.displayName || d.hostname || "device"}`} onClick={() => setEditingDevice(d)}><EditIcon /></IconButton></TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && (
            <TableRow><TableCell colSpan={11}>No devices yet — register a probe, sync from an RMM, or add one manually.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      </Paper>
      <DeviceEditorDialog
        open={!!editingDevice}
        device={editingDevice}
        onClose={() => setEditingDevice(null)}
        onSaved={() => { setEditingDevice(null); reload(); }}
      />
    </Stack>
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

function IntegrationsPanel() {
  const { data, loading, error, reload } = useAsync(() => api.getIntegrations());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (key: "smtp" | "connectwise" | "jira" | "tactical" | "ninjaone" | "datto" | "storage" | "tickets", patch: Record<string, unknown>) => {
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
        title="Ticket numbering"
        configured
        fields={[
          { k: "numberDigits", label: "Ticket number digits (4–6)", value: data.tickets.numberDigits ?? 5, type: "number" },
        ]}
        onSave={(patch) => save("tickets", patch)}
      />

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
        title="Jira Cloud (two-way tickets)"
        configured={!!data.jira.baseUrl && !!data.jira.email}
        fields={[
          { k: "baseUrl", label: "Site URL (e.g. https://org.atlassian.net)", value: data.jira.baseUrl },
          { k: "email", label: "Account email", value: data.jira.email },
          { k: "apiToken", label: "API token", secret: true, has: data.jira.hasApiToken },
          { k: "projectKey", label: "Project key (optional)", value: data.jira.projectKey },
          { k: "jql", label: "JQL filter (optional)", value: data.jira.jql },
        ]}
        onSave={(patch) => save("jira", patch)}
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

      <IntegrationCard
        title="NinjaOne RMM"
        configured={!!data.ninjaone.apiUrl && !!data.ninjaone.clientId}
        fields={[
          { k: "apiUrl", label: "API URL (regional host, e.g. https://app.ninjarmm.com)", value: data.ninjaone.apiUrl },
          { k: "clientId", label: "Client ID", value: data.ninjaone.clientId },
          { k: "clientSecret", label: "Client secret", secret: true, has: data.ninjaone.hasClientSecret },
          { k: "scope", label: "Scope (e.g. monitoring management)", value: data.ninjaone.scope },
        ]}
        onSave={(patch) => save("ninjaone", patch)}
      />

      <IntegrationCard
        title="Datto RMM"
        configured={!!data.datto.apiUrl && !!data.datto.apiKey}
        fields={[
          { k: "apiUrl", label: "API URL (platform host, e.g. https://merlot-api.centrastage.net)", value: data.datto.apiUrl },
          { k: "apiKey", label: "API key", value: data.datto.apiKey },
          { k: "apiSecretKey", label: "API secret key", secret: true, has: data.datto.hasApiSecretKey },
        ]}
        onSave={(patch) => save("datto", patch)}
      />

      <IntegrationCard
        title="Attachment storage"
        configured={data.storage.backend === "s3" ? !!data.storage.s3Bucket : true}
        fields={[
          { k: "backend", label: "Backend", value: data.storage.backend ?? "local", type: "select", options: ["local", "s3"] },
          { k: "localDir", label: "Local directory (local backend)", value: data.storage.localDir },
          { k: "s3Bucket", label: "S3 bucket", value: data.storage.s3Bucket },
          { k: "s3Endpoint", label: "S3 endpoint (MinIO/R2/B2)", value: data.storage.s3Endpoint },
          { k: "s3Region", label: "S3 region", value: data.storage.s3Region },
          { k: "s3AccessKeyId", label: "S3 access key ID", value: data.storage.s3AccessKeyId },
          { k: "s3SecretAccessKey", label: "S3 secret access key", secret: true, has: data.storage.hasS3SecretAccessKey },
          { k: "s3ForcePathStyle", label: "Force path-style (MinIO/B2)", value: data.storage.s3ForcePathStyle, type: "bool" },
        ]}
        onSave={(patch) => save("storage", patch)}
      />
    </Stack>
  );
}

interface IField { k: string; label: string; value?: unknown; secret?: boolean; has?: boolean; type?: "number" | "bool" | "select"; options?: string[] }

function IntegrationCard({ title, configured, fields, onSave }: { title: string; configured: boolean; fields: IField[]; onSave: (patch: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          mb: 1
        }}>
        <Typography variant="subtitle1">{title}</Typography>
        <Chip size="small" color={configured ? "success" : "default"} label={configured ? "configured" : "not set"} />
      </Stack>
      <Stack spacing={1.5}>
        {fields.map((f) =>
          f.type === "bool" ? (
            <label key={f.k}>
              <Switch checked={f.k in draft ? !!draft[f.k] : !!f.value} onChange={(e) => set(f.k, e.target.checked)} /> {f.label}
            </label>
          ) : f.type === "select" ? (
            <Box key={f.k}>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{f.label}</Typography>
              <Select fullWidth size="small" value={f.k in draft ? String(draft[f.k]) : String(f.value ?? "")}
                onChange={(e) => set(f.k, e.target.value)}>
                {(f.options ?? []).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
              </Select>
            </Box>
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
  const [labels, setLabels] = useState<api.Label[]>([]);
  const [identities, setIdentities] = useState<api.MailIdentity[]>([]);
  const [form, setForm] = useState({ name: "", host: "", port: 993, secure: true, username: "", password: "", folder: "INBOX", companyName: "", labelId: "" as number | "", identityId: "" as number | "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.listLabels().then(setLabels).catch(() => setLabels([]));
    api.listAllMailIdentities().then(setIdentities).catch(() => setIdentities([]));
  }, []);
  const labelName = (id: unknown) => labels.find((l) => l.id === id)?.name ?? "—";

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); reload(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const create = () => act(async () => {
    await api.createMailbox({
      ...form,
      labelId: form.labelId === "" ? null : form.labelId,
      identityId: form.identityId === "" ? null : form.identityId,
    });
    setForm({ name: "", host: "", port: 993, secure: true, username: "", password: "", folder: "INBOX", companyName: "", labelId: "", identityId: "" });
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
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{
          flexWrap: "wrap"
        }}>
          <TextField size="small" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField size="small" label="IMAP host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          <TextField size="small" label="Port" type="number" value={form.port} sx={{ width: 90 }} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
          <TextField size="small" label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextField size="small" label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <TextField size="small" label="Company" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <Select<number | ""> size="small" displayEmpty value={form.labelId} onChange={(e) => setForm({ ...form, labelId: e.target.value === "" ? "" : Number(e.target.value) })} sx={{ minWidth: 130 }}>
            <MenuItem value="">No label</MenuItem>
            {labels.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
          </Select>
          <Select<number | ""> size="small" displayEmpty value={form.identityId} onChange={(e) => setForm({ ...form, identityId: e.target.value === "" ? "" : Number(e.target.value) })} sx={{ minWidth: 150 }}>
            <MenuItem value="">Default From</MenuItem>
            {identities.map((i) => <MenuItem key={i.id} value={i.id}>{i.address}</MenuItem>)}
          </Select>
          <Button variant="contained" disabled={!form.name || !form.host || !form.username} onClick={create}>Add</Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>Host</TableCell><TableCell>User</TableCell>
              <TableCell>Company</TableCell><TableCell>Label</TableCell><TableCell>Enabled</TableCell><TableCell>Last poll</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data ?? []).map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.name}</TableCell>
                <TableCell>{m.host}:{m.port}</TableCell>
                <TableCell>{m.username}</TableCell>
                <TableCell>{m.companyName ?? "—"}</TableCell>
                <TableCell>{(m as { labelId?: number }).labelId ? labelName((m as { labelId?: number }).labelId) : "—"}</TableCell>
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
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={8}>No mailboxes configured.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function SlaPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listSlaPolicies());
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [form, setForm] = useState({ name: "", priority: "", companyId: "", responseMinutes: 60, resolutionMinutes: 480 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.listCompanies().then(setCompanies).catch(() => setCompanies([])); }, []);

  const companyName = (id: number | null) => companies.find((c) => c.id === id)?.name ?? "Any";

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); reload(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };

  const create = () => act(async () => {
    await api.createSlaPolicy({
      name: form.name,
      priority: form.priority || null,
      companyId: form.companyId ? Number(form.companyId) : null,
      responseMinutes: Number(form.responseMinutes),
      resolutionMinutes: Number(form.resolutionMinutes),
    });
    setForm({ name: "", priority: "", companyId: "", responseMinutes: 60, resolutionMinutes: 480 });
  }, "SLA policy created");

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">SLA Policies</Typography>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Alert severity="info">
        Each policy sets response &amp; resolution targets (in minutes). The most specific match wins:
        company + priority &gt; company &gt; priority &gt; a global default (leave both blank). Tickets are scored
        on create and when priority/company changes.
      </Alert>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Add policy</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{
          flexWrap: "wrap"
        }}>
          <TextField size="small" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select size="small" displayEmpty value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} sx={{ minWidth: 130 }}>
            <MenuItem value="">Any priority</MenuItem>
            {TICKET_PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </Select>
          <Select size="small" displayEmpty value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} sx={{ minWidth: 160 }}>
            <MenuItem value="">Any company</MenuItem>
            {companies.map((c) => <MenuItem key={c.id} value={String(c.id)}>{c.name}</MenuItem>)}
          </Select>
          <TextField size="small" label="Response (min)" type="number" sx={{ width: 130 }} value={form.responseMinutes} onChange={(e) => setForm({ ...form, responseMinutes: Number(e.target.value) })} />
          <TextField size="small" label="Resolution (min)" type="number" sx={{ width: 140 }} value={form.resolutionMinutes} onChange={(e) => setForm({ ...form, resolutionMinutes: Number(e.target.value) })} />
          <Button variant="contained" disabled={!form.name} onClick={create}>Add</Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>Priority</TableCell><TableCell>Company</TableCell>
              <TableCell>Response</TableCell><TableCell>Resolution</TableCell><TableCell>Enabled</TableCell><TableCell align="right"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.priority ?? "Any"}</TableCell>
                <TableCell>{companyName(p.companyId)}</TableCell>
                <TableCell>{p.responseMinutes} min</TableCell>
                <TableCell>{p.resolutionMinutes} min</TableCell>
                <TableCell><Switch checked={p.enabled} onChange={(e) => act(() => api.updateSlaPolicy(p.id, { enabled: e.target.checked }))} /></TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => act(() => api.deleteSlaPolicy(p.id))}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7}>No SLA policies — tickets won't have deadlines until you add one.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function LabelsPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listLabels());
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6750A4");

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  const create = async () => { if (name) { await api.createLabel({ name, color }); setName(""); reload(); } };

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Labels</Typography>
      <Alert severity="info">Managed tags. Assign on a ticket or auto-apply via a mailbox (catchall vs help@ vs personal).</Alert>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{
          alignItems: "center"
        }}>
          <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, height: 36, border: "none", background: "none" }} />
          <Button variant="contained" disabled={!name} onClick={create}>Add</Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Label</TableCell><TableCell>Color</TableCell><TableCell align="right"></TableCell></TableRow></TableHead>
          <TableBody>
            {(data ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell><Chip size="small" label={l.name} sx={{ bgcolor: l.color, color: "#fff" }} /></TableCell>
                <TableCell>{l.color}</TableCell>
                <TableCell align="right"><IconButton size="small" onClick={async () => { await api.deleteLabel(l.id); reload(); }}><DeleteIcon fontSize="small" /></IconButton></TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={3}>No labels yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function MailIdentitiesPanel() {
  const identities = useAsync(() => api.listAllMailIdentities());
  const templates = useAsync(() => api.listMailTemplates());
  const [iAddr, setIAddr] = useState("");
  const [iName, setIName] = useState("");
  const [tName, setTName] = useState("");
  const [tSubject, setTSubject] = useState("");
  const [tBody, setTBody] = useState("");

  const addIdentity = async () => { if (iAddr) { await api.createMailIdentity({ address: iAddr, displayName: iName || undefined, shared: true }); setIAddr(""); setIName(""); identities.reload(); } };
  const addTemplate = async () => { if (tName && tBody) { await api.createMailTemplate({ name: tName, subject: tSubject || undefined, bodyHtml: tBody }); setTName(""); setTSubject(""); setTBody(""); templates.reload(); } };

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Mail Identities & Templates</Typography>
      <Alert severity="info">
        Send-from identities are the addresses techs may send as — shared boxes (help@, support@) and personal aliases on your SMTP domain. The message From header uses the chosen identity; the SMTP envelope stays your relay account so SPF/DKIM still pass.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Add shared identity</Typography>
        <Stack direction="row" spacing={1}>
          <TextField size="small" label="Address" placeholder="help@yourdomain" value={iAddr} onChange={(e) => setIAddr(e.target.value)} />
          <TextField size="small" label="Display name" value={iName} onChange={(e) => setIName(e.target.value)} />
          <Button variant="contained" disabled={!iAddr} onClick={addIdentity}>Add</Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Address</TableCell><TableCell>Name</TableCell><TableCell>Type</TableCell><TableCell>Enabled</TableCell><TableCell align="right"></TableCell></TableRow></TableHead>
          <TableBody>
            {(identities.data ?? []).map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.address}</TableCell>
                <TableCell>{i.displayName ?? "—"}</TableCell>
                <TableCell><Chip size="small" label={i.shared ? "shared" : "personal"} /></TableCell>
                <TableCell><Switch checked={i.enabled} onChange={async (e) => { await api.updateMailIdentity(i.id, { enabled: e.target.checked }); identities.reload(); }} /></TableCell>
                <TableCell align="right"><IconButton size="small" onClick={async () => { await api.deleteMailIdentity(i.id); identities.reload(); }}><DeleteIcon fontSize="small" /></IconButton></TableCell>
              </TableRow>
            ))}
            {(identities.data ?? []).length === 0 && <TableRow><TableCell colSpan={5}>No identities — the configured SMTP From is used.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Add boilerplate template</Typography>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Name" value={tName} onChange={(e) => setTName(e.target.value)} />
            <TextField size="small" label="Subject (optional)" value={tSubject} onChange={(e) => setTSubject(e.target.value)} sx={{ flexGrow: 1 }} />
          </Stack>
          <TextField size="small" label="Body (HTML)" value={tBody} onChange={(e) => setTBody(e.target.value)} multiline minRows={3} />
          <Box><Button variant="contained" disabled={!tName || !tBody} onClick={addTemplate}>Add template</Button></Box>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Template</TableCell><TableCell>Subject</TableCell><TableCell align="right"></TableCell></TableRow></TableHead>
          <TableBody>
            {(templates.data ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>{t.subject ?? "—"}</TableCell>
                <TableCell align="right"><IconButton size="small" onClick={async () => { await api.deleteMailTemplate(t.id); templates.reload(); }}><DeleteIcon fontSize="small" /></IconButton></TableCell>
              </TableRow>
            ))}
            {(templates.data ?? []).length === 0 && <TableRow><TableCell colSpan={3}>No templates yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

function AutomationsPanel() {
  const rules = useAsync(() => api.listAutomations());
  const [editing, setEditing] = useState<api.AutomationRule | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    setMsg(null);
    try {
      await operation();
      setMsg({ ok: true, text: success });
      rules.reload();
    } catch (error) {
      setMsg({ ok: false, text: errText(error) });
    }
  };

  if (rules.loading) return <CircularProgress />;
  if (rules.error) return <Alert severity="error">{rules.error}</Alert>;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{
        alignItems: { xs: "stretch", sm: "center" }
      }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Automations</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>Run ordered actions when ticket and SLA events match all conditions.</Typography>
        </Box>
        <Button variant="contained" onClick={() => setEditing(null)}>Add rule</Button>
      </Stack>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {(rules.data ?? []).map((rule) => (
        <Paper key={rule.id} variant="outlined" sx={{ p: 2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{
            alignItems: { xs: "stretch", sm: "center" }
          }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  alignItems: "center",
                  flexWrap: "wrap"
                }}>
                <Typography variant="subtitle1">{rule.name}</Typography>
                <Chip size="small" label={rule.enabled ? "Enabled" : "Disabled"} color={rule.enabled ? "success" : "default"} />
                <Chip size="small" variant="outlined" label={rule.trigger.replace(/_/g, " ")} />
              </Stack>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {rule.conditions.length} conditions · {rule.actions.length} actions · {rule.runCount} runs
                {rule.lastRunAt ? ` · last ${new Date(rule.lastRunAt).toLocaleString()}` : ""}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.5}>
              <Switch
                checked={rule.enabled}
                onChange={(event) => void mutate(() => api.updateAutomation(rule.id, { enabled: event.target.checked }), event.target.checked ? "Rule enabled" : "Rule disabled")}
                slotProps={{
                  input: { "aria-label": `${rule.enabled ? "Disable" : "Enable"} ${rule.name}` }
                }}
              />
              <IconButton aria-label={`Edit ${rule.name}`} onClick={() => setEditing(rule)}><EditIcon /></IconButton>
              <IconButton color="error" aria-label={`Delete ${rule.name}`} onClick={() => setConfirmDelete({ id: rule.id, name: rule.name })}><DeleteIcon /></IconButton>
            </Stack>
          </Stack>
        </Paper>
      ))}
      {(rules.data ?? []).length === 0 && <Alert severity="info">No rules yet. Add one to automate routing, notifications, notes, and SLA escalations.</Alert>}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete automation “${confirmDelete?.name}”?`}
        body="The rule stops immediately. Actions it already took on tickets are kept and stay attributed in history."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void mutate(() => api.deleteAutomation(confirmDelete.id), "Rule deleted");
          setConfirmDelete(null);
        }}
      />
      <AutomationEditorDialog
        open={editing !== undefined}
        rule={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSave={async (data) => {
          if (editing) await api.updateAutomation(editing.id, data);
          else await api.createAutomation(data);
          setEditing(undefined);
          rules.reload();
        }}
      />
    </Stack>
  );
}

function AutomationEditorDialog({
  open,
  rule,
  onClose,
  onSave,
}: {
  open: boolean;
  rule: api.AutomationRule | null;
  onClose: () => void;
  onSave: (data: api.AutomationRuleInput) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<api.AutomationTrigger>("ticket_created");
  const [enabled, setEnabled] = useState(true);
  // Builder rows are the default surface; the JSON editors are the escape
  // hatch. Whichever surface is visible is the source of truth on save.
  const [advanced, setAdvanced] = useState(false);
  const [conditionDrafts, setConditionDrafts] = useState<ConditionDraft[]>([]);
  const [actionDrafts, setActionDrafts] = useState<ActionDraft[]>([defaultAction("add_note")]);
  const [conditions, setConditions] = useState("[]");
  const [actions, setActions] = useState("[]");
  const [preview, setPreview] = useState<api.AutomationPreview | null>(null);
  const [references, setReferences] = useState<RuleReferences>({ teams: [], users: [], labels: [], fields: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? "");
    setTrigger(rule?.trigger ?? "ticket_created");
    setEnabled(rule?.enabled ?? true);
    setConditionDrafts(conditionsToDrafts(rule?.conditions ?? []));
    setActionDrafts((rule?.actions as ActionDraft[] | undefined) ?? [defaultAction("add_note")]);
    setConditions(JSON.stringify(rule?.conditions ?? [], null, 2));
    setActions(JSON.stringify(rule?.actions ?? [defaultAction("add_note")], null, 2));
    setAdvanced(false);
    setPreview(null);
    setError(null);
    Promise.all([api.listTeams(), api.listAssignees(), api.listLabels(), api.listCustomFields()])
      .then(([teams, users, labels, fields]) => setReferences({ teams, users, labels, fields }))
      .catch(() => setReferences({ teams: [], users: [], labels: [], fields: [] }));
  }, [open, rule]);

  /** The rule as currently edited, or an error string. */
  const collect = (): { conditions: api.AutomationCondition[]; actions: api.AutomationAction[] } | string => {
    if (!advanced) {
      const built = normalizeActions(actionDrafts);
      if (built.length === 0) return "Add at least one action.";
      return {
        conditions: draftsToConditions(conditionDrafts) as unknown as api.AutomationCondition[],
        actions: built as api.AutomationAction[],
      };
    }
    try {
      const parsedConditions = JSON.parse(conditions);
      const parsedActions = JSON.parse(actions);
      if (!Array.isArray(parsedConditions)) return "Conditions must be a JSON array.";
      if (!Array.isArray(parsedActions) || parsedActions.length === 0) return "Actions must be a non-empty JSON array.";
      return { conditions: parsedConditions, actions: parsedActions };
    } catch (err) {
      return (err as Error).message;
    }
  };

  const toggleAdvanced = () => {
    if (!advanced) {
      // Serialize builder state into the JSON editors.
      setConditions(JSON.stringify(draftsToConditions(conditionDrafts), null, 2));
      setActions(JSON.stringify(normalizeActions(actionDrafts), null, 2));
      setAdvanced(true);
      return;
    }
    // Bring JSON edits back into the builder; invalid JSON stays in advanced.
    try {
      const parsedConditions = JSON.parse(conditions);
      const parsedActions = JSON.parse(actions);
      setConditionDrafts(conditionsToDrafts(parsedConditions));
      setActionDrafts(Array.isArray(parsedActions) && parsedActions.length ? parsedActions : [defaultAction("add_note")]);
      setAdvanced(false);
      setError(null);
    } catch {
      setError("Fix the JSON before returning to the builder.");
    }
  };

  const runPreview = async () => {
    const collected = collect();
    if (typeof collected === "string") { setError(collected); return; }
    setError(null);
    try {
      setPreview(await api.previewAutomation(collected.conditions));
    } catch (err) {
      setError(errText(err));
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    const collected = collect();
    if (typeof collected === "string") { setError(collected); return; }
    setSaving(true);
    setError(null);
    try { await onSave({ name: name.trim(), trigger, enabled, conditions: collected.conditions, actions: collected.actions }); }
    catch (err) { setError(errText(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md" fullScreen={isPhone}>
      <DialogTitle>{rule ? "Edit automation" : "Add automation"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Rule name" required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <TextField select label="Trigger" value={trigger} onChange={(event) => setTrigger(event.target.value as api.AutomationTrigger)}>
            {(["ticket_created", "ticket_updated", "note_added", "sla_at_risk", "sla_breached"] as api.AutomationTrigger[]).map((value) => (
              <MenuItem key={value} value={value}>{value.replace(/_/g, " ")}</MenuItem>
            ))}
          </TextField>
          <FormControlLabel control={<Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />} label="Enabled" />

          {!advanced ? (
            <>
              <Typography variant="subtitle2">Conditions — all must match (none = every event)</Typography>
              <ConditionRowsEditor drafts={conditionDrafts} references={references} onChange={setConditionDrafts} />
              <Box>
                <Button size="small" onClick={() => setConditionDrafts([...conditionDrafts, { field: "status", op: "eq", value: "" }])}>
                  Add condition
                </Button>
              </Box>
              <Typography variant="subtitle2">Actions — run in order</Typography>
              <ActionRowsEditor drafts={actionDrafts} references={references} onChange={setActionDrafts} />
              <Box>
                <Button size="small" onClick={() => setActionDrafts([...actionDrafts, defaultAction("add_note")])}>
                  Add action
                </Button>
              </Box>
            </>
          ) : (
            <>
              <TextField
                label="Conditions (all must match)"
                value={conditions}
                onChange={(event) => setConditions(event.target.value)}
                multiline
                minRows={5}
                helperText='JSON array, e.g. [{"field":"priority","op":"eq","value":"Urgent"}]. Use custom.<key> for custom fields; dueAt = manual deadline only, effectiveDueAt = manual or SLA target.'
                slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: 13 } } }}
              />
              <TextField
                label="Actions (run in order)"
                value={actions}
                onChange={(event) => setActions(event.target.value)}
                multiline
                minRows={7}
                helperText="Action types: set_status, set_priority, assign_user, assign_team, add_label, add_note, notify_user, notify_team."
                slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: 13 } } }}
              />
            </>
          )}

          {preview && (
            <Alert severity={preview.matched > 0 ? "info" : "warning"}>
              Would have matched <strong>{preview.matched}</strong> of {preview.sampled} tickets active in the last {preview.sinceDays} days
              {preview.usesEventFields ? " (SLA kind/level conditions only match during real SLA events)" : ""}.
              {preview.sample.length > 0 && (
                <> Sample: {preview.sample.map((t) => `#${t.ticketNumber ?? t.id}`).join(", ")}</>
              )}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={toggleAdvanced} disabled={saving}>{advanced ? "Builder" : "Advanced JSON"}</Button>
        <Button onClick={() => void runPreview()} disabled={saving}>Preview matches</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save rule"}</Button>
      </DialogActions>
    </Dialog>
  );
}

function CustomFieldsPanel() {
  const fields = useAsync(() => api.listCustomFields(true));
  const [editing, setEditing] = useState<api.CustomFieldDef | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; label: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    setMsg(null);
    try {
      await operation();
      setMsg({ ok: true, text: success });
      fields.reload();
    } catch (error) {
      setMsg({ ok: false, text: errText(error) });
    }
  };

  if (fields.loading) return <CircularProgress />;
  if (fields.error) return <Alert severity="error">{fields.error}</Alert>;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{
        alignItems: { xs: "stretch", sm: "center" }
      }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Custom ticket fields</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>Define structured fields rendered on every ticket.</Typography>
        </Box>
        <Button variant="contained" onClick={() => setEditing(null)}>Add field</Button>
      </Stack>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Key</TableCell><TableCell>Type</TableCell><TableCell>Required</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {(fields.data ?? []).map((field) => (
              <TableRow key={field.id} sx={{ opacity: field.archived ? 0.65 : 1 }}>
                <TableCell>{field.label}</TableCell>
                <TableCell><code>{field.key}</code></TableCell>
                <TableCell>{field.type}{field.type === "select" ? ` · ${(field.options ?? []).length} options` : ""}</TableCell>
                <TableCell>{field.required ? "Yes" : "No"}</TableCell>
                <TableCell><Chip size="small" label={field.archived ? "Archived" : "Active"} color={field.archived ? "default" : "success"} /></TableCell>
                <TableCell align="right">
                  <IconButton aria-label={`Edit ${field.label}`} onClick={() => setEditing(field)}><EditIcon fontSize="small" /></IconButton>
                  <Switch
                    size="small"
                    checked={!field.archived}
                    onChange={() => void mutate(() => api.updateCustomField(field.id, { archived: !field.archived }), field.archived ? "Field restored" : "Field archived")}
                    slotProps={{
                      input: { "aria-label": field.archived ? `Restore ${field.label}` : `Archive ${field.label}` }
                    }}
                  />
                  <IconButton color="error" aria-label={`Delete ${field.label}`} onClick={() => setConfirmDelete({ id: field.id, label: field.label })}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {(fields.data ?? []).length === 0 && <TableRow><TableCell colSpan={6}>No custom fields defined.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Permanently delete “${confirmDelete?.label}”?`}
        body="If tickets still use this key, archive it instead — archiving keeps stored values and saved-view filters working."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void mutate(() => api.deleteCustomField(confirmDelete.id), "Field deleted");
          setConfirmDelete(null);
        }}
      />
      <CustomFieldEditorDialog
        open={editing !== undefined}
        field={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSave={async (data) => {
          if (editing) await api.updateCustomField(editing.id, data);
          else await api.createCustomField(data as api.CustomFieldDefInput);
          setEditing(undefined);
          fields.reload();
        }}
      />
    </Stack>
  );
}

function CustomFieldEditorDialog({
  open,
  field,
  onClose,
  onSave,
}: {
  open: boolean;
  field: api.CustomFieldDef | null;
  onClose: () => void;
  onSave: (data: api.CustomFieldDefInput | Partial<Omit<api.CustomFieldDefInput, "key" | "type">>) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [form, setForm] = useState({ key: "", label: "", type: "text" as api.CustomFieldType, options: "", required: false, sortOrder: 0, archived: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setForm({
      key: field?.key ?? "",
      label: field?.label ?? "",
      type: field?.type ?? "text",
      options: (field?.options ?? []).join(", "),
      required: field?.required ?? false,
      sortOrder: field?.sortOrder ?? 0,
      archived: field?.archived ?? false,
    });
    setError(null);
  }, [open, field]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!form.key.trim() || !form.label.trim()) return;
    const options = form.type === "select" ? form.options.split(",").map((option) => option.trim()).filter(Boolean) : null;
    if (form.type === "select" && (!options || options.length === 0)) { setError("Select fields need at least one option."); return; }
    setSaving(true);
    setError(null);
    try {
      const common = { label: form.label.trim(), options, required: form.required, sortOrder: form.sortOrder, archived: form.archived };
      await onSave(field ? common : { ...common, key: form.key.trim(), type: form.type });
    } catch (err) { setError(errText(err)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>{field ? "Edit custom field" : "Add custom field"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Key" required disabled={!!field} value={form.key} onChange={(event) => set("key", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} helperText="Stable API key: lowercase letters, digits, underscores" fullWidth />
            <TextField select label="Type" disabled={!!field} value={form.type} onChange={(event) => set("type", event.target.value as api.CustomFieldType)} fullWidth>
              {(["text", "number", "boolean", "date", "select"] as api.CustomFieldType[]).map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField label="Label" required value={form.label} onChange={(event) => set("label", event.target.value)} />
          {form.type === "select" && <TextField label="Options" value={form.options} onChange={(event) => set("options", event.target.value)} helperText="Comma-separated choices" multiline minRows={2} />}
          <TextField label="Sort order" type="number" value={form.sortOrder} onChange={(event) => set("sortOrder", Number(event.target.value))} />
          <FormControlLabel control={<Checkbox checked={form.required} onChange={(event) => set("required", event.target.checked)} />} label="Required" />
          {field && <FormControlLabel control={<Checkbox checked={form.archived} onChange={(event) => set("archived", event.target.checked)} />} label="Archived" />}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={saving || !form.key.trim() || !form.label.trim()}>{saving ? "Saving…" : "Save"}</Button></DialogActions>
    </Dialog>
  );
}

function TeamsPanel() {
  const teams = useAsync(() => api.listTeams());
  const [users, setUsers] = useState<api.ManagedUser[]>([]);
  const [editing, setEditing] = useState<api.Team | null | undefined>(undefined);
  const [addingMember, setAddingMember] = useState<Record<number, number | "">>({});
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const act = async (operation: () => Promise<unknown>, success: string) => {
    setMsg(null);
    try {
      await operation();
      setMsg({ ok: true, text: success });
      teams.reload();
    } catch (error) {
      setMsg({ ok: false, text: errText(error) });
    }
  };

  if (teams.loading) return <CircularProgress />;
  if (teams.error) return <Alert severity="error">{teams.error}</Alert>;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{
        alignItems: { xs: "stretch", sm: "center" }
      }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Teams</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>Route tickets to queues and control team membership.</Typography>
        </Box>
        <Button variant="contained" onClick={() => setEditing(null)}>Add team</Button>
      </Stack>
      {msg && <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {(teams.data ?? []).map((team) => {
        const memberIds = new Set(team.members.map((member) => member.userId));
        const available = users.filter((user) => user.isActive && !memberIds.has(user.id));
        return (
          <Paper key={team.id} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{
                alignItems: "flex-start"
              }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1">{team.name}</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {team.description || "No description"} · {team._count?.tickets ?? 0} tickets
                  </Typography>
                </Box>
                <IconButton aria-label={`Edit ${team.name}`} onClick={() => setEditing(team)}><EditIcon /></IconButton>
                <IconButton aria-label={`Delete ${team.name}`} color="error" onClick={() => setConfirmDelete({ id: team.id, name: team.name })}><DeleteIcon /></IconButton>
              </Stack>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{
                flexWrap: "wrap"
              }}>
                {team.members.map((member) => (
                  <Chip
                    key={member.userId}
                    label={member.user.displayName || member.user.username}
                    onDelete={() => void act(() => api.removeTeamMember(team.id, member.userId), "Member removed")}
                  />
                ))}
                {team.members.length === 0 && <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>No members yet.</Typography>}
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  select
                  size="small"
                  label="Add member"
                  value={addingMember[team.id] ?? ""}
                  onChange={(event) => setAddingMember((current) => ({ ...current, [team.id]: event.target.value === "" ? "" : Number(event.target.value) }))}
                  sx={{ minWidth: 220, flexGrow: 1 }}
                >
                  <MenuItem value="">Choose a user…</MenuItem>
                  {available.map((user) => <MenuItem key={user.id} value={user.id}>{user.displayName || user.username} · {user.role}</MenuItem>)}
                </TextField>
                <Button
                  variant="outlined"
                  disabled={!addingMember[team.id]}
                  onClick={() => {
                    const userId = addingMember[team.id];
                    if (typeof userId !== "number") return;
                    void act(() => api.addTeamMember(team.id, userId), "Member added");
                    setAddingMember((current) => ({ ...current, [team.id]: "" }));
                  }}
                >
                  Add
                </Button>
              </Stack>
            </Stack>
          </Paper>
        );
      })}
      {(teams.data ?? []).length === 0 && <Alert severity="info">No teams yet. Add a queue for routing tickets.</Alert>}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete team “${confirmDelete?.name}”?`}
        body="Tickets routed to this queue keep everything else and become team-unassigned."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void act(() => api.deleteTeam(confirmDelete.id), "Team deleted");
          setConfirmDelete(null);
        }}
      />
      <TeamEditorDialog
        open={editing !== undefined}
        team={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSave={async (data) => {
          if (editing) await api.updateTeam(editing.id, data);
          else await api.createTeam(data);
          setEditing(undefined);
          teams.reload();
        }}
      />
    </Stack>
  );
}

function TeamEditorDialog({
  open,
  team,
  onClose,
  onSave,
}: {
  open: boolean;
  team: api.Team | null;
  onClose: () => void;
  onSave: (data: { name: string; description: string | null }) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? "");
    setDescription(team?.description ?? "");
    setError(null);
  }, [open, team]);
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try { await onSave({ name: name.trim(), description: description.trim() || null }); }
    catch (err) { setError(errText(err)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>{team ? "Edit team" : "Add team"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <TextField label="Description" value={description} onChange={(event) => setDescription(event.target.value)} multiline minRows={3} />
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button></DialogActions>
    </Dialog>
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
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
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
