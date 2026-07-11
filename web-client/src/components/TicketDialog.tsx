// ./components/TicketDialog.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { Close, Save as SaveIcon, Undo as UndoIcon } from "@mui/icons-material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import EditIcon from "@mui/icons-material/Edit";
import ComputerIcon from "@mui/icons-material/Computer";
import TerminalIcon from "@mui/icons-material/Terminal";
import BusinessIcon from "@mui/icons-material/Business";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import SyncIcon from "@mui/icons-material/Sync";
import EmailIcon from "@mui/icons-material/Email";
import DownloadIcon from "@mui/icons-material/Download";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import { Ticket, Note } from "../interfaces";
import NotesSection from "./NotesSection";
import RichTextEditor from "./RichTextEditor";
import HtmlContent from "./HtmlContent";
import RunScriptDialog from "./RunScriptDialog";
import SlaChip from "./SlaChip";
import SyncBadges from "./SyncBadges";
import { SYNC_PROVIDER_LABELS } from "../syncBadges";
import * as api from "../api/client";
import { TICKET_STATUSES, TICKET_PRIORITIES } from "../ticketVocab";
import { PrioritySignal, StatusSignal } from "./TicketSignals";
import { htmlToPlainText, isRichTextEmpty, toEditorHtml } from "../html";

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
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [company, setCompany] = useState<api.Company | null>(null);
  const [contacts, setContacts] = useState<api.Contact[]>([]);
  const [contactId, setContactId] = useState<number | "">("");
  const [timeMinutes, setTimeMinutes] = useState(0);
  const [timeEntries, setTimeEntries] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<api.Attachment[]>([]);
  const [allLabels, setAllLabels] = useState<api.Label[]>([]);
  const [liveDevices, setLiveDevices] = useState<
    Record<number, { loading: boolean; data?: api.RmmLiveData; error?: string }>
  >({});

  const reloadAttachments = useCallback(() => {
    if (ticket.localId == null) return;
    api.listAttachments(ticket.localId).then(setAttachments).catch(() => setAttachments([]));
  }, [ticket.localId]);

  const reloadFull = useCallback(() => {
    if (ticket.localId == null) return;
    api.getTicket(ticket.localId).then((t) => setFull(t as any)).catch(() => {});
  }, [ticket.localId]);

  // Two-way sync: reconcile now, or resolve a held conflict by picking a side.
  const [syncing, setSyncing] = useState(false);
  const doSyncNow = async () => {
    if (ticket.localId == null) return;
    setSyncing(true);
    try {
      await api.syncTicket(ticket.localId);
      reloadFull();
      onNotesChanged?.();
      onUpdated?.("sync");
    } catch (e) {
      /* surfaced via the badge on next reload */
    } finally {
      setSyncing(false);
    }
  };
  const doResolveConflict = async (resolution: "local" | "remote") => {
    if (ticket.localId == null) return;
    setSyncing(true);
    try {
      await api.resolveTicketConflict(ticket.localId, resolution);
      reloadFull();
      onNotesChanged?.();
      onUpdated?.("sync");
    } catch (e) {
      /* surfaced via the badge on next reload */
    } finally {
      setSyncing(false);
    }
  };

  const addLabel = async (labelId: number) => {
    if (ticket.localId == null) return;
    await api.tagTicket(ticket.localId, labelId).then(reloadFull).catch(() => {});
  };
  const removeLabel = async (labelId: number) => {
    if (ticket.localId == null) return;
    await api.untagTicket(ticket.localId, labelId).then(reloadFull).catch(() => {});
  };

  const loadDeviceLive = useCallback(async (deviceId: number) => {
    setLiveDevices((prev) => ({ ...prev, [deviceId]: { loading: true } }));
    try {
      const data = await api.getDeviceLive(deviceId);
      setLiveDevices((prev) => ({ ...prev, [deviceId]: { loading: false, data } }));
    } catch (err) {
      setLiveDevices((prev) => ({
        ...prev,
        [deviceId]: { loading: false, error: (err as Error).message },
      }));
    }
  }, []);

  const reloadDevices = useCallback(() => {
    if (ticket.localId == null) return;
    api.listTicketDevices(ticket.localId).then((d) => {
      const next = d as any[];
      setDevices(next);
      const tacticalDevices = next.filter((device) => device.source === "tactical_rmm" && device.externalId);
      setLiveDevices({});
      tacticalDevices.forEach((device) => loadDeviceLive(device.id));
    }).catch(() => {
      setDevices([]);
      setLiveDevices({});
    });
  }, [ticket.localId, loadDeviceLive]);

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

  const selectedContact = contacts.find((c) => c.id === contactId) ?? null;
  const defaultRecipient = selectedContact?.email
    ?? contacts.find((contact) => contact.isPrimary && contact.email)?.email
    ?? contacts.find((contact) => contact.email)?.email
    ?? "";

  // Unified pick-or-create for the contact field, mirroring pickCompany: a chosen
  // Contact links it, a free-typed name matches an existing contact (case-
  // insensitive) or creates one on the company, and null clears the selection.
  const pickContactValue = async (value: api.Contact | string | null) => {
    if (value == null) {
      pickContact("");
      return;
    }
    if (typeof value !== "string") {
      pickContact(value.id);
      return;
    }
    const name = value.trim();
    if (!name || !company) return;
    const existing = contacts.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      pickContact(existing.id);
      return;
    }
    const c = await api.createContact(company.id, { name }).catch(() => null);
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

  // Devices available to link. When the ticket has a company, scope the picker to
  // that company's hardware so another company's devices can't be mis-associated.
  // Unassigned devices (no company) stay visible — they're ambiguous, not wrong —
  // and "Show all companies" is an escape hatch so the user is never boxed in.
  const ticketCompanyId = (full?.companyId as number | null | undefined) ?? null;
  const linkableDevices = useMemo(() => {
    const unlinked = allDevices.filter((d) => !devices.some((ld) => ld.id === d.id));
    if (showAllDevices || ticketCompanyId == null) return unlinked;
    return unlinked.filter((d) => d.companyId == null || d.companyId === ticketCompanyId);
  }, [allDevices, devices, showAllDevices, ticketCompanyId]);
  const hiddenByCompany =
    ticketCompanyId != null && !showAllDevices
      ? allDevices.filter(
          (d) => !devices.some((ld) => ld.id === d.id) && d.companyId != null && d.companyId !== ticketCompanyId
        ).length
      : 0;

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const persist = useCallback(async (data: Record<string, unknown>): Promise<boolean> => {
    if (ticket.localId == null) return false;
    setSaveState("saving");
    try {
      const updated = await api.updateTicket(ticket.localId, data);
      const returned = updated && typeof updated === "object" ? (updated as Record<string, unknown>) : data;
      setFull((prev) => (prev ? { ...prev, ...returned } : prev));
      onUpdated?.(Object.keys(data)[0]);
      setSaveState("saved");
      // Fade the "Saved" confirmation back to idle so edits stay unobtrusive.
      setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
      return true;
    } catch (err) {
      console.error("Failed to save ticket edit:", err);
      setSaveState("error");
      return false;
    }
  }, [ticket.localId, onUpdated]);

  const handleStatus = async (s: string) => {
    const previous = status;
    setStatus(s);
    const ok = await persist({ status: s });
    if (!ok) setStatus(previous);
  };
  const handlePriority = async (p: string) => {
    const previous = priority;
    setPriority(p);
    const ok = await persist({ priority: p });
    if (!ok) setPriority(previous);
  };
  const canEditNote = (note: Note) => note.type === "note" && !!currentUser?.canWrite;

  const createTicketNote = async (html: string) => {
    if (ticket.localId == null) return;
    await api.createNote(ticket.localId, {
      content: htmlToPlainText(html) || "Note",
      htmlContent: html,
      noteType: "note",
    });
    onNotesChanged?.();
  };

  const editTicketNote = async (note: Note, html: string) => {
    if (ticket.localId == null) return;
    if (!canEditNote(note)) return;
    await api.updateNote(ticket.localId, Number(note.id), {
      content: htmlToPlainText(html) || "Note",
      htmlContent: html,
    });
    onNotesChanged?.();
  };

  const source = String(full?.source ?? "local");
  const externalProvider = full?.externalProvider as string | undefined;
  const created = full?.createdAt ? new Date(full.createdAt).toLocaleString() : ticket.dateEntered;
  const description = full?.description ?? ticket.ticketSummary;
  const hasIntegrations = source !== "local" || devices.length > 0 || jobs.length > 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      {/* Header band */}
      <Box sx={(theme) => ({ background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 58%, ${theme.palette.secondary.main} 100%)`, color: theme.palette.primary.contrastText, px: 3, py: 2 })}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Chip size="small" label={`#${ticket.ticketnumber}`} sx={{ bgcolor: "rgba(255,255,255,0.2)", color: "inherit", fontWeight: 700 }} />
              <SyncBadges
                ticket={{
                  source,
                  externalProvider,
                  externalId: full?.externalId ? String(full.externalId) : ticket.externalId,
                  syncState: full?.syncState ?? undefined,
                }}
                header
              />
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
                <IconButton sx={{ color: "inherit" }} onClick={() => window.open(api.ticketExportUrl(ticket.localId!), "_blank")}>
                  <DownloadIcon />
                </IconButton>
              </Tooltip>
            )}
            <IconButton onClick={onClose} sx={{ color: "inherit" }}><Close /></IconButton>
          </Stack>
        </Stack>
      </Box>

      <DialogContent dividers sx={{ bgcolor: "background.default", p: { xs: 1.5, md: 2 } }}>
        {source !== "local" && full?.externalId && (
          <SyncStatusBar
            state={full?.syncState as string | undefined}
            provider={externalProvider ?? source}
            syncing={syncing}
            onSyncNow={doSyncNow}
            onResolve={doResolveConflict}
          />
        )}
        <Grid container spacing={2}>
          {/* Main column */}
          <Grid item xs={12} md={7}>
            <Card>
              <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Description</Typography>
                <DescriptionEditor value={description} onSave={(v) => persist({ description: v })} />
              </CardContent>
            </Card>

            <Card sx={{ mt: 2 }}>
              <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  alignItems={{ xs: "stretch", sm: "center" }}
                  justifyContent="space-between"
                  sx={{ mb: 1.5 }}
                >
                  <Typography variant="subtitle2" color="text.secondary">Activity & notes</Typography>
                  <EmailActionButton
                    enabled={mailConfigured && ticket.localId != null}
                    disabledReason={ticket.localId == null ? "Save the ticket before sending email." : "Email is not configured."}
                    onClick={() => setCompose({ to: defaultRecipient })}
                  />
                </Stack>
                {ticket.localId != null && <AddNoteComposer onSave={createTicketNote} />}
                <NotesSection
                  notes={notes}
                  sortAscending={sortAscending}
                  toggleSort={() => setSortAscending((s) => !s)}
                  canEditNote={canEditNote}
                  currentUser={currentUser}
                  onEditNote={editTicketNote}
                  onReply={mailConfigured ? (n) => setCompose({
                    to: n.emailFrom,
                    subject: /^re:/i.test(n.subject ?? "") ? n.subject : `Re: ${n.subject ?? title}`,
                  }) : undefined}
                />
              </CardContent>
            </Card>
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} md={5}>
            <Card>
              <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Details</Typography>
                <Stack spacing={1.5}>
                  {/* Status + priority share a row — both are short and read at a glance. */}
                  <Stack direction="row" spacing={1}>
                    <TextField select label="Status" size="small" fullWidth value={status}
                      SelectProps={{ renderValue: (value) => <StatusSignal status={String(value)} /> }}
                      onChange={(e) => handleStatus(e.target.value)}>
                      {TICKET_STATUSES.map((s) => <MenuItem key={s} value={s}><StatusSignal status={s} /></MenuItem>)}
                    </TextField>
                    <TextField select label="Priority" size="small" fullWidth value={priority || "Medium"}
                      SelectProps={{ renderValue: (value) => <PrioritySignal priority={String(value)} /> }}
                      onChange={(e) => handlePriority(e.target.value)}>
                      {TICKET_PRIORITIES.map((p) => <MenuItem key={p} value={p}><PrioritySignal priority={p} /></MenuItem>)}
                    </TextField>
                  </Stack>
                  <InlineEditableText
                    label="Title"
                    value={title}
                    required
                    onSave={async (v) => {
                      const ok = await persist({ title: v });
                      if (ok) setTitle(v);
                      return ok;
                    }}
                  />
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
                    <>
                      <Autocomplete
                        size="small"
                        freeSolo
                        options={contacts}
                        value={selectedContact}
                        getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        onChange={(_e, v) => pickContactValue(v)}
                        renderOption={(props, c) => {
                          const { key, ...rest } = props as { key?: React.Key };
                          return (
                            <li key={key ?? c.id} {...rest}>
                              <Box>
                                <Typography variant="body2">
                                  {c.name}{c.isPrimary ? " · Primary" : ""}
                                </Typography>
                                {(c.title || c.email) && (
                                  <Typography variant="caption" color="text.secondary">
                                    {[c.title, c.email].filter(Boolean).join(" · ")}
                                  </Typography>
                                )}
                              </Box>
                            </li>
                          );
                        }}
                        renderInput={(params) => (
                          <TextField {...params} label="Contact" placeholder="Search or type to add…" />
                        )}
                      />
                      {selectedContact && (selectedContact.email || selectedContact.phone) && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: -0.75, ml: 0.5 }}>
                          {[selectedContact.email, selectedContact.phone].filter(Boolean).join(" · ")}
                        </Typography>
                      )}
                    </>
                  )}
                  <TextField select label="Assignee" size="small" fullWidth value={assigneeId}
                    onChange={(e) => saveAssignee(e.target.value === "" ? "" : Number(e.target.value))}>
                    <MenuItem value="">Unassigned</MenuItem>
                    {assignees.map((a) => (
                      <MenuItem key={a.id} value={a.id}>{a.displayName || a.username} · {a.role}</MenuItem>
                    ))}
                  </TextField>
                  <Box>
                    {(full?.labels ?? []).length > 0 && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                        {(full?.labels ?? []).map((tl: any) => (
                          <Chip key={tl.label.id} size="small" label={tl.label.name}
                            sx={{ bgcolor: tl.label.color, color: "#fff" }}
                            onDelete={() => removeLabel(tl.label.id)} />
                        ))}
                      </Stack>
                    )}
                    {(() => {
                      const available = allLabels.filter((l) => !(full?.labels ?? []).some((tl: any) => tl.label.id === l.id));
                      return (
                        <TextField select label="Labels" size="small" fullWidth value=""
                          onChange={(e) => e.target.value !== "" && addLabel(Number(e.target.value))}
                          InputLabelProps={{ shrink: true }}
                          SelectProps={{ displayEmpty: true, renderValue: () => (available.length ? "Add a label…" : "No labels available") }}>
                          {/* Hidden empty option anchors the value="" so MUI doesn't warn. */}
                          <MenuItem value="" sx={{ display: "none" }} />
                          {available.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                        </TextField>
                      );
                    })()}
                  </Box>
                  <Divider sx={{ my: 0.5 }} />
                  <MetaRow icon={<BusinessIcon fontSize="small" />} label="Source" value={source} />
                  <MetaRow icon={<CalendarTodayIcon fontSize="small" />} label="Created" value={created} />
                </Stack>
              </CardContent>
            </Card>

            {/* Time tracking */}
            <TimeCard minutes={timeMinutes} entries={timeEntries} onLog={logTime} onLogRange={logTimeRange} onDelete={deleteTimeEntry} onEdit={editTimeEntry} />

            {/* Linked devices */}
            <Card sx={{ mt: 2 }}>
              <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
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
                        <Box key={d.id}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <ComputerIcon fontSize="small" color={d.status === "online" ? "success" : "disabled"} />
                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                              <Typography variant="body2" noWrap>{d.displayName || d.hostname || d.ipAddress || "device"}</Typography>
                              {d.ipAddress && <Typography variant="caption" color="text.secondary">{d.ipAddress}</Typography>}
                            </Box>
                            <Chip size="small" variant="outlined" label={sourceLabel(d.source)} color={sourceColor(d.source)} />
                            {isRmmSource(d.source) && (
                              <Tooltip title="Refresh live RMM data">
                                <IconButton size="small" onClick={() => loadDeviceLive(d.id)}><SyncIcon fontSize="small" /></IconButton>
                              </Tooltip>
                            )}
                            {canRun && (
                              <Tooltip title="Run script">
                                <IconButton size="small" onClick={() => setScriptDevice(d)}><TerminalIcon fontSize="small" /></IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="Unlink device">
                              <IconButton size="small" onClick={() => unlinkDevice(d.id)}><Close fontSize="small" /></IconButton>
                            </Tooltip>
                          </Stack>
                          {isRmmSource(d.source) && (
                            <RmmLivePanel state={liveDevices[d.id]} />
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                )}
                {/* Link an existing device to this ticket */}
                <Stack direction="row" spacing={1} alignItems="center">
                  <Autocomplete
                    size="small"
                    sx={{ flexGrow: 1 }}
                    options={linkableDevices}
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
                {ticketCompanyId != null && (hiddenByCompany > 0 || showAllDevices) && (
                  <FormControlLabel
                    sx={{ mt: 0.5, ml: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={showAllDevices}
                        onChange={(e) => setShowAllDevices(e.target.checked)}
                      />
                    }
                    label={
                      <Typography variant="caption" color="text.secondary">
                        {showAllDevices
                          ? "Showing devices from all companies"
                          : `Scoped to this company — show all companies (${hiddenByCompany} hidden)`}
                      </Typography>
                    }
                  />
                )}
              </CardContent>
            </Card>

            {/* Attachments */}
            {ticket.localId != null && (
              <AttachmentsCard ticketId={ticket.localId} attachments={attachments} onChange={reloadAttachments} />
            )}

            {/* Integration-aware panel */}
            {hasIntegrations && (
              <Card sx={{ mt: 2 }}>
                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>Integrations</Typography>
                  <Stack spacing={1}>
                    {source !== "local" && (
                      <MetaRow icon={<SyncIcon fontSize="small" />} label="Synced from" value={`${externalProvider ?? source}${full?.externalId ? ` · ${full.externalId}` : ""}`} />
                    )}
                    {jobs.length > 0 && <MetaRow icon={<TerminalIcon fontSize="small" />} label="Script jobs" value={`${jobs.length} run`} />}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {scriptDevice && (
        <RunScriptDialog
          open={!!scriptDevice}
          onClose={() => setScriptDevice(null)}
          deviceId={scriptDevice.id}
          deviceName={scriptDevice.displayName || scriptDevice.hostname || `device ${scriptDevice.id}`}
          deviceSource={scriptDevice.source}
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

/**
 * Two-way sync status bar for an external ticket. Shows the current state and,
 * on a held conflict, the "keep local / keep remote" resolution. "Sync now"
 * reconciles on demand. Local edits already push automatically on save.
 */
function SyncStatusBar({
  state,
  provider,
  syncing,
  onSyncNow,
  onResolve,
}: {
  state?: string;
  provider: string;
  syncing: boolean;
  onSyncNow: () => void;
  onResolve: (r: "local" | "remote") => void;
}) {
  const providerLabel = SYNC_PROVIDER_LABELS[provider] ?? provider;

  if (state === "conflict") {
    return (
      <Alert
        severity="error"
        sx={{ mb: 2 }}
        action={
          <Stack direction="row" spacing={1}>
            <Button color="inherit" size="small" disabled={syncing} onClick={() => onResolve("local")}>
              Keep local
            </Button>
            <Button color="inherit" size="small" disabled={syncing} onClick={() => onResolve("remote")}>
              Keep {providerLabel}
            </Button>
          </Stack>
        }
      >
        This ticket changed here and in {providerLabel} — auto-sync is paused. Choose which version wins.
      </Alert>
    );
  }

  const severity = state === "error" ? "warning" : state === "pending" ? "info" : "success";
  const text =
    state === "error"
      ? `Last sync with ${providerLabel} failed.`
      : state === "pending"
      ? `Local changes are queued to push to ${providerLabel}.`
      : `In sync with ${providerLabel}.`;

  return (
    <Alert
      severity={severity}
      sx={{ mb: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          disabled={syncing}
          startIcon={syncing ? <CircularProgress size={14} /> : undefined}
          onClick={onSyncNow}
        >
          Sync now
        </Button>
      }
    >
      {text}
    </Alert>
  );
}

const RMM_SOURCES = ["tactical_rmm", "ninjaone", "datto_rmm"];
function isRmmSource(s?: string): boolean {
  return !!s && RMM_SOURCES.includes(s);
}

function sourceLabel(s?: string): string {
  switch (s) {
    case "tactical_rmm": return "Tactical";
    case "ninjaone": return "NinjaOne";
    case "datto_rmm": return "Datto";
    case "netviz": return "NetViz";
    case "meshcentral": return "Mesh";
    case "api": return "API";
    default: return "Manual";
  }
}
function sourceColor(s?: string): "primary" | "secondary" | "default" {
  if (isRmmSource(s)) return "primary";
  if (s === "netviz") return "secondary";
  return "default";
}

function RmmLivePanel({
  state,
}: {
  state?: { loading: boolean; data?: api.RmmLiveData; error?: string };
}) {
  if (!state || state.loading) {
    return (
      <Stack direction="row" alignItems="center" spacing={1} sx={{ ml: 4, mt: 0.75 }}>
        <CircularProgress size={12} />
        <Typography variant="caption" color="text.secondary">Loading live RMM data…</Typography>
      </Stack>
    );
  }
  if (state.error) {
    return <Alert severity="warning" sx={{ ml: 4, mt: 0.75, py: 0 }}>{state.error}</Alert>;
  }
  const live = state.data;
  if (!live) return null;

  const facts = [
    ["Status", live.status],
    ["OS", live.operatingSystem],
    ["Local IP", live.localIps.join(", ")],
    ["Public IP", live.publicIp],
    ["Client / site", [live.clientName, live.siteName].filter(Boolean).join(" / ")],
    ["Last seen", live.lastSeen ? new Date(live.lastSeen).toLocaleString() : null],
    ["Hardware", live.makeModel],
    ["CPU", live.cpuModel],
  ].filter(([, value]) => value);

  return (
    <Box sx={{ ml: 4, mt: 0.75, p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
      <Grid container spacing={0.5}>
        {facts.map(([label, value]) => (
          <Grid item xs={12} sm={6} key={label}>
            <Typography variant="caption" color="text.secondary">{label}: </Typography>
            <Typography variant="caption">{value}</Typography>
          </Grid>
        ))}
      </Grid>
      <Typography variant="caption" color="text.disabled">
        Live as of {new Date(live.fetchedAt).toLocaleTimeString()}
      </Typography>
    </Box>
  );
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
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
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
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
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
  const common = { color: "inherit", display: "flex", alignItems: "center", gap: 0.5, fontSize: 13 } as const;
  if (state === "saving") return <Box sx={common}><CircularProgress size={14} color="inherit" /> Saving…</Box>;
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

function EmailActionButton({
  enabled,
  disabledReason,
  onClick,
}: {
  enabled: boolean;
  disabledReason: string;
  onClick: () => void;
}) {
  return (
    <Tooltip title={enabled ? "Send email from this ticket" : disabledReason}>
      <span>
        <Button
          size="small"
          variant={enabled ? "contained" : "outlined"}
          startIcon={<EmailIcon />}
          disabled={!enabled}
          onClick={onClick}
        >
          Send email
        </Button>
      </span>
    </Tooltip>
  );
}

function InlineEditableText({
  label,
  value,
  required = false,
  onSave,
}: {
  label: string;
  value: string;
  required?: boolean;
  onSave: (value: string) => Promise<boolean | void> | boolean | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const trimmed = draft.trim();
  const dirty = trimmed !== value;
  const invalid = required && !trimmed;

  const cancel = () => {
    setDraft(value);
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    if (invalid || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const ok = await onSave(trimmed);
      if (ok === false) {
        setError("Save failed.");
        return;
      }
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <Stack spacing={0.75}>
        <TextField
          label={label}
          size="small"
          fullWidth
          autoFocus
          value={draft}
          error={invalid || !!error}
          helperText={error}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") cancel();
          }}
        />
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Cancel edit">
            <span>
              <IconButton size="small" aria-label={`Cancel ${label.toLowerCase()} edit`} onClick={cancel} disabled={saving}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Save field">
            <span>
              <IconButton
                size="small"
                color="primary"
                aria-label={`Save ${label.toLowerCase()}`}
                onClick={save}
                disabled={saving || invalid || !dirty}
              >
                {saving ? <CircularProgress size={16} /> : <SaveIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
    );
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Typography variant="body1" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>
          {value || "—"}
        </Typography>
        <Tooltip title={`Edit ${label.toLowerCase()}`}>
          <IconButton size="small" aria-label={`Edit ${label.toLowerCase()}`} onClick={() => setEditing(true)}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

function DescriptionEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => boolean | void | Promise<boolean | void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(toEditorHtml(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(toEditorHtml(value));
  }, [editing, value]);

  const current = toEditorHtml(value);
  const dirty = draft !== current;

  const startEdit = () => {
    setDraft(toEditorHtml(value));
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(toEditorHtml(value));
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const body = isRichTextEmpty(draft) ? "" : draft;
      const ok = await onSave(body);
      if (ok === false) {
        setError("Save failed.");
        return;
      }
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <Stack spacing={1.25}>
        {error && <Alert severity="error">{error}</Alert>}
        <RichTextEditor value={draft} onChange={setDraft} minHeight={190} />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" startIcon={<UndoIcon />} onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="small" variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />} disabled={saving || !dirty} onClick={save}>
            {saving ? "Saving" : "Save"}
          </Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack direction="row" alignItems="flex-start" spacing={1}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <HtmlContent value={value} emptyText="No description." />
      </Box>
      <Tooltip title="Edit description">
        <IconButton aria-label="Edit description" onClick={startEdit}>
          <EditIcon />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function AddNoteComposer({ onSave }: { onSave: (html: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setHtml("");
    setError(null);
    setExpanded(false);
  };

  const submit = async () => {
    if (isRichTextEmpty(html)) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(html);
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!expanded) {
    return (
      <Button
        size="small"
        variant="outlined"
        startIcon={<NoteAddIcon />}
        onClick={() => setExpanded(true)}
        sx={{ mb: 1.5 }}
      >
        Add note
      </Button>
    );
  }

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25, mb: 2, bgcolor: "background.paper" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">New note</Typography>
        <Tooltip title="Discard note">
          <IconButton size="small" aria-label="Discard note" onClick={reset}>
            <Close fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack spacing={1.25}>
        {error && <Alert severity="error">{error}</Alert>}
        <RichTextEditor value={html} onChange={setHtml} minHeight={150} />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" startIcon={<UndoIcon />} onClick={reset}>
            Cancel
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<NoteAddIcon />}
            disabled={saving || isRichTextEmpty(html)}
            onClick={submit}
          >
            {saving ? "Adding" : "Add note"}
          </Button>
        </Stack>
      </Stack>
    </Box>
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

  const insertTemplate = (t: api.MailTemplate) => {
    if (t.subject) setSubj(t.subject);
    setHtml((prev) => (prev && !isRichTextEmpty(prev) ? prev + t.bodyHtml : t.bodyHtml));
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

          <RichTextEditor
            value={html}
            onChange={setHtml}
            onImageUpload={async (file) => {
              const [a] = await api.uploadAttachments(ticketId, [file]);
              return api.attachmentDownloadUrl(a.id);
            }}
          />

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="caption" color="text.secondary" sx={{ width: "100%" }}>
              Tip: paste or drop an image into the message to embed it inline.
            </Typography>
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
        <Button variant="contained" disabled={to.length === 0 || !subj.trim() || isRichTextEmpty(html) || sending} onClick={send}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TicketDialog;
