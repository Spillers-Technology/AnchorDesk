// ./components/TicketDialog.tsx
import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogActions,
  Typography,
  IconButton,
  Button,
  Box,
  Chip,
  Stack,
  Grid,
  Card,
  CardContent,
  Select,
  MenuItem,
  TextField,
  Alert,
  Tooltip,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import ComputerIcon from "@mui/icons-material/Computer";
import TerminalIcon from "@mui/icons-material/Terminal";
import BusinessIcon from "@mui/icons-material/Business";
import PersonIcon from "@mui/icons-material/Person";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import SyncIcon from "@mui/icons-material/Sync";
import EmailIcon from "@mui/icons-material/Email";
import { Ticket, Note } from "../interfaces";
import EditableField from "./EditableField";
import NotesSection from "./NotesSection";
import RunScriptDialog from "./RunScriptDialog";
import * as api from "../api/client";

interface TicketDialogProps {
  ticket: Ticket;
  open: boolean;
  onClose: () => void;
  notes: Note[];
  currentUser: any;
}

const STATUSES = ["New", "Assigned", "In Progress", "Waiting", "Resolved", "Closed"];

function statusColor(s: string): "info" | "warning" | "success" | "default" | "error" {
  if (["Resolved", "Closed"].includes(s)) return "success";
  if (["In Progress", "Assigned"].includes(s)) return "warning";
  if (s === "Waiting") return "default";
  if (s === "Deleted") return "error";
  return "info";
}

