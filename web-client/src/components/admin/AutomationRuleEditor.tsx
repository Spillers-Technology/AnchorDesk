/**
 * Visual automation rule builder: condition and action rows with pickers
 * driven by the same vocabulary the backend validates, so anything built
 * here passes validateRuleCondition/validateRuleAction. The JSON editors
 * remain available behind the dialog's Advanced toggle; the draft⇄JSON
 * converters below are pure and unit-tested.
 */
import { IconButton, MenuItem, Stack, TextField, Tooltip } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import * as api from "../../api/client";
import { TICKET_PRIORITIES } from "../../ticketVocab";

export interface RuleReferences {
  teams: api.Team[];
  users: api.Assignee[];
  labels: api.Label[];
  fields: api.CustomFieldDef[];
}

// ---- Conditions -------------------------------------------------------------

export interface ConditionDraft {
  field: string;
  op: string;
  /** Text form of the value; `in` uses comma-separated entries. */
  value: string;
}

export const CONDITION_OPS = ["eq", "neq", "contains", "in", "gte", "lte", "set", "unset"] as const;
const VALUELESS_OPS = new Set(["set", "unset"]);

/** Builtin fields with human labels; custom.<key> fields are appended live. */
export const BUILTIN_CONDITION_FIELDS: { id: string; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "companyName", label: "Company name" },
  { id: "assignee", label: "Assignee (name)" },
  { id: "assigneeId", label: "Assignee (user)" },
  { id: "teamId", label: "Team" },
  { id: "source", label: "Source" },
  { id: "title", label: "Title" },
  { id: "labelIds", label: "Labels" },
  { id: "dueAt", label: "Manual deadline" },
  { id: "effectiveDueAt", label: "Effective deadline" },
  { id: "kind", label: "SLA clock (kind)" },
  { id: "level", label: "SLA level" },
];

export function conditionsToDrafts(conditions: unknown): ConditionDraft[] {
  if (!Array.isArray(conditions)) return [];
  return conditions.map((c) => {
    const record = (c ?? {}) as Record<string, unknown>;
    const value = record.value;
    return {
      field: String(record.field ?? "status"),
      op: String(record.op ?? "eq"),
      value: Array.isArray(value) ? value.map(String).join(", ") : value == null ? "" : String(value),
    };
  });
}

export function draftsToConditions(drafts: ConditionDraft[]): Record<string, unknown>[] {
  return drafts.map((d) => {
    const out: Record<string, unknown> = { field: d.field, op: d.op };
    if (VALUELESS_OPS.has(d.op)) return out;
    if (d.op === "in") {
      out.value = d.value.split(",").map((v) => v.trim()).filter(Boolean);
    } else if ((d.op === "gte" || d.op === "lte") && d.field !== "dueAt" && d.field !== "effectiveDueAt") {
      const n = Number(d.value);
      out.value = Number.isFinite(n) && d.value.trim() !== "" ? n : d.value;
    } else {
      out.value = d.value;
    }
    return out;
  });
}

function ConditionValueInput({ draft, references, onChange }: { draft: ConditionDraft; references: RuleReferences; onChange: (value: string) => void }) {
  if (VALUELESS_OPS.has(draft.op)) return null;
  const select = (options: { value: string; label: string }[]) => (
    <TextField select size="small" label="Value" value={draft.value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 160, flexGrow: 1 }}>
      {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
    </TextField>
  );
  if (draft.field === "teamId" && draft.op !== "in") {
    return select(references.teams.map((t) => ({ value: String(t.id), label: t.name })));
  }
  if (draft.field === "assigneeId" && draft.op !== "in") {
    return select(references.users.map((u) => ({ value: String(u.id), label: u.displayName || u.username })));
  }
  if (draft.field === "labelIds" && draft.op !== "in") {
    return select(references.labels.map((l) => ({ value: String(l.id), label: l.name })));
  }
  if (draft.field === "priority" && (draft.op === "eq" || draft.op === "neq")) {
    return select(TICKET_PRIORITIES.map((p) => ({ value: p, label: p })));
  }
  if (draft.field === "kind") return select([{ value: "response", label: "response" }, { value: "resolution", label: "resolution" }]);
  if (draft.field === "level") return select([{ value: "warning", label: "warning" }, { value: "breached", label: "breached" }]);
  const isDate = draft.field === "dueAt" || draft.field === "effectiveDueAt";
  return (
    <TextField
      size="small"
      label={draft.op === "in" ? "Values (comma-separated)" : isDate ? "ISO datetime" : "Value"}
      placeholder={isDate ? "2026-08-01T17:00:00Z" : undefined}
      value={draft.value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: 160, flexGrow: 1 }}
    />
  );
}

