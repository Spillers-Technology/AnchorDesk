import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Paper,
  Stack,
  Typography,
  TextField,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Chip,
  Divider,
  IconButton,
  CircularProgress,
  Alert,
  Grid,
  Card,
  CardContent,
  InputAdornment,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import SearchIcon from "@mui/icons-material/Search";
import BusinessIcon from "@mui/icons-material/Business";
import ComputerIcon from "@mui/icons-material/Computer";
import HubIcon from "@mui/icons-material/Hub";
import * as api from "../api/client";
import { statusColor } from "../ticketVocab";

function fmtMinutes(m: number): string {
  if (!m) return "0m";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}

export default function CompaniesView({ onOpenTicket, onViewNetwork }: { onOpenTicket?: (ticketId: number) => void; onViewNetwork?: (name: string) => void }) {
  const [companies, setCompanies] = useState<api.Company[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const backfill = async () => {
    setBackfillMsg(null);
    try {
      const r = await api.backfillCompanies();
      setBackfillMsg(`Linked ${r.tickets} tickets and ${r.devices} devices · created ${r.companies} companies`);
      reload();
    } catch (e) {
      setBackfillMsg((e as Error).message);
    }
  };

  const reload = useCallback(() => {
    api.listCompanies().then((c) => { setCompanies(c); if (selectedId == null && c.length) setSelectedId(c[0].id); }).finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!newName.trim()) return;
    const c = await api.createCompany({ name: newName.trim() }).catch(() => null);
    setNewName("");
    if (c) { setSelectedId(c.id); }
    reload();
  };

  const filtered = companies.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  if (loading) return <CircularProgress />;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Typography variant="h5">Companies</Typography>
        <Button size="small" variant="outlined" onClick={backfill}>Import from ticket/device data</Button>
      </Stack>
      {backfillMsg && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setBackfillMsg(null)}>{backfillMsg}</Alert>}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
        <Paper variant="outlined" sx={{ width: { xs: "100%", md: 300 }, flexShrink: 0 }}>
          <Box sx={{ p: 1.5 }}>
            <TextField size="small" fullWidth placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <TextField size="small" fullWidth placeholder="New company…" value={newName}
                onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
              <IconButton color="primary" onClick={create} disabled={!newName.trim()}><AddIcon /></IconButton>
            </Stack>
          </Box>
          <Divider />
          <List dense sx={{ maxHeight: 520, overflow: "auto" }}>
            {filtered.map((c) => (
              <ListItemButton key={c.id} selected={selectedId === c.id} onClick={() => setSelectedId(c.id)}>
                <ListItemText primary={c.name} secondary={`${c._count?.tickets ?? 0} tickets · ${c._count?.contacts ?? 0} contacts`} />
              </ListItemButton>
            ))}
            {filtered.length === 0 && <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">No companies.</Typography></Box>}
          </List>
        </Paper>

        <Box sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
          {selectedId == null ? (
            <Alert severity="info">Select or create a company.</Alert>
          ) : (
            <CompanyDetail key={selectedId} id={selectedId} onChanged={reload} onOpenTicket={onOpenTicket} onViewNetwork={onViewNetwork} onDeleted={() => { setSelectedId(null); reload(); }} />
          )}
        </Box>
      </Stack>
    </Box>
  );
}

