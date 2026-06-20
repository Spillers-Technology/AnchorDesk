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
  Snackbar,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  InputAdornment,
  Tooltip,
  IconButton,
  Paper,
} from "@mui/material";
import { theme as defaultTheme } from "./theme";
import DashboardAppBar from "./components/DashboardAppBar";
import DashboardDrawer from "./components/DashboardDrawer";
import TicketCard from "./components/TicketCard";
import FilterDialog from "./components/FilterDialog";
import CWManageView from "./components/CWManageView";
import AdminView from "./components/AdminView";
import NetworkView from "./components/NetworkView";
import TicketDialog from "./components/TicketDialog";
import TicketTable from "./components/TicketTable";
import KanbanBoard from "./components/KanbanBoard";
import CreateTicketDialog from "./components/CreateTicketDialog";
import { Ticket, Company, Note } from "./interfaces";
import * as api from "./api/client";
import { useAuth } from "./auth/AuthContext";
import LoginView from "./auth/LoginView";
import AddIcon from "@mui/icons-material/Add";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import TableRowsIcon from "@mui/icons-material/TableRows";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";

// Map local-DB ticket record to the component-facing Ticket interface.
// The component interface uses CW-era field names; this adapter lets us keep
// all existing components unchanged while the data layer migrates.
function mapDbTicket(t: Record<string, unknown>): Ticket & { localId: number } {
  return {
    localId: t.id as number,
    ticketnumber: t.id as number,
    ticketTitle: String(t.title ?? ""),
    ticketSummary: String(t.summary ?? t.description ?? ""),
    status: String(t.status ?? "New"),
    priority: String(t.priority ?? ""),
    assignee: String(t.assignee ?? ""),
    company: {
      CompanyName: String(t.companyName ?? ""),
      Acronym: "",
      PrimaryEngagementMgr: "",
    } as Company,
    technician: null,
    timeEntries: [],
    dateEntered: String(t.createdAt ?? ""),
  };
}

