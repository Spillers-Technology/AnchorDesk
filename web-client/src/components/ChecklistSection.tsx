import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EventIcon from "@mui/icons-material/Event";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import * as api from "../api/client";

/** ISO → timezone-correct datetime-local input value. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dueLabel(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Props {
  ticketId: number;
  /** Bump to force a reload (e.g. the dialog received a live ticket.updated). */
  refreshKey?: number;
}

/**
 * The ticket's working checklist: apply a template, add ad-hoc items, toggle
 * with attribution, and give any item its own independent deadline. Item
 * deadlines never feed the ticket's SLA/manual clocks.
 */
export default function ChecklistSection({ ticketId, refreshKey = 0 }: Props) {
  const [items, setItems] = useState<api.ChecklistItem[]>([]);
  const [templates, setTemplates] = useState<api.ChecklistTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | "">("");
  const [newText, setNewText] = useState("");
  const [dueEditor, setDueEditor] = useState<{ id: number; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.listChecklist(ticketId).then(setItems).catch(() => setItems([]));
  }, [ticketId]);

  useEffect(() => {
    reload();
    api.listChecklistTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [reload, refreshKey]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checklist update failed");
    } finally {
      setBusy(false);
    }
  };

  const doneCount = useMemo(() => items.filter((i) => i.done).length, [items]);
  const now = Date.now();

  // Render nothing until there is something to show or do — the section
  // header only earns space on a phone screen once it has a job.
  return (
    <Box sx={{ mb: 2 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="subtitle2" sx={{ color: "text.secondary" }}>
          Checklist{items.length > 0 ? ` — ${doneCount} of ${items.length}` : ""}
        </Typography>
        {templates.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TextField
              select
              size="small"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value === "" ? "" : Number(e.target.value))}
              sx={{ minWidth: 180 }}
              label="Template"
            >
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.name} ({t.items.length})</MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlaylistAddIcon />}
              disabled={busy || templateId === ""}
              onClick={() => templateId !== "" && act(() => api.applyChecklistTemplate(ticketId, templateId))}
            >
              Apply
            </Button>
          </Stack>
        )}
      </Stack>

      {items.length > 0 && (
        <LinearProgress
          variant="determinate"
          value={items.length ? (doneCount / items.length) * 100 : 0}
          sx={{ mb: 1, borderRadius: 1 }}
        />
      )}
      {error && <Typography variant="caption" color="error">{error}</Typography>}

      <Stack spacing={0.25}>
        {items.map((item) => {
          const overdue = !item.done && item.dueAt != null && new Date(item.dueAt).getTime() < now;
          return (
            <Stack key={item.id} direction="row" sx={{ alignItems: "center", minHeight: 40 }}>
              <Checkbox
                size="small"
                checked={item.done}
                disabled={busy}
                onChange={(e) => act(() => api.updateChecklistItem(ticketId, item.id, { done: e.target.checked }))}
                slotProps={{ input: { "aria-label": `Mark "${item.text}" ${item.done ? "not done" : "done"}` } }}
              />
              <Typography
                variant="body2"
                sx={{
                  flexGrow: 1,
                  minWidth: 0,
                  overflowWrap: "anywhere",
                  textDecoration: item.done ? "line-through" : "none",
                  color: item.done ? "text.disabled" : "text.primary",
                }}
              >
                {item.text}
              </Typography>
              {item.done && item.doneBy && (
                <Tooltip title={item.doneAt ? new Date(item.doneAt).toLocaleString() : ""}>
                  <Typography variant="caption" sx={{ color: "text.disabled", mx: 0.5, display: { xs: "none", sm: "block" } }}>
                    {item.doneBy}
                  </Typography>
                </Tooltip>
              )}
              {dueEditor?.id === item.id ? (
                <TextField
                  size="small"
                  type="datetime-local"
                  value={dueEditor.value}
                  autoFocus
                  onChange={(e) => setDueEditor({ id: item.id, value: e.target.value })}
                  onBlur={() => {
                    const value = dueEditor.value;
                    setDueEditor(null);
                    void act(() =>
                      api.updateChecklistItem(ticketId, item.id, {
                        dueAt: value ? new Date(value).toISOString() : null,
                      })
                    );
                  }}
                  sx={{ width: 200 }}
                />
              ) : item.dueAt ? (
                <Chip
                  size="small"
                  icon={<EventIcon />}
                  label={dueLabel(item.dueAt)}
                  color={overdue ? "error" : "default"}
                  variant={overdue ? "filled" : "outlined"}
                  onClick={() => setDueEditor({ id: item.id, value: toLocalInput(item.dueAt!) })}
                  sx={{ mx: 0.5 }}
                />
              ) : (
                !item.done && (
                  <Tooltip title="Set item deadline">
                    <IconButton size="small" onClick={() => setDueEditor({ id: item.id, value: "" })}>
                      <EventIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              )}
              <IconButton
                size="small"
                aria-label={`Delete "${item.text}"`}
                disabled={busy}
                onClick={() => act(() => api.deleteChecklistItem(ticketId, item.id))}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          );
        })}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Add checklist item…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newText.trim()) {
              void act(() => api.addChecklistItem(ticketId, { text: newText.trim() }));
              setNewText("");
            }
          }}
          slotProps={{ htmlInput: { maxLength: 500, "aria-label": "New checklist item" } }}
        />
        <Button
          size="small"
          variant="outlined"
          disabled={busy || !newText.trim()}
          onClick={() => {
            void act(() => api.addChecklistItem(ticketId, { text: newText.trim() }));
            setNewText("");
          }}
        >
          Add
        </Button>
      </Stack>
    </Box>
  );
}
