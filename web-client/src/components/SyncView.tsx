import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Alert,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
} from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import * as api from "../api/client";
import { useAuth } from "../auth/AuthContext";
import IntegrationsRoadmap from "./IntegrationsRoadmap";

interface SyncLogEntry {
  id: string;
  externalId: string | null;
  direction: string;
  status: string;
  message: string | null;
  syncedAt: string;
  provider: { name: string; type: string };
}

interface SyncResult {
  providerName: string;
  ticketsCreated: number;
  ticketsUpdated: number;
  notesUpserted: number;
  errors: string[];
  durationMs: number;
}

interface Props {
  onTicketsChanged?: () => void;
}

export default function SyncView({ onTicketsChanged }: Props) {
  // Sync is one surface for everyone: techs can view activity and trigger runs;
  // only admins can add/remove/enable providers (the config half).
  const { isAdmin } = useAuth();
  const [providers, setProviders] = useState<api.SyncProvider[]>([]);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [lastResults, setLastResults] = useState<SyncResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"connectwise" | "jira">("connectwise");
  const [newBoard, setNewBoard] = useState("");
  const [creating, setCreating] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const data = await api.listSyncProviders();
      setProviders(data);
    } catch {
      setError("Could not load sync providers");
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const data = await api.getSyncLog({ limit: 50 });
      setSyncLog(data as SyncLogEntry[]);
    } catch {
      // Non-fatal — log might be empty
    }
  }, []);

  useEffect(() => {
    Promise.all([loadProviders(), loadLog()]).finally(() => setLoading(false));
  }, [loadProviders, loadLog]);

  const handleSync = async (providerName?: string) => {
    const key = providerName ?? "__all__";
    setSyncing((s) => ({ ...s, [key]: true }));
    setError(null);

    try {
      const result = await api.runSync(providerName);
      const results = Array.isArray(result) ? result : [result];
      setLastResults(results as SyncResult[]);
      await Promise.all([loadProviders(), loadLog()]);
      onTicketsChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing((s) => ({ ...s, [key]: false }));
    }
  };

  const handleToggleProvider = async (provider: api.SyncProvider) => {
    try {
      await api.toggleSyncProvider(provider.id, !provider.enabled);
      await loadProviders();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateProvider = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.createSyncProvider({
        name: newName.trim(),
        type: newType,
        // The optional field is the CW board name, or a Jira JQL override.
        config: newBoard.trim()
          ? newType === "jira"
            ? { jql: newBoard.trim() }
            : { board: newBoard.trim() }
          : {},
      });
      setNewName("");
      setNewBoard("");
      setCreateOpen(false);
      await loadProviders();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProvider = async (provider: api.SyncProvider) => {
    if (!window.confirm(`Delete sync provider "${provider.name}" and its activity log?`)) return;
    setError(null);
    try {
      await api.deleteSyncProvider(provider.id);
      await Promise.all([loadProviders(), loadLog()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const formatDate = (dateStr: string | null) =>
    dateStr ? new Date(dateStr).toLocaleString() : "Never";

  if (loading) return <CircularProgress sx={{ m: 4 }} />;

  return (
    <Box sx={{ p: 3, maxWidth: 1000 }}>
      <Typography variant="h5" gutterBottom sx={{
        fontWeight: 600
      }}>
        Sync Management
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 3
        }}>
        Sync tickets from external platforms into anchordesk's local database.
        The local database is always the source of truth.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {/* Last sync results */}
      {lastResults.length > 0 && (
        <Box sx={{ mb: 3 }}>
          {lastResults.map((r, i) => (
            <Alert
              key={i}
              severity={r.errors.length > 0 ? "warning" : "success"}
              sx={{ mb: 1 }}
            >
              <strong>{r.providerName}</strong> — {r.ticketsCreated} created,{" "}
              {r.ticketsUpdated} updated, {r.notesUpserted} notes · {r.durationMs}ms
              {r.errors.length > 0 && (
                <Box sx={{ mt: 0.5, fontSize: 12 }}>
                  {r.errors.slice(0, 3).map((e, j) => (
                    <div key={j}>{e}</div>
                  ))}
                  {r.errors.length > 3 && <div>…and {r.errors.length - 3} more errors</div>}
                </Box>
              )}
            </Alert>
          ))}
        </Box>
      )}
      {/* Providers */}
      <Paper variant="outlined" sx={{ mb: 3, overflowX: "auto" }}>
        <Box sx={{ p: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{
            fontWeight: 600
          }}>
            Configured Providers
          </Typography>
          <Stack direction="row" spacing={1}>
            {isAdmin && (
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
                Add provider
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={syncing["__all__"] ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              onClick={() => handleSync()}
              disabled={Object.values(syncing).some(Boolean) || providers.filter((p) => p.enabled).length === 0}
            >
              Sync All
            </Button>
          </Stack>
        </Box>
        <Divider />

        {providers.length === 0 ? (
          <Typography
            sx={{
              color: "text.secondary",
              p: 2
            }}>
            No sync providers configured. Add one here to get started.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Provider</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Last Synced</TableCell>
                <TableCell>Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>
                    <Chip label={p.type} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {formatDate(p.lastSyncedAt)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={p.enabled}
                      onChange={() => handleToggleProvider(p)}
                      disabled={!isAdmin}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={
                        syncing[p.name] ? (
                          <CircularProgress size={14} color="inherit" />
                        ) : (
                          <SyncIcon />
                        )
                      }
                      onClick={() => handleSync(p.name)}
                      disabled={!p.enabled || Object.values(syncing).some(Boolean)}
                    >
                      Sync Now
                    </Button>
                    {isAdmin && (
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => handleDeleteProvider(p)}
                        disabled={Object.values(syncing).some(Boolean)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      {/* Recent sync log */}
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Box sx={{ p: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{
            fontWeight: 600
          }}>
            Recent Sync Activity
          </Typography>
          <Button size="small" onClick={loadLog}>
            Refresh
          </Button>
        </Box>
        <Divider />

        {syncLog.length === 0 ? (
          <Typography
            sx={{
              color: "text.secondary",
              p: 2
            }}>
            No sync activity yet.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Provider</TableCell>
                <TableCell>External ID</TableCell>
                <TableCell>Direction</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Message</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {syncLog.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Typography variant="body2" noWrap sx={{
                      color: "text.secondary"
                    }}>
                      {new Date(entry.syncedAt).toLocaleTimeString()}
                    </Typography>
                  </TableCell>
                  <TableCell>{entry.provider.name}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                      {entry.externalId ?? "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={entry.direction}
                      size="small"
                      color={entry.direction === "inbound" ? "info" : "default"}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{
                      alignItems: "center"
                    }}>
                      {entry.status === "success" ? (
                        <CheckCircleIcon fontSize="small" color="success" />
                      ) : entry.status === "error" ? (
                        <ErrorIcon fontSize="small" color="error" />
                      ) : null}
                      <Typography variant="body2">{entry.status}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {entry.message ?? ""}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      <IntegrationsRoadmap />
      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add sync provider</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Provider name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="ConnectWise Support"
            />
            <TextField
              select
              label="Provider type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as "connectwise" | "jira")}
            >
              <MenuItem value="connectwise">ConnectWise Manage</MenuItem>
              <MenuItem value="jira">Jira Cloud</MenuItem>
            </TextField>
            <TextField
              label={newType === "jira" ? "JQL filter (optional)" : "Board name (optional)"}
              value={newBoard}
              onChange={(e) => setNewBoard(e.target.value)}
              helperText="Leave blank to use the adapter default. Credentials come from Admin → Integrations."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateProvider}
            disabled={creating || !newName.trim()}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
          >
            Add provider
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