function mapDbNote(n: Record<string, unknown>): Note {
  return {
    id: String(n.id),
    dateCreated: String(n.createdAt ?? ""),
    text: String(n.content ?? ""),
    authorId: String(n.authorId ?? ""),
    authorName: String(n.author ?? ""),
    type: n.noteType === "time_entry" ? "timeEntry" : "note",
    timeStart: n.timeStart ? String(n.timeStart) : undefined,
    timeStop: n.timeStop ? String(n.timeStop) : undefined,
  };
}

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tickets, setTickets] = useState<(Ticket & { localId: number })[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<(Ticket & { localId: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketNotes, setTicketNotes] = useState<Note[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "table" | "kanban" | "sync" | "admin" | "network">("cards");
  const [cardSize, setCardSize] = useState(5);
  const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { user, loading: authLoading, isAdmin, setUser } = useAuth();
  const currentUser = { id: user?.id ?? 0, name: user?.displayName ?? user?.username ?? "User" };

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTickets({ pageSize: 200 });
      const mapped = (data as Record<string, unknown>[]).map(mapDbTicket);
      setTickets(mapped);
      setFilteredTickets(mapped);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTicketNotes = async (ticketId: number): Promise<Note[]> => {
    try {
      const data = await api.listNotes(ticketId);
      return (data as Record<string, unknown>[]).map(mapDbNote);
    } catch (err) {
      console.error("Error fetching notes:", err);
      return [];
    }
  };

  const handleTicketClick = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setTicketDialogOpen(true);
    if (ticket.localId != null) {
      const notes = await fetchTicketNotes(ticket.localId);
      setTicketNotes(notes);
    }
  };

  const handleTicketDialogClose = () => {
    setTicketDialogOpen(false);
    setSelectedTicket(null);
    setTicketNotes([]);
  };

  const handleStatusChange = async (ticketId: number, newStatus: string) => {
    // Optimistic update
    const update = (list: (Ticket & { localId: number })[]) =>
      list.map((t) => (t.localId === ticketId ? { ...t, status: newStatus } : t));
    setTickets((prev) => update(prev));
    setFilteredTickets((prev) => update(prev));

    try {
      await api.updateTicket(ticketId, { status: newStatus });
      setToast({ message: `Status updated to ${newStatus}`, severity: "success" });
    } catch (err) {
      // Revert on failure by re-fetching
      setToast({ message: `Failed to update status: ${(err as Error).message}`, severity: "error" });
      fetchTickets();
    }
  };

  const applyFilters = (filtered: Ticket[]) => {
    setFilteredTickets(filtered as (Ticket & { localId: number })[]);
    setFilterDialogOpen(false);
  };

  const shortenSummary = (summary: string) =>
    summary.length > 100 ? `${summary.slice(0, 100)}...` : summary;

  const handleCardSizeChange = (_event: unknown, newValue: number | number[]) => {
    setCardSize(newValue as number);
  };

  useEffect(() => {
    if (user) fetchTickets();
  }, [fetchTickets, user]);

  // Full-text search (debounced). Empty query falls back to the full list.
  useEffect(() => {
    if (!user) return;
    const q = searchTerm.trim();
    if (!q) {
      setFilteredTickets(tickets);
      return;
    }
    const handle = setTimeout(() => {
      api
        .searchTickets(q)
        .then((data) => setFilteredTickets((data as Record<string, unknown>[]).map(mapDbTicket)))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [searchTerm, tickets, user]);

  if (authLoading) {
    return (
      <ThemeProvider theme={defaultTheme}>
        <CssBaseline />
        <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  if (!user) {
    return (
      <ThemeProvider theme={defaultTheme}>
        <CssBaseline />
        <LoginView
          onAuthenticated={(u) => {
            setUser(u);
            // Drop any ?authError=... left by an SSO redirect.
            window.history.replaceState({}, "", window.location.pathname);
          }}
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={defaultTheme}>
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <CssBaseline />
        <DashboardAppBar
          drawerOpen={drawerOpen}
          toggleDrawer={() => setDrawerOpen(!drawerOpen)}
          currentView={viewMode}
          viewMode={viewMode}
          cardSize={cardSize}
          handleCardSizeChange={handleCardSizeChange}
        />
        <DashboardDrawer
          drawerOpen={drawerOpen}
          toggleDrawer={() => setDrawerOpen(!drawerOpen)}
          setViewMode={setViewMode}
          currentView={viewMode}
          isAdmin={isAdmin}
        />

        <Box component="main" sx={{ flexGrow: 1, p: 3, backgroundColor: "background.default" }}>
          <Toolbar />

          {["cards", "table", "kanban"].includes(viewMode) && (
            <Paper variant="outlined" sx={{ p: 1, mb: 2, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={viewMode}
                onChange={(_e, v) => v && setViewMode(v)}
              >
                <ToggleButton value="cards"><Tooltip title="Cards"><ViewModuleIcon fontSize="small" /></Tooltip></ToggleButton>
                <ToggleButton value="table"><Tooltip title="Table"><TableRowsIcon fontSize="small" /></Tooltip></ToggleButton>
                <ToggleButton value="kanban"><Tooltip title="Board"><ViewKanbanIcon fontSize="small" /></Tooltip></ToggleButton>
              </ToggleButtonGroup>

              <TextField
                size="small"
                placeholder="Search tickets…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ flexGrow: 1, minWidth: 200, maxWidth: 420 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>
                  ),
                }}
              />

              <Tooltip title="Filter">
                <IconButton onClick={() => setFilterDialogOpen(true)}><FilterListIcon /></IconButton>
              </Tooltip>

              <Box sx={{ flexGrow: 1 }} />

              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialogOpen(true)}>
                New ticket
              </Button>
            </Paper>
          )}

          {viewMode === "admin" ? (
            <AdminView />
          ) : viewMode === "network" ? (
            <NetworkView />
          ) : viewMode === "sync" ? (
            <CWManageView onTicketsChanged={fetchTickets} />
          ) : (
            <>
          {error && <Typography color="error">Error: {error.message}</Typography>}

          {loading ? (
            <CircularProgress />
          ) : filteredTickets.length > 0 ? (
            viewMode === "cards" ? (
              <Grid container spacing={3} sx={{ mt: 2 }}>
                {filteredTickets.map((ticket) => (
                  <Grid item xs={12} sm={6} md={12 / cardSize} key={ticket.localId}>
                    <TicketCard
                      ticket={ticket}
                      onClick={() => handleTicketClick(ticket)}
                      shortenedSummary={shortenSummary(ticket.ticketSummary)}
                    />
                  </Grid>
                ))}
              </Grid>
            ) : viewMode === "table" ? (
              <TicketTable tickets={filteredTickets} onRowClick={handleTicketClick} />
            ) : (
              <KanbanBoard
                tickets={filteredTickets}
                onStatusChange={(ticketId, newStatus) => handleStatusChange(ticketId, newStatus)}
                onTicketClick={handleTicketClick}
              />
            )
          ) : (
            <Typography variant="body1">No tickets found.</Typography>
          )}
            </>
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
            notes={ticketNotes}
            currentUser={currentUser}
            onUpdated={(field) => {
              fetchTickets();
              setToast({ message: field === "status" ? "Status updated" : "Ticket updated", severity: "success" });
            }}
          />
        )}

        <CreateTicketDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onCreated={() => {
            fetchTickets();
            setToast({ message: "Ticket created", severity: "success" });
          }}
        />

        <Snackbar
          open={!!toast}
          autoHideDuration={4000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          {toast ? (
            <Alert onClose={() => setToast(null)} severity={toast.severity} sx={{ width: "100%" }}>
              {toast.message}
            </Alert>
          ) : undefined}
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}

export default App;
