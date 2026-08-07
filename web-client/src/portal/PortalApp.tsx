import { Navigate, Route, Routes } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { usePortalAuth } from "./PortalAuthContext";
import PortalLoginView from "./PortalLoginView";
import PortalRegisterView from "./PortalRegisterView";
import PortalNewTicketView from "./PortalNewTicketView";
import PortalShell from "./PortalShell";
import PortalTicketDetailView from "./PortalTicketDetailView";
import PortalTicketsView from "./PortalTicketsView";

export default function PortalApp() {
  const { status, requester, notice, refresh } = usePortalAuth();

  if (status === "loading") {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress aria-label="Loading portal" />
      </Box>
    );
  }

  if (status === "unavailable" || (status === "authenticated" && !requester)) {
    return (
      <Box
        component="main"
        sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}
      >
        <Stack spacing={2} sx={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
          <Typography component="h1" variant="h5">Portal temporarily unavailable</Typography>
          <Alert severity="error">
            AnchorDesk could not confirm your portal session. No ticket information was loaded.
          </Alert>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            sx={{ minHeight: 44, alignSelf: "center" }}
          >
            Retry
          </Button>
        </Stack>
      </Box>
    );
  }

  if (status === "anonymous") {
    return (
      <Routes>
        <Route path="/login" element={<PortalLoginView notice={notice} />} />
        <Route path="/register" element={<PortalRegisterView />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<PortalShell />}>
        <Route index element={<Navigate to="/tickets" replace />} />
        <Route path="/tickets" element={<PortalTicketsView />} />
        <Route path="/tickets/new" element={<PortalNewTicketView />} />
        <Route path="/tickets/:ticketId" element={<PortalTicketDetailView />} />
        <Route path="*" element={<Navigate to="/tickets" replace />} />
      </Route>
    </Routes>
  );
}

