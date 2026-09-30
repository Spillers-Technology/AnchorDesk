import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Select,
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
import { alpha, useTheme } from "@mui/material/styles";
import PeopleOutlined from "@mui/icons-material/PeopleOutlined";
import PersonAddOutlined from "@mui/icons-material/PersonAddOutlined";
import KeyOutlined from "@mui/icons-material/KeyOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import SearchOffOutlined from "@mui/icons-material/SearchOffOutlined";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";
import ConfirmDialog from "./ConfirmDialog";
import PanelSearch, { rowMatches } from "./PanelSearch";
import { AdminPage, EmptyRow, EmptyState, PanelError, PanelLoading, StatusChip, When, errText, initials, useAdminToast, useAsync } from "./kit";

const ROLES = [
  { id: "admin", label: "Admin", hint: "Everything, including this console" },
  { id: "technician", label: "Technician", hint: "Works tickets, devices and the KB" },
  { id: "readonly", label: "Read-only", hint: "Sees everything, changes nothing" },
];
const MIN_PASSWORD = 10;

export default function UsersPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listUsers());
  const toast = useAdminToast();
  const isPhone = useIsPhone();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<api.ManagedUser | null>(null);
  const [deleting, setDeleting] = useState<api.ManagedUser | null>(null);

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    if (await toast.run(fn, okText)) reload();
  };

  if (loading && !data) return <PanelLoading rows={5} />;
  if (error) return <PanelError message={error} onRetry={reload} />;

  const users = data ?? [];
  const shown = users.filter((u) => rowMatches(q, [u.username, u.displayName, u.email, u.role]));
  const admins = users.filter((u) => u.role === "admin" && u.isActive).length;
  const withoutMfa = users.filter((u) => u.isActive && u.authProvider === "local" && !u.mfaEnabled).length;

  /** One user's controls, laid out as a table row on desktop and a card on phones. */
  const controlsFor = (u: api.ManagedUser) => {
    const name = u.displayName || u.username;
    const lastAdmin = u.role === "admin" && u.isActive && admins <= 1;
    return {
      identity: (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
          <UserAvatar name={name} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{name}</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap component="div">
              {u.username}{u.email && u.email !== u.username ? ` · ${u.email}` : ""}
            </Typography>
          </Box>
        </Stack>
      ),
      provider: <Chip size="small" variant="outlined" label={u.authProvider === "local" ? "Password" : u.authProvider.toUpperCase()} />,
      role: (
        <Select
          size="small"
          value={u.role}
          disabled={lastAdmin}
          onChange={(e) => void act(() => api.updateUser(u.id, { role: e.target.value }), `${name} is now ${ROLES.find((r) => r.id === e.target.value)?.label ?? e.target.value}`)}
          inputProps={{ "aria-label": `Role for ${name}` }}
          sx={{ minWidth: 132, fontSize: 14 }}
        >
          {ROLES.map((r) => <MenuItem key={r.id} value={r.id}>{r.label}</MenuItem>)}
        </Select>
      ),
      mfa: u.mfaEnabled
        ? <StatusChip tone="success" label="MFA on" />
        : u.authProvider === "local"
          ? <StatusChip tone="warning" label="MFA off" />
          : <StatusChip tone="neutral" label="MFA via IdP" title="Enforced by the identity provider, not AnchorDesk" />,
      active: (
        <Tooltip title={lastAdmin ? "The last active admin can't be deactivated" : ""}>
          <span>
            <Switch
              checked={u.isActive}
              disabled={lastAdmin}
              onChange={(e) => void act(() => api.updateUser(u.id, { isActive: e.target.checked }), e.target.checked ? `${name} can sign in again` : `${name} is deactivated`)}
              slotProps={{ input: { "aria-label": `${u.isActive ? "Deactivate" : "Activate"} ${name}` } }}
            />
          </span>
        </Tooltip>
      ),
      actions: (
        <>
          {u.authProvider === "local" && (
            <Tooltip title="Reset password">
              <IconButton aria-label={`Reset password for ${name}`} onClick={() => setResetting(u)}><KeyOutlined fontSize="small" /></IconButton>
            </Tooltip>
          )}
          <Tooltip title={lastAdmin ? "The last active admin can't be deleted" : "Delete user"}>
            <span>
              <IconButton color="error" disabled={lastAdmin} aria-label={`Delete ${name}`} onClick={() => setDeleting(u)}><DeleteOutline fontSize="small" /></IconButton>
            </span>
          </Tooltip>
        </>
      ),
    };
  };

  return (
    <AdminPage
      icon={PeopleOutlined}
      title="Users & Roles"
      subtitle="Who can sign in, what they can change, and whether their account is protected by MFA."
      status={<>
        <Chip size="small" label={`${users.filter((u) => u.isActive).length} active`} />
        {withoutMfa > 0 && <StatusChip tone="warning" label={`${withoutMfa} without MFA`} title="Local accounts that haven't enrolled a TOTP authenticator" />}
      </>}
      actions={<Button variant="contained" startIcon={<PersonAddOutlined />} onClick={() => setCreating(true)}>Add user</Button>}
    >
      <PanelSearch value={q} onChange={setQ} placeholder="Filter users…" />
      {isPhone ? (
        <Stack spacing={1.25}>
          {shown.map((u) => {
            const c = controlsFor(u);
            return (
              <Paper key={u.id} variant="outlined" sx={{ p: 1.75, opacity: u.isActive ? 1 : 0.6 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>{c.identity}</Box>
                    {c.active}
                  </Stack>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    {c.provider}
                    {c.mfa}
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>Seen <When iso={u.lastSeenAt} /></Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box sx={{ flexGrow: 1 }}>{c.role}</Box>
                    {c.actions}
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
          {users.length === 0 && (
            <Paper variant="outlined">
              <EmptyState icon={PeopleOutlined} title="No users yet" action={<Button variant="outlined" onClick={() => setCreating(true)}>Add the first user</Button>}>
                Local accounts sign in with a password and TOTP; SSO users appear here after their first sign-in.
              </EmptyState>
            </Paper>
          )}
          {users.length > 0 && shown.length === 0 && (
            <Paper variant="outlined">
              <EmptyState compact icon={SearchOffOutlined} title={`No users match “${q}”`} action={<Button onClick={() => setQ("")}>Clear filter</Button>} />
            </Paper>
          )}
        </Stack>
      ) : (
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Sign-in</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>MFA</TableCell>
              <TableCell>Last seen</TableCell>
              <TableCell>Active</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((u) => {
              const c = controlsFor(u);
              return (
                <TableRow key={u.id} sx={{ opacity: u.isActive ? 1 : 0.6 }}>
                  <TableCell sx={{ minWidth: 200 }}>{c.identity}</TableCell>
                  <TableCell>{c.provider}</TableCell>
                  <TableCell>{c.role}</TableCell>
                  <TableCell>{c.mfa}</TableCell>
                  <TableCell><When iso={u.lastSeenAt} /></TableCell>
                  <TableCell>{c.active}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>{c.actions}</TableCell>
                </TableRow>
              );
            })}
            {users.length === 0 && (
              <EmptyRow colSpan={7} icon={PeopleOutlined} title="No users yet" action={<Button variant="outlined" onClick={() => setCreating(true)}>Add the first user</Button>}>
                Local accounts sign in with a password and TOTP; SSO users appear here after their first sign-in.
              </EmptyRow>
            )}
            {users.length > 0 && shown.length === 0 && (
              <EmptyRow colSpan={7} icon={SearchOffOutlined} title={`No users match “${q}”`} action={<Button onClick={() => setQ("")}>Clear filter</Button>} />
            )}
          </TableBody>
        </Table>
      </Paper>
      )}

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (form) => {
          await api.createUser(form);
          setCreating(false);
          toast.notify(true, `${form.displayName || form.username} can now sign in`);
          reload();
        }}
      />
      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onReset={async (pw) => {
          if (!resetting) return;
          await api.setUserPassword(resetting.id, pw);
          toast.notify(true, `Password reset for ${resetting.displayName || resetting.username}`);
          setResetting(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.displayName || deleting?.username}?`}
        body="Their account and sessions are removed. Tickets, notes and audit history they created are kept. To keep the account but block sign-in, deactivate it instead."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void act(() => api.deleteUser(target.id), `${target.displayName || target.username} deleted`);
        }}
      />
    </AdminPage>
  );
}

function UserAvatar({ name }: { name: string }) {
  const theme = useTheme();
  // Stable per-name hue from the palette's own accents so avatars stay on-theme.
  const hues = [theme.palette.primary.main, theme.palette.secondary.main, theme.palette.success.main, theme.palette.warning.main];
  const main = hues[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % hues.length];
  return (
    <Avatar sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 700, color: main, bgcolor: alpha(main, 0.16) }}>
      {initials(name)}
    </Avatar>
  );
}

const EMPTY_USER = { username: "", password: "", displayName: "", email: "", role: "technician" };

function CreateUserDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (form: typeof EMPTY_USER) => Promise<void> }) {
  const isPhone = useIsPhone();
  const [form, setForm] = useState(EMPTY_USER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm(EMPTY_USER); setError(null); } }, [open]);
  const set = (k: keyof typeof EMPTY_USER, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const short = form.password.length > 0 && form.password.length < MIN_PASSWORD;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await onCreate(form); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>Add local account</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField fullWidth required autoFocus label="Username" value={form.username} onChange={(e) => set("username", e.target.value)} />
            <TextField fullWidth label="Display name" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} />
          </Stack>
          <TextField label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          <TextField
            required
            label="Initial password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            error={short}
            helperText={short ? `${MIN_PASSWORD - form.password.length} more characters` : `At least ${MIN_PASSWORD} characters. They'll enroll MFA at first sign-in if it's required.`}
            onChange={(e) => set("password", e.target.value)}
          />
          <TextField select label="Role" value={form.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                <Box>
                  <Typography variant="body2">{r.label}</Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>{r.hint}</Typography>
                </Box>
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={busy || !form.username.trim() || form.password.length < MIN_PASSWORD} onClick={() => void submit()}>
          {busy ? "Creating…" : "Create user"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onReset }: { user: api.ManagedUser | null; onClose: () => void; onReset: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (user) { setPw(""); setConfirm(""); setError(null); } }, [user]);
  const mismatch = confirm.length > 0 && confirm !== pw;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await onReset(pw); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={user !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reset password for {user?.displayName || user?.username}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            label="New password"
            type="password"
            autoComplete="new-password"
            value={pw}
            helperText={pw.length > 0 && pw.length < MIN_PASSWORD ? `${MIN_PASSWORD - pw.length} more characters` : `At least ${MIN_PASSWORD} characters`}
            onChange={(e) => setPw(e.target.value)}
          />
          <TextField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            error={mismatch}
            helperText={mismatch ? "Doesn't match" : " "}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={busy || pw.length < MIN_PASSWORD || pw !== confirm} onClick={() => void submit()}>
          {busy ? "Resetting…" : "Reset password"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
