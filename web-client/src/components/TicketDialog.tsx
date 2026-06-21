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
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  Checkbox,
  FormControlLabel,
  CircularProgress,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import EditIcon from "@mui/icons-material/Edit";
import ComputerIcon from "@mui/icons-material/Computer";
import TerminalIcon from "@mui/icons-material/Terminal";
import BusinessIcon from "@mui/icons-material/Business";
import PersonIcon from "@mui/icons-material/Person";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import SyncIcon from "@mui/icons-material/Sync";
import EmailIcon from "@mui/icons-material/Email";
import DownloadIcon from "@mui/icons-material/Download";
import { Ticket, Note } from "../interfaces";
import EditableField from "./EditableField";
import NotesSection from "./NotesSection";
import RichTextEditor from "./RichTextEditor";
import RunScriptDialog from "./RunScriptDialog";
import SlaChip from "./SlaChip";
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
  /** Called after the ticket's notes/timeline change (email sent, time logged). */
  onNotesChanged?: () => void;
}

/** Prefill payload for the email composer (set when replying to a message). */
interface ComposePrefill {
  to?: string;
  subject?: string;
}

const TicketDialog: React.FC<TicketDialogProps> = ({ ticket, open, onClose, notes, currentUser, onUpdated, onNotesChanged }) => {
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
  const [compose, setCompose] = useState<ComposePrefill | null>(null);
  const [assignees, setAssignees] = useState<api.Assignee[]>([]);
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [allDevices, setAllDevices] = useState<any[]>([]);
  const [addDevice, setAddDevice] = useState<any | null>(null);
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [company, setCompany] = useState<api.Company | null>(null);
  const [contacts, setContacts] = useState<api.Contact[]>([]);
  const [contactId, setContactId] = useState<number | "">("");
  const [newContact, setNewContact] = useState("");
  const [timeMinutes, setTimeMinutes] = useState(0);
  const [timeEntries, setTimeEntries] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<api.Attachment[]>([]);
  const [allLabels, setAllLabels] = useState<api.Label[]>([]);

  const reloadAttachments = useCallback(() => {
    if (ticket.localId == null) return;
    api.listAttachments(ticket.localId).then(setAttachments).catch(() => setAttachments([]));
  }, [ticket.localId]);

  const reloadFull = useCallback(() => {
    if (ticket.localId == null) return;
    api.getTicket(ticket.localId).then((t) => setFull(t as any)).catch(() => {});
  }, [ticket.localId]);

  const addLabel = async (labelId: number) => {
    if (ticket.localId == null) return;
    await api.tagTicket(ticket.localId, labelId).then(reloadFull).catch(() => {});
  };
  const removeLabel = async (labelId: number) => {
    if (ticket.localId == null) return;
    await api.untagTicket(ticket.localId, labelId).then(reloadFull).catch(() => {});
  };

  const reloadDevices = useCallback(() => {
    if (ticket.localId == null) return;
    api.listTicketDevices(ticket.localId).then((d) => setDevices(d as any[])).catch(() => setDevices([]));
  }, [ticket.localId]);

  const reloadTime = useCallback(() => {
    if (ticket.localId == null) return;
    api.getTicketTime(ticket.localId).then((t) => setTimeMinutes(t.minutes)).catch(() => {});
    api.listNotes(ticket.localId).then((ns) => setTimeEntries((ns as any[]).filter((n) => n.noteType === "time_entry"))).catch(() => {});
  }, [ticket.localId]);

  const deleteTimeEntry = (noteId: number) => {
    if (ticket.localId == null) return;
    api.deleteNote(ticket.localId, noteId).then(() => { reloadTime(); onUpdated?.("time"); }).catch(() => {});
  };
  const editTimeEntry = (noteId: number, minutes: number, content: string) => {
    if (ticket.localId == null) return;
    api.updateNote(ticket.localId, noteId, { minutes, content }).then(() => { reloadTime(); onUpdated?.("time"); }).catch(() => {});
  };

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
    reloadAttachments();
    api.listLabels().then(setAllLabels).catch(() => setAllLabels([]));
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

  const addContactInline = async () => {
    if (!company || !newContact.trim()) return;
    const c = await api.createContact(company.id, { name: newContact.trim() }).catch(() => null);
    setNewContact("");
    if (c) {
      const full = await api.getCompany(company.id).catch(() => null);
      setContacts(full?.contacts ?? [...contacts, c]);
      pickContact(c.id);
    }
  };

  const logTime = (minutes: number, note?: string) => {
    if (ticket.localId == null || minutes <= 0) return;
    api.logTicketTime(ticket.localId, minutes, note).then(() => { reloadTime(); onUpdated?.("time"); }).catch(() => {});
  };
  const logTimeRange = (start: string, stop: string, note?: string) => {
    if (ticket.localId == null) return;
    api.logTicketTimeRange(ticket.localId, start, stop, note).then(() => { reloadTime(); onUpdated?.("time"); }).catch(() => {});
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

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const persist = useCallback(async (data: Record<string, unknown>) => {
    if (ticket.localId == null) return;
    setSaveState("saving");
    try {
      await api.updateTicket(ticket.localId, data);
      onUpdated?.(Object.keys(data)[0]);
      setSaveState("saved");
      // Fade the "Saved" confirmation back to idle so edits stay unobtrusive.
      setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (err) {
      console.error("Failed to save ticket edit:", err);
      setSaveState("error");
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
              <Chip size="small" variant="outlined" label={priority || "Medium"} sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.5)" }} />
              {source !== "local" && <Chip size="small" icon={<SyncIcon sx={{ color: "#fff !important" }} />} label={externalProvider ?? source} sx={{ bgcolor: "rgba(255,255,255,0.18)", color: "#fff" }} />}
              <SlaChip
                responseDueAt={full?.responseDueAt}
                resolutionDueAt={full?.resolutionDueAt}
                firstRespondedAt={full?.firstRespondedAt}
                status={status}
              />
            </Stack>
            <Typography variant="h5" noWrap sx={{ fontWeight: 700 }}>{title || "(untitled)"}</Typography>
            <Typography variant="body2" sx={{ opacity: 0.85 }}>{companyName || "No company"}</Typography>
            {(full?.labels ?? []).length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                {(full?.labels ?? []).map((tl: any) => (
                  <Chip key={tl.label.id} size="small" label={tl.label.name}
                    sx={{ bgcolor: tl.label.color, color: "#fff", height: 20 }} />
                ))}
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <SaveStatus state={saveState} />
            {ticket.localId != null && (
              <Tooltip title="Download ticket (printable)">
                <IconButton sx={{ color: "#fff" }} onClick={() => window.open(api.ticketExportUrl(ticket.localId!), "_blank")}>
                  <DownloadIcon />
                </IconButton>
              </Tooltip>
            )}
            <IconButton onClick={onClose} sx={{ color: "#fff" }}><Close /></IconButton>
          </Stack>
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
                  onReply={mailConfigured ? (n) => setCompose({
                    to: n.emailFrom,
                    subject: /^re:/i.test(n.subject ?? "") ? n.subject : `Re: ${n.subject ?? title}`,
                  }) : undefined}
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
                  <Box>
                    <Typography variant="caption" color="text.secondary">Priority</Typography>
                    <Select fullWidth size="small" value={priority || "Medium"} sx={{ mt: 0.5 }}
                      onChange={(e) => { setPriority(e.target.value); persist({ priority: e.target.value }); }}>
                      {TICKET_PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                    </Select>
                  </Box>
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
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <TextField size="small" placeholder="New contact name" value={newContact}
                          onChange={(e) => setNewContact(e.target.value)} sx={{ flexGrow: 1 }}
                          onKeyDown={(e) => e.key === "Enter" && addContactInline()} />
                        <Button size="small" variant="outlined" disabled={!newContact.trim()} onClick={addContactInline}>Add</Button>
                      </Stack>
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
                  <Box>
                    <Typography variant="caption" color="text.secondary">Labels</Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5, mb: 1 }}>
                      {(full?.labels ?? []).map((tl: any) => (
                        <Chip key={tl.label.id} size="small" label={tl.label.name}
                          sx={{ bgcolor: tl.label.color, color: "#fff" }}
                          onDelete={() => removeLabel(tl.label.id)} />
                      ))}
                      {(full?.labels ?? []).length === 0 && <Typography variant="caption" color="text.secondary">None</Typography>}
                    </Stack>
                    <Select size="small" fullWidth displayEmpty value=""
                      onChange={(e) => e.target.value !== "" && addLabel(Number(e.target.value))}>
                      <MenuItem value="" disabled>Add label…</MenuItem>
                      {allLabels
                        .filter((l) => !(full?.labels ?? []).some((tl: any) => tl.label.id === l.id))
                        .map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                    </Select>
                  </Box>
                  <MetaRow icon={<BusinessIcon fontSize="small" />} label="Source" value={source} />
                  <MetaRow icon={<CalendarTodayIcon fontSize="small" />} label="Created" value={created} />
                </Stack>
              </CardContent>
            </Card>

            {/* Time tracking */}
            <TimeCard minutes={timeMinutes} entries={timeEntries} onLog={logTime} onLogRange={logTimeRange} onDelete={deleteTimeEntry} onEdit={editTimeEntry} />

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
                          <Chip size="small" variant="outlined" label={sourceLabel(d.source)} color={sourceColor(d.source)} />
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
                    renderOption={(props, d) => (
                      <Box component="li" {...props} key={d.id} sx={{ display: "flex", gap: 1 }}>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap>{d.displayName || d.hostname || d.ipAddress || "device"}</Typography>
                          {d.ipAddress && <Typography variant="caption" color="text.secondary">{d.ipAddress}</Typography>}
                        </Box>
                        <Chip size="small" variant="outlined" label={sourceLabel(d.source)} color={sourceColor(d.source)} />
                      </Box>
                    )}
                    renderInput={(params) => <TextField {...params} label="Link a device" />}
                  />
                  <Button size="small" variant="outlined" disabled={!addDevice} onClick={linkDevice}>Link</Button>
                </Stack>
              </CardContent>
            </Card>

            {/* Attachments */}
            {ticket.localId != null && (
              <AttachmentsCard ticketId={ticket.localId} attachments={attachments} onChange={reloadAttachments} />
            )}

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
                      <Button size="small" startIcon={<EmailIcon />} onClick={() => setCompose({})} sx={{ alignSelf: "flex-start" }}>
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
          <Button startIcon={<EmailIcon />} onClick={() => setCompose({})}>Email</Button>
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

      {compose && ticket.localId != null && (
        <EmailDialog
          ticketId={ticket.localId}
          to={compose.to ?? ""}
          subject={compose.subject ?? `Re: ${title}`}
          contacts={contacts}
          onClose={() => setCompose(null)}
          onSent={() => { onNotesChanged?.(); reloadAttachments(); }}
        />
      )}
    </Dialog>
  );
};

function sourceLabel(s?: string): string {
  switch (s) {
    case "tactical_rmm": return "Tactical";
    case "netviz": return "NetViz";
    case "meshcentral": return "Mesh";
    case "api": return "API";
    default: return "Manual";
  }
}
function sourceColor(s?: string): "primary" | "secondary" | "default" {
  if (s === "tactical_rmm") return "primary";
  if (s === "netviz") return "secondary";
  return "default";
}

function fmtMinutes(m: number): string {
  if (m <= 0) return "0m";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h${min ? ` ${min}m` : ""}` : `${min}m`;
}

interface TimeCardProps {
  minutes: number;
  entries: any[];
  onLog: (m: number, note?: string) => void;
  onLogRange: (start: string, stop: string, note?: string) => void;
  onDelete: (noteId: number) => void;
  onEdit: (noteId: number, minutes: number, content: string) => void;
}

/** datetime-local value for "now", rounded to the minute, in local time. */
function nowLocalInput(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  d.setSeconds(0, 0);
  const tzAdjusted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tzAdjusted.toISOString().slice(0, 16);
}

function TimeCard({ minutes, entries, onLog, onLogRange, onDelete, onEdit }: TimeCardProps) {
  const [mode, setMode] = useState<"duration" | "range">("duration");
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [start, setStart] = useState(nowLocalInput(-30));
  const [stop, setStop] = useState(nowLocalInput());
  const [editing, setEditing] = useState<number | null>(null);
  const [editMin, setEditMin] = useState("");
  const presets = [15, 30, 60, 120];

  const startEdit = (e: any) => { setEditing(e.id); setEditMin(String(e.minutes ?? "")); };
  const commitEdit = (e: any) => { const m = Number(editMin); if (m > 0) onEdit(e.id, m, e.content); setEditing(null); };

  // Live preview of the start/stop window so the duration is obvious before logging.
  const rangeMinutes = (() => {
    const a = new Date(start).getTime();
    const b = new Date(stop).getTime();
    return a && b && b > a ? Math.round((b - a) / 60000) : 0;
  })();

  const logRange = () => {
    if (rangeMinutes <= 0) return;
    onLogRange(new Date(start).toISOString(), new Date(stop).toISOString(), note);
    setNote("");
  };

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">Time logged</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{fmtMinutes(minutes)}</Typography>
        </Stack>

        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={mode}
          onChange={(_e, v) => v && setMode(v)}
          sx={{ mb: 1.5 }}
        >
          <ToggleButton value="duration">Duration</ToggleButton>
          <ToggleButton value="range">Start / Stop</ToggleButton>
        </ToggleButtonGroup>

        {mode === "duration" ? (
          <>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mb: 1 }}>
              {presets.map((p) => (
                <Button key={p} size="small" variant="outlined" onClick={() => onLog(p)}>+{fmtMinutes(p)}</Button>
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mb: entries.length ? 1.5 : 0 }}>
              <TextField size="small" label="min" type="number" value={custom} onChange={(e) => setCustom(e.target.value)} sx={{ width: 84 }} />
              <TextField size="small" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ flexGrow: 1 }} />
              <Button variant="contained" disabled={!Number(custom)} onClick={() => { onLog(Number(custom), note); setCustom(""); setNote(""); }}>Log</Button>
            </Stack>
          </>
        ) : (
          <Stack spacing={1} sx={{ mb: entries.length ? 1.5 : 0 }}>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="Start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ flexGrow: 1 }} />
              <TextField size="small" label="Stop" type="datetime-local" value={stop} onChange={(e) => setStop(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ flexGrow: 1 }} />
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" onClick={() => setStop(nowLocalInput())}>Stop = now</Button>
              <Chip size="small" color={rangeMinutes > 0 ? "primary" : "default"}
                label={rangeMinutes > 0 ? fmtMinutes(rangeMinutes) : "—"} />
              <Box sx={{ flexGrow: 1 }} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ flexGrow: 1 }} />
              <Button variant="contained" disabled={rangeMinutes <= 0} onClick={logRange}>Log</Button>
            </Stack>
          </Stack>
        )}
        {entries.length > 0 && <Divider sx={{ mb: 1 }} />}
        <Stack spacing={0.5}>
          {entries.map((e) => (
            <Stack key={e.id} direction="row" alignItems="center" spacing={1}>
              {editing === e.id ? (
                <>
                  <TextField size="small" type="number" value={editMin} onChange={(ev) => setEditMin(ev.target.value)} sx={{ width: 80 }} autoFocus
                    onKeyDown={(ev) => ev.key === "Enter" && commitEdit(e)} />
                  <Button size="small" onClick={() => commitEdit(e)}>Save</Button>
                </>
              ) : (
                <>
                  <Chip size="small" label={fmtMinutes(e.minutes ?? 0)} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" noWrap title={e.content}>
                      {e.author} · {new Date(e.createdAt).toLocaleDateString()}{e.content && ` · ${e.content}`}
                    </Typography>
                  </Box>
                  <IconButton size="small" onClick={() => startEdit(e)}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => onDelete(e.id)}><Close fontSize="small" /></IconButton>
                </>
              )}
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentsCard({
  ticketId,
  attachments,
  onChange,
}: {
  ticketId: number;
  attachments: api.Attachment[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    try {
      await api.uploadAttachments(ticketId, list);
      onChange();
    } catch (err) {
      console.error("upload failed", err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try { await api.deleteAttachment(id); onChange(); }
    catch (err) { console.error("delete attachment failed", err); }
  };

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Attachments {attachments.length > 0 && `(${attachments.length})`}
        </Typography>
        <Stack spacing={1} sx={{ mb: 1.5 }}>
          {attachments.map((a) => (
            <Stack key={a.id} direction="row" alignItems="center" spacing={1}>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" noWrap component="a"
                  href={api.attachmentDownloadUrl(a.id)} target="_blank" rel="noopener"
                  sx={{ color: "primary.main", textDecoration: "none" }}>
                  {a.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary">{fmtBytes(a.size)}</Typography>
              </Box>
              <Tooltip title="Delete attachment">
                <IconButton size="small" onClick={() => remove(a.id)}><Close fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
        <Box
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          sx={{
            border: "1px dashed",
            borderColor: dragOver ? "primary.main" : "divider",
            borderRadius: 1,
            p: 1.5,
            textAlign: "center",
            cursor: "pointer",
            bgcolor: dragOver ? "action.hover" : "transparent",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {busy ? "Uploading…" : "Drop files here or click to upload"}
          </Typography>
          <input ref={inputRef} type="file" multiple hidden
            onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
        </Box>
      </CardContent>
    </Card>
  );
}

/** Unobtrusive save-state indicator for the ticket header: shows while a field
 *  edit is in flight, confirms briefly, or flags a failure. */
function SaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  const common = { color: "#fff", display: "flex", alignItems: "center", gap: 0.5, fontSize: 13 } as const;
  if (state === "saving") return <Box sx={common}><CircularProgress size={14} sx={{ color: "#fff" }} /> Saving…</Box>;
  if (state === "saved") return <Box sx={common}><CheckCircleIcon sx={{ fontSize: 16 }} /> Saved</Box>;
  return <Box sx={{ ...common, color: "#ffd5d5" }}><ErrorOutlineIcon sx={{ fontSize: 16 }} /> Save failed</Box>;
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

/** Multi-recipient field: contact emails autocomplete + free-typed addresses. */
function RecipientField({ label, value, onChange, options }: {
  label: string; value: string[]; onChange: (v: string[]) => void; options: string[];
}) {
  return (
    <Autocomplete
      multiple freeSolo size="small" options={options} value={value}
      onChange={(_e, v) => onChange(v as string[])}
      renderInput={(params) => <TextField {...params} label={label} placeholder="name@example.com" />}
    />
  );
}

function EmailDialog({
  ticketId,
  to: initialTo,
  subject,
  contacts,
  onClose,
  onSent,
}: {
  ticketId: number;
  to: string;
  subject: string;
  contacts: api.Contact[];
  onClose: () => void;
  onSent?: () => void;
}) {
  const [to, setTo] = useState<string[]>(initialTo ? [initialTo] : []);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subj, setSubj] = useState(subject);
  const [html, setHtml] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [identities, setIdentities] = useState<api.MailIdentity[]>([]);
  const [fromId, setFromId] = useState<number | "">("");
  const [templates, setTemplates] = useState<api.MailTemplate[]>([]);
  const [hasSignature, setHasSignature] = useState(false);
  const [includeSig, setIncludeSig] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const contactEmails = contacts.map((c) => c.email).filter(Boolean) as string[];

  useEffect(() => {
    api.listMyMailIdentities().then((ids) => { setIdentities(ids); if (ids[0]) setFromId(ids[0].id); }).catch(() => {});
    api.listMailTemplates().then(setTemplates).catch(() => {});
    api.getMySignature().then((s) => setHasSignature(!!s.signatureHtml)).catch(() => {});
  }, []);

  // TipTap reports an empty doc as "<p></p>" — treat that as no body.
  const isEmpty = (h: string) => h.replace(/<p>\s*<\/p>/g, "").replace(/<[^>]+>/g, "").trim() === "";

  const insertTemplate = (t: api.MailTemplate) => {
    if (t.subject) setSubj(t.subject);
    setHtml((prev) => (prev && !isEmpty(prev) ? prev + t.bodyHtml : t.bodyHtml));
  };

  const send = async () => {
    setSending(true);
    setMsg(null);
    try {
      let attachmentIds: number[] | undefined;
      if (files.length) {
        const uploaded = await api.uploadAttachments(ticketId, files);
        attachmentIds = uploaded.map((a) => a.id);
      }
      await api.sendTicketEmail(ticketId, {
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: subj,
        html,
        attachmentIds,
        fromIdentityId: fromId === "" ? undefined : fromId,
        includeSignature: hasSignature && includeSig,
      });
      setMsg({ ok: true, text: "Email sent and recorded on the ticket." });
      onSent?.();
      setTimeout(onClose, 600);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogContent>
        <Typography variant="h6" gutterBottom>Send email from ticket</Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}

          {identities.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">From</Typography>
              <Select fullWidth size="small" value={fromId} onChange={(e) => setFromId(e.target.value === "" ? "" : Number(e.target.value))}>
                {identities.map((i) => (
                  <MenuItem key={i.id} value={i.id}>
                    {i.displayName ? `${i.displayName} <${i.address}>` : i.address}{i.shared ? " · shared" : ""}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          )}

          <RecipientField label="To" value={to} onChange={setTo} options={contactEmails} />
          {showCcBcc ? (
            <>
              <RecipientField label="Cc" value={cc} onChange={setCc} options={contactEmails} />
              <RecipientField label="Bcc" value={bcc} onChange={setBcc} options={contactEmails} />
            </>
          ) : (
            <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setShowCcBcc(true)}>Add Cc / Bcc</Button>
          )}

          <Stack direction="row" spacing={1} alignItems="center">
            <TextField label="Subject" value={subj} onChange={(e) => setSubj(e.target.value)} fullWidth size="small" />
            {templates.length > 0 && (
              <Select size="small" displayEmpty value="" sx={{ minWidth: 140 }}
                onChange={(e) => { const t = templates.find((x) => x.id === Number(e.target.value)); if (t) insertTemplate(t); }}>
                <MenuItem value="" disabled>Insert template</MenuItem>
                {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </Select>
            )}
          </Stack>

          <RichTextEditor value={html} onChange={setHtml} />

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Button component="label" size="small" variant="outlined">
              Attach files
              <input type="file" multiple hidden
                onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])} />
            </Button>
            {files.map((f, i) => (
              <Chip key={i} size="small" label={f.name} onDelete={() => setFiles((prev) => prev.filter((_, j) => j !== i))} />
            ))}
            <Box sx={{ flexGrow: 1 }} />
            {hasSignature && (
              <FormControlLabel
                control={<Checkbox size="small" checked={includeSig} onChange={(e) => setIncludeSig(e.target.checked)} />}
                label="Signature"
              />
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={to.length === 0 || !subj.trim() || isEmpty(html) || sending} onClick={send}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TicketDialog;
