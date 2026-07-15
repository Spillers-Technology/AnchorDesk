import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  MenuItem,
  LinearProgress,
  Checkbox,
  FormControlLabel,
} from "@mui/material";
import DashboardAppBar from "./components/DashboardAppBar";
import DashboardDrawer from "./components/DashboardDrawer";
import TicketCard from "./components/TicketCard";
import FilterDialog from "./components/FilterDialog";
import SyncView from "./components/SyncView";
import AdminView from "./components/AdminView";
import NetworkView from "./components/NetworkView";
import CompaniesView from "./components/CompaniesView";
import MyDayView from "./components/MyDayView";
import TicketDialog from "./components/TicketDialog";
import TicketTable from "./components/TicketTable";
import KanbanBoard from "./components/KanbanBoard";
import CreateTicketDialog from "./components/CreateTicketDialog";
import { Ticket, Company, Note } from "./interfaces";
import * as api from "./api/client";
import { subscribeRealtime } from "./api/realtime";
import { useAuth } from "./auth/AuthContext";
import LoginView from "./auth/LoginView";
import { htmlToPreviewText } from "./html";
import AddIcon from "@mui/icons-material/Add";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import TableRowsIcon from "@mui/icons-material/TableRows";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import ClearIcon from "@mui/icons-material/Clear";
import EditNoteIcon from "@mui/icons-material/EditNote";
import BookmarkAddIcon from "@mui/icons-material/BookmarkAdd";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import SaveIcon from "@mui/icons-material/Save";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "./ticketVocab";
import { PrioritySignal, StatusSignal } from "./components/TicketSignals";
import { useIsPhone } from "./theme/useIsPhone";