export function ConditionRowsEditor({ drafts, references, onChange }: { drafts: ConditionDraft[]; references: RuleReferences; onChange: (next: ConditionDraft[]) => void }) {
  const fieldOptions = [
    ...BUILTIN_CONDITION_FIELDS,
    ...references.fields.map((f) => ({ id: `custom.${f.key}`, label: `Custom: ${f.label}` })),
  ];
  const setAt = (index: number, patch: Partial<ConditionDraft>) =>
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  return (
    <Stack spacing={1}>
      {drafts.map((draft, index) => (
        <Stack key={index} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
          <TextField select size="small" label="Field" value={draft.field} onChange={(e) => setAt(index, { field: e.target.value, value: "" })} sx={{ minWidth: 170 }}>
            {fieldOptions.map((f) => <MenuItem key={f.id} value={f.id}>{f.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Operator" value={draft.op} onChange={(e) => setAt(index, { op: e.target.value })} sx={{ minWidth: 110 }}>
            {CONDITION_OPS.map((op) => <MenuItem key={op} value={op}>{op}</MenuItem>)}
          </TextField>
          <ConditionValueInput draft={draft} references={references} onChange={(value) => setAt(index, { value })} />
          <Tooltip title="Remove condition">
            <IconButton size="small" onClick={() => onChange(drafts.filter((_, i) => i !== index))} aria-label={`Remove condition ${index + 1}`}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ))}
    </Stack>
  );
}

// ---- Actions ----------------------------------------------------------------

export type ActionDraft = Record<string, unknown> & { type: string };

export const ACTION_TYPES = [
  { id: "set_status", label: "Set status" },
  { id: "set_priority", label: "Set priority" },
  { id: "assign_user", label: "Assign user" },
  { id: "assign_team", label: "Route to team" },
  { id: "add_label", label: "Add label" },
  { id: "add_note", label: "Add note" },
  { id: "notify_user", label: "Notify user" },
  { id: "notify_team", label: "Notify team" },
] as const;

/** Fresh defaults per action type so a type switch never leaks stale keys. */
export function defaultAction(type: string): ActionDraft {
  switch (type) {
    case "set_status": return { type, status: "In Progress" };
    case "set_priority": return { type, priority: TICKET_PRIORITIES[0] ?? "3" };
    case "assign_user": return { type, userId: 0 };
    case "assign_team": return { type, teamId: 0 };
    case "add_label": return { type, labelId: 0 };
    case "notify_user": return { type, userId: 0, message: "" };
    case "notify_team": return { type, teamId: 0, message: "" };
    default: return { type: "add_note", content: "Automated update" };
  }
}

/** Strip empty optional messages so saved JSON stays minimal. */
export function normalizeActions(drafts: ActionDraft[]): ActionDraft[] {
  return drafts.map((a) => {
    const out = { ...a };
    if ((out.type === "notify_user" || out.type === "notify_team") && typeof out.message === "string" && !out.message.trim()) {
      delete out.message;
    }
    return out;
  });
}

export function ActionRowsEditor({ drafts, references, onChange }: { drafts: ActionDraft[]; references: RuleReferences; onChange: (next: ActionDraft[]) => void }) {
  const setAt = (index: number, patch: Record<string, unknown>) =>
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const idSelect = (index: number, key: string, label: string, options: { id: number; name: string }[], current: unknown) => (
    <TextField select size="small" label={label} value={current ? String(current) : ""} onChange={(e) => setAt(index, { [key]: Number(e.target.value) })} sx={{ minWidth: 170, flexGrow: 1 }}>
      {options.map((o) => <MenuItem key={o.id} value={String(o.id)}>{o.name}</MenuItem>)}
    </TextField>
  );
  return (
    <Stack spacing={1}>
      {drafts.map((action, index) => (
        <Stack key={index} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
          <TextField select size="small" label="Action" value={action.type} onChange={(e) => onChange(drafts.map((d, i) => (i === index ? defaultAction(e.target.value) : d)))} sx={{ minWidth: 150 }}>
            {ACTION_TYPES.map((t) => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
          </TextField>
          {action.type === "set_status" && (
            <TextField size="small" label="Status" value={String(action.status ?? "")} onChange={(e) => setAt(index, { status: e.target.value })} sx={{ flexGrow: 1 }} />
          )}
          {action.type === "set_priority" && (
            <TextField select size="small" label="Priority" value={String(action.priority ?? "")} onChange={(e) => setAt(index, { priority: e.target.value })} sx={{ minWidth: 140 }}>
              {TICKET_PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
          )}
          {(action.type === "assign_user" || action.type === "notify_user") &&
            idSelect(index, "userId", "User", references.users.map((u) => ({ id: u.id, name: u.displayName || u.username })), action.userId)}
          {(action.type === "assign_team" || action.type === "notify_team") &&
            idSelect(index, "teamId", "Team", references.teams.map((t) => ({ id: t.id, name: t.name })), action.teamId)}
          {action.type === "add_label" &&
            idSelect(index, "labelId", "Label", references.labels.map((l) => ({ id: l.id, name: l.name })), action.labelId)}
          {action.type === "add_note" && (
            <TextField size="small" label="Note content" value={String(action.content ?? "")} onChange={(e) => setAt(index, { content: e.target.value })} sx={{ flexGrow: 1 }} />
          )}
          {(action.type === "notify_user" || action.type === "notify_team") && (
            <TextField size="small" label="Message (optional)" value={String(action.message ?? "")} onChange={(e) => setAt(index, { message: e.target.value })} sx={{ flexGrow: 1 }} />
          )}
          <Tooltip title="Remove action">
            <IconButton size="small" onClick={() => onChange(drafts.filter((_, i) => i !== index))} aria-label={`Remove action ${index + 1}`}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ))}
    </Stack>
  );
}
