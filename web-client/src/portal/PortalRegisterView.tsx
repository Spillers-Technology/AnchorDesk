import { FormEvent, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AnchorIcon from "@mui/icons-material/Anchor";
import * as portalApi from "./api";

export default function PortalRegisterView() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await portalApi.requestPortalRegistration(email.trim());
      setSent(true);
    } catch (requestError) {
      if (requestError instanceof portalApi.PortalApiError && requestError.status === 429) {
        setError("Too many access requests. Wait a moment, then try again.");
      } else {
        setError("Access requests are temporarily unavailable. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="main" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "background.default", p: { xs: 2, sm: 3 } }}>
      <Card sx={{ width: "100%", maxWidth: 430 }} elevation={4}>
        <CardContent sx={{ p: { xs: 2.5, sm: 4 }, "&:last-child": { pb: { xs: 2.5, sm: 4 } } }}>
          <Stack spacing={2.25}>
            <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
              <Box sx={{ width: 50, height: 50, display: "grid", placeItems: "center", borderRadius: 2.5, bgcolor: "primary.main", color: "primary.contrastText" }}>
                <AnchorIcon />
              </Box>
              <Typography variant="h5">Request portal access</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Enter your work email. A support technician will review your request.
              </Typography>
            </Stack>

            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
            {sent ? (
              <Stack spacing={2}>
                <Alert severity="success">Check your email for an update on your portal access request.</Alert>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  If approved, we will send a separate one-time sign-in link. You may close this page.
                </Typography>
                <Button component={RouterLink} to="/login" variant="outlined" sx={{ minHeight: 44 }}>
                  Back to sign in
                </Button>
              </Stack>
            ) : (
              <Box component="form" onSubmit={(event) => void submit(event)}>
                <Stack spacing={2}>
                  <TextField label="Work email address" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus fullWidth required />
                  <Button type="submit" variant="contained" disabled={busy || !email.trim()} sx={{ minHeight: 44 }}>
                    {busy ? <CircularProgress size={22} color="inherit" /> : "Request access"}
                  </Button>
                  <Button component={RouterLink} to="/login" sx={{ minHeight: 44 }}>
                    I already have access
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
