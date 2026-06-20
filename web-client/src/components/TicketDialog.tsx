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
  Autocomplete,
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
import { TICKET_STATUSES, TICKET_PRIORITIES, statusColor } from "../ticketVocab";

interface TicketDialogProps {
  ticket: Ticket;
  open: boolean;
  onClose: () => void;
  notes: Note[];
  currentUser: any;
  /** Called after a successful edit so the parent list reflects the change. */
  onUpdated?: (field?: string) => void;
}

const TicketDialog: React.FC<TicketDialogProps> = ({ ticket, open, onClose, notes, currentUser, onUpdated }) => {
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
  const [assignees, setAssignees] = useState<api.Assignee[]>([]);
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [allDevices, setAllDevices] = useState<any[]>([]);
  const [addDevice, setAddDevice] = useState<any | null>(null);
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [company, setCompany] = useState<api.Company | null>(null);
  const [contacts, setContacts] = useState<api.Contact[]>([]);
  const [contactId, setContactId] = useState<number | "">("");
  const [timeMinutes, setTimeMinutes] = useState(0);

  const reloadDevices = useCallback(() => {
    if (ticket.localId == null) return;
    api.listTicketDevices(ticket.localId).then((d) => setDevices(d as any[])).catch(() => setDevices([]));
  }, [ticket.localId]);

  const reloadTime = useCallback(() => {
    if (ticket.localId == null) return;
    api.getTicketTime(ticket.localId).then((t) => setTimeMinutes(t.minutes)).catch(() => {});
  }, [ticket.localId]);

  // Load the cockpit: full ticket record, linked devices, script jobs, mail,
  // assignable users, and the device pool for linking.
  useEffect(() => {
    if (!open || ticket.localId == null) return;
    const id = ticket.localId;
    api.getTicket(id).then((t) => {
      const tt = t as any;
      setFull(tt);
      setStatus(tt.status ?? status);
      setAssigneeId((tt.assigneeId as number) ?? "");
      setCompany(tt.company ?? null);
      setContactId((tt.contactId as number) ?? "");
      if (tt.companyId) api.getCompany(tt.companyId).then((c) => setContacts(c.contacts ?? [])).catch(() => setContacts([]));
    }).catch(() => setFull(null));
    reloadDevices();
    reloadTime();
    api.listTicketScriptJobs(id).then((j) => setJobs(j as any[])).catch(() => setJobs([]));
    api.getMailStatus().then((m) => setMailConfigured(m.configured)).catch(() => setMailConfigured(false));
    api.listAssignees().then(setAssignees).catch(() => setAssignees([]));
    api.listDevices({ pageSize: 500 }).then((d) => setAllDevices(d as any[])).catch(() => setAllDevices([]));
    api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket.localId]);

  // Select (or create) a company on the ticket, then load its contacts.
  const pickCompany = async (value: api.Company | string | null) => {
    let c: api.Company | null = null;
    if (typeof value === "string") {
      const name = value.trim();
      if (!name) return;
      c = companies.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? (await api.createCompany({ name }).catch(() => null));
      if (c && !companies.some((x) => x.id === c!.id)) setCompanies((prev) => [...prev, c!].sort((a, b) => a.name.localeCompare(b.name)));
    } else {
      c = value;
    }
    setCompany(c);
    setContactId("");
    setCompanyName(c?.name ?? "");
    persist({ companyId: c?.id ?? null, contactId: null });
    if (c) api.getCompany(c.id).then((full) => setContacts(full.contacts ?? [])).catch(() => setContacts([]));
    else setContacts([]);
  };

  const pickContact = (id: number | "") => {
    setContactId(id);
    persist({ contactId: id === "" ? null : id });
  };

  const logTime = (minutes: number, note?: string) => {
    if (ticket.localId == null || minutes <= 0) return;
    api.logTicketTime(ticket.localId, minutes, note).then(() => { reloadTime(); onUpdated?.("time"); }).catch(() => {});
  };

  const saveAssignee = (id: number | "") => {
    setAssigneeId(id);
    const u = assignees.find((a) => a.id === id);
    persist({ assigneeId: id === "" ? null : id, assignee: u ? (u.displayName || u.username) : null });
  };

  const linkDevice = async () => {
    if (ticket.localId == null || !addDevice) return;
    try { await api.linkDevice(ticket.localId, addDevice.id); setAddDevice(null); reloadDevices(); }
    catch (err) { console.error("link device failed", err); }
  };
  const unlinkDevice = async (deviceId: number) => {
    if (ticket.localId == null) return;
    try { await api.unlinkDevice(ticket.localId, deviceId); reloadDevices(); }
    catch (err) { console.error("unlink device failed", err); }
  };

  const persist = useCallback(async (data: Record<string, unknown>) => {
    if (ticket.localId == null) return;
    try {
      await api.updateTicket(ticket.localId, data);
      onUpdated?.(Object.keys(data)[0]);
    } catch (err) {
      console.error("Failed to save ticket edit:", err);
    }
  }, [ticket.localId, onUpdated]);

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
                      {TICKET_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </Box>
                  <EditableField label="Title" value={title} onSave={(v) => { setTitle(v); persist({ title: v }); }} />
                  <EditableField label="Priority" value={priority} options={[...TICKET_PRIORITIES]} onSave={(v) => { setPriority(v); persist({ priority: v }); }} />
                  <Autocomplete
                    size="small"
                    freeSolo
                    options={companies}
                    getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
                    value={company}
                    onChange={(_e, v) => pickCompany(v)}
                    renderInput={(params) => <TextField {...params} label="Company" placeholder="Search or type to add…" />}
                  />
                  {company && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Contact</Typography>
                      <Select fullWidth size="small" value={contactId} displayEmpty sx={{ mt: 0.5 }}
                        onChange={(e) => pickContact(e.target.value === "" ? "" : Number(e.target.value))}>
                        <MenuItem value="">None</MenuItem>
                        {contacts.map((c) => (
                          <MenuItem key={c.id} value={c.id}>{c.name}{c.title ? ` · ${c.title}` : ""}</MenuItem>
                        ))}
                      </Select>
                    </Box>
                  )}
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ color: "text.secondary", display: "flex" }}><PersonIcon fontSize="small" /></Box>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 70 }}>Assignee</Typography>
                    <Select size="small" value={assigneeId} displayEmpty sx={{ flexGrow: 1 }}
                      onChange={(e) => saveAssignee(e.target.value === "" ? "" : Number(e.target.value))}>
                      <MenuItem value="">Unassigned</MenuItem>
                      {assignees.map((a) => (
                        <MenuItem key={a.id} value={a.id}>{a.displayName || a.username} · {a.role}</MenuItem>
                      ))}
                    </Select>
                  </Stack>
                  <MetaRow icon={<BusinessIcon fontSize="small" />} label="Source" value={source} />
                  <MetaRow icon={<CalendarTodayIcon fontSize="small" />} label="Created" value={created} />
                </Stack>
              </CardContent>
            </Card>

            {/* Time tracking */}
            <TimeCard minutes={timeMinutes} onLog={logTime} />

            {/* Linked devices */}
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Devices {devices.length > 0 && `(${devices.length})`}
                </Typography>
                {devices.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>No devices linked.</Typography>
                ) : (
                  <Stack spacing={1} sx={{ mb: 1.5 }}>
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
                          <Tooltip title="Unlink device">
                            <IconButton size="small" onClick={() => unlinkDevice(d.id)}><Close fontSize="small" /></IconButton>
                          </Tooltip>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
                {/* Link an existing device to this ticket */}
                <Stack direction="row" spacing={1} alignItems="center">
                  <Autocomplete
                    size="small"
                    sx={{ flexGrow: 1 }}
                    options={allDevices.filter((d) => !devices.some((ld) => ld.id === d.id))}
                    getOptionLabel={(d) => `${d.displayName || d.hostname || d.ipAddress || "device"}${d.ipAddress ? ` · ${d.ipAddress}` : ""}`}
                    value={addDevice}
                    onChange={(_e, v) => setAddDevice(v)}
                    renderInput={(params) => <TextField {...params} label="Link a device" />}
                  />
                  <Button size="small" variant="outlined" disabled={!addDevice} onClick={linkDevice}>Link</Button>
                </Stack>
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

function fmtMinutes(m: number): string {
  if (m <= 0) return "0m";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h${min ? ` ${min}m` : ""}` : `${min}m`;
}

function TimeCard({ minutes, onLog }: { minutes: number; onLog: (m: number, note?: string) => void }) {
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const presets = [15, 30, 60, 120];
  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">Time logged</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{fmtMinutes(minutes)}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mb: 1 }}>
          {presets.map((p) => (
            <Button key={p} size="small" variant="outlined" onClick={() => onLog(p)}>+{fmtMinutes(p)}</Button>
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField size="small" label="min" type="number" value={custom} onChange={(e) => setCustom(e.target.value)} sx={{ width: 84 }} />
          <TextField size="small" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ flexGrow: 1 }} />
          <Button variant="contained" disabled={!Number(custom)} onClick={() => { onLog(Number(custom), note); setCustom(""); setNote(""); }}>Log</Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

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
