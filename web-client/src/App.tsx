import { useState, useEffect, useCallback } from "react";
import { Box, CssBaseline, ThemeProvider, Toolbar, CircularProgress, Grid, Button, Typography } from "@mui/material";
import { createTheme } from "@mui/material/styles";
import DashboardAppBar from "./components/DashboardAppBar";
import DashboardDrawer from "./components/DashboardDrawer";
import TicketCard from "./components/TicketCard";
import FilterDialog from "./components/FilterDialog";
import CWManageView from "./components/CWManageView";
import TicketDialog from "./components/TicketDialog";
import { Ticket } from "./interfaces";

const defaultTheme = createTheme({
  palette: {
    primary: { main: "#1976d2" },
    secondary: { main: "#f50057" },
    background: { default: "#f4f6f8" },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: "Roboto, Arial, sans-serif",
  },
});

function App() {
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState<boolean>(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState<boolean>(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [currentView, setCurrentView] = useState<"tickets" | "cwManage">("tickets"); // Updated state to handle multiple views

  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/Tickets"); // Update with your endpoint
      if (!response.ok) {
        throw new Error("Failed to fetch tickets");
      }
      const data = await response.json();
      setTickets(data);
      setFilteredTickets(data); // Initially, show all tickets
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const applyFilters = (filtered: Ticket[]) => {
    setFilteredTickets(filtered);
    setFilterDialogOpen(false);
  };

  // Function to handle ticket click
  const handleTicketClick = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setTicketDialogOpen(true);
  };

  // Function to close the TicketDialog
  const handleTicketDialogClose = () => {
    setTicketDialogOpen(false);
    setSelectedTicket(null);
  };

  return (
    <ThemeProvider theme={defaultTheme}>
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <CssBaseline />
        <DashboardAppBar drawerOpen={drawerOpen} toggleDrawer={toggleDrawer} />
        <DashboardDrawer
          drawerOpen={drawerOpen}
          toggleDrawer={toggleDrawer}
          switchToView={(view) => setCurrentView(view)} // Passing a generic switchToView function
        />

        <Box component="main" sx={{ flexGrow: 1, p: 3, backgroundColor: "background.default" }}>
          <Toolbar /> {/* To offset the AppBar height */}

          {currentView === "tickets" ? (
            <>
              <Button variant="contained" onClick={() => setFilterDialogOpen(true)}>Filter Tickets</Button>

              {error && <Typography color="error">Error: {error.message}</Typography>}
              {loading ? (
                <CircularProgress />
              ) : filteredTickets.length > 0 ? (
                <Grid container spacing={3} sx={{ mt: 2 }}>
                  {filteredTickets.map((ticket) => (
                    <Grid item xs={12} sm={6} md={4} key={ticket.ticketnumber}>
                      <TicketCard ticket={ticket} onClick={() => handleTicketClick(ticket)} />
                    </Grid>
                  ))}
                </Grid>
              ) : (
                <Typography variant="body1">No tickets found.</Typography>
              )}
            </>
          ) : (
            <CWManageView />
          )}
        </Box>

        {/* Filter Dialog */}
        <FilterDialog
          open={filterDialogOpen}
          onClose={() => setFilterDialogOpen(false)}
          tickets={tickets}
          applyFilters={applyFilters}
        />

        {/* Ticket Dialog */}
        {selectedTicket && (
          <TicketDialog
            ticket={selectedTicket}
            open={ticketDialogOpen}
            onClose={handleTicketDialogClose}
          />
        )}
      </Box>
    </ThemeProvider>
  );
}

export default App;
