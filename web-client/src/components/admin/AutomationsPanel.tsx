import { useEffect, useState } from "react";
import {
  Alert,
  Box,
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
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import BoltOutlined from "@mui/icons-material/BoltOutlined";
import AddOutlined from "@mui/icons-material/AddOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import FiberNewOutlined from "@mui/icons-material/FiberNewOutlined";
import EditNoteOutlined from "@mui/icons-material/EditNoteOutlined";
import CommentOutlined from "@mui/icons-material/CommentOutlined";
import AlarmOutlined from "@mui/icons-material/AlarmOutlined";
import GppBadOutlined from "@mui/icons-material/GppBadOutlined";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";
import ConfirmDialog from "./ConfirmDialog";
import {
  ActionDraft,
  ActionRowsEditor,
  ConditionDraft,
  ConditionRowsEditor,
  RuleReferences,
  conditionsToDrafts,
  defaultAction,
  draftsToConditions,
  normalizeActions,
} from "./AutomationRuleEditor";
import { AdminPage, EmptyState, IconTile, PanelError, PanelLoading, StatusChip, When, errText, useAdminToast, useAsync } from "./kit";

const TRIGGERS: Record<api.AutomationTrigger, { label: string; icon: SvgIconComponent; tone: "primary" | "info" | "success" | "warning" | "error" }> = {
  ticket_created: { label: "Ticket created", icon: FiberNewOutlined, tone: "success" },
  ticket_updated: { label: "Ticket updated", icon: EditNoteOutlined, tone: "info" },
  note_added: { label: "Note added", icon: CommentOutlined, tone: "primary" },
  sla_at_risk: { label: "SLA at risk", icon: AlarmOutlined, tone: "warning" },
  sla_breached: { label: "SLA breached", icon: GppBadOutlined, tone: "error" },
};

export default function AutomationsPanel() {
  const rules = useAsync(() => api.listAutomations());
  const toast = useAdminToast();
  const [editing, setEditing] = useState<api.AutomationRule | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (await toast.run(operation, success)) rules.reload();
  };

  if (rules.loading && !rules.data) return <PanelLoading />;
  if (rules.error) return <PanelError message={rules.error} onRetry={rules.reload} />;

  const list = rules.data ?? [];
  const enabled = list.filter((r) => r.enabled).length;

  return (
    <AdminPage
      icon={BoltOutlined}
      title="Automations"
      subtitle="Run ordered actions when ticket and SLA events match all conditions."
      status={list.length > 0 ? <Chip size="small" label={`${enabled} of ${list.length} enabled`} /> : undefined}
      actions={<Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing(null)}>Add rule</Button>}
    >
      {list.length === 0 && (
        <Paper variant="outlined">
          <EmptyState icon={BoltOutlined} title="No rules yet" action={<Button variant="contained" onClick={() => setEditing(null)}>Create a rule</Button>}>
            Automate routing, notifications, notes and SLA escalations. Every action a rule takes is attributed to it in ticket history.
          </EmptyState>
        </Paper>
      )}
      <Stack spacing={1.25}>
        {list.map((rule) => {
          const trigger = TRIGGERS[rule.trigger] ?? { label: rule.trigger.replace(/_/g, " "), icon: BoltOutlined, tone: "primary" as const };
          return (
            <Paper key={rule.id} variant="outlined" sx={{ p: 2, opacity: rule.enabled ? 1 : 0.7 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexGrow: 1, minWidth: 0 }}>
                  <IconTile icon={trigger.icon} size={38} tone={trigger.tone} />
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                      <Typography variant="subtitle1" component="h2">{rule.name}</Typography>
                      {rule.enabled ? <StatusChip tone="success" label="Enabled" /> : <StatusChip tone="neutral" label="Disabled" />}
                    </Stack>
                    <Typography variant="body2" component="div" sx={{ color: "text.secondary" }}>
                      When <strong>{trigger.label.toLowerCase()}</strong>
                      {" · "}{rule.conditions.length || "no"} condition{rule.conditions.length === 1 ? "" : "s"}
                      {" · "}{rule.actions.length} action{rule.actions.length === 1 ? "" : "s"}
                      {" · "}{rule.runCount} run{rule.runCount === 1 ? "" : "s"}
                      {rule.lastRunAt && <> · last <When iso={rule.lastRunAt} /></>}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
                  <Switch
                    checked={rule.enabled}
                    onChange={(event) => void mutate(() => api.updateAutomation(rule.id, { enabled: event.target.checked }), event.target.checked ? "Rule enabled" : "Rule disabled")}
                    slotProps={{
                      input: { "aria-label": `${rule.enabled ? "Disable" : "Enable"} ${rule.name}` }
                    }}
                  />
                  <Tooltip title="Edit rule"><IconButton aria-label={`Edit ${rule.name}`} onClick={() => setEditing(rule)}><EditOutlined /></IconButton></Tooltip>
                  <Tooltip title="Delete rule"><IconButton color="error" aria-label={`Delete ${rule.name}`} onClick={() => setConfirmDelete({ id: rule.id, name: rule.name })}><DeleteOutline /></IconButton></Tooltip>
                </Stack>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete automation “${confirmDelete?.name}”?`}
        body="The rule stops immediately. Actions it already took on tickets are kept and stay attributed in history."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void mutate(() => api.deleteAutomation(confirmDelete.id), "Rule deleted");
          setConfirmDelete(null);
        }}
      />
      <AutomationEditorDialog
        open={editing !== undefined}
        rule={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSave={async (data) => {
          if (editing) await api.updateAutomation(editing.id, data);
          else await api.createAutomation(data);
          toast.notify(true, editing ? "Rule saved" : `Rule “${data.name}” created`);
          setEditing(undefined);
          rules.reload();
        }}
      />
    </AdminPage>
  );
}

function AutomationEditorDialog({
  open,
  rule,
  onClose,
  onSave,
}: {
  open: boolean;
  rule: api.AutomationRule | null;
  onClose: () => void;
  onSave: (data: api.AutomationRuleInput) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<api.AutomationTrigger>("ticket_created");
  const [enabled, setEnabled] = useState(true);
  // Builder rows are the default surface; the JSON editors are the escape
  // hatch. Whichever surface is visible is the source of truth on save.
  const [advanced, setAdvanced] = useState(false);
  const [conditionDrafts, setConditionDrafts] = useState<ConditionDraft[]>([]);
  const [actionDrafts, setActionDrafts] = useState<ActionDraft[]>([defaultAction("add_note")]);
  const [conditions, setConditions] = useState("[]");
  const [actions, setActions] = useState("[]");
  const [preview, setPreview] = useState<api.AutomationPreview | null>(null);
  const [references, setReferences] = useState<RuleReferences>({ teams: [], users: [], labels: [], fields: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? "");
    setTrigger(rule?.trigger ?? "ticket_created");
    setEnabled(rule?.enabled ?? true);
    setConditionDrafts(conditionsToDrafts(rule?.conditions ?? []));
    setActionDrafts((rule?.actions as ActionDraft[] | undefined) ?? [defaultAction("add_note")]);
    setConditions(JSON.stringify(rule?.conditions ?? [], null, 2));
    setActions(JSON.stringify(rule?.actions ?? [defaultAction("add_note")], null, 2));
    setAdvanced(false);
    setPreview(null);
    setError(null);
    Promise.all([api.listTeams(), api.listAssignees(), api.listLabels(), api.listCustomFields()])
      .then(([teams, users, labels, fields]) => setReferences({ teams, users, labels, fields }))
      .catch(() => setReferences({ teams: [], users: [], labels: [], fields: [] }));
  }, [open, rule]);

  /** The rule as currently edited, or an error string. */
  const collect = (): { conditions: api.AutomationCondition[]; actions: api.AutomationAction[] } | string => {
    if (!advanced) {
      const built = normalizeActions(actionDrafts);
      if (built.length === 0) return "Add at least one action.";
      return {
        conditions: draftsToConditions(conditionDrafts) as unknown as api.AutomationCondition[],
        actions: built as api.AutomationAction[],
      };
    }
    try {
      const parsedConditions = JSON.parse(conditions);
      const parsedActions = JSON.parse(actions);
      if (!Array.isArray(parsedConditions)) return "Conditions must be a JSON array.";
      if (!Array.isArray(parsedActions) || parsedActions.length === 0) return "Actions must be a non-empty JSON array.";
      return { conditions: parsedConditions, actions: parsedActions };
    } catch (err) {
      return (err as Error).message;
    }
  };

  const toggleAdvanced = () => {
    if (!advanced) {
      // Serialize builder state into the JSON editors.
      setConditions(JSON.stringify(draftsToConditions(conditionDrafts), null, 2));
      setActions(JSON.stringify(normalizeActions(actionDrafts), null, 2));
      setAdvanced(true);
      return;
    }
    // Bring JSON edits back into the builder; invalid JSON stays in advanced.
    try {
      const parsedConditions = JSON.parse(conditions);
      const parsedActions = JSON.parse(actions);
      setConditionDrafts(conditionsToDrafts(parsedConditions));
      setActionDrafts(Array.isArray(parsedActions) && parsedActions.length ? parsedActions : [defaultAction("add_note")]);
      setAdvanced(false);
      setError(null);
    } catch {
      setError("Fix the JSON before returning to the builder.");
    }
  };

  const runPreview = async () => {
    const collected = collect();
    if (typeof collected === "string") { setError(collected); return; }
    setError(null);
    try {
      setPreview(await api.previewAutomation(collected.conditions));
    } catch (err) {
      setError(errText(err));
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    const collected = collect();
    if (typeof collected === "string") { setError(collected); return; }
    setSaving(true);
    setError(null);
    try { await onSave({ name: name.trim(), trigger, enabled, conditions: collected.conditions, actions: collected.actions }); }
    catch (err) { setError(errText(err)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md" fullScreen={isPhone}>
      <DialogTitle>{rule ? "Edit automation" : "Add automation"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Rule name" required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <TextField select label="Trigger" value={trigger} onChange={(event) => setTrigger(event.target.value as api.AutomationTrigger)}>
            {(["ticket_created", "ticket_updated", "note_added", "sla_at_risk", "sla_breached"] as api.AutomationTrigger[]).map((value) => (
              <MenuItem key={value} value={value}>{value.replace(/_/g, " ")}</MenuItem>
            ))}
          </TextField>
          <FormControlLabel control={<Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />} label="Enabled" />

          {!advanced ? (
            <>
              <Typography variant="subtitle2">Conditions — all must match (none = every event)</Typography>
              <ConditionRowsEditor drafts={conditionDrafts} references={references} onChange={setConditionDrafts} />
              <Box>
                <Button size="small" onClick={() => setConditionDrafts([...conditionDrafts, { field: "status", op: "eq", value: "" }])}>
                  Add condition
                </Button>
              </Box>
              <Typography variant="subtitle2">Actions — run in order</Typography>
              <ActionRowsEditor drafts={actionDrafts} references={references} onChange={setActionDrafts} />
              <Box>
                <Button size="small" onClick={() => setActionDrafts([...actionDrafts, defaultAction("add_note")])}>
                  Add action
                </Button>
              </Box>
            </>
          ) : (
            <>
              <TextField
                label="Conditions (all must match)"
                value={conditions}
                onChange={(event) => setConditions(event.target.value)}
                multiline
                minRows={5}
                helperText='JSON array, e.g. [{"field":"priority","op":"eq","value":"Urgent"}]. Use custom.<key> for custom fields; dueAt = manual deadline only, effectiveDueAt = manual or SLA target.'
                slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: 13 } } }}
              />
              <TextField
                label="Actions (run in order)"
                value={actions}
                onChange={(event) => setActions(event.target.value)}
                multiline
                minRows={7}
                helperText="Action types: set_status, set_priority, assign_user, assign_team, add_label, add_note, notify_user, notify_team."
                slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: 13 } } }}
              />
            </>
          )}

          {preview && (
            <Alert severity={preview.matched > 0 ? "info" : "warning"}>
              Would have matched <strong>{preview.matched}</strong> of {preview.sampled} tickets active in the last {preview.sinceDays} days
              {preview.usesEventFields ? " (SLA kind/level conditions only match during real SLA events)" : ""}.
              {preview.sample.length > 0 && (
                <> Sample: {preview.sample.map((t) => `#${t.ticketNumber ?? t.id}`).join(", ")}</>
              )}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={toggleAdvanced} disabled={saving}>{advanced ? "Builder" : "Advanced JSON"}</Button>
        <Button onClick={() => void runPreview()} disabled={saving}>Preview matches</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save rule"}</Button>
      </DialogActions>
    </Dialog>
  );
}
