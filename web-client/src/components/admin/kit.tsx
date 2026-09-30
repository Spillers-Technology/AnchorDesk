import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { SvgIconComponent } from "@mui/icons-material";
import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import ErrorOutlineOutlined from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import RadioButtonUncheckedOutlined from "@mui/icons-material/RadioButtonUncheckedOutlined";
import ReportProblemOutlined from "@mui/icons-material/ReportProblemOutlined";
import SyncOutlined from "@mui/icons-material/SyncOutlined";
import * as api from "../../api/client";

/**
 * The admin console kit. Every panel is built from these pieces so the console
 * reads as one product: one page header, one card, one empty state, one status
 * chip, one way to say "saved". Colors come from the active palette only — all
 * seven AnchorDesk themes must look deliberate, so nothing here hard-codes a hex.
 */

// ─── Data ────────────────────────────────────────────────────────────────────

export function errText(e: unknown): string {
  if (e instanceof api.ApiError) {
    try { const p = JSON.parse(e.body); if (p?.error) return p.error; } catch { /* ignore */ }
  }
  return (e as Error).message;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    loader()
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, loading, error, reload };
}

// ─── Feedback ────────────────────────────────────────────────────────────────

type Toast = { id: number; ok: boolean; text: string };
type ToastApi = {
  /** Show a result. Errors stay until dismissed; successes fade. */
  notify: (ok: boolean, text: string) => void;
  /** Run a mutation, toast its outcome, and report whether it succeeded. */
  run: (operation: () => Promise<unknown>, success?: string) => Promise<boolean>;
};

const ToastContext = createContext<ToastApi | null>(null);

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback((ok: boolean, text: string) => setToast({ id: Date.now(), ok, text }), []);
  const run = useCallback(async (operation: () => Promise<unknown>, success?: string) => {
    try {
      await operation();
      if (success) notify(true, success);
      return true;
    } catch (e) {
      notify(false, errText(e));
      return false;
    }
  }, [notify]);
  const value = useMemo(() => ({ notify, run }), [notify, run]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        key={toast?.id}
        open={toast !== null}
        autoHideDuration={toast?.ok ? 4000 : null}
        onClose={(_e, reason) => { if (reason !== "clickaway") setToast(null); }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          variant="filled"
          severity={toast?.ok ? "success" : "error"}
          onClose={() => setToast(null)}
          sx={{ width: "100%", maxWidth: 560, boxShadow: 6 }}
        >
          {toast?.text}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useAdminToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useAdminToast must be used inside AdminToastProvider");
  return ctx;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

/** A tinted square behind an icon — the console's one decorative motif. */
export function IconTile({ icon: Icon, size = 44, tone = "primary" }: { icon: SvgIconComponent; size?: number; tone?: "primary" | "success" | "warning" | "error" | "info" }) {
  const theme = useTheme();
  const main = theme.palette[tone].main;
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size >= 40 ? "12px" : "10px",
        display: "grid",
        placeItems: "center",
        color: main,
        background: `linear-gradient(140deg, ${alpha(main, 0.22)} 0%, ${alpha(main, 0.08)} 100%)`,
        boxShadow: `inset 0 0 0 1px ${alpha(main, 0.22)}`,
      }}
    >
      <Icon sx={{ fontSize: size * 0.52 }} />
    </Box>
  );
}

/**
 * Opens every panel: icon, one h1-level title, one sentence on what the panel
 * is for, inline status, and the panel's primary action on the right.
 */
