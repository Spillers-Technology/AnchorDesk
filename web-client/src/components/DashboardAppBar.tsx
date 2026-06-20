import React from "react";
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  Slider,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AccountMenu from "../auth/AccountMenu";

interface DashboardAppBarProps {
  drawerOpen: boolean;
  toggleDrawer: () => void;
  currentView: string;
  viewMode: "cards" | "table" | "kanban" | "sync" | "admin" | "network" | "companies";
  cardSize: number;
  handleCardSizeChange: (event: any, newValue: number | number[]) => void;
}

const DashboardAppBar: React.FC<DashboardAppBarProps> = ({
  toggleDrawer,
  currentView,
  viewMode,
  cardSize,
  handleCardSizeChange,
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
        <Typography variant="h6" noWrap>
          Dashboard - {getTitle()}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />

        {/* Conditionally render the slider only when in card view */}
        {viewMode === "cards" && (
          <Box sx={{ width: 200 }}>
            <Typography
              variant="body2"
              color="inherit"
              sx={{ mr: 2, textAlign: "center" }}
            >
              Card Size
            </Typography>
            <Slider
              value={cardSize}
              onChange={handleCardSizeChange}
              step={1}
              marks
              min={1}
              max={6}
              valueLabelDisplay="auto"
              sx={{ color: "#fff" }}
            />
          </Box>
        )}
        <AccountMenu />
      </Toolbar>
    </AppBar>
  );
};

export default DashboardAppBar;