// Map local-DB ticket record to the component-facing Ticket interface.
// The component interface uses CW-era field names; this adapter lets us keep
// all existing components unchanged while the data layer migrates.
function mapDbTicket(t: Record<string, unknown>): Ticket & { localId: number } {
  const summarySource = String(t.summary ?? t.description ?? "");
  return {
    localId: t.id as number,
    ticketnumber: String(t.ticketNumber ?? t.id),
    ticketTitle: String(t.title ?? ""),
    ticketSummary: htmlToPreviewText(summarySource) || summarySource,
    status: String(t.status ?? "New"),
    priority: String(t.priority ?? ""),
    assignee: String(t.assignee ?? ""),
    teamId: t.teamId == null ? null : Number(t.teamId),
    team: (t.team as Ticket["team"]) ?? null,
    customFields: (t.customFields as Record<string, unknown>) ?? {},
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
    source: String(t.source ?? "local"),
    externalProvider: t.externalProvider ? String(t.externalProvider) : undefined,
    externalId: t.externalId ? String(t.externalId) : undefined,
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
  labelId?: number;
  teamId?: number;
  /** POSIX regex matched server-side across ticket text. */
  regex?: string;
  /** Surface closed tickets too (default off keeps the board to live work). */
  includeClosed?: boolean;
}

interface BulkTicketUpdate {
  status?: string;
  priority?: string;
  assigneeId?: number | null;
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
  const [viewMode, setViewMode] = useState<"cards" | "table" | "kanban" | "sync" | "admin" | "network" | "companies" | "myday">("kanban");
  const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [networkCompany, setNetworkCompany] = useState<string | undefined>(undefined);
  const [bulkSelectionMode, setBulkSelectionMode] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<number>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [assignees, setAssignees] = useState<api.Assignee[]>([]);
  const [savedViews, setSavedViews] = useState<api.SavedView[]>([]);
  const [savedViewId, setSavedViewId] = useState<number | "">("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [kanbanColumns, setKanbanColumns] = useState<string[] | null>(null);
  const [kanbanColumnsOpen, setKanbanColumnsOpen] = useState(false);
  // Legacy DataGrid table view is opt-in via an admin setting; off by default.
  const [legacyTableView, setLegacyTableView] = useState(false);

  const pageSize = PAGE_SIZE[viewMode] ?? 50;

  const { user, loading: authLoading, isAdmin, canWrite, setUser } = useAuth();
  const currentUser = {
    id: user?.id ?? 0,
    name: user?.displayName ?? user?.username ?? "User",
    role: user?.role,
    canWrite,
  };

  // MCP OAuth consent bounce: /oauth/authorize redirects an unauthenticated user
  // here with ?oauth_return=<the authorize request>. Captured once at mount (so a
  // later history.replaceState can't drop it) and only honored for same-origin
  // /oauth/ paths, so it can't be abused as an open redirect. Once the user is
  // authenticated we send the browser back to finish the authorization.
  const [oauthReturn] = useState(() => {
    const rt = new URLSearchParams(window.location.search).get("oauth_return");
    return rt && rt.startsWith("/oauth/") ? rt : null;
  });
  useEffect(() => {
    if (user && oauthReturn) window.location.replace(oauthReturn);
  }, [user, oauthReturn]);

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
        labelId: filters.labelId || undefined,
        teamId: filters.teamId || undefined,
        regex: filters.regex || undefined,
        includeClosed: filters.includeClosed || undefined,
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

  // Close from the board: the card has already played its fall-off animation, so
  // drop it from the page (and total) immediately, then persist. Closed tickets
  // are hidden by default, so a successful close simply leaves it gone.
  const handleCloseTicket = async (ticketId: number) => {
    setTickets((prev) => prev.filter((t) => t.localId !== ticketId));
    setTotal((n) => Math.max(0, n - 1));
    try {
      await api.updateTicket(ticketId, { status: "Closed" });
      setToast({ message: "Ticket closed", severity: "success" });
    } catch (err) {
      setToast({ message: `Failed to close ticket: ${(err as Error).message}`, severity: "error" });
      fetchTickets(); // restore the card if the write failed
    }
  };

  const applyFilters = (criteria: TicketFilterCriteria) => {
    setFilters(criteria);
    setPage(1);
    setFilterDialogOpen(false);
  };

  const reloadSavedViews = useCallback(() => {
    api.listSavedViews().then(setSavedViews).catch(() => setSavedViews([]));
  }, []);

  const applySavedView = (id: number | "") => {
    setSavedViewId(id);
    if (id === "") return;
    const selected = savedViews.find((view) => view.id === id);
    if (!selected) return;
    const { q, ...criteria } = selected.filters;
    setFilters(criteria);
    setSearchTerm(q ?? "");
    setPage(1);
  };

  const saveCurrentView = async (name: string, shared: boolean) => {
    const created = await api.createSavedView({
      name,
      shared,
      filters: { ...filters, q: searchTerm.trim() || undefined },
    });
    setSaveViewOpen(false);
    reloadSavedViews();
    setSavedViewId(created.id);
  };

  const removeSavedView = async () => {
    if (savedViewId === "") return;
    try {
      await api.deleteSavedView(savedViewId);
      setSavedViewId("");
      reloadSavedViews();
    } catch (err) {
      setToast({ message: `Could not delete view: ${(err as Error).message}`, severity: "error" });
    }
  };

  const updateCurrentSavedView = async () => {
    if (savedViewId === "") return;
    try {
      await api.updateSavedView(savedViewId, { filters: { ...filters, q: searchTerm.trim() || undefined } });
      reloadSavedViews();
      setToast({ message: "Saved view updated", severity: "success" });
    } catch (err) {
      setToast({ message: `Could not update view: ${(err as Error).message}`, severity: "error" });
    }
  };

  const saveKanbanColumns = async (columns: string[] | null) => {
    try {
      const result = await api.setMyKanbanColumns(columns);
      setKanbanColumns(result.kanbanColumns);
      if (user) setUser({ ...user, kanbanColumns: result.kanbanColumns });
      setKanbanColumnsOpen(false);
      setToast({ message: "Board columns saved", severity: "success" });
    } catch (err) {
      setToast({ message: `Could not save board columns: ${(err as Error).message}`, severity: "error" });
    }
  };

  const shortenSummary = (summary: string) =>
    summary.length > 100 ? `${summary.slice(0, 100)}...` : summary;

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const visibleTicketIds = tickets.map((t) => t.localId);
  const selectedIdsArray = Array.from(selectedTicketIds);
  const selectedTicketCount = selectedIdsArray.length;
  const selectionEnabled = canWrite && bulkSelectionMode;

  const toggleTicketSelection = (ticketId: number) => {
    setSelectedTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const selectVisibleTickets = () => {
    setBulkSelectionMode(true);
    setSelectedTicketIds(new Set(visibleTicketIds));
  };

  const clearBulkSelection = () => {
    setSelectedTicketIds(new Set());
    setBulkSelectionMode(false);
    setBulkDialogOpen(false);
  };

  const applyBulkUpdate = async (update: BulkTicketUpdate) => {
    const ids = selectedIdsArray.filter((id) => visibleTicketIds.includes(id));
    if (!ids.length) return;

    const payload: Record<string, unknown> = {};
    if (update.status) payload.status = update.status;
    if (update.priority) payload.priority = update.priority;
    if (update.assigneeId !== undefined) {
      payload.assigneeId = update.assigneeId;
      const assignee = assignees.find((a) => a.id === update.assigneeId);
      payload.assignee = assignee ? assignee.displayName || assignee.username : null;
    }
    if (!Object.keys(payload).length) return;

    setBulkBusy(true);
    setTickets((prev) =>
      prev.map((ticket) =>
        ids.includes(ticket.localId)
          ? {
              ...ticket,
              status: typeof payload.status === "string" ? payload.status : ticket.status,
              priority: typeof payload.priority === "string" ? payload.priority : ticket.priority,
              assignee:
                update.assigneeId !== undefined
                  ? typeof payload.assignee === "string"
                    ? payload.assignee
                    : ""
                  : ticket.assignee,
            }
          : ticket
      )
    );

    const results = await Promise.allSettled(ids.map((id) => api.updateTicket(id, payload)));
    const failures = results.filter((result) => result.status === "rejected");
    setBulkBusy(false);
    setBulkDialogOpen(false);

    if (failures.length) {
      setToast({ message: `${ids.length - failures.length} updated, ${failures.length} failed.`, severity: "error" });
      fetchTickets();
      return;
    }

    setToast({ message: `${ids.length} tickets updated`, severity: "success" });
    clearBulkSelection();
    fetchTickets();
  };

  useEffect(() => {
    if (user) fetchTickets();
  }, [fetchTickets, user]);

  useEffect(() => {
    const visible = new Set(visibleTicketIds);
    setSelectedTicketIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  useEffect(() => {
    if (!user || !canWrite) return;
    api.listAssignees().then(setAssignees).catch(() => setAssignees([]));
  }, [user, canWrite]);

  useEffect(() => {
    if (!user) return;
    reloadSavedViews();
    setKanbanColumns(Array.isArray(user.kanbanColumns) ? user.kanbanColumns : null);
  }, [user, reloadSavedViews]);

  // Load interface prefs once signed in (gates the legacy table view).
  useEffect(() => {
    if (!user) return;
    api.getUiSettings().then((s) => setLegacyTableView(s.legacyTableView)).catch(() => {});
  }, [user]);

  // If the legacy table is disabled while it's the active view, fall back.
  useEffect(() => {
    if (!legacyTableView && viewMode === "table") setViewMode("kanban");
  }, [legacyTableView, viewMode]);

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
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <LoginView
        onAuthenticated={(u) => {
          setUser(u);
          // Drop any ?authError=... left by an SSO redirect.
          window.history.replaceState({}, "", window.location.pathname);
        }}
      />
    );
  }

  return (
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
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
          legacyTableView={legacyTableView}
        />

        {/* minWidth: 0 lets wide children (Kanban's fixed columns) scroll inside
            main instead of stretching the page past the viewport on phones. */}
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, minHeight: "100vh", p: { xs: 1.5, sm: 2, md: 3 }, backgroundColor: "background.default" }}>
          <Toolbar />

          {["cards", "table", "kanban"].includes(viewMode) && (
            <Paper variant="outlined" sx={{ p: 1, mb: 2, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={viewMode}
                onChange={(_e, v) => v && setViewMode(v)}
              >
                <ToggleButton value="kanban"><Tooltip title="Board"><ViewKanbanIcon fontSize="small" /></Tooltip></ToggleButton>
                <ToggleButton value="cards"><Tooltip title="Cards"><ViewModuleIcon fontSize="small" /></Tooltip></ToggleButton>
                {legacyTableView && (
                  <ToggleButton value="table"><Tooltip title="Table (legacy)"><TableRowsIcon fontSize="small" /></Tooltip></ToggleButton>
                )}
              </ToggleButtonGroup>

              <TextField
                size="small"
                placeholder="Search tickets…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                sx={{ flexGrow: 1, minWidth: { xs: 140, sm: 200 }, maxWidth: 420 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment>
                  ),
                }}
              />

              <Tooltip title="Advanced search">
                <IconButton onClick={() => setFilterDialogOpen(true)}>
                  <Badge badgeContent={activeFilterCount} color="primary">
                    <FilterListIcon />
                  </Badge>
                </IconButton>
              </Tooltip>

              <TextField
                select
                size="small"
                label="Saved view"
                value={savedViewId}
                onChange={(event) => applySavedView(event.target.value === "" ? "" : Number(event.target.value))}
                sx={{ minWidth: { xs: 145, sm: 180 } }}
              >
                <MenuItem value="">Current filters</MenuItem>
                {savedViews.map((view) => (
                  <MenuItem key={view.id} value={view.id}>
                    {view.shared ? "Shared · " : ""}{view.name}
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip title="Save current search and filters">
                <IconButton aria-label="Save current view" onClick={() => setSaveViewOpen(true)}><BookmarkAddIcon /></IconButton>
              </Tooltip>
              {savedViewId !== "" && (
                <>
                  <Tooltip title="Update selected view with current filters">
                    <IconButton aria-label="Update saved view" onClick={() => void updateCurrentSavedView()}><SaveIcon /></IconButton>
                  </Tooltip>
                  <Tooltip title="Delete selected view">
                    <IconButton aria-label="Delete saved view" onClick={removeSavedView}><DeleteOutlineIcon /></IconButton>
                  </Tooltip>
                </>
              )}
              {viewMode === "kanban" && (
                <Tooltip title="Choose board columns">
                  <IconButton aria-label="Choose board columns" onClick={() => setKanbanColumnsOpen(true)}><ViewColumnIcon /></IconButton>
                </Tooltip>
              )}

              <Box sx={{ flexGrow: 1 }} />

              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
                sx={{ minWidth: { xs: 0, sm: 64 }, px: { xs: 1.25, sm: 2 }, "& .MuiButton-startIcon": { mr: { xs: 0, sm: 1 } } }}
              >
                <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>New ticket</Box>
              </Button>
            </Paper>
          )}

          {viewMode === "admin" ? (
            <AdminView />
          ) : viewMode === "myday" ? (
            <MyDayView onOpenTicket={openTicketById} />
          ) : viewMode === "network" ? (
            <NetworkView initialCompany={networkCompany} />
          ) : viewMode === "companies" ? (
            <CompaniesView
              onOpenTicket={openTicketById}
              onViewNetwork={(name) => { setNetworkCompany(name); setViewMode("network"); }}
            />
          ) : viewMode === "sync" ? (
            <SyncView onTicketsChanged={fetchTickets} />
          ) : (
            <>
          {error && <Typography color="error">Error: {error.message}</Typography>}
          {canWrite && tickets.length > 0 && ["cards", "table", "kanban"].includes(viewMode) && (
            <BulkSelectionBar
              selectionMode={bulkSelectionMode}
              selectedCount={selectedTicketCount}
              visibleCount={visibleTicketIds.length}
              busy={bulkBusy}
              onStartSelection={() => setBulkSelectionMode(true)}
              onSelectVisible={selectVisibleTickets}
              onClear={clearBulkSelection}
              onOpenUpdate={() => setBulkDialogOpen(true)}
            />
          )}

          {/* Only blank to a spinner on the first load (nothing to show yet).
              Background refetches — live WebSocket updates, an optimistic close —
              keep the current board on screen and swap data in place, so the view
              never flashes out from under the user. */}
          {loading && tickets.length === 0 ? (
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
              selectionEnabled={selectionEnabled}
              selectedIds={selectedIdsArray}
              onSelectionChange={(ids) => setSelectedTicketIds(new Set(ids))}
            />
          ) : tickets.length > 0 ? (
            viewMode === "cards" ? (
              <>
                <Grid container spacing={{ xs: 2, md: 3 }} sx={{ mt: 0 }}>
                  {tickets.map((ticket) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={ticket.localId}>
                      <TicketCard
                        ticket={ticket}
                        onClick={() => handleTicketClick(ticket)}
                        shortenedSummary={shortenSummary(ticket.ticketSummary)}
                        selectionEnabled={selectionEnabled}
                        selected={selectedTicketIds.has(ticket.localId)}
                        onToggleSelected={() => toggleTicketSelection(ticket.localId)}
                      />
                    </Grid>
                  ))}
                </Grid>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 3, flexWrap: "wrap", gap: 1 }}>
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
                  columns={kanbanColumns ?? undefined}
                  onStatusChange={(ticketId, newStatus) => handleStatusChange(ticketId, newStatus)}
                  onTicketClick={handleTicketClick}
                  onTicketClose={handleCloseTicket}
                  selectionEnabled={selectionEnabled}
                  selectedIds={selectedTicketIds}
                  onToggleTicketSelected={toggleTicketSelection}
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

        <SaveViewDialog
          open={saveViewOpen}
          allowShared={isAdmin}
          onClose={() => setSaveViewOpen(false)}
          onSave={saveCurrentView}
        />

        <KanbanColumnsDialog
          open={kanbanColumnsOpen}
          value={kanbanColumns}
          onClose={() => setKanbanColumnsOpen(false)}
          onSave={saveKanbanColumns}
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

        <BulkUpdateDialog
          open={bulkDialogOpen}
          count={selectedTicketCount}
          busy={bulkBusy}
          assignees={assignees}
          onClose={() => setBulkDialogOpen(false)}
          onApply={applyBulkUpdate}
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
  );
}

function BulkSelectionBar({
  selectionMode,
  selectedCount,
  visibleCount,
  busy,
  onStartSelection,
  onSelectVisible,
  onClear,
  onOpenUpdate,
}: {
  selectionMode: boolean;
  selectedCount: number;
  visibleCount: number;
  busy: boolean;
  onStartSelection: () => void;
  onSelectVisible: () => void;
  onClear: () => void;
  onOpenUpdate: () => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, mb: 2, position: "relative", overflow: "hidden" }}>
      {busy && <LinearProgress sx={{ position: "absolute", top: 0, left: 0, right: 0 }} />}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle2">Bulk update</Typography>
          <Typography variant="caption" color="text.secondary">
            {selectionMode ? `${selectedCount} selected on this page` : `${visibleCount} visible tickets`}
          </Typography>
        </Box>
        {!selectionMode ? (
          <Button size="small" variant="outlined" startIcon={<SelectAllIcon />} onClick={onStartSelection}>
            Select tickets
          </Button>
        ) : (
          <>
            <Button size="small" startIcon={<SelectAllIcon />} disabled={busy || selectedCount === visibleCount} onClick={onSelectVisible}>
              Select visible
            </Button>
            <Button size="small" startIcon={<ClearIcon />} disabled={busy} onClick={onClear}>
              Clear
            </Button>
            <Button size="small" variant="contained" startIcon={<EditNoteIcon />} disabled={busy || selectedCount === 0} onClick={onOpenUpdate}>
              Update fields
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function BulkUpdateDialog({
  open,
  count,
  busy,
  assignees,
  onClose,
  onApply,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  assignees: api.Assignee[];
  onClose: () => void;
  onApply: (update: BulkTicketUpdate) => void;
}) {
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");

  useEffect(() => {
    if (!open) {
      setStatus("");
      setPriority("");
      setAssignee("");
    }
  }, [open]);

  const hasChanges = !!status || !!priority || !!assignee;

  const apply = () => {
    const update: BulkTicketUpdate = {};
    if (status) update.status = status;
    if (priority) update.priority = priority;
    if (assignee === "unassigned") update.assigneeId = null;
    else if (assignee.startsWith("user:")) update.assigneeId = Number(assignee.slice(5));
    onApply(update);
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Update {count} tickets</DialogTitle>
      <DialogContent dividers>
        {busy && <LinearProgress sx={{ mb: 2 }} />}
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField select label="Status" value={status} onChange={(event) => setStatus(event.target.value)} fullWidth disabled={busy}>
            <MenuItem value="">Leave unchanged</MenuItem>
            {TICKET_STATUSES.map((s) => (
              <MenuItem key={s} value={s}><StatusSignal status={s} /></MenuItem>
            ))}
          </TextField>
          <TextField select label="Priority" value={priority} onChange={(event) => setPriority(event.target.value)} fullWidth disabled={busy}>
            <MenuItem value="">Leave unchanged</MenuItem>
            {TICKET_PRIORITIES.map((p) => (
              <MenuItem key={p} value={p}><PrioritySignal priority={p} /></MenuItem>
            ))}
          </TextField>
          <TextField select label="Assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)} fullWidth disabled={busy}>
            <MenuItem value="">Leave unchanged</MenuItem>
            <MenuItem value="unassigned">Unassigned</MenuItem>
            {assignees.map((a) => (
              <MenuItem key={a.id} value={`user:${a.id}`}>
                {a.displayName || a.username} · {a.role}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" startIcon={<EditNoteIcon />} onClick={apply} disabled={busy || !hasChanges || count === 0}>
          {busy ? "Updating" : "Apply"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SaveViewDialog({
  open,
  allowShared,
  onClose,
  onSave,
}: {
  open: boolean;
  allowShared: boolean;
  onClose: () => void;
  onSave: (name: string, shared: boolean) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setShared(false);
    setError(null);
  }, [open]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), allowShared && shared);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs" fullScreen={isPhone}>
      <DialogTitle>Save view</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="View name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
            autoFocus
            fullWidth
          />
          {allowShared && (
            <FormControlLabel
              control={<Checkbox checked={shared} onChange={(event) => setShared(event.target.checked)} />}
              label="Share with everyone"
            />
          )}
          <Typography variant="body2" color="text.secondary">
            Saves the current search, team, label, status, company, assignee, and closed-ticket filters.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save view"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function KanbanColumnsDialog({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: string[] | null;
  onClose: () => void;
  onSave: (columns: string[] | null) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const defaultColumns = TICKET_STATUSES.filter((status) => status !== "Closed");
  const [draft, setDraft] = useState<string[]>(defaultColumns);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(value?.filter((status) => (TICKET_STATUSES as readonly string[]).includes(status)) ?? defaultColumns);
    // `defaultColumns` is derived from a module constant and is intentionally stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  const move = (status: string, offset: -1 | 1) => {
    setDraft((current) => {
      const index = current.indexOf(status);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async (columns: string[] | null) => {
    setSaving(true);
    try { await onSave(columns); } finally { setSaving(false); }
  };

  const rows = [...draft, ...TICKET_STATUSES.filter((status) => !draft.includes(status))];

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs" fullScreen={isPhone}>
      <DialogTitle>Board columns</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Choose visible statuses and arrange their left-to-right order.
        </Typography>
        <Stack spacing={0.5}>
          {rows.map((status) => {
            const index = draft.indexOf(status);
            const selected = index >= 0;
            return (
              <Paper key={status} variant="outlined" sx={{ px: 1, py: 0.5, display: "flex", alignItems: "center", gap: 0.5 }}>
                <FormControlLabel
                  sx={{ flexGrow: 1, m: 0 }}
                  control={
                    <Checkbox
                      checked={selected}
                      onChange={(event) => setDraft((current) =>
                        event.target.checked ? [...current, status] : current.filter((entry) => entry !== status)
                      )}
                    />
                  }
                  label={<StatusSignal status={status} />}
                />
                {selected && (
                  <>
                    <IconButton aria-label={`Move ${status} left`} size="small" disabled={index === 0} onClick={() => move(status, -1)}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label={`Move ${status} right`} size="small" disabled={index === draft.length - 1} onClick={() => move(status, 1)}>
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </Paper>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap" }}>
        <Button color="inherit" onClick={() => void save(null)} disabled={saving}>Use default</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => void save(draft)} disabled={saving || draft.length === 0}>
          Save columns
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default App;
