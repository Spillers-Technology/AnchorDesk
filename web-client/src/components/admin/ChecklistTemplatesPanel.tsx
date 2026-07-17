/**
 * Admin management for checklist templates ("boilerplating"). First panel in
 * the components/admin/ split — self-contained: list, editor dialog, and
 * delete confirmation, following the AdminView panel conventions.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { useIsPhone } from "../../theme/useIsPhone";
import * as api from "../../api/client";

interface EditorItem {
  text: string;
  dueOffsetMinutes: number | null;
}

function offsetLabel(minutes: number | null): string {
  if (minutes == null) return "no deadline";
  if (minutes % 1440 === 0) return `${minutes / 1440}d after apply`;
  if (minutes % 60 === 0) return `${minutes / 60}h after apply`;
  return `${minutes}m after apply`;
}

export default function ChecklistTemplatesPanel() {
  const [templates, setTemplates] = useState<api.ChecklistTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<api.ChecklistTemplate | null | "new">(null);

  const reload = useCallback(() => {
    api.listChecklistTemplates(true).then(setTemplates).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(reload, [reload]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!templates) return <CircularProgress />;

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5">Checklists</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>New template</Button>
      </Stack>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Reusable boilerplate lists. Applying a template copies its items onto a ticket — editing or
        deleting a template never changes checklists already on tickets. Item offsets become
        independent per-item deadlines counted from the moment of application.
      </Typography>

      {templates.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" gutterBottom>No checklist templates yet.</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
            Create one for a recurring runbook — new-user onboarding, workstation setup, offboarding —
            and technicians can apply it to any ticket in one click.
          </Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setEditing("new")}>Create your first template</Button>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Items</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                    {t.description && <Typography variant="caption" sx={{ color: "text.secondary" }}>{t.description}</Typography>}
                  </TableCell>
                  <TableCell>{t.items.length}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t.active ? "Active" : "Inactive"} color={t.active ? "success" : "default"} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(t)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <DeleteTemplateButton template={t} onDeleted={reload} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {editing !== null && (
        <TemplateEditorDialog
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </Stack>
  );
}

function DeleteTemplateButton({ template, onDeleted }: { template: api.ChecklistTemplate; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Tooltip title="Delete">
        <IconButton size="small" onClick={() => setConfirming(true)}><DeleteIcon fontSize="small" /></IconButton>
      </Tooltip>
      <Dialog open={confirming} onClose={busy ? undefined : () => setConfirming(false)}>
        <DialogTitle>Delete “{template.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Checklists already applied to tickets keep their items — only the reusable template goes away.
            Prefer marking it inactive if you might want it back.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await api.deleteChecklistTemplate(template.id); onDeleted(); }
              finally { setBusy(false); setConfirming(false); }
            }}
          >
            Delete template
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function TemplateEditorDialog({
  template,
  onClose,
  onSaved,
}: {
  template: api.ChecklistTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isPhone = useIsPhone();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [active, setActive] = useState(template?.active ?? true);
  const [items, setItems] = useState<EditorItem[]>(
    template?.items.map((i) => ({ text: i.text, dueOffsetMinutes: i.dueOffsetMinutes })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = (index: number, delta: number) => {
    const next = [...items];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row);
    setItems(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload: api.ChecklistTemplateInput = {
      name: name.trim(),
      description: description.trim() || null,
      active,
      items: items.filter((i) => i.text.trim()).map((i) => ({ text: i.text.trim(), dueOffsetMinutes: i.dueOffsetMinutes })),
    };
    try {
      if (template) await api.updateChecklistTemplate(template.id, payload);
      else await api.createChecklistTemplate(payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>{template ? "Edit checklist template" : "New checklist template"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Template name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus slotProps={{ htmlInput: { maxLength: 150 } }} />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
          <FormControlLabel control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Active (offered on tickets)" />

          <Typography variant="subtitle2">Items — applied in order</Typography>
          {items.map((item, index) => (
            <Stack key={index} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
              <TextField
                size="small"
                fullWidth
                placeholder={`Item ${index + 1}`}
                value={item.text}
                onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, text: e.target.value } : it)))}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
                <Tooltip title={`Deadline offset: ${offsetLabel(item.dueOffsetMinutes)}`}>
                  <TextField
                    size="small"
                    type="number"
                    label="Due (min)"
                    value={item.dueOffsetMinutes ?? ""}
                    onChange={(e) =>
                      setItems(items.map((it, i) =>
                        i === index ? { ...it, dueOffsetMinutes: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) } : it
                      ))
                    }
                    sx={{ width: 110 }}
                    slotProps={{ htmlInput: { min: 0, "aria-label": "Due offset in minutes after apply" } }}
                  />
                </Tooltip>
                <IconButton size="small" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up"><ArrowUpwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label="Move down"><ArrowDownwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => setItems(items.filter((_, i) => i !== index))} aria-label="Remove item"><DeleteIcon fontSize="small" /></IconButton>
              </Stack>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setItems([...items, { text: "", dueOffsetMinutes: null }])}>
              Add item
            </Button>
          </Box>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            “Due (min)” is a relative deadline: minutes after the template is applied (1440 = 1 day).
            Leave blank for no deadline.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || !name.trim()} onClick={save}>
          {template ? "Save changes" : "Create template"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
