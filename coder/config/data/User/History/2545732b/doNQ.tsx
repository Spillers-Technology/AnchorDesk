import React, { useState } from "react";
import {
  styled,
  createTheme,
  ThemeProvider,
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Badge,
  Card,
  CardContent,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Drawer,
} from "@mui/material";
import {
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  Notifications as NotificationsIcon,
} from "@mui/icons-material";
import CssBaseline from "@mui/material/CssBaseline";

// Define Theme for Styling
const defaultTheme = createTheme({
  palette: {
    primary: {
      main: "#1976d2", // Example primary color
    },
    secondary: {
      main: "#f50057", // Example secondary color
    },
  },
});


// Define Styled Components
const DashboardAppBar = styled(AppBar)(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
}));

const DashboardDrawer = styled(Drawer)(({ theme }) => ({
  width: 240, // Drawer width
  flexShrink: 0,
  "& .MuiDrawer-paper": {
    width: 240,
    boxSizing: "border-box",
  },
}));

function Dashboard() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  return (
    <ThemeProvider theme={defaultTheme}>
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <CssBaseline />

        {/* AppBar */}
        <DashboardAppBar position="fixed">
          <Toolbar>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={toggleDrawer}
              sx={{ mr: 2, ...(drawerOpen && { display: "none" }) }}
            >
              <MenuIcon />
            </IconButton>
            <Typography
              variant="h6"
              noWrap
              component="div"
              sx={{ flexGrow: 1 }}
            >
              Dashboard
            </Typography>
            <IconButton color="inherit">
              <Badge badgeContent={4} color="secondary">
                <NotificationsIcon />
              </Badge>
            </IconButton>
          </Toolbar>
        </DashboardAppBar>

        {/* Navigation Drawer */}
        <DashboardDrawer
          variant="temporary"
          open={drawerOpen}
          onClose={toggleDrawer}
        >
          <Toolbar>
            <IconButton onClick={toggleDrawer}>
              <ChevronLeftIcon />
            </IconButton>
          </Toolbar>
          <Divider />

          <List>
            <ListItemButton>
              <ListItemIcon>{/* Add icons as needed */}</ListItemIcon>
              <ListItemText primary="Home" />
            </ListItemButton>
            {/* Add more ListItems for navigation */}
          </List>
        </DashboardDrawer>

        {/* Main Content */}
        <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
          <Toolbar /> {/* To offset the AppBar height */}
          <Card>
            <CardContent>
              {/* Add your card content here */}
              <Typography variant="h5" component="div">
                Welcome to Your Dashboard
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default Dashboard;
