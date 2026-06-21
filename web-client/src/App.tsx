import { useState, useEffect, useCallback, useRef } from "react";
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
  Pagination,
  Badge,
} from "@mui/material";
import { theme as defaultTheme } from "./theme";
import DashboardAppBar from "./components/DashboardAppBar";
import DashboardDrawer from "./components/DashboardDrawer";
import TicketCard from "./components/TicketCard";
import FilterDialog from "./components/FilterDialog";
import CWManageView from "./components/CWManageView";
import AdminView from "./components/AdminView";
import NetworkView from "./components/NetworkView";
import CompaniesView from "./components/CompaniesView";
import TicketDialog from "./components/TicketDialog";
import TicketTable from "./components/TicketTable";
import KanbanBoard from "./components/KanbanBoard";
import CreateTicketDialog from "./components/CreateTicketDialog";
import { Ticket, Company, Note } from "./interfaces";
import * as api from "./api/client";
import { subscribeRealtime } from "./api/realtime";
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
    responseDueAt: (t.responseDueAt as string | null) ?? null,
    resolutionDueAt: (t.resolutionDueAt as string | null) ?? null,
    firstRespondedAt: (t.firstRespondedAt as string | null) ?? null,
    labels: (t.labels as Ticket["labels"]) ?? [],
  };
}

function mapDbNote(n: Record<string, unknown>): Note {
  return {
    id: String(n.id),
    dateCreated: String(n.createdAt ?? ""),
    text: String(n.content ?? ""),
    authorId: String(n.authorId ?? ""),
    authorName: String(n.author ?? ""),
    type: n.noteType === "time_entry" ? "timeEntry" : n.noteType === "email" ? "email" : "note",
    timeStart: n.timeStart ? String(n.timeStart) : undefined,
    timeStop: n.timeStop ? String(n.timeStop) : undefined,
    minutes: n.minutes != null ? Number(n.minutes) : undefined,
    direction: n.direction ? (String(n.direction) as "inbound" | "outbound") : undefined,
    html: n.htmlContent ? String(n.htmlContent) : undefined,
    emailFrom: n.emailFrom ? String(n.emailFrom) : undefined,
    emailTo: n.emailTo ? String(n.emailTo) : undefined,
    emailCc: n.emailCc ? String(n.emailCc) : undefined,
    subject: n.subject ? String(n.subject) : undefined,
  };
}

// Per-view page sizes. Cards/table page modestly; kanban is bounded (a board
// over thousands of cards isn't meaningful — narrow with search/filters).
const PAGE_SIZE: Record<string, number> = { cards: 24, table: 50, kanban: 200 };

