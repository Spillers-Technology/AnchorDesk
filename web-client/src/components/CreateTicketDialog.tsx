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
} from "@mui/material";
import * as api from "../api/client";
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  DEFAULT_STATUS,
  DEFAULT_PRIORITY,
} from "../ticketVocab";

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
};

export default function CreateTicketDialog({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState({ ...emptyForm });
  const [assignees, setAssignees] = useState<api.Assignee[]>([]);
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [company, setCompany] = useState<api.Company | null>(null);
  const [contacts, setContacts] = useState<api.Contact[]>([]);
  const [contactId, setContactId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.listAssignees().then(setAssignees).catch(() => setAssignees([]));
    api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
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
    setSaving(true);
    setError(null);
    try {
      const assignee = assignees.find((a) => a.id === form.assigneeId);
      await api.createTicket({
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
        source: "local",
      });
      setForm({ ...emptyForm });
      setCompany(null); setContacts([]); setContactId("");
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New ticket</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <TextField label="Title" required value={form.title} onChange={(e) => setField("title", e.target.value)} fullWidth autoFocus />
          <TextField label="Summary" value={form.summary} onChange={(e) => setField("summary", e.target.value)} fullWidth />
          <TextField label="Description" value={form.description} onChange={(e) => setField("description", e.target.value)} fullWidth multiline rows={4} />
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={form.status} label="Status" onChange={(e) => setField("status", e.target.value)}>
                {TICKET_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Priority</InputLabel>
              <Select value={form.priority} label="Priority" onChange={(e) => setField("priority", e.target.value)}>
                {TICKET_PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
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
              <Select value={contactId} label="Contact" displayEmpty notched
                onChange={(e) => setContactId(e.target.value === "" ? "" : Number(e.target.value))}>
                <MenuItem value="">None</MenuItem>
                {contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}{c.title ? ` · ${c.title}` : ""}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <FormControl fullWidth size="small">
            <InputLabel shrink>Assignee</InputLabel>
            <Select value={form.assigneeId} label="Assignee" displayEmpty notched
              onChange={(e) => setField("assigneeId", e.target.value === "" ? "" : Number(e.target.value))}>
              <MenuItem value="">Unassigned</MenuItem>
              {assignees.map((a) => <MenuItem key={a.id} value={a.id}>{a.displayName || a.username} · {a.role}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? "Creating…" : "Create ticket"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
