import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Alert,
  Autocomplete,
  Checkbox,
  FormControlLabel,
  Typography,
  Divider,
  FormHelperText,
  ListItemText,
} from "@mui/material";
import * as api from "../api/client";
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  DEFAULT_STATUS,
  DEFAULT_PRIORITY,
} from "../ticketVocab";
import { PrioritySignal, StatusSignal } from "./TicketSignals";
import { useIsPhone } from "../theme/useIsPhone";
import { SYNC_PROVIDER_LABELS } from "../syncBadges";

/** Per-browser memory of the last PSA destination picked, as a convenience only. */
const LAST_DESTINATION_KEY = "anchordesk.syncDestination";
const readLastDestination = (): number | "" => {
  try { const v = Number(localStorage.getItem(LAST_DESTINATION_KEY)); return Number.isInteger(v) && v > 0 ? v : ""; } catch { return ""; }
};
const rememberDestination = (jobId: number | "") => {
  try { if (jobId === "") localStorage.removeItem(LAST_DESTINATION_KEY); else localStorage.setItem(LAST_DESTINATION_KEY, String(jobId)); } catch { /* storage blocked */ }
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const emptyForm = {
  title: "",
  summary: "",
  description: "",
  status: DEFAULT_STATUS as string,
  priority: DEFAULT_PRIORITY as string,
  companyName: "",
  assigneeId: "" as number | "",
  teamId: "" as number | "",
};

export default function CreateTicketDialog({ open, onClose, onCreated }: Props) {
  const isPhone = useIsPhone();
  const [form, setForm] = useState({ ...emptyForm });
  const [assignees, setAssignees] = useState<api.Assignee[]>([]);
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [teams, setTeams] = useState<api.Team[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<api.CustomFieldDef[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [company, setCompany] = useState<api.Company | null>(null);
  const [contacts, setContacts] = useState<api.Contact[]>([]);
  const [contactId, setContactId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<api.SyncDestination[]>([]);
  const [syncJobId, setSyncJobId] = useState<number | "">("");
  // Created locally, but the PSA refused it: the ticket is safe; say so and stay open.
  const [partial, setPartial] = useState<{ ticketNumber: string; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    api.listAssignees().then(setAssignees).catch(() => setAssignees([]));
    api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
    api.listTeams().then(setTeams).catch(() => setTeams([]));
    api.listCustomFields().then(setCustomFieldDefs).catch(() => setCustomFieldDefs([]));
    setPartial(null);
    api.listSyncDestinations()
      .then((found) => {
        setDestinations(found);
        const last = readLastDestination();
        setSyncJobId(found.some((d) => d.jobId === last && !d.blocker) ? last : "");
      })
      .catch(() => setDestinations([]));
  }, [open]);

  const pickCompany = async (value: api.Company | string | null) => {
    let c: api.Company | null = null;
    if (typeof value === "string") {
      const name = value.trim();
      if (!name) return;
      c = companies.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? (await api.createCompany({ name }).catch(() => null));
      if (c && !companies.some((x) => x.id === c!.id)) setCompanies((p) => [...p, c!]);
    } else c = value;
    setCompany(c);
    setContactId("");
    if (c) api.getCompany(c.id).then((full) => setContacts(full.contacts ?? [])).catch(() => setContacts([]));
    else setContacts([]);
  };

  const setField = (field: string, value: unknown) => setForm((p) => ({ ...p, [field]: value }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    const missing = customFieldDefs.find((def) => {
      const value = customFields[def.key];
      return def.required && (value === undefined || value === null || value === "");
    });
    if (missing) {
      setError(`${missing.label} is required`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const assignee = assignees.find((a) => a.id === form.assigneeId);
      const created = (await api.createTicket({
        title: form.title,
        summary: form.summary,
        description: form.description,
        status: form.status,
        priority: form.priority,
        companyName: company?.name || form.companyName || undefined,
        companyId: company?.id,
        contactId: contactId === "" ? undefined : contactId,
        assigneeId: form.assigneeId === "" ? undefined : form.assigneeId,
        assignee: assignee ? assignee.displayName || assignee.username : undefined,
        teamId: form.teamId === "" ? undefined : form.teamId,
        customFields,
      })) as { id: number; ticketNumber?: string | null };
      setForm({ ...emptyForm });
      setCompany(null); setContacts([]); setContactId("");
      setCustomFields({});
      rememberDestination(syncJobId);
      onCreated();
      if (syncJobId !== "") {
        try {
          await api.sendTicketToPsa(created.id, syncJobId);
        } catch (err) {
          setPartial({ ticketNumber: created.ticketNumber ?? String(created.id), message: (err as Error).message });
          return;
        }
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isPhone}>
      <DialogTitle>New ticket</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          {partial && (
            <Alert severity="warning">
              Ticket #{partial.ticketNumber} was created in AnchorDesk, but the PSA refused it: {partial.message}.
              Fix that and use <strong>Send to PSA</strong> on the ticket to try again.
            </Alert>
          )}
          <TextField label="Title" required value={form.title} onChange={(e) => setField("title", e.target.value)} fullWidth autoFocus />
          <TextField label="Summary" value={form.summary} onChange={(e) => setField("summary", e.target.value)} fullWidth />
          <TextField label="Description" value={form.description} onChange={(e) => setField("description", e.target.value)} fullWidth multiline rows={4} />
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={form.status} label="Status" renderValue={(value) => <StatusSignal status={String(value)} />} onChange={(e) => setField("status", e.target.value)}>
                {TICKET_STATUSES.map((s) => <MenuItem key={s} value={s}><StatusSignal status={s} /></MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Priority</InputLabel>
              <Select value={form.priority} label="Priority" renderValue={(value) => <PrioritySignal priority={String(value)} />} onChange={(e) => setField("priority", e.target.value)}>
                {TICKET_PRIORITIES.map((p) => <MenuItem key={p} value={p}><PrioritySignal priority={p} /></MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction="row" spacing={2}>
            <Autocomplete
              size="small"
              freeSolo
              fullWidth
              options={companies}
              getOptionLabel={(c) => (typeof c === "string" ? c : c.name)}
              value={company}
              onChange={(_e, v) => pickCompany(v)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Company"
                  placeholder="Search or type to add…"
                  helperText="Blank tickets go to SpillersTech"
                />
              )}
            />
            <FormControl fullWidth size="small" disabled={!company}>
              {/* shrink is forced because these selects use displayEmpty — without it
                  the floating label overlaps the value ("Nontact"/"Unassigneed"). */}
              <InputLabel shrink>Contact</InputLabel>
              <Select<number | ""> value={contactId} label="Contact" displayEmpty notched
                onChange={(e) => setContactId(e.target.value === "" ? "" : Number(e.target.value))}>
                <MenuItem value="">None</MenuItem>
                {contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}{c.title ? ` · ${c.title}` : ""}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <FormControl fullWidth size="small">
            <InputLabel shrink>Assignee</InputLabel>
            <Select<number | ""> value={form.assigneeId} label="Assignee" displayEmpty notched
              onChange={(e) => setField("assigneeId", e.target.value === "" ? "" : Number(e.target.value))}>
              <MenuItem value="">Unassigned</MenuItem>
              {assignees.map((a) => <MenuItem key={a.id} value={a.id}>{a.displayName || a.username} · {a.role}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel shrink>Team / queue</InputLabel>
            <Select<number | ""> value={form.teamId} label="Team / queue" displayEmpty notched
              onChange={(e) => setField("teamId", e.target.value === "" ? "" : Number(e.target.value))}>
              <MenuItem value="">No team</MenuItem>
              {teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
            </Select>
          </FormControl>
          {destinations.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel shrink id="create-sync-destination-label">Sync to external PSA</InputLabel>
              <Select<number | ""> labelId="create-sync-destination-label" value={syncJobId} label="Sync to external PSA" displayEmpty notched
                onChange={(e) => setSyncJobId(e.target.value === "" ? "" : Number(e.target.value))}
                renderValue={(v) => v === "" ? "AnchorDesk only" : destinations.find((d) => d.jobId === v)?.target ?? ""}>
                <MenuItem value="">
                  <ListItemText primary="AnchorDesk only" secondary="Don't create it in a PSA" />
                </MenuItem>
                {destinations.map((d) => (
                  <MenuItem key={d.jobId} value={d.jobId} disabled={!!d.blocker} sx={{ whiteSpace: "normal" }}>
                    <ListItemText primary={d.target} secondary={d.blocker ?? `Syncs through “${d.name}”`} />
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {syncJobId === ""
                  ? "Created here only. You can send it to a PSA later from the ticket."
                  : `Also created in ${SYNC_PROVIDER_LABELS[destinations.find((d) => d.jobId === syncJobId)?.type ?? ""] ?? "the PSA"} and kept in sync.`}
              </FormHelperText>
            </FormControl>
          )}
          {customFieldDefs.length > 0 && (
            <>
              <Divider><Typography variant="caption" sx={{
                color: "text.secondary"
              }}>custom fields</Typography></Divider>
              {customFieldDefs.map((def) => (
                <CreateCustomFieldControl
                  key={def.id}
                  def={def}
                  value={customFields[def.key]}
                  onChange={(value) => setCustomFields((current) => ({ ...current, [def.key]: value }))}
                />
              ))}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {partial ? (
          <Button variant="contained" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} variant="contained" disabled={saving}>
              {saving ? (syncJobId === "" ? "Creating…" : "Creating and sending…") : "Create ticket"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function CreateCustomFieldControl({
  def,
  value,
  onChange,
}: {
  def: api.CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (def.type === "boolean") {
    return <FormControlLabel control={<Checkbox checked={value === true} onChange={(event) => onChange(event.target.checked)} />} label={`${def.label}${def.required ? " *" : ""}`} />;
  }
  if (def.type === "select") {
    return (
      <TextField select label={def.label} required={def.required} value={value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value)}>
        {!def.required && <MenuItem value="">None</MenuItem>}
        {(def.options ?? []).map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
      </TextField>
    );
  }
  return (
    <TextField
      label={def.label}
      required={def.required}
      type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
      value={value == null ? "" : String(value)}
      onChange={(event) => onChange(def.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
      slotProps={{
        inputLabel: def.type === "date" ? { shrink: true } : undefined
      }}
    />
  );
}
