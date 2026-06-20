import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import * as api from "../api/client";

type Step = "credentials" | "mfa" | "enroll";

/** Full-screen login. Drives local + MFA (verify/enroll) + SSO redirects. */
export default function LoginView({ onAuthenticated }: { onAuthenticated: (u: api.AuthUser) => void }) {
  const [opts, setOpts] = useState<api.LoginOptions | null>(null);
  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enroll, setEnroll] = useState<{ qr: string; secret: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAuthConfig().then(setOpts).catch(() => setOpts({ local: true, oidc: false, saml: false }));
    // Surface an SSO callback error passed back as ?authError=...
    const p = new URLSearchParams(window.location.search);
    if (p.get("authError")) setError(`SSO login failed (${p.get("authError")}). Please try again.`);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof api.ApiError ? safeMsg(e) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitCredentials = () =>
    run(async () => {
      const res = await api.login(username, password);
      if (res.user) return onAuthenticated(res.user);
      if (res.mfaRequired) return setStep("mfa");
      if (res.enrollmentRequired) {
        const s = await api.setupMfa();
        setEnroll({ qr: s.qr, secret: s.secret });
        setStep("enroll");
      }
    });

  const submitMfa = () =>
    run(async () => {
      const res = await api.verifyMfa(code.trim());
      onAuthenticated(res.user);
    });

  const submitEnroll = () =>
    run(async () => {
      const res = await api.enableMfa(code.trim());
      setRecovery(res.recoveryCodes);
      // Keep the recovery codes on screen; finish when the user acknowledges.
      setEnroll(null);
    });

  if (!opts) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  }

  return (
    <Centered>
      <Card sx={{ width: 420, maxWidth: "92vw" }} elevation={6}>
        <CardContent>
          <Typography variant="h5" gutterBottom>AnchorDesk</Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

          {recovery ? (
            <Stack spacing={2}>
              <Alert severity="warning">
                Save these recovery codes somewhere safe. Each works once if you lose your authenticator.
                They will not be shown again.
              </Alert>
              <Box sx={{ fontFamily: "monospace", p: 2, bgcolor: "grey.100", borderRadius: 1 }}>
                {recovery.map((c) => <div key={c}>{c}</div>)}
              </Box>
              <Button variant="contained" onClick={() => api.getMe().then((r) => onAuthenticated(r.user))}>
                Continue
              </Button>
            </Stack>
          ) : step === "credentials" ? (
            <Stack spacing={2}>
              {opts.local && (
                <>
                  <TextField label="Username" value={username} autoFocus
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitCredentials()} />
                  <TextField label="Password" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitCredentials()} />
                  <Button variant="contained" disabled={busy || !username || !password} onClick={submitCredentials}>
                    {busy ? <CircularProgress size={22} /> : "Sign in"}
                  </Button>
                </>
              )}
              {(opts.oidc || opts.saml) && opts.local && <Divider>or</Divider>}
              {opts.oidc && (
                <Button variant="outlined" href="/api/auth/oidc/login">Sign in with SSO (OIDC)</Button>
              )}
              {opts.saml && (
                <Button variant="outlined" href="/api/auth/saml/login">Sign in with SSO (SAML)</Button>
              )}
              {!opts.local && !opts.oidc && !opts.saml && (
                <Alert severity="error">No login methods are enabled. Check server configuration.</Alert>
              )}
            </Stack>
          ) : step === "mfa" ? (
            <Stack spacing={2}>
              <Typography variant="body2">Enter the 6-digit code from your authenticator app (or a recovery code).</Typography>
              <TextField label="Authentication code" value={code} autoFocus
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitMfa()} />
              <Button variant="contained" disabled={busy || !code} onClick={submitMfa}>
                {busy ? <CircularProgress size={22} /> : "Verify"}
              </Button>
            </Stack>
          ) : (
            // enroll
            <Stack spacing={2}>
              <Alert severity="info">Multi-factor authentication is required. Scan this QR code with an authenticator app, then enter a code to finish.</Alert>
              {enroll && <Box sx={{ textAlign: "center" }}><img src={enroll.qr} alt="TOTP QR code" width={200} height={200} /></Box>}
              {enroll && (
                <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
                  Or enter this secret manually: <code>{enroll.secret}</code>
                </Typography>
              )}
              <TextField label="6-digit code" value={code} autoFocus
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitEnroll()} />
              <Button variant="contained" disabled={busy || !code} onClick={submitEnroll}>
                {busy ? <CircularProgress size={22} /> : "Enable & continue"}
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      {children}
    </Box>
  );
}

// Try to surface the server's JSON {error} message rather than the raw envelope.
function safeMsg(e: api.ApiError): string {
  try {
    const parsed = JSON.parse(e.body);
    if (parsed?.error) return parsed.error;
  } catch {
    /* ignore */
  }
  return e.message;
}
