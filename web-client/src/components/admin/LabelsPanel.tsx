import { useState } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Chip,
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
import LabelOutlined from "@mui/icons-material/LabelOutlined";
import AddOutlined from "@mui/icons-material/AddOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import CheckIcon from "@mui/icons-material/Check";
import ColorizeOutlined from "@mui/icons-material/ColorizeOutlined";
import * as api from "../../api/client";
import ConfirmDialog from "./ConfirmDialog";
import { AdminPage, EmptyRow, PanelError, PanelLoading, SectionCard, monoSx, readableTextOn, useAdminToast, useAsync } from "./kit";

/** Presets span the hue wheel at similar weight so no label shouts over another. */
const SWATCHES = ["#6750A4", "#4f46e5", "#0ea5e9", "#0d9488", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#db2777", "#64748b"];

export function LabelChip({ name, color }: { name: string; color: string }) {
  return <Chip size="small" label={name} sx={{ bgcolor: color, color: readableTextOn(color), fontWeight: 600 }} />;
}

export default function LabelsPanel() {
  const { data, loading, error, reload } = useAsync(() => api.listLabels());
  const toast = useAdminToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [deleting, setDeleting] = useState<api.Label | null>(null);

  if (loading && !data) return <PanelLoading />;
  if (error) return <PanelError message={error} onRetry={reload} />;

  const labels = data ?? [];
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await toast.run(() => api.createLabel({ name: trimmed, color }), `Label “${trimmed}” created`)) {
      setName("");
      reload();
    }
  };

  return (
    <AdminPage
      icon={LabelOutlined}
      title="Labels"
      subtitle="Managed tags. Assign them on a ticket, auto-apply them per mailbox (catchall vs help@ vs personal), or let automations tag tickets."
      status={labels.length > 0 ? <Chip size="small" label={`${labels.length} label${labels.length === 1 ? "" : "s"}`} /> : undefined}
    >
      <SectionCard icon={AddOutlined} title="New label">
        <Stack spacing={1.75}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
              sx={{ minWidth: 220 }}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>Preview</Typography>
              <LabelChip name={name.trim() || "Label"} color={color} />
            </Stack>
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="contained" disabled={!name.trim()} onClick={() => void create()}>Add label</Button>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap role="radiogroup" aria-label="Label color" sx={{ flexWrap: "wrap", alignItems: "center" }}>
            {SWATCHES.map((s) => (
              <Swatch key={s} color={s} selected={s.toLowerCase() === color.toLowerCase()} onClick={() => setColor(s)} />
            ))}
            <Tooltip title="Custom color">
              <Box
                component="label"
                sx={{ position: "relative", width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", cursor: "pointer", border: 1, borderColor: "divider", color: "text.secondary", "&:focus-within": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main" } }}
              >
                <ColorizeOutlined fontSize="small" />
                <input
                  type="color"
                  aria-label="Custom label color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                />
              </Box>
            </Tooltip>
          </Stack>
        </Stack>
      </SectionCard>

      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Label</TableCell><TableCell>Color</TableCell><TableCell align="right" /></TableRow></TableHead>
          <TableBody>
            {labels.map((l) => (
              <TableRow key={l.id}>
                <TableCell><LabelChip name={l.name} color={l.color} /></TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box sx={{ width: 14, height: 14, borderRadius: "4px", bgcolor: l.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
                    <Box component="span" sx={monoSx}>{l.color}</Box>
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Delete label"><IconButton color="error" aria-label={`Delete label ${l.name}`} onClick={() => setDeleting(l)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {labels.length === 0 && (
              <EmptyRow colSpan={3} icon={LabelOutlined} title="No labels yet">
                Create one above. Mailboxes can auto-apply a label, and automations can tag tickets with them.
              </EmptyRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete label “${deleting?.name}”?`}
        body="It's removed from every ticket that carries it. Mailboxes that auto-applied it stop tagging."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void toast.run(() => api.deleteLabel(target.id), `Label “${target.name}” deleted`).then((ok) => ok && reload());
        }}
      />
    </AdminPage>
  );
}

function Swatch({ color, selected, onClick }: { color: string; selected: boolean; onClick: () => void }) {
  return (
    <ButtonBase
      role="radio"
      aria-checked={selected}
      aria-label={color}
      onClick={onClick}
      sx={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        bgcolor: color,
        color: readableTextOn(color),
        boxShadow: selected ? (t) => `0 0 0 2px ${t.palette.background.paper}, 0 0 0 4px ${color}` : "inset 0 0 0 1px rgba(0,0,0,.12)",
        "&.Mui-focusVisible": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main", outlineOffset: 3 },
      }}
    >
      {selected && <CheckIcon sx={{ fontSize: 18 }} />}
    </ButtonBase>
  );
}
