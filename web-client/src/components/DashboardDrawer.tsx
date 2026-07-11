import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Box,
  Typography,
  Divider,
} from "@mui/material";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import TableRowsIcon from "@mui/icons-material/TableRows";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import HubIcon from "@mui/icons-material/Hub";
import SyncIcon from "@mui/icons-material/Sync";
import SettingsIcon from "@mui/icons-material/Settings";
import AnchorIcon from "@mui/icons-material/Anchor";
import BusinessIcon from "@mui/icons-material/Business";
import ViewTimelineIcon from "@mui/icons-material/ViewTimeline";

type ViewMode = "cards" | "table" | "kanban" | "sync" | "admin" | "network" | "companies" | "myday";

interface DashboardDrawerProps {
  drawerOpen: boolean;
  toggleDrawer: () => void;
  setViewMode: (viewMode: ViewMode) => void;
  currentView?: ViewMode;
  isAdmin?: boolean;
  legacyTableView?: boolean;
}

interface NavItem {
  mode: ViewMode;
  label: string;
  icon: React.ReactNode;
}

// "Table" is the legacy view — only shown when the admin has enabled it, matching
// the toolbar toggle. Filtered in the component from the legacyTableView flag.
const TICKET_NAV: NavItem[] = [
  { mode: "kanban", label: "Board", icon: <ViewKanbanIcon /> },
  { mode: "cards", label: "Cards", icon: <ViewModuleIcon /> },
  { mode: "table", label: "Table", icon: <TableRowsIcon /> },
];

const TIME_NAV: NavItem[] = [
  { mode: "myday", label: "My Day", icon: <ViewTimelineIcon /> },
];

const OPS_NAV: NavItem[] = [
  { mode: "companies", label: "Companies", icon: <BusinessIcon /> },
  { mode: "network", label: "Network", icon: <HubIcon /> },
  { mode: "sync", label: "Sync", icon: <SyncIcon /> },
];

export default function DashboardDrawer({ drawerOpen, toggleDrawer, setViewMode, currentView, isAdmin, legacyTableView }: DashboardDrawerProps) {
  const nav = (mode: ViewMode) => () => {
    setViewMode(mode);
    toggleDrawer();
  };

  const ticketNav = TICKET_NAV.filter((it) => it.mode !== "table" || legacyTableView);

  const section = (label: string, items: NavItem[]) => (
    <List
      subheader={
        <ListSubheader sx={{ bgcolor: "transparent", lineHeight: "32px", fontSize: ".72rem", letterSpacing: ".08em", color: "text.secondary" }}>
          {label.toUpperCase()}
        </ListSubheader>
      }
    >
      {items.map((it) => (
        <ListItemButton key={it.mode} selected={currentView === it.mode} onClick={nav(it.mode)}>
          <ListItemIcon sx={{ minWidth: 40 }}>{it.icon}</ListItemIcon>
          <ListItemText primary={it.label} />
        </ListItemButton>
      ))}
    </List>
  );

  return (
    <Drawer anchor="left" open={drawerOpen} onClose={toggleDrawer}>
      <Box sx={{ width: 252 }}>
        {/* Brand */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 2.5, py: 2 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: "primary.main", color: "#fff", display: "grid", placeItems: "center" }}>
            <AnchorIcon fontSize="small" />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>AnchorDesk</Typography>
        </Box>
        <Divider />

        {section("Tickets", ticketNav)}
        <Divider sx={{ mx: 2 }} />
        {section("Time", TIME_NAV)}
        <Divider sx={{ mx: 2 }} />
        {section("Operations", OPS_NAV)}

        {isAdmin && (
          <>
            <Divider sx={{ mx: 2 }} />
            {section("Administration", [{ mode: "admin", label: "Admin console", icon: <SettingsIcon /> }])}
          </>
        )}
      </Box>
    </Drawer>
  );
}
