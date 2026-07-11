import React from "react";
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AnchorIcon from "@mui/icons-material/Anchor";
import AccountMenu from "../auth/AccountMenu";
import NotificationBell from "./NotificationBell";

interface DashboardAppBarProps {
  drawerOpen: boolean;
  toggleDrawer: () => void;
  currentView: string;
  viewMode: "cards" | "table" | "kanban" | "sync" | "admin" | "network" | "companies" | "myday";
  onOpenTicket?: (ticketId: number) => void;
}

const DashboardAppBar: React.FC<DashboardAppBarProps> = ({
  toggleDrawer,
  currentView,
  onOpenTicket,
}) => {
  // Dynamically set the title based on the current view
  const getTitle = () => {
    switch (currentView) {
      case "tickets":
        return "Tickets";
      case "myTickets":
        return "My Tickets";
      case "sync":
        return "Sync Management";
      case "admin":
        return "Admin";
      case "network":
        return "Network";
      case "companies":
        return "Companies";
      case "myday":
        return "My Day";
      case "kanban":
        return "Kanban Board";
      default:
        return "Dashboard";
    }
  };

  return (
    <AppBar
      position="fixed"
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
    >
      <Toolbar>
        <IconButton
          color="inherit"
          edge="start"
          onClick={toggleDrawer}
          sx={{ mr: 2 }}
        >
          <MenuIcon />
        </IconButton>
        <AnchorIcon fontSize="small" sx={{ mr: 1, opacity: 0.85 }} />
        <Typography variant="h6" noWrap>
          {getTitle()}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <NotificationBell onOpenTicket={onOpenTicket} />
        <AccountMenu />
      </Toolbar>
    </AppBar>
  );
};

export default DashboardAppBar;