export function AdminPage({
  icon,
  title,
  subtitle,
  status,
  actions,
  children,
}: {
  icon: SvgIconComponent;
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const { primary, secondary } = theme.palette;
  return (
    <Stack spacing={2}>
      <Box
        component="header"
        sx={{
          position: "relative",
          overflow: "hidden",
          borderRadius: "16px",
          border: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          px: { xs: 2, sm: 2.5 },
          py: { xs: 2, sm: 2.25 },
          backgroundImage: [
            `radial-gradient(120% 160% at 100% 0%, ${alpha(primary.main, 0.16)} 0%, transparent 55%)`,
            `radial-gradient(90% 140% at 0% 110%, ${alpha(secondary.main, 0.09)} 0%, transparent 60%)`,
          ].join(", "),
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1.5, sm: 2 }} useFlexGap sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
          {/* Phones: icon + title on one row, the subtitle full-width beneath.
              Wider: the subtitle sits under the title, beside the icon. */}
          <Box
            sx={{
              flexGrow: 1,
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 2,
              rowGap: 0.75,
              alignItems: "center",
              gridTemplateAreas: { xs: '"icon title" "sub sub"', sm: '"icon title" "icon sub"' },
            }}
          >
            <Box sx={{ gridArea: "icon", display: "flex" }}><IconTile icon={icon} /></Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ gridArea: "title", alignItems: "center", flexWrap: "wrap", alignSelf: subtitle ? { sm: "end" } : undefined }}>
              <Typography variant="h5" component="h1" sx={{ lineHeight: 1.2 }}>{title}</Typography>
              {status}
            </Stack>
            {subtitle && (
              <Typography variant="body2" component="div" sx={{ gridArea: "sub", color: "text.secondary", maxWidth: 760, alignSelf: "start" }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {actions && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", flexShrink: 0, justifyContent: { xs: "flex-start", sm: "flex-end" } }}>
              {actions}
            </Stack>
          )}
        </Stack>
      </Box>
      {children}
    </Stack>
  );
}

/** A titled card. `flush` drops the body padding for tables and lists. */
export function SectionCard({
  icon,
  title,
  description,
  status,
  action,
  flush = false,
  children,
}: {
  icon?: SvgIconComponent;
  title?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  children?: ReactNode;
}) {
  const hasHead = title || description || action;
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      {hasHead && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          useFlexGap
          sx={{
            px: 2,
            pt: 1.75,
            pb: flush ? 1.5 : 0,
            alignItems: { xs: "stretch", sm: "center" },
            ...(flush && { borderBottom: 1, borderColor: "divider" }),
          }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexGrow: 1, minWidth: 0 }}>
            {icon && <IconTile icon={icon} size={32} />}
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                {title && <Typography variant="subtitle1" component="h2" sx={{ lineHeight: 1.3 }}>{title}</Typography>}
                {status}
              </Stack>
              {description && (
                <Typography variant="body2" component="div" sx={{ color: "text.secondary" }}>{description}</Typography>
              )}
            </Box>
          </Stack>
          {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
        </Stack>
      )}
      {children && <Box sx={flush ? { overflowX: "auto" } : { p: 2 }}>{children}</Box>}
    </Paper>
  );
}

/** One setting: what it is and why on the left, the control on the right. */
export function SettingRow({ title, description, control, divider = false }: { title: ReactNode; description?: ReactNode; control: ReactNode; divider?: boolean }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 1, sm: 3 }}
      sx={{
        alignItems: { xs: "flex-start", sm: "center" },
        justifyContent: "space-between",
        py: 1.25,
        ...(divider && { borderTop: 1, borderColor: "divider" }),
      }}
    >
      <Box sx={{ minWidth: 0, maxWidth: 640 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
        {description && (
          <Typography variant="caption" component="div" sx={{ color: "text.secondary", lineHeight: 1.5 }}>{description}</Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0 }}>{control}</Box>
    </Stack>
  );
}

/** One heading, one sentence, at most one action — never a dead grey box. */
export function EmptyState({ icon: Icon, title, children, action, compact = false }: { icon?: SvgIconComponent; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  const theme = useTheme();
  return (
    <Stack spacing={1.25} sx={{ alignItems: "center", textAlign: "center", py: compact ? 3 : 5, px: 3, maxWidth: 520, mx: "auto" }}>
      {Icon && (
        <Box
          aria-hidden
          sx={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            color: "primary.main",
            background: `radial-gradient(circle at 30% 30%, ${alpha(theme.palette.primary.main, 0.22)}, ${alpha(theme.palette.primary.main, 0.06)})`,
          }}
        >
          <Icon />
        </Box>
      )}
      <Typography variant="subtitle1" component="p">{title}</Typography>
      {children && <Typography variant="body2" component="div" sx={{ color: "text.secondary" }}>{children}</Typography>}
      {action && <Box sx={{ pt: 0.5 }}>{action}</Box>}
    </Stack>
  );
}

/** EmptyState sized for a table body. */
export function EmptyRow({ colSpan, ...props }: { colSpan: number } & Parameters<typeof EmptyState>[0]) {
  return (
    <TableRow sx={{ "&:hover": { bgcolor: "transparent" } }}>
      <TableCell colSpan={colSpan} sx={{ borderBottom: 0 }}>
        <EmptyState compact {...props} />
      </TableCell>
    </TableRow>
  );
}

export type Tone = "success" | "warning" | "error" | "info" | "neutral" | "busy";

