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

const NEUTRAL_SUCCESS =
  "If that email belongs to a contact, we sent a one-time sign-in link.";

export default function PortalLoginView({ notice }: { notice?: string | null }) {
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
      // The backend deliberately returns the same response for known and
      // unknown addresses. Keep the browser copy equally neutral.
      await portalApi.requestMagicLink(email.trim());
      setSent(true);
    } catch (requestError) {
      if (requestError instanceof portalApi.PortalApiError && requestError.status === 429) {
        setError("Too many sign-in requests. Wait a moment, then try again.");
      } else {
        setError("Sign-in email is temporarily unavailable. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        p: { xs: 2, sm: 3 },
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 430 }} elevation={4}>
        <CardContent sx={{ p: { xs: 2.5, sm: 4 }, "&:last-child": { pb: { xs: 2.5, sm: 4 } } }}>
          <Stack spacing={2.25}>
            <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
              <Box
                sx={{
                  width: 50,
                  height: 50,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 2.5,
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                }}
              >
                <AnchorIcon />
              </Box>
              <Typography variant="h5">AnchorDesk Support</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Sign in to submit and track your support requests.
              </Typography>
            </Stack>

            {notice && <Alert severity="warning">{notice}</Alert>}
            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
            {sent ? (
              <Stack spacing={2}>
                <Alert severity="success">{NEUTRAL_SUCCESS}</Alert>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  The link expires shortly and can be used only once. You may close this page.
                </Typography>
                <Button
                  variant="outlined"
                  sx={{ minHeight: 44 }}
                  onClick={() => {
                    setSent(false);
                    setEmail("");
                  }}
                >
                  Use another email
                </Button>
              </Stack>
            ) : (
              <Box component="form" onSubmit={(event) => void submit(event)}>
                <Stack spacing={2}>
                  <TextField
                    label="Email address"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoFocus
                    fullWidth
                    required
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={busy || !email.trim()}
                    sx={{ minHeight: 44 }}
                  >
                    {busy ? <CircularProgress size={22} color="inherit" /> : "Email me a sign-in link"}
                  </Button>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    We use your contact email to find your requests. AnchorDesk does not store a
                    portal password.
                  </Typography>
                  <Button component={RouterLink} to="/register" size="small" sx={{ alignSelf: "center", minHeight: 44 }}>
                    Need access? Request it here
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