export interface TicketFilterCriteria {
  status?: string;
  assignee?: string;
  company?: string;
}

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tickets, setTickets] = useState<(Ticket & { localId: number })[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); // 1-based
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [filters, setFilters] = useState<TicketFilterCriteria>({});
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketNotes, setTicketNotes] = useState<Note[]>([]);
  const [viewMode, setViewMode] = useState<"cards" | "table" | "kanban" | "sync" | "admin" | "network" | "companies">("cards");
  const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [networkCompany, setNetworkCompany] = useState<string | undefined>(undefined);

  const pageSize = PAGE_SIZE[viewMode] ?? 50;

  const { user, loading: authLoading, isAdmin, setUser } = useAuth();
  const currentUser = { id: user?.id ?? 0, name: user?.displayName ?? user?.username ?? "User" };

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listTickets({
        page,
        pageSize,
        q: debouncedSearch || undefined,
        status: filters.status || undefined,
        assignee: filters.assignee || undefined,
        company: filters.company || undefined,
      });
      setTickets((res.items as Record<string, unknown>[]).map(mapDbTicket));
      setTotal(res.total);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, filters]);

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

  const openTicketById = async (id: number) => {
    try {
      const t = await api.getTicket(id);
      handleTicketClick(mapDbTicket(t as Record<string, unknown>));
    } catch (err) {
      console.error("open ticket failed", err);
    }
  };

  const handleTicketDialogClose = () => {
    setTicketDialogOpen(false);
    setSelectedTicket(null);
    setTicketNotes([]);
  };

  const handleStatusChange = async (ticketId: number, newStatus: string) => {
    // Optimistic update of the current page.
    setTickets((prev) => prev.map((t) => (t.localId === ticketId ? { ...t, status: newStatus } : t)));
    try {
      await api.updateTicket(ticketId, { status: newStatus });
      setToast({ message: `Status updated to ${newStatus}`, severity: "success" });
    } catch (err) {
      setToast({ message: `Failed to update status: ${(err as Error).message}`, severity: "error" });
      fetchTickets(); // revert by re-fetching
    }
  };

  const applyFilters = (criteria: TicketFilterCriteria) => {
    setFilters(criteria);
    setPage(1);
    setFilterDialogOpen(false);
  };

  const shortenSummary = (summary: string) =>
    summary.length > 100 ? `${summary.slice(0, 100)}...` : summary;

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => {
    if (user) fetchTickets();
  }, [fetchTickets, user]);

  // Page size differs per view, so reset to page 1 when switching views.
  useEffect(() => { setPage(1); }, [viewMode]);

  // Debounce the search box, then drive the server query. Reset to page 1 on
  // a new search so results aren't hidden on a stale page.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  // Live updates: a shared WebSocket pushes ticket/note changes from anywhere
  // (another tech, an inbound email, an SLA breach) so the list and the open
  // ticket stay current without a manual refresh. Refs keep the subscription
  // stable while still calling the latest fetchers.
  const fetchTicketsRef = useRef(fetchTickets);
  useEffect(() => { fetchTicketsRef.current = fetchTickets; }, [fetchTickets]);
  const selectedRef = useRef(selectedTicket);
  useEffect(() => { selectedRef.current = selectedTicket; }, [selectedTicket]);

  useEffect(() => {
    if (!user) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refetchSoon = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => fetchTicketsRef.current(), 400);
    };
    const unsub = subscribeRealtime((event) => {
      if (event.type === "note.added") {
        const sel = selectedRef.current;
        if (sel?.localId === event.ticketId) {
          fetchTicketNotes(event.ticketId).then(setTicketNotes).catch(() => {});
        }
        refetchSoon();
      } else if (event.type.startsWith("ticket.")) {
        refetchSoon();
      }
    });
    return () => { if (pending) clearTimeout(pending); unsub(); };
  }, [user]);

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
          onOpenTicket={openTicketById}
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
                <IconButton onClick={() => setFilterDialogOpen(true)}>
                  <Badge badgeContent={activeFilterCount} color="primary">
                    <FilterListIcon />
                  </Badge>
                </IconButton>
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
            <NetworkView initialCompany={networkCompany} />
          ) : viewMode === "companies" ? (
            <CompaniesView
              onOpenTicket={openTicketById}
              onViewNetwork={(name) => { setNetworkCompany(name); setViewMode("network"); }}
            />
          ) : viewMode === "sync" ? (
            <CWManageView onTicketsChanged={fetchTickets} />
          ) : (
            <>
          {error && <Typography color="error">Error: {error.message}</Typography>}

          {loading ? (
            <CircularProgress />
          ) : viewMode === "table" ? (
            // DataGrid is virtualized + paginates server-side; it renders its own
            // footer and empty state, so it sits outside the cards/kanban branch.
            <TicketTable
              tickets={tickets}
              rowCount={total}
              page={page - 1}
              pageSize={pageSize}
              onPageChange={(p) => setPage(p + 1)}
              onRowClick={handleTicketClick}
            />
          ) : tickets.length > 0 ? (
            viewMode === "cards" ? (
              <>
                <Grid container spacing={3} sx={{ mt: 0 }}>
                  {tickets.map((ticket) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={ticket.localId}>
                      <TicketCard
                        ticket={ticket}
                        onClick={() => handleTicketClick(ticket)}
                        shortenedSummary={shortenSummary(ticket.ticketSummary)}
                      />
                    </Grid>
                  ))}
                </Grid>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                  </Typography>
                  <Pagination
                    count={Math.max(1, Math.ceil(total / pageSize))}
                    page={page}
                    onChange={(_e, p) => setPage(p)}
                    color="primary"
                    shape="rounded"
                  />
                </Box>
              </>
            ) : (
              // Kanban: bounded to one page; warn when more tickets exist than shown.
              <>
                {total > tickets.length && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Showing {tickets.length} of {total} tickets. Use search or filters to narrow the board.
                  </Alert>
                )}
                <KanbanBoard
                  tickets={tickets}
                  onStatusChange={(ticketId, newStatus) => handleStatusChange(ticketId, newStatus)}
                  onTicketClick={handleTicketClick}
                />
              </>
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
          value={filters}
          applyFilters={applyFilters}
        />

        {selectedTicket && (
          <TicketDialog
            ticket={selectedTicket}
            open={ticketDialogOpen}
            onClose={handleTicketDialogClose}
            notes={ticketNotes}
            currentUser={currentUser}
            onNotesChanged={async () => {
              if (selectedTicket?.localId != null) setTicketNotes(await fetchTicketNotes(selectedTicket.localId));
            }}
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