const TONE_ICONS: Record<Tone, SvgIconComponent> = {
  success: CheckCircleOutlined,
  warning: ReportProblemOutlined,
  error: ErrorOutlineOutlined,
  info: InfoOutlined,
  neutral: RadioButtonUncheckedOutlined,
  busy: SyncOutlined,
};

/** Never color alone: every tone carries its icon, and the label says the state. */
export function StatusChip({ tone, label, title }: { tone: Tone; label: string; title?: string }) {
  const theme = useTheme();
  const Icon = TONE_ICONS[tone];
  const main = tone === "neutral" ? theme.palette.text.secondary : theme.palette[tone === "busy" ? "info" : tone].main;
  const chip = (
    <Chip
      size="small"
      icon={<Icon sx={tone === "busy" ? { animation: "ad-spin 1.4s linear infinite", "@keyframes ad-spin": { to: { transform: "rotate(360deg)" } } } : undefined} />}
      label={label}
      sx={{
        height: 24,
        color: main,
        bgcolor: alpha(main, 0.1),
        border: 1,
        borderColor: alpha(main, 0.28),
        "& .MuiChip-icon": { color: "inherit", fontSize: 16, ml: 0.75 },
      }}
    />
  );
  return title ? <Tooltip title={title}><span>{chip}</span></Tooltip> : chip;
}

/** Skeleton in the console's shape, instead of a lone spinner in the corner. */
export function PanelLoading({ rows = 4 }: { rows?: number }) {
  return (
    <Stack spacing={2} aria-busy="true" aria-label="Loading">
      <Skeleton variant="rounded" height={88} sx={{ borderRadius: "16px" }} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.25}>
          <Skeleton width="30%" height={24} />
          {Array.from({ length: rows }, (_, i) => <Skeleton key={i} variant="rounded" height={36} />)}
        </Stack>
      </Paper>
    </Stack>
  );
}

export function PanelError({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  return (
    <Alert
      severity="error"
      action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}
    >
      {message ?? "Failed to load"}
    </Alert>
  );
}

/** A read-only value with a copy button: redirect URIs, API keys. */
export function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the field is still selectable */ }
  };
  return (
    <TextField
      fullWidth
      label={label}
      value={value}
      slotProps={{
        input: {
          readOnly: true,
          sx: mono ? { fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: 13 } : undefined,
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={copied ? "Copied" : "Copy"}>
                <IconButton edge="end" aria-label={`Copy ${label}`} onClick={() => void copy()}>
                  {copied ? <CheckCircleOutlined fontSize="small" color="success" /> : <ContentCopyOutlined fontSize="small" />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** A thin bar for "n of total" stats. */
export function Meter({ value, total, tone = "success" }: { value: number; total: number; tone?: "success" | "primary" | "warning" }) {
  const theme = useTheme();
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const main = theme.palette[tone].main;
  return (
    <Box role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={total} sx={{ height: 6, borderRadius: 3, bgcolor: alpha(main, 0.14), overflow: "hidden" }}>
      <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 3, bgcolor: main, transition: "width 400ms ease" }} />
    </Box>
  );
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** For table cells a phone can live without; the row keeps its name, status and actions. */
export const hideOnPhone = { display: { xs: "none", sm: "table-cell" } } as const;

export const monoSx = { fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: 12.5 } as const;

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

/** "5 minutes ago" / "yesterday"; falls back to the absolute date past a month. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const seconds = Math.round((t - now) / 1000);
  const abs = Math.abs(seconds);
  if (!rtf || abs > 30 * 86400) return new Date(iso).toLocaleDateString();
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

/** Audit actors: "automation:<rule>" reads as the rule, everything else as-is. */
export function actorLabel(changedBy: string): string {
  return changedBy.startsWith("automation:") ? `Automation · ${changedBy.slice("automation:".length)}` : changedBy;
}

/** Relative time with the exact timestamp on hover. */
export function When({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <Box component="span" sx={{ color: "text.secondary" }}>never</Box>;
  return (
    <Tooltip title={new Date(iso).toLocaleString()}>
      <Box component="time" dateTime={iso} sx={{ whiteSpace: "nowrap" }}>{relativeTime(iso)}</Box>
    </Tooltip>
  );
}

/** 90 → "1 h 30 min", 4320 → "3 d". */
export function formatMinutes(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "—";
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ");
}

/** Black or white text, whichever reads on this background (WCAG relative luminance). */
export function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#111" : "#fff";
}

/** Two-letter initials for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