function CompanyDetail({ id, onChanged, onOpenTicket, onViewNetwork, onDeleted }: { id: number; onChanged: () => void; onOpenTicket?: (t: number) => void; onViewNetwork?: (name: string) => void; onDeleted: () => void }) {
  const [company, setCompany] = useState<api.Company | null>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [minutes, setMinutes] = useState(0);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [contactForm, setContactForm] = useState({ name: "", email: "", title: "", phone: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getCompany(id).then(setCompany).catch(() => setCompany(null));
    api.getCompanyTickets(id).then((t) => setTickets(t as any[])).catch(() => setTickets([]));
    api.getCompanyDevices(id).then((d) => setDevices(d as any[])).catch(() => setDevices([]));
    api.getCompanyTime(id).then((t) => setMinutes(t.minutes)).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  if (!company) return <CircularProgress />;

  const field = (k: keyof api.Company) => (k in draft ? draft[k] : (company[k] ?? "")) as string;
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    if (Object.keys(draft).length === 0) return;
    await api.updateCompany(id, draft).catch((e) => setMsg((e as Error).message));
    setDraft({});
    load();
    onChanged();
    setMsg("Saved");
  };
  const addContact = async () => {
    if (!contactForm.name.trim()) return;
    await api.createContact(id, contactForm).catch(() => {});
    setContactForm({ name: "", email: "", title: "", phone: "" });
    load();
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${company.name}? Tickets/devices keep their name but are unlinked.`)) return;
    await api.deleteCompany(id).catch((e) => setMsg((e as Error).message));
    onDeleted();
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: "primary.main", color: "#fff", display: "grid", placeItems: "center" }}>
          <BusinessIcon />
        </Box>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>{company.name}</Typography>
        <Chip label={`${fmtMinutes(minutes)} logged`} color="info" />
        {onViewNetwork && devices.length > 0 && (
          <Button size="small" startIcon={<HubIcon />} onClick={() => onViewNetwork(company.name)}>Network map</Button>
        )}
        <IconButton color="error" onClick={remove}><DeleteIcon /></IconButton>
      </Stack>
      {msg && <Alert severity="success" onClose={() => setMsg(null)}>{msg}</Alert>}

      <Grid container spacing={2}>
        {/* Company info (editable) */}
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Details</Typography>
            <Stack spacing={1.5}>
              <TextField size="small" label="Name" value={field("name")} onChange={(e) => set("name", e.target.value)} />
              <Stack direction="row" spacing={1}>
                <TextField size="small" label="Domain" value={field("domain")} onChange={(e) => set("domain", e.target.value)} fullWidth />
                <TextField size="small" label="Phone" value={field("phone")} onChange={(e) => set("phone", e.target.value)} fullWidth />
              </Stack>
              <Stack direction="row" spacing={1}>
                <TextField size="small" label="Email" value={field("email")} onChange={(e) => set("email", e.target.value)} fullWidth />
                <TextField size="small" label="Website" value={field("website")} onChange={(e) => set("website", e.target.value)} fullWidth />
              </Stack>
              <TextField size="small" label="Address" value={field("address")} onChange={(e) => set("address", e.target.value)} />
              <TextField size="small" label="Notes" value={field("notes")} onChange={(e) => set("notes", e.target.value)} multiline minRows={2} />
              <Box><Button variant="contained" disabled={Object.keys(draft).length === 0} onClick={save}>Save</Button></Box>
            </Stack>
          </CardContent></Card>
        </Grid>

        {/* Contacts */}
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Contacts ({company.contacts?.length ?? 0})</Typography>
            <Stack spacing={1} sx={{ mb: 1.5 }}>
              {(company.contacts ?? []).map((c) => (
                <ContactRow key={c.id} contact={c} contacts={company.contacts ?? []} onChanged={load} />
              ))}
              {(company.contacts ?? []).length === 0 && <Typography variant="body2" color="text.secondary">No contacts yet.</Typography>}
            </Stack>
            <Divider sx={{ mb: 1 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <TextField size="small" label="Name" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} />
              <TextField size="small" label="Title" value={contactForm.title} onChange={(e) => setContactForm({ ...contactForm, title: e.target.value })} />
              <TextField size="small" label="Email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
              <Button variant="outlined" disabled={!contactForm.name.trim()} onClick={addContact}>Add</Button>
            </Stack>
          </CardContent></Card>
        </Grid>

        {/* Tickets */}
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Tickets ({tickets.length})</Typography>
            <Stack spacing={0.5}>
              {tickets.map((t) => (
                <Box key={t.id} sx={{ display: "flex", alignItems: "center", gap: 1, cursor: onOpenTicket ? "pointer" : "default", "&:hover": { color: "primary.main" } }}
                  onClick={() => onOpenTicket?.(t.id)}>
                  <Chip size="small" label={t.status} color={statusColor(t.status)} />
                  <Typography variant="body2" noWrap>#{t.id} {t.title}</Typography>
                </Box>
              ))}
              {tickets.length === 0 && <Typography variant="body2" color="text.secondary">No tickets.</Typography>}
            </Stack>
          </CardContent></Card>
        </Grid>

        {/* Devices */}
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Devices ({devices.length})</Typography>
            <Stack spacing={0.5}>
              {devices.map((d) => (
                <Stack key={d.id} direction="row" alignItems="center" spacing={1}>
                  <ComputerIcon fontSize="small" color={d.status === "online" ? "success" : "disabled"} />
                  <Typography variant="body2" noWrap>{d.displayName || d.hostname || d.ipAddress || `device ${d.id}`}</Typography>
                  {d.ipAddress && <Typography variant="caption" color="text.secondary">{d.ipAddress}</Typography>}
                </Stack>
              ))}
              {devices.length === 0 && <Typography variant="body2" color="text.secondary">No devices. Set a device's company to see it here and on the network map.</Typography>}
            </Stack>
          </CardContent></Card>
        </Grid>
      </Grid>
    </Stack>
  );
}

function ContactRow({ contact, contacts, onChanged }: { contact: api.Contact; contacts: api.Contact[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: contact.name, title: contact.title ?? "", email: contact.email ?? "", phone: contact.phone ?? "" });

  const startEdit = () => {
    setForm({ name: contact.name, title: contact.title ?? "", email: contact.email ?? "", phone: contact.phone ?? "" });
    setEditing(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    await api.updateContact(contact.id, {
      name: form.name.trim(),
      title: form.title.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
    }).catch(() => {});
    setBusy(false);
    setEditing(false);
    onChanged();
  };

  const makePrimary = async () => {
    setBusy(true);
    const prev = contacts.find((c) => c.isPrimary && c.id !== contact.id);
    await api.updateContact(contact.id, { isPrimary: true }).catch(() => {});
    if (prev) await api.updateContact(prev.id, { isPrimary: false }).catch(() => {});
    setBusy(false);
    onChanged();
  };

  const remove = async () => {
    setBusy(true);
    await api.deleteContact(contact.id).catch(() => {});
    setBusy(false);
    onChanged();
  };

  if (editing) {
    return (
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Stack spacing={1} sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} fullWidth autoFocus />
            <TextField size="small" label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth />
            <TextField size="small" label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth />
          </Stack>
        </Stack>
        <Tooltip title="Save">
          <span>
            <IconButton size="small" color="primary" onClick={save} disabled={busy || !form.name.trim()}><CheckIcon fontSize="small" /></IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Cancel">
          <IconButton size="small" onClick={() => setEditing(false)} disabled={busy}><CloseIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>
    );
  }

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" component="div" noWrap sx={{ display: "flex", alignItems: "center", gap: 1 }}>{contact.name}{contact.isPrimary && <Chip size="small" label="primary" />}</Typography>
        <Typography variant="caption" color="text.secondary">{[contact.title, contact.email, contact.phone].filter(Boolean).join(" · ")}</Typography>
      </Box>
      {contact.isPrimary ? (
        <Tooltip title="Primary contact">
          <span>
            <IconButton size="small" color="warning" disabled><StarIcon fontSize="small" /></IconButton>
          </span>
        </Tooltip>
      ) : (
        <Tooltip title="Make primary">
          <span>
            <IconButton size="small" onClick={makePrimary} disabled={busy}><StarBorderIcon fontSize="small" /></IconButton>
          </span>
        </Tooltip>
      )}
      <Tooltip title="Edit">
        <IconButton size="small" onClick={startEdit} disabled={busy}><EditIcon fontSize="small" /></IconButton>
      </Tooltip>
      <Tooltip title="Delete">
        <IconButton size="small" onClick={remove} disabled={busy}><DeleteIcon fontSize="small" /></IconButton>
      </Tooltip>
    </Stack>
  );
}
