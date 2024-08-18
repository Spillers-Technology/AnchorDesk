import React, { useState, useEffect } from "react";
import {
  Box,
  CssBaseline,
  Card,
  CardContent,
  Typography,
  ThemeProvider,
  Badge,
  IconButton,
  Toolbar,
} from "@mui/material";
import { createTheme } from "@mui/material/styles";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { Database } from "./Database"; // Assume you have this from previous file
import TicketFactory from "./TicketFactory"; // Assume this is abstracted as well
import DashboardAppBar from "./components/DashboardAppBar"; // Custom component
import DashboardDrawer from "./components/DashboardDrawer"; // Custom component

// Define Theme for Styling
const defaultTheme = createTheme({
  palette: {
    primary: { main: "#1976d2" }, // Example primary color
    secondary: { main: "#f50057" }, // Example secondary color
  },
});

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState(null);

  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  useEffect(() => {
    const fetchTickets = async () => {
      const db = new Database("localhost", "root", "Joseph1356", "Resultant");

      try {
        await db.connect();
        const ticketFactory = new TicketFactory(db);
        const fetchedTickets = await ticketFactory.getAllTickets();
        setTickets(fetchedTickets);
      } catch (err) {
        setError(err);
      } finally {
        await db.close();
      }
    };

    fetchTickets();
  }, []);

  return (
    <ThemeProvider theme={defaultTheme}>
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <CssBaseline />
        <DashboardAppBar drawerOpen={drawerOpen} toggleDrawer={toggleDrawer} />
        <DashboardDrawer drawerOpen={drawerOpen} toggleDrawer={toggleDrawer} />

        {/* Main Content */}
        <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
          <Toolbar /> {/* To offset the AppBar height */}
          <Card>
            <CardContent>
              <Typography variant="h5">Welcome to Your Dashboard</Typography>
              {error && <Typography color="error">Error: {error.message}</Typography>}
              <Typography variant="body1">Total Tickets: {tickets.length}</Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
