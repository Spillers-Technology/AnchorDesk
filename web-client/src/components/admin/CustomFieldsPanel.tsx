import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DynamicFormOutlined from "@mui/icons-material/DynamicFormOutlined";
import AddOutlined from "@mui/icons-material/AddOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";
import ConfirmDialog from "./ConfirmDialog";
import { AdminPage, EmptyRow, PanelError, PanelLoading, StatusChip, errText, monoSx, useAdminToast, useAsync } from "./kit";

const TYPE_LABEL: Record<api.CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / no",
  date: "Date",
  select: "Choice",
};

export default function CustomFieldsPanel() {
  const fields = useAsync(() => api.listCustomFields(true));
  const toast = useAdminToast();
  const [editing, setEditing] = useState<api.CustomFieldDef | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; label: string } | null>(null);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (await toast.run(operation, success)) fields.reload();
  };

  if (fields.loading && !fields.data) return <PanelLoading />;
  if (fields.error) return <PanelError message={fields.error} onRetry={fields.reload} />;

  const list = fields.data ?? [];
  const active = list.filter((f) => !f.archived).length;

  return (
    <AdminPage
      icon={DynamicFormOutlined}
      title="Custom ticket fields"
      subtitle="Define structured fields rendered on every ticket. Active fields also become table columns and advanced-search filters."
      status={list.length > 0 ? <Chip size="small" label={`${active} active${list.length > active ? ` · ${list.length - active} archived` : ""}`} /> : undefined}
      actions={<Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing(null)}>Add field</Button>}
    >
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Type</TableCell><TableCell>Required</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {list.map((field) => (
              <TableRow key={field.id} sx={{ opacity: field.archived ? 0.6 : 1 }}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{field.label}</Typography>
                  <Typography variant="caption" sx={{ ...monoSx, color: "text.secondary" }}>custom.{field.key}</Typography>
                </TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" label={TYPE_LABEL[field.type] ?? field.type} />
                  {field.type === "select" && (
                    <Typography variant="caption" sx={{ color: "text.secondary", ml: 1 }}>{(field.options ?? []).length} options</Typography>
                  )}
                </TableCell>
                <TableCell>{field.required ? <StatusChip tone="info" label="Required" /> : <Typography variant="body2" sx={{ color: "text.secondary" }}>Optional</Typography>}</TableCell>
                <TableCell>{field.archived ? <StatusChip tone="neutral" label="Archived" /> : <StatusChip tone="success" label="Active" />}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  <Tooltip title="Edit field"><IconButton aria-label={`Edit ${field.label}`} onClick={() => setEditing(field)}><EditOutlined fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title={field.archived ? "Restore" : "Archive (keeps stored values)"}>
                    <Switch
                      size="small"
                      checked={!field.archived}
                      onChange={() => void mutate(() => api.updateCustomField(field.id, { archived: !field.archived }), field.archived ? "Field restored" : "Field archived")}
                      slotProps={{
                        input: { "aria-label": field.archived ? `Restore ${field.label}` : `Archive ${field.label}` }
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="Delete permanently"><IconButton color="error" aria-label={`Delete ${field.label}`} onClick={() => setConfirmDelete({ id: field.id, label: field.label })}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <EmptyRow colSpan={5} icon={DynamicFormOutlined} title="No custom fields defined" action={<Button variant="outlined" onClick={() => setEditing(null)}>Add a field</Button>}>
                Capture what your tickets always need — contract number, site, asset tag — as typed, filterable data instead of free text.
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </Paper>
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Permanently delete “${confirmDelete?.label}”?`}
        body="If tickets still use this key, archive it instead — archiving keeps stored values and saved-view filters working."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void mutate(() => api.deleteCustomField(confirmDelete.id), "Field deleted");
          setConfirmDelete(null);
        }}
      />
      <CustomFieldEditorDialog
        open={editing !== undefined}
        field={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSave={async (data) => {
          if (editing) await api.updateCustomField(editing.id, data);
          else await api.createCustomField(data as api.CustomFieldDefInput);
          toast.notify(true, editing ? "Field saved" : "Field created");
          setEditing(undefined);
          fields.reload();
        }}
      />
    </AdminPage>
  );
}

function CustomFieldEditorDialog({
  open,
  field,
  onClose,
  onSave,
}: {
  open: boolean;
  field: api.CustomFieldDef | null;
  onClose: () => void;
  onSave: (data: api.CustomFieldDefInput | Partial<Omit<api.CustomFieldDefInput, "key" | "type">>) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [form, setForm] = useState({ key: "", label: "", type: "text" as api.CustomFieldType, options: "", required: false, sortOrder: 0, archived: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setForm({
      key: field?.key ?? "",
      label: field?.label ?? "",
      type: field?.type ?? "text",
      options: (field?.options ?? []).join(", "),
      required: field?.required ?? false,
      sortOrder: field?.sortOrder ?? 0,
      archived: field?.archived ?? false,
    });
    setError(null);
  }, [open, field]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!form.key.trim() || !form.label.trim()) return;
    const options = form.type === "select" ? form.options.split(",").map((option) => option.trim()).filter(Boolean) : null;
    if (form.type === "select" && (!options || options.length === 0)) { setError("Select fields need at least one option."); return; }
    setSaving(true);
    setError(null);
    try {
      const common = { label: form.label.trim(), options, required: form.required, sortOrder: form.sortOrder, archived: form.archived };
      await onSave(field ? common : { ...common, key: form.key.trim(), type: form.type });
    } catch (err) { setError(errText(err)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>{field ? "Edit custom field" : "Add custom field"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Key" required disabled={!!field} value={form.key} onChange={(event) => set("key", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} helperText="Stable API key: lowercase letters, digits, underscores" fullWidth />
            <TextField select label="Type" disabled={!!field} value={form.type} onChange={(event) => set("type", event.target.value as api.CustomFieldType)} fullWidth>
              {(["text", "number", "boolean", "date", "select"] as api.CustomFieldType[]).map((type) => <MenuItem key={type} value={type}>{TYPE_LABEL[type]}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField label="Label" required value={form.label} onChange={(event) => set("label", event.target.value)} />
          {form.type === "select" && <TextField label="Options" value={form.options} onChange={(event) => set("options", event.target.value)} helperText="Comma-separated choices" multiline minRows={2} />}
          <TextField label="Sort order" type="number" value={form.sortOrder} onChange={(event) => set("sortOrder", Number(event.target.value))} />
          <FormControlLabel control={<Checkbox checked={form.required} onChange={(event) => set("required", event.target.checked)} />} label="Required" />
          {field && <FormControlLabel control={<Checkbox checked={form.archived} onChange={(event) => set("archived", event.target.checked)} />} label="Archived" />}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={saving || !form.key.trim() || !form.label.trim()}>{saving ? "Saving…" : "Save"}</Button></DialogActions>
    </Dialog>
  );
}
