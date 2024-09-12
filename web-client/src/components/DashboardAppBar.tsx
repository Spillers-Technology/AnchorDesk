import { AppBar, Toolbar, IconButton, Typography, Box, Slider } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

interface DashboardAppBarProps {
  drawerOpen: boolean;
  toggleDrawer: () => void;
  currentView: "tickets" | "myTickets" | "cwManage";
  viewMode: "cards" | "table"; // Add viewMode prop
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
      case "cwManage":
        return "CW Manage";
      default:
        return "Dashboard";
    }
  };

  return (
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar>
        <IconButton color="inherit" edge="start" onClick={toggleDrawer} sx={{ mr: 2 }}>
          <MenuIcon />
        </IconButton>
        <Typography variant="h6" noWrap>
          Dashboard - {getTitle()}
        </Typography>
        <Box sx={{ flexGrow: 1 }} /> {/* This pushes the slider to the right */}

        {/* Conditionally render the slider only when in card view */}
        {viewMode === "cards" && (
          <Box sx={{ width: 200 }}>
            <Typography variant="body2" color="inherit" sx={{ mr: 2 }}>
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
              sx={{ color: "#fff" }} // Optional: Adjust the color to match AppBar
            />
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default DashboardAppBar;
