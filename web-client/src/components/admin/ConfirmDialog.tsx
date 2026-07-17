import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** One or two sentences on what the action does (and doesn't) destroy. */
  body?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The console-wide destructive-action confirmation. Every admin panel uses
 * this instead of window.confirm so the dialog is themed, phone-safe, and
 * can explain consequences.
 */
export default function ConfirmDialog({ open, title, body, confirmLabel = "Delete", busy = false, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      {body && (
        <DialogContent>
          <Typography variant="body2">{body}</Typography>
        </DialogContent>
      )}
      <DialogActions>
        <Button disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button color="error" variant="contained" disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
