import { useState } from "react";
import { Link as RouterLink, Outlet, useNavigate } from "react-router-dom";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import AnchorIcon from "@mui/icons-material/Anchor";
import AddIcon from "@mui/icons-material/Add";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import { usePortalAuth } from "./PortalAuthContext";

export default function PortalShell() {
  const { requester, logout } = usePortalAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(false);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch {
      setLogoutError(true);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="inherit">
        <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, px: { xs: 1.5, sm: 3 } }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              borderRadius: 2,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              mr: 1.25,
              flexShrink: 0,
            }}
          >
            <AnchorIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>AnchorDesk Support</Typography>
            <Typography
              variant="caption"
              noWrap
              sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}
            >
              Signed in as {requester?.displayName || requester?.email}
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title="Sign out">
            <span>
              <IconButton
                aria-label="Sign out"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                sx={{ width: 44, height: 44 }}
              >
                <LogoutIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container
        component="main"
        maxWidth="md"
        sx={{ minWidth: 0, py: { xs: 2, sm: 3 }, px: { xs: 2, sm: 3 } }}
      >
        {logoutError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLogoutError(false)}>
            Sign out could not be completed. Please try again.
          </Alert>
        )}
        <Stack direction="row" spacing={1} sx={{ mb: { xs: 2, sm: 3 } }}>
          <Button
            component={RouterLink}
            to="/tickets"
            variant="outlined"
            startIcon={<ConfirmationNumberOutlinedIcon />}
            sx={{ minHeight: 44, flex: { xs: 1, sm: "0 0 auto" } }}
          >
            My tickets
          </Button>
          <Button
            component={RouterLink}
            to="/tickets/new"
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ minHeight: 44, flex: { xs: 1, sm: "0 0 auto" } }}
          >
            New request
          </Button>
        </Stack>
        <Outlet />
      </Container>
    </Box>
  );
}

