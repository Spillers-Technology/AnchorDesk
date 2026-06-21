import { useState } from "react";
import {
  IconButton,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  Chip,
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Alert,
} from "@mui/material";
import { useEffect } from "react";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import LogoutIcon from "@mui/icons-material/Logout";
import LockIcon from "@mui/icons-material/Lock";
import SecurityIcon from "@mui/icons-material/Security";
import DrawIcon from "@mui/icons-material/Draw";
import { useAuth } from "./AuthContext";
import * as api from "../api/client";
import RichTextEditor from "../components/RichTextEditor";

export default function AccountMenu() {
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);

  if (!user) return null;
  const close = () => setAnchor(null);

  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)}>
        <AccountCircleIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2">{user.displayName || user.username}</Typography>
          <Chip size="small" label={user.role} sx={{ mt: 0.5 }} />
        </Box>
        <Divider />
        {user.authProvider === "local" && (
          <MenuItem onClick={() => { setPwOpen(true); close(); }}>
            <ListItemIcon><LockIcon fontSize="small" /></ListItemIcon>
            Change password
          </MenuItem>
        )}
        {user.authProvider === "local" && (
          <MenuItem onClick={() => { setMfaOpen(true); close(); }}>
            <ListItemIcon><SecurityIcon fontSize="small" /></ListItemIcon>
            Manage MFA
          </MenuItem>
        )}
        <MenuItem onClick={() => { setSigOpen(true); close(); }}>
          <ListItemIcon><DrawIcon fontSize="small" /></ListItemIcon>
          Email signature
        </MenuItem>
        <MenuItem onClick={() => { close(); logout(); }}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>

      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} />}
      {mfaOpen && <ManageMfaDialog onClose={() => setMfaOpen(false)} />}
      {sigOpen && <SignatureDialog onClose={() => setSigOpen(false)} />}
    </>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setMsg(null);
    try {
      await api.changeOwnPassword(current, next);
      setMsg({ ok: true, text: "Password changed." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Change password</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          <TextField label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <TextField label="New password (min 10 chars)" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!current || next.length < 10} onClick={submit}>Update</Button>
      </DialogActions>
    </Dialog>
  );
}

function ManageMfaDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [enroll, setEnroll] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const begin = async () => {
    setMsg(null);
    try {
      const s = await api.setupMfa();
      setEnroll({ qr: s.qr, secret: s.secret });
    } catch (e) { setMsg(errText(e)); }
  };
  const finish = async () => {
    setMsg(null);
    try {
      const r = await api.enableMfa(code.trim());
      setRecovery(r.recoveryCodes);
      setEnroll(null);
    } catch (e) { setMsg(errText(e)); }
  };
  const disable = async () => {
    setMsg(null);
    try { await api.disableMfa(); setMsg("MFA disabled."); }
    catch (e) { setMsg(errText(e)); }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Multi-factor authentication</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {msg && <Alert severity="info">{msg}</Alert>}
          {recovery ? (
            <>
              <Alert severity="warning">Save these one-time recovery codes. They won't be shown again.</Alert>
              <Box sx={{ fontFamily: "monospace", p: 2, bgcolor: "grey.100", borderRadius: 1 }}>
                {recovery.map((c) => <div key={c}>{c}</div>)}
              </Box>
            </>
          ) : enroll ? (
            <>
              <Box sx={{ textAlign: "center" }}><img src={enroll.qr} alt="TOTP QR" width={180} height={180} /></Box>
              <Typography variant="caption" sx={{ wordBreak: "break-all" }}>Secret: <code>{enroll.secret}</code></Typography>
              <TextField label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button variant="contained" disabled={!code} onClick={finish}>Enable</Button>
            </>
          ) : (
            <>
              <Typography variant="body2">
                Add an authenticator app for {user?.username}. Re-enrolling replaces any existing setup.
              </Typography>
              <Button variant="contained" onClick={begin}>Set up authenticator</Button>
              <Button color="error" onClick={disable}>Disable MFA</Button>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function SignatureDialog({ onClose }: { onClose: () => void }) {
  const [html, setHtml] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getMySignature().then((s) => { setHtml(s.signatureHtml || ""); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setMsg(null);
    try {
      await api.setMySignature(html);
      setMsg({ ok: true, text: "Signature saved." });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Email signature</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          <Typography variant="caption" color="text.secondary">
            Appended to outbound ticket emails when "Signature" is checked in the composer.
          </Typography>
          {loaded && <RichTextEditor value={html} onChange={setHtml} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function errText(e: unknown): string {
  if (e instanceof api.ApiError) {
    try { const p = JSON.parse(e.body); if (p?.error) return p.error; } catch { /* ignore */ }
  }
  return (e as Error).message;
}
