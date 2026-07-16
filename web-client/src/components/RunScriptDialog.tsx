import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Stack,
  Typography,
  Alert,
  CircularProgress,
  Box,
  Chip,
} from "@mui/material";
import * as api from "../api/client";
import { useIsPhone } from "../theme/useIsPhone";

interface RunScriptDialogProps {
  open: boolean;
  onClose: () => void;
  deviceId: number;
  deviceName: string;
  /** RMM the device belongs to — selects the script catalog. */
  deviceSource?: string;
  ticketId?: number;
}

type Script = { id: string; name: string; shell?: string };

/** Run or schedule a script against a single device. Lean: pick script (or, for
 *  RMMs with no catalog like Datto, paste a component UID), optional args +
 *  schedule, fire, show the result. */
export default function RunScriptDialog({ open, onClose, deviceId, deviceName, deviceSource, ticketId }: RunScriptDialogProps) {
  const isPhone = useIsPhone();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [script, setScript] = useState<string>("");
  const [manualRef, setManualRef] = useState("");
  const [args, setArgs] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setScript("");
    setManualRef("");
    setLoadingScripts(true);
    api.listScripts(deviceSource)
      .then(setScripts)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingScripts(false));
  }, [open, deviceSource]);

  // No catalog (Datto, or an RMM with no scripts yet) → collect a ref by hand.
  const useManualRef = !loadingScripts && scripts.length === 0;
  const isDatto = deviceSource === "datto_rmm";
  const scriptRef = useManualRef ? manualRef.trim() : script;

  const run = async () => {
    if (!scriptRef) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const job = await api.runDeviceScript(deviceId, {
        script: scriptRef,
        scriptName: scripts.find((s) => s.id === scriptRef)?.name,
        args: args.trim() ? args.split(/\s+/) : undefined,
        ticketId,
        scheduledFor: scheduledFor || undefined,
        provider: deviceSource,
      });
      setResult(job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>Run script on {deviceName}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {loadingScripts ? (
            <Stack direction="row" spacing={1} sx={{
              alignItems: "center"
            }}>
              <CircularProgress size={16} />
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>Loading scripts…</Typography>
            </Stack>
          ) : useManualRef ? (
            <TextField
              label={isDatto ? "Component UID" : "Script reference"}
              value={manualRef}
              onChange={(e) => setManualRef(e.target.value)}
              fullWidth
              size="small"
              helperText={
                isDatto
                  ? "Datto exposes no script catalog over the API — paste the component's UID from its page in Datto RMM."
                  : "No scripts found for this RMM — enter the script's id/reference."
              }
            />
          ) : (
            <TextField
              select
              label="Script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              fullWidth
              size="small"
            >
              {scripts.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name} {s.shell ? `(${s.shell})` : ""}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            label="Arguments (space-separated)"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            fullWidth
            size="small"
          />

          <TextField
            label="Schedule for (optional)"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            fullWidth
            size="small"
            helperText="Leave blank to run immediately"
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />

          {result && (
            <Box>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  mb: 1
                }}>
                <Typography variant="subtitle2">Result</Typography>
                <Chip
                  size="small"
                  color={result.status === "success" ? "success" : result.status === "queued" ? "info" : result.status === "error" ? "error" : "default"}
                  label={result.status}
                />
              </Stack>
              {result.status === "queued" ? (
                <Alert severity="info">Scheduled — it will run at the chosen time.</Alert>
              ) : (
                <TextField
                  value={result.output ?? ""}
                  multiline
                  minRows={3}
                  maxRows={14}
                  fullWidth
                  size="small"
                  slotProps={{
                    input: { readOnly: true, sx: { fontFamily: "monospace", fontSize: 13 } }
                  }}
                />
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={run} disabled={!scriptRef || running} startIcon={running ? <CircularProgress size={16} /> : undefined}>
          {scheduledFor ? "Schedule" : "Run now"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
