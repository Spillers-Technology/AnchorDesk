import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
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
import HowToRegOutlined from "@mui/icons-material/HowToRegOutlined";
import * as api from "../../api/client";
import { AdminPage, EmptyState, PanelLoading, StatusChip, When, type Tone } from "./kit";
import { useIsPhone } from "../../theme/useIsPhone";

const STATUS_OPTIONS: Array<"" | api.PortalRegistration["status"]> = ["", "pending", "approved", "rejected"];

function statusTone(status: api.PortalRegistration["status"]): Tone {
  return status === "pending" ? "warning" : status === "approved" ? "success" : "error";
}

const STATUS_LABEL: Record<api.PortalRegistration["status"], string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

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
    <AdminPage
      icon={HowToRegOutlined}
      title="Portal access requests"
      subtitle="Domain matches are only a review hint. Approving creates or reuses the contact, records a portal grant, and sends the sign-in email."
      status={status === "pending" && rows && rows.length > 0 ? <StatusChip tone="warning" label={`${rows.length} waiting`} /> : undefined}
      actions={
        <TextField select size="small" label="Status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} sx={{ minWidth: 150 }}>
          {STATUS_OPTIONS.map((option) => <MenuItem key={option || "all"} value={option}>{option ? option[0].toUpperCase() + option.slice(1) : "All requests"}</MenuItem>)}
        </TextField>
      }
    >

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {!rows ? <PanelLoading /> : rows.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState icon={HowToRegOutlined} title={`No ${status || ""} portal access requests`.replace("  ", " ")}>
            {status === "pending" ? "You're caught up. New requests from the portal's sign-up form land here for review." : "Try another status filter."}
          </EmptyState>
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
                  <TableCell><When iso={row.createdAt} /></TableCell>
                  <TableCell><StatusChip tone={statusTone(row.status)} label={STATUS_LABEL[row.status] ?? row.status} /></TableCell>
                  <TableCell align="right"><Button size="small" onClick={() => setSelected(row)}>Review</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {selected && <RegistrationDialog registration={selected} busy={busy} onClose={() => setSelected(null)} onReview={review} />}
    </AdminPage>
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
