import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Autocomplete,
  TextField,
  Stack,
  Divider,
  Typography,
  FormControlLabel,
  Checkbox,
  InputAdornment,
  MenuItem,
} from "@mui/material";
import RegexIcon from "@mui/icons-material/Code";
import { useEffect, useState } from "react";
import * as api from "../api/client";
import { TICKET_STATUSES } from "../ticketVocab";
import type { TicketFilterCriteria } from "../App";
import { useIsPhone } from "../theme/useIsPhone";

interface FilterDialogProps {
  open: boolean;
  onClose: () => void;
  /** Current applied criteria (so the dialog reflects active filters). */
  value: TicketFilterCriteria;
  applyFilters: (criteria: TicketFilterCriteria) => void;
}

/**
 * Advanced search. Combines the canonical facet filters (status, company,
 * assignee, label — sourced from their lists, not the current page) with a raw
 * POSIX regex matched server-side across ticket text, plus an opt-in to surface
 * closed tickets (hidden from working views by default).
 */
const FilterDialog: React.FC<FilterDialogProps> = ({ open, onClose, value, applyFilters }) => {
  const isPhone = useIsPhone();
  const [status, setStatus] = useState(value.status ?? "");
  const [company, setCompany] = useState(value.company ?? "");
  const [assignee, setAssignee] = useState(value.assignee ?? "");
  const [labelId, setLabelId] = useState<number | "">(value.labelId ?? "");
  const [teamId, setTeamId] = useState<number | "">(value.teamId ?? "");
  const [regex, setRegex] = useState(value.regex ?? "");
  const [includeClosed, setIncludeClosed] = useState(value.includeClosed ?? false);
  const [companies, setCompanies] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [labels, setLabels] = useState<api.Label[]>([]);
  const [teams, setTeams] = useState<api.Team[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<api.CustomFieldDef[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, string | number | boolean>>(value.customFields ?? {});

  // Re-sync local fields whenever the dialog opens with the active criteria.
  useEffect(() => {
    if (!open) return;
    setStatus(value.status ?? "");
    setCompany(value.company ?? "");
    setAssignee(value.assignee ?? "");
    setLabelId(value.labelId ?? "");
    setTeamId(value.teamId ?? "");
    setCustomFields(value.customFields ?? {});
    setRegex(value.regex ?? "");
    setIncludeClosed(value.includeClosed ?? false);
    api.listCompanies().then((cs) => setCompanies(cs.map((c) => c.name))).catch(() => setCompanies([]));
    api.listAssignees().then((as) => setAssignees(as.map((a) => a.displayName || a.username))).catch(() => setAssignees([]));
    api.listLabels().then(setLabels).catch(() => setLabels([]));
    api.listTeams().then(setTeams).catch(() => setTeams([]));
    api.listCustomFields().then(setCustomFieldDefs).catch(() => setCustomFieldDefs([]));
  }, [open, value]);

  // A regex is only valid if it compiles; flag a bad one before it round-trips.
  let regexError = "";
  if (regex.trim()) {
    try { new RegExp(regex); } catch (e) { regexError = (e as Error).message; }
  }

  const apply = () => {
    const normalizedCustomFields = Object.fromEntries(
      Object.entries(customFields)
        .filter(([, fieldValue]) => fieldValue !== "")
        .map(([key, fieldValue]) => {
          const def = customFieldDefs.find((candidate) => candidate.key === key);
          return [key, def?.type === "number" ? Number(fieldValue) : fieldValue];
        })
    );
    applyFilters({
      status: status || undefined,
      company: company || undefined,
      assignee: assignee || undefined,
      labelId: labelId === "" ? undefined : labelId,
      teamId: teamId === "" ? undefined : teamId,
      customFields: Object.keys(normalizedCustomFields).length ? normalizedCustomFields : undefined,
      regex: regex.trim() || undefined,
      includeClosed: includeClosed || undefined,
    });
  };
  const clear = () => {
    setStatus(""); setCompany(""); setAssignee(""); setLabelId(""); setTeamId(""); setCustomFields({}); setRegex(""); setIncludeClosed(false);
    applyFilters({});
  };

  const setCustomField = (key: string, fieldValue: string | number | boolean) => {
    setCustomFields((current) => {
      if (fieldValue === "") {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: fieldValue };
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>Advanced search</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Regex"
            value={regex}
            onChange={(e) => setRegex(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !regexError) apply(); }}
            error={!!regexError}
            helperText={regexError || "Case-insensitive POSIX regex across title, summary, description, company, #, priority. e.g. (vpn|wifi).*down"}
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start"><RegexIcon fontSize="small" color="action" /></InputAdornment>
                ),
                sx: { fontFamily: "monospace" },
              }
            }}
          />

          <Divider flexItem>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>filters</Typography>
          </Divider>

          <Autocomplete
            options={TICKET_STATUSES}
            value={status || null}
            onChange={(_e, v) => setStatus(v ?? "")}
            renderInput={(params) => <TextField {...params} label="Status" />}
          />
          <Autocomplete
            freeSolo
            options={companies}
            value={company || null}
            onChange={(_e, v) => setCompany(v ?? "")}
            onInputChange={(_e, v) => setCompany(v)}
            renderInput={(params) => <TextField {...params} label="Company" />}
          />
          <Autocomplete
            freeSolo
            options={assignees}
            value={assignee || null}
            onChange={(_e, v) => setAssignee(v ?? "")}
            onInputChange={(_e, v) => setAssignee(v)}
            renderInput={(params) => <TextField {...params} label="Assignee" />}
          />
          <Autocomplete
            options={labels}
            getOptionLabel={(l) => l.name}
            value={labels.find((l) => l.id === labelId) ?? null}
            onChange={(_e, v) => setLabelId(v ? v.id : "")}
            renderInput={(params) => <TextField {...params} label="Label" />}
          />
          <Autocomplete
            options={teams}
            getOptionLabel={(team) => team.name}
            value={teams.find((team) => team.id === teamId) ?? null}
            onChange={(_e, team) => setTeamId(team?.id ?? "")}
            renderInput={(params) => <TextField {...params} label="Team / queue" />}
          />

          {customFieldDefs.length > 0 && (
            <>
              <Divider flexItem>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>custom fields</Typography>
              </Divider>
              {customFieldDefs.map((def) => (
                <CustomFieldFilter
                  key={def.id}
                  def={def}
                  value={customFields[def.key]}
                  onChange={(fieldValue) => setCustomField(def.key, fieldValue)}
                />
              ))}
            </>
          )}

          <FormControlLabel
            control={<Checkbox checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />}
            label="Include closed tickets"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={clear} color="inherit">Clear</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={apply} variant="contained" disabled={!!regexError}>Apply</Button>
      </DialogActions>
    </Dialog>
  );
};

function CustomFieldFilter({
  def,
  value,
  onChange,
}: {
  def: api.CustomFieldDef;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  if (def.type === "boolean") {
    return (
      <TextField
        select
        label={def.label}
        value={value === undefined ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? "" : event.target.value === "true")}
      >
        <MenuItem value="">Any</MenuItem>
        <MenuItem value="true">Yes</MenuItem>
        <MenuItem value="false">No</MenuItem>
      </TextField>
    );
  }

  if (def.type === "select") {
    return (
      <TextField select label={def.label} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <MenuItem value="">Any</MenuItem>
        {(def.options ?? []).map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
      </TextField>
    );
  }

  return (
    <TextField
      label={def.label}
      type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ inputLabel: def.type === "date" ? { shrink: true } : undefined }}
    />
  );
}

export default FilterDialog;