const TicketDialog: React.FC<TicketDialogProps> = ({ ticket, open, onClose, notes, currentUser }) => {
  const [title, setTitle] = useState(ticket.ticketTitle);
  const [priority, setPriority] = useState(ticket.priority);
  const [companyName, setCompanyName] = useState(ticket.company.CompanyName);
  const [status, setStatus] = useState(ticket.status);
  const [sortAscending, setSortAscending] = useState(true);
  const [devices, setDevices] = useState<any[]>([]);
  const [scriptDevice, setScriptDevice] = useState<any | null>(null);
  const [full, setFull] = useState<Record<string, any> | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  // Load the cockpit: full ticket record, linked devices, script jobs, mail status.
  useEffect(() => {
    if (!open || ticket.localId == null) return;
    const id = ticket.localId;
    api.getTicket(id).then((t) => { setFull(t as any); setStatus((t as any).status ?? status); }).catch(() => setFull(null));
    api.listTicketDevices(id).then((d) => setDevices(d as any[])).catch(() => setDevices([]));
    api.listTicketScriptJobs(id).then((j) => setJobs(j as any[])).catch(() => setJobs([]));
    api.getMailStatus().then((m) => setMailConfigured(m.configured)).catch(() => setMailConfigured(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket.localId]);

  const persist = useCallback(async (data: Record<string, unknown>) => {
    if (ticket.localId == null) return;
    try { await api.updateTicket(ticket.localId, data); } catch (err) { console.error("Failed to save ticket edit:", err); }
  }, [ticket.localId]);

  const handleStatus = (s: string) => { setStatus(s); persist({ status: s }); };
  const canEditNote = (note: Note) => note.authorId === currentUser.id.toString();

  const source = String(full?.source ?? "local");
  const externalProvider = full?.externalProvider as string | undefined;
  const created = full?.createdAt ? new Date(full.createdAt).toLocaleString() : ticket.dateEntered;
  const description = full?.description ?? ticket.ticketSummary;
  const hasIntegrations = source !== "local" || devices.length > 0 || jobs.length > 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      {/* Header band */}
      <Box sx={{ background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 60%, #0ea5e9 100%)", color: "#fff", px: 3, py: 2 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Chip size="small" label={`#${ticket.ticketnumber}`} sx={{ bgcolor: "rgba(255,255,255,0.2)", color: "#fff", fontWeight: 700 }} />
              <Chip size="small" label={status} color={statusColor(status)} />
              {priority && <Chip size="small" variant="outlined" label={`P${priority}`} sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.5)" }} />}
              {source !== "local" && <Chip size="small" icon={<SyncIcon sx={{ color: "#fff !important" }} />} label={externalProvider ?? source} sx={{ bgcolor: "rgba(255,255,255,0.18)", color: "#fff" }} />}
            </Stack>
            <Typography variant="h5" noWrap sx={{ fontWeight: 700 }}>{title || "(untitled)"}</Typography>
            <Typography variant="body2" sx={{ opacity: 0.85 }}>{companyName || "No company"}</Typography>
          </Box>
          <IconButton onClick={onClose} sx={{ color: "#fff" }}><Close /></IconButton>
        </Stack>
      </Box>

      <DialogContent dividers sx={{ bgcolor: "background.default", p: { xs: 1.5, md: 3 } }}>
        <Grid container spacing={2}>
          {/* Main column */}
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Description</Typography>
                <EditableField label="" value={description} onSave={(v) => persist({ description: v })} />
              </CardContent>
            </Card>

            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Activity & notes</Typography>
                <NotesSection
                  notes={notes}
                  sortAscending={sortAscending}
                  toggleSort={() => setSortAscending((s) => !s)}
                  canEditNote={canEditNote}
                  currentUser={currentUser}
                />
              </CardContent>
            </Card>
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Details</Typography>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Status</Typography>
                    <Select fullWidth size="small" value={status} onChange={(e) => handleStatus(e.target.value)} sx={{ mt: 0.5 }}>
                      {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </Box>
                  <EditableField label="Title" value={title} onSave={(v) => { setTitle(v); persist({ title: v }); }} />
                  <EditableField label="Priority" value={priority} options={["1", "2", "3", "4", "5", "6"]} onSave={(v) => { setPriority(v); persist({ priority: v }); }} />
                  <EditableField label="Company" value={companyName} onSave={(v) => { setCompanyName(v); persist({ companyName: v }); }} />
                  <MetaRow icon={<PersonIcon fontSize="small" />} label="Assignee" value={ticket.assignee || "Unassigned"} />
                  <MetaRow icon={<BusinessIcon fontSize="small" />} label="Source" value={source} />
                  <MetaRow icon={<CalendarTodayIcon fontSize="small" />} label="Created" value={created} />
                </Stack>
              </CardContent>
            </Card>

            {/* Linked devices */}
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Devices {devices.length > 0 && `(${devices.length})`}
                </Typography>
                {devices.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No devices linked.</Typography>
                ) : (
                  <Stack spacing={1}>
                    {devices.map((d) => {
                      const canRun = !!d.externalId && d.source !== "local" && d.source !== "netviz";
                      return (
                        <Stack key={d.id} direction="row" alignItems="center" spacing={1}>
                          <ComputerIcon fontSize="small" color={d.status === "online" ? "success" : "disabled"} />
                          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                            <Typography variant="body2" noWrap>{d.displayName || d.hostname || d.ipAddress || "device"}</Typography>
                            {d.ipAddress && <Typography variant="caption" color="text.secondary">{d.ipAddress}</Typography>}
                          </Box>
                          {canRun && (
                            <Tooltip title="Run script">
                              <IconButton size="small" onClick={() => setScriptDevice(d)}><TerminalIcon fontSize="small" /></IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </CardContent>
            </Card>

            {/* Integration-aware panel */}
            {hasIntegrations && (
              <Card sx={{ mt: 2 }}>
                <CardContent>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>Integrations</Typography>
                  <Stack spacing={1}>
                    {source !== "local" && (
                      <MetaRow icon={<SyncIcon fontSize="small" />} label="Synced from" value={`${externalProvider ?? source}${full?.externalId ? ` · ${full.externalId}` : ""}`} />
                    )}
                    {jobs.length > 0 && <MetaRow icon={<TerminalIcon fontSize="small" />} label="Script jobs" value={`${jobs.length} run`} />}
                    {mailConfigured && (
                      <Button size="small" startIcon={<EmailIcon />} onClick={() => setEmailOpen(true)} sx={{ alignSelf: "flex-start" }}>
                        Send email
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions>
        {mailConfigured && !hasIntegrations && (
          <Button startIcon={<EmailIcon />} onClick={() => setEmailOpen(true)}>Email</Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {scriptDevice && (
        <RunScriptDialog
          open={!!scriptDevice}
          onClose={() => setScriptDevice(null)}
          deviceId={scriptDevice.id}
          deviceName={scriptDevice.displayName || scriptDevice.hostname || `device ${scriptDevice.id}`}
          ticketId={ticket.localId}
        />
      )}

      {emailOpen && ticket.localId != null && (
        <EmailDialog ticketId={ticket.localId} subject={`Re: ${title}`} onClose={() => setEmailOpen(false)} />
      )}
    </Dialog>
  );
};

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary" sx={{ width: 70 }}>{label}</Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{value}</Typography>
    </Stack>
  );
}

function EmailDialog({ ticketId, subject, onClose }: { ticketId: number; subject: string; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [subj, setSubj] = useState(subject);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    setMsg(null);
    try {
      await api.sendTicketEmail(ticketId, { to, subject: subj, text });
      setMsg({ ok: true, text: "Email sent and recorded on the ticket." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogContent>
        <Typography variant="h6" gutterBottom>Send email from ticket</Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          <TextField label="To" value={to} onChange={(e) => setTo(e.target.value)} />
          <TextField label="Subject" value={subj} onChange={(e) => setSubj(e.target.value)} />
          <TextField label="Message" value={text} onChange={(e) => setText(e.target.value)} multiline minRows={5} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!to || !subj || sending} onClick={send}>Send</Button>
      </DialogActions>
    </Dialog>
  );
}

export default TicketDialog;
