import { useEffect, useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloudUploadOutlined from "@mui/icons-material/CloudUploadOutlined";
import ArrowDropDown from "@mui/icons-material/ArrowDropDown";
import * as api from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SYNC_PROVIDER_LABELS } from "../syncBadges";

interface ScopeTicket {
  externalId?: string | null;
  externalProvider?: string | null;
  syncState?: string | null;
  syncScopePinned?: boolean;
  mergedIntoId?: number | null;
}

const PSA_PROVIDERS = ["jira", "connectwise"];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/**
 * A ticket's place in its sync job (docs/roadmap-sync-scope.md):
 *  - stopped syncing because it left the job's scope — why, and how to ask for
 *    it to keep syncing (anyone) or keep it syncing (admins);
 *  - kept syncing by a bypass — and a way for admins to remove it;
 *  - local only — send it to a PSA through a sync job.
 */
export default function SyncScopeBar({
  ticketId,
  ticket,
  canMutate,
  onChanged,
}: {
  ticketId: number;
  ticket: ScopeTicket | null;
  canMutate: boolean;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Only a PSA link counts: an email ticket's externalId is its Message-ID.
  const external = !!ticket?.externalId && PSA_PROVIDERS.includes(ticket?.externalProvider ?? "");
  const detached = ticket?.syncState === "detached";
  const pinned = !!ticket?.syncScopePinned;

  const [scope, setScope] = useState<api.TicketSyncScope | null>(null);
  const [destinations, setDestinations] = useState<api.SyncDestination[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<api.SendToPsaResult | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setError(null);
    if (external && (detached || pinned)) {
      api.getTicketSyncScope(ticketId).then(setScope).catch(() => setScope(null));
    } else setScope(null);
  }, [ticketId, external, detached, pinned, ticket?.syncState]);

  useEffect(() => {
    if (!external && canMutate && !ticket?.mergedIntoId) {
      api.listSyncDestinations().then(setDestinations).catch(() => setDestinations([]));
    }
  }, [external, canMutate, ticket?.mergedIntoId]);

  const provider = SYNC_PROVIDER_LABELS[ticket?.externalProvider ?? ""] ?? ticket?.externalProvider ?? "the PSA";
  const pending = scope?.requests.find((r) => r.status === "pending") ?? null;
  const lastDecided = scope?.requests.find((r) => r.status !== "pending") ?? null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      if (external) setScope(await api.getTicketSyncScope(ticketId).catch(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  // ─── Local ticket: send it to a PSA ────────────────────────────────────────
  if (!external) {
    if (sent) {
      return (
        <Alert severity={sent.warnings.length ? "warning" : "success"} sx={{ mb: 2 }} onClose={() => setSent(null)}>
          Created in {SYNC_PROVIDER_LABELS[sent.provider] ?? sent.provider} as <strong>{sent.externalId}</strong> through
          “{sent.jobName}”. It syncs from now on.
          {sent.warnings.length > 0 && <> Not carried over: {sent.warnings.join("; ")}.</>}
        </Alert>
      );
    }
    if (!canMutate || !destinations || destinations.length === 0) return null;
    const send = (d: api.SyncDestination) => {
      setMenu(null);
      void act(async () => setSent(await api.sendTicketToPsa(ticketId, d.jobId)));
    };
    return (
      <Box sx={{ mb: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" }, px: 1.5, py: 1, border: 1, borderColor: "divider", borderRadius: 2, borderStyle: "dashed" }}
        >
          <Typography variant="body2" sx={{ color: "text.secondary", flexGrow: 1 }}>
            Local only — this ticket isn't in a PSA.
          </Typography>
          <Button
            size="small"
            startIcon={busy ? <CircularProgress size={14} /> : <CloudUploadOutlined />}
            endIcon={destinations.length > 1 ? <ArrowDropDown /> : undefined}
            disabled={busy || destinations.every((d) => d.blocker)}
            onClick={(e) => (destinations.length > 1 ? setMenu(e.currentTarget) : send(destinations[0]))}
          >
            {destinations.length > 1 ? "Send to PSA" : `Send to ${destinations[0].target}`}
          </Button>
        </Stack>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
          {destinations.map((d) => (
            <MenuItem key={d.jobId} disabled={!!d.blocker} onClick={() => send(d)} sx={{ whiteSpace: "normal", maxWidth: 360 }}>
              <ListItemText primary={d.target} secondary={d.blocker ?? d.name} />
            </MenuItem>
          ))}
        </Menu>
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </Box>
    );
  }

  // ─── Kept syncing by a bypass ─────────────────────────────────────────────
  if (!detached) {
    if (!pinned) return null;
    return (
      <Alert
        severity="info"
        variant="outlined"
        sx={{ mb: 2 }}
        action={isAdmin && canMutate ? (
          <Button color="inherit" size="small" disabled={busy} onClick={() => void act(() => api.removeSyncBypass(ticketId))}>
            Remove bypass
          </Button>
        ) : undefined}
      >
        Sync bypass: this ticket keeps syncing with {provider} even outside
        {scope?.job ? ` job “${scope.job.name}”'s` : " its sync job's"} filter.
        {error && <Box sx={{ color: "error.main", mt: 0.5 }}>{error}</Box>}
      </Alert>
    );
  }

  // ─── Stopped syncing: left its job's scope ─────────────────────────────────
  return (
    <>
      <Alert
        severity="warning"
        sx={{ mb: 2 }}
        action={canMutate && !pending ? (
          <Button color="inherit" size="small" disabled={busy} onClick={() => setAsking(true)}>
            {isAdmin ? "Keep syncing" : "Request bypass"}
          </Button>
        ) : undefined}
      >
        <AlertTitle>Sync with {provider} stopped</AlertTitle>
        This ticket left the scope of {scope?.job ? <>sync job <strong>{scope.job.name}</strong></> : "its sync job"}
        {scope?.detachReason ? <>: {scope.detachReason}</> : null}.
        {scope?.detachedAt ? <> Stopped {when(scope.detachedAt)}.</> : null}{" "}
        The local copy is kept, but changes no longer travel either way. It resumes on its own if it comes back into scope.
        {pending && (
          <Box sx={{ mt: 1 }}>
            <strong>{pending.requestedBy}</strong> asked to keep it syncing: “{pending.reason}” — waiting for an admin.
            {isAdmin && canMutate && (
              <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                <Button size="small" variant="contained" color="warning" disabled={busy} onClick={() => void act(() => api.decideSyncBypass(pending.id, "approve"))}>
                  Approve
                </Button>
                <Button size="small" color="inherit" disabled={busy} onClick={() => void act(() => api.decideSyncBypass(pending.id, "reject"))}>
                  Reject
                </Button>
              </Stack>
            )}
          </Box>
        )}
        {!pending && lastDecided?.status === "rejected" && (
          <Box sx={{ mt: 1 }}>
            {lastDecided.reviewedBy} rejected a bypass {when(lastDecided.reviewedAt)}
            {lastDecided.reviewNote ? <>: “{lastDecided.reviewNote}”</> : "."}
          </Box>
        )}
        {error && <Box sx={{ color: "error.main", mt: 0.5 }}>{error}</Box>}
      </Alert>
      <BypassDialog
        open={asking}
        isAdmin={isAdmin}
        busy={busy}
        onClose={() => setAsking(false)}
        onSubmit={(reason) => {
          setAsking(false);
          void act(() => api.requestSyncBypass(ticketId, reason));
        }}
      />
    </>
  );
}

function BypassDialog({ open, isAdmin, busy, onClose, onSubmit }: { open: boolean; isAdmin: boolean; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isAdmin ? "Keep this ticket syncing?" : "Request a sync bypass"}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
          {isAdmin
            ? "It will keep syncing even outside its job's filter, until an admin removes the bypass. Your reason is recorded on the ticket."
            : "An admin decides. If approved, it keeps syncing even outside its job's filter. You'll get a notification either way."}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label="Why should it keep syncing?"
          placeholder="Still Joe's escalation — the reassignment was temporary."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())}>
          {isAdmin ? "Keep syncing" : "Send request"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
