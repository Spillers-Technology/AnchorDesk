import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MergeIcon from "@mui/icons-material/Merge";
import * as api from "../api/client";
import { useIsPhone } from "../theme/useIsPhone";

interface MergeTicketDialogProps {
  open: boolean;
  source: api.MergeTicketSummary;
  onClose: () => void;
  onMerged: (updatedSource: api.RelatedTicketRecord, target: api.MergeTicketSummary) => void;
}

type SearchTicket = api.MergeTicketSummary & {
  status?: string;
  companyName?: string;
  mergedIntoId?: number | null;
};

const MOVE_LABELS: Array<[keyof api.MergePreviewMoveCounts, string]> = [
  ["notes", "Notes"],
  ["attachments", "Attachments"],
  ["checklistItems", "Checklist items"],
  ["children", "Children"],
  ["labels", "Labels"],
  ["deviceLinks", "Device links"],
];

function toSearchTicket(value: unknown): SearchTicket | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    ticketNumber: String(row.ticketNumber ?? row.id),
    title: String(row.title ?? ""),
    status: row.status == null ? undefined : String(row.status),
    companyName: row.companyName == null ? undefined : String(row.companyName),
    mergedIntoId: row.mergedIntoId == null ? null : Number(row.mergedIntoId),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof api.ApiError) {
    try {
      const body = JSON.parse(error.body) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // The shared client preserves text bodies too; fall through to Error.message.
    }
  }
  return error instanceof Error ? error.message : "The merge could not be completed.";
}

export default function MergeTicketDialog({
  open,
  source,
  onClose,
  onMerged,
}: MergeTicketDialogProps) {
  const isPhone = useIsPhone();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchTicket[]>([]);
  const [target, setTarget] = useState<SearchTicket | null>(null);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<api.MergePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setOptions([]);
    setTarget(null);
    setPreview(null);
    setAcknowledged(new Set());
    setSubmitting(false);
    setError("");
  }, [open, source.id]);

  useEffect(() => {
    if (!open || query.trim().length === 0) {
      setOptions([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.searchTickets(query.trim(), 20)
        .then((rows) => {
          if (!active) return;
          setOptions(
            rows
              .map(toSearchTicket)
              .filter((row): row is SearchTicket => row != null && row.id !== source.id)
          );
        })
        .catch((cause) => {
          if (active) setError(errorMessage(cause));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query, source.id]);

  useEffect(() => {
    setPreview(null);
    setAcknowledged(new Set());
    setError("");
    if (!open || !target) {
      setPreviewing(false);
      return;
    }
    let active = true;
    setPreviewing(true);
    api.mergePreview(source.id, target.id)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setPreviewing(false);
      });
    return () => {
      active = false;
    };
  }, [open, source.id, target]);

  const allWarningsAcknowledged = useMemo(
    () => preview?.warnings.every((warning) => acknowledged.has(warning.code)) ?? false,
    [acknowledged, preview]
  );
  const mergeDisabled =
    !preview ||
    previewing ||
    submitting ||
    preview.blockers.length > 0 ||
    !allWarningsAcknowledged;

  const toggleAcknowledgement = (code: string) => {
    setAcknowledged((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const submit = async () => {
    if (!target || mergeDisabled) return;
    setSubmitting(true);
    setError("");
    try {
      const updated = await api.mergeTicket(source.id, target.id, [...acknowledged]);
      onMerged(updated, preview?.target ?? target);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>Merge ticket #{source.ticketNumber}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info">
            The source becomes a closed, reversible tombstone. Its ticket number will continue to resolve to the
            surviving ticket.
          </Alert>

          <Autocomplete
            options={options}
            value={target}
            inputValue={query}
            loading={searching}
            filterOptions={(values) => values}
            getOptionLabel={(option) => `#${option.ticketNumber} · ${option.title}`}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            onInputChange={(_event, value, reason) => {
              if (reason !== "reset") setQuery(value);
            }}
            onChange={(_event, value) => setTarget(value)}
            renderOption={(props, option) => {
              const { key, ...rest } = props as { key?: React.Key };
              return (
                <Box component="li" key={key ?? option.id} {...rest}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      #{option.ticketNumber} · {option.title}
                    </Typography>
                    {(option.companyName || option.status) && (
                      <Typography variant="caption" color="text.secondary">
                        {[option.companyName, option.status].filter(Boolean).join(" · ")}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                label="Surviving ticket"
                placeholder="Search by ticket number or title"
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps.input,
                    endAdornment: (
                      <>
                        {searching ? <CircularProgress color="inherit" size={18} /> : null}
                        {params.slotProps.input.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />

          {previewing && (
            <Stack
              direction="row"
              spacing={1}
              sx={{ py: 3, alignItems: "center", justifyContent: "center" }}
            >
              <CircularProgress size={22} />
              <Typography variant="body2" color="text.secondary">Building merge preview…</Typography>
            </Stack>
          )}

          {preview && !previewing && (
            <>
              <Box>
                <Typography variant="subtitle2">
                  Move from #{preview.source.ticketNumber} to #{preview.target.ticketNumber}
                </Typography>
                <List dense disablePadding aria-label="Merge move counts">
                  {MOVE_LABELS.map(([key, label]) => (
                    <ListItem key={key} disableGutters divider>
                      <ListItemText primary={label} />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{preview.moves[key]}</Typography>
                    </ListItem>
                  ))}
                </List>
              </Box>

              {preview.warnings.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" color="warning.main" gutterBottom>
                    Acknowledgements required
                  </Typography>
                  <Stack spacing={1}>
                    {preview.warnings.map((warning) => (
                      <Alert key={warning.code} severity="warning" icon={false} sx={{ py: 0.5 }}>
                        <FormControlLabel
                          sx={{ m: 0, alignItems: "flex-start" }}
                          control={
                            <Checkbox
                              checked={acknowledged.has(warning.code)}
                              onChange={() => toggleAcknowledgement(warning.code)}
                              slotProps={{ input: { "aria-label": `Acknowledge ${warning.code}` } }}
                            />
                          }
                          label={
                            <Typography variant="body2" sx={{ pt: 1 }}>
                              {warning.message}
                            </Typography>
                          }
                        />
                      </Alert>
                    ))}
                  </Stack>
                </Box>
              )}

              {preview.blockers.length > 0 && (
                <Stack spacing={1}>
                  {preview.blockers.map((blocker) => (
                    <Alert key={blocker.code} severity="error">
                      {blocker.message}
                    </Alert>
                  ))}
                </Stack>
              )}
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
        <Button disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <MergeIcon />}
          disabled={mergeDisabled}
          onClick={() => void submit()}
        >
          Merge
        </Button>
      </DialogActions>
    </Dialog>
  );
}
