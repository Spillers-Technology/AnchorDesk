import { useState, useEffect, useCallback } from "react";
import {
  Box,
  CssBaseline,
  ThemeProvider,
  Toolbar,
  CircularProgress,
  Grid,
  Button,
  Typography,
} from "@mui/material";
import { createTheme } from "@mui/material/styles";
import DashboardAppBar from "./components/DashboardAppBar";
import DashboardDrawer from "./components/DashboardDrawer";
import TicketCard from "./components/TicketCard";
import FilterDialog from "./components/FilterDialog";
import CWManageView from "./components/CWManageView";
import TicketDialog from "./components/TicketDialog";
import TicketTable from "./components/TicketTable";
import { Ticket, Technician, Company } from "./interfaces";

// Define Theme for Styling
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
  const [ticketNotes, setTicketNotes] = useState<any[]>([]);
  const [currentView, setCurrentView] = useState<"tickets" | "myTickets" | "cwManage">("tickets");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [cardSize, setCardSize] = useState<number>(5); // State to manage card size dynamically

  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  const fetchTickets = useCallback(
    async (forceUpdate: boolean = false) => {
      setLoading(true);
      try {
        let endpoint = `/api/Tickets/Open${forceUpdate ? "?forceUpdate=true" : ""}`;
        if (currentView === "myTickets") {
          endpoint = `/api/Tickets/ByResource/jspillers${forceUpdate ? "?forceUpdate=true" : ""}`;
        }

        const response = await fetch(endpoint);
        if (!response.ok) {
          throw new Error("Failed to fetch tickets");
        }
        const data = await response.json();

        const mappedTickets: Ticket[] = data.map((ticket: any) => ({
          ticketnumber: ticket.id,
          ticketSummary: " ", // ticket.name
          ticketTitle: ticket.summary,
          company: {
            CompanyName: ticket.company.name,
            Acronym: ticket.company.identifier,
            PrimaryEngagementMgr: ticket.company._info.updatedBy,
          } as Company,
          technician: ticket.technician
            ? {
                TechnicianID: ticket.technician.id,
                FirstName: ticket.technician.firstName,
                LastName: ticket.technician.lastName,
                Username: ticket.technician.username,
              } as Technician
            : null,
          priority: ticket.priority.name,
          status: ticket.status.name,
          dateEntered: ticket.dateEntered,
          timeEntries: ticket.timeEntries || [],
        }));

        setTickets(mappedTickets);
        setFilteredTickets(mappedTickets);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    },
    [currentView]
  );

  const fetchTicketNotes = async (ticketId: number) => {
    try {
      const response = await fetch(`/api/Tickets/${ticketId}/Notes`);
      if (!response.ok) {
        throw new Error("Failed to fetch ticket notes");
      }
      const data = await response.json();
      return data;
    } catch (err) {
      console.error("Error fetching notes:", err);
      return [];
    }
  };

  const handleTicketClick = async (ticket: Ticket) => {
    setLoading(true);
    setSelectedTicket(ticket);

    const notes = await fetchTicketNotes(ticket.ticketnumber);
    setTicketNotes(notes);
    setTicketDialogOpen(true);
    setLoading(false);
  };

  const handleTicketDialogClose = () => {
    setTicketDialogOpen(false);
    setSelectedTicket(null);
    setTicketNotes([]);
  };

  const applyFilters = (filtered: Ticket[]) => {
    setFilteredTickets(filtered);
    setFilterDialogOpen(false);
  };

  const shortenSummary = (summary: string) => {
    return summary.length > 100 ? `${summary.slice(0, 100)}...` : summary;
  };

  const handleCardSizeChange = (event: any, newValue: number | number[]) => {
    setCardSize(newValue as number);
  };

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets, currentView]);

  return (
    <ThemeProvider theme={defaultTheme}>
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <CssBaseline />
        <DashboardAppBar
          drawerOpen={drawerOpen}
          toggleDrawer={toggleDrawer}
          currentView={currentView}
          viewMode={viewMode} // Pass viewMode to AppBar
          cardSize={cardSize} // Pass cardSize to AppBar
          handleCardSizeChange={handleCardSizeChange} // Pass handler to AppBar
        />
        <DashboardDrawer
          drawerOpen={drawerOpen}
          toggleDrawer={toggleDrawer}
          switchToView={(view) => setCurrentView(view)}
        />

        <Box component="main" sx={{ flexGrow: 1, p: 3, backgroundColor: "background.default" }}>
          <Toolbar />

          {currentView === "tickets" || currentView === "myTickets" ? (
            <>
              <Button
                variant="contained"
                onClick={() => setViewMode((prev) => (prev === "cards" ? "table" : "cards"))}
                sx={{ mb: 2 }}
              >
                {viewMode === "cards" ? "Switch to Table View" : "Switch to Card View"}
              </Button>

              <Button variant="contained" onClick={() => setFilterDialogOpen(true)} sx={{ mb: 2, ml: 2 }}>
                Filter Tickets
              </Button>

              {error && <Typography color="error">Error: {error.message}</Typography>}
              {loading ? (
                <CircularProgress />
              ) : filteredTickets.length > 0 ? (
                viewMode === "cards" ? (
                  <Grid container spacing={3} sx={{ mt: 2 }}>
                    {filteredTickets.map((ticket) => (
                      <Grid item xs={12} sm={6} md={12 / cardSize} key={ticket.ticketnumber}>
                        <TicketCard
                          ticket={ticket}
                          onClick={() => handleTicketClick(ticket)}
                          shortenedSummary={shortenSummary(ticket.ticketSummary)}
                        />
                      </Grid>
                    ))}
                  </Grid>
                ) : (
                  <TicketTable tickets={filteredTickets} onRowClick={handleTicketClick} />
                )
              ) : (
                <Typography variant="body1">No tickets found.</Typography>
              )}
            </>
          ) : (
            <CWManageView fetchTickets={() => fetchTickets(true)} />
          )}
        </Box>

        <FilterDialog
          open={filterDialogOpen}
          onClose={() => setFilterDialogOpen(false)}
          tickets={tickets}
          applyFilters={applyFilters}
        />

        {selectedTicket && (
          <TicketDialog
            ticket={selectedTicket}
            open={ticketDialogOpen}
            onClose={handleTicketDialogClose}
            shortenedSummary={shortenSummary(selectedTicket.ticketSummary)}
            notes={ticketNotes}
          />
        )}
      </Box>
    </ThemeProvider>
  );
}

export default App;
