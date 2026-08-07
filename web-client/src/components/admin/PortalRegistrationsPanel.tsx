import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";

const STATUS_OPTIONS: Array<"" | api.PortalRegistration["status"]> = ["", "pending", "approved", "rejected"];

function statusColor(status: api.PortalRegistration["status"]): "warning" | "success" | "error" {
  return status === "pending" ? "warning" : status === "approved" ? "success" : "error";
}

export default function PortalRegistrationsPanel() {
  const [status, setStatus] = useState<"" | api.PortalRegistration["status"]>("pending");
  const [rows, setRows] = useState<api.PortalRegistration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<api.PortalRegistration | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setError(null);
    api.listPortalRegistrations(status || undefined).then(setRows).catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load portal registrations");
    });
  }, [status]);
  useEffect(reload, [reload]);

  const review = async (action: "approve" | "reject") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await (action === "approve"
        ? api.approvePortalRegistration(selected.id)
        : api.rejectPortalRegistration(selected.id));
      setSelected(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${action} registration`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5">Portal access requests</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Domain matches are only a review hint. Approving creates or reuses the contact, records a portal grant, and sends the sign-in email.
          </Typography>
        </Box>
        <TextField select size="small" label="Status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} sx={{ minWidth: 150 }}>
          {STATUS_OPTIONS.map((option) => <MenuItem key={option || "all"} value={option}>{option ? option[0].toUpperCase() + option.slice(1) : "All requests"}</MenuItem>)}
        </TextField>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {!rows ? <CircularProgress /> : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography>No {status || ""} portal access requests.</Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Email</TableCell><TableCell>Matched company</TableCell><TableCell>Requested</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.email}</TableCell>
                  <TableCell>{row.company?.name ?? "No domain match"}</TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                  <TableCell><Chip size="small" label={row.status} color={statusColor(row.status)} /></TableCell>
                  <TableCell align="right"><Button size="small" onClick={() => setSelected(row)}>Review</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {selected && <RegistrationDialog registration={selected} busy={busy} onClose={() => setSelected(null)} onReview={review} />}
    </Stack>
  );
}

export function RegistrationDialog({
  registration,
  busy,
  onClose,
  onReview,
}: {
  registration: api.PortalRegistration;
  busy: boolean;
  onClose: () => void;
  onReview: (action: "approve" | "reject") => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const pending = registration.status === "pending";
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>Portal access request</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography><strong>Email:</strong> {registration.email}</Typography>
          <Typography><strong>Matched company:</strong> {registration.company?.name ?? "No matching company"}</Typography>
          <Typography><strong>Requested:</strong> {new Date(registration.createdAt).toLocaleString()}</Typography>
          <Typography><strong>Status:</strong> {registration.status}</Typography>
          {registration.reviewedBy && <Typography><strong>Reviewed by:</strong> {registration.reviewedBy}</Typography>}
          {registration.contact && <Typography><strong>Contact:</strong> {registration.contact.name} (#{registration.contact.id})</Typography>}
          {pending && !registration.company && <Alert severity="warning">This address did not match an existing company domain. Approval can still reuse an exact existing contact; otherwise establish the company first.</Alert>}
          {pending && registration.company && <Alert severity="info">Approve only after confirming this requester should receive access to {registration.company.name}. Their domain match is not proof of identity.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>Close</Button>
        {pending && <>
          <Button color="error" disabled={busy} onClick={() => void onReview("reject")}>Reject</Button>
          <Button variant="contained" disabled={busy} onClick={() => void onReview("approve")}>Approve & send link</Button>
        </>}
      </DialogActions>
    </Dialog>
  );
}
