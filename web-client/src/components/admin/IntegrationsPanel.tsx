import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import CableOutlined from "@mui/icons-material/CableOutlined";
import OutboxOutlined from "@mui/icons-material/OutboxOutlined";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import TagOutlined from "@mui/icons-material/TagOutlined";
import MonitorHeartOutlined from "@mui/icons-material/MonitorHeartOutlined";
import ExpandMore from "@mui/icons-material/ExpandMore";
import * as api from "../../api/client";
import { AdminPage, IconTile, PanelError, PanelLoading, StatusChip, useAdminToast, useAsync } from "./kit";
import type { AdminSection } from "./nav";

type IntegrationKey = "smtp" | "connectwise" | "jira" | "tactical" | "ninjaone" | "datto" | "storage" | "tickets";

export default function IntegrationsPanel({ onNavigate }: { onNavigate: (s: AdminSection) => void }) {
  const { data, loading, error, reload } = useAsync(() => api.getIntegrations());
  const toast = useAdminToast();

  const save = async (key: IntegrationKey, title: string, patch: Record<string, unknown>) => {
    const ok = await toast.run(() => api.updateIntegration(key, patch), `${title} saved`);
    if (ok) reload();
    return ok;
  };

  if (loading && !data) return <PanelLoading rows={6} />;
  if (error || !data) return <PanelError message={error} onRetry={reload} />;

  const rmmCount = [data.tactical.apiUrl, data.ninjaone.apiUrl && data.ninjaone.clientId, data.datto.apiUrl && data.datto.apiKey].filter(Boolean).length;
  const s3 = data.storage.backend === "s3";

  return (
    <AdminPage
      icon={CableOutlined}
      title="Integrations"
      subtitle="Seeded from environment variables; edits here take effect immediately and override the env defaults. Secrets are write-only — leave blank to keep the current value."
      status={data.smtp.host ? <StatusChip tone="success" label="Mail can send" /> : <StatusChip tone="error" label="No outbound mail" />}
    >
      <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => onNavigate("ticket-sync")}>Open</Button>}>
        ConnectWise and Jira ticket sync — connections, scope, filtering, and health — moved to{" "}
        <strong>Ticket sync</strong>, under Channels &amp; Integrations.
      </Alert>

      <GroupHeading>Email, files &amp; numbering</GroupHeading>
      <IntegrationCard
        icon={OutboxOutlined}
        title="SMTP (outbound email)"
        configured={!!data.smtp.host}
        summary={data.smtp.host ? `${data.smtp.host}:${data.smtp.port ?? 587}${data.smtp.from ? ` · from ${data.smtp.from}` : ""}` : "Replies and notifications can't be sent until a relay is set."}
        fields={[
          { k: "host", label: "Host", value: data.smtp.host },
          { k: "port", label: "Port", value: data.smtp.port, type: "number" },
          { k: "user", label: "Username", value: data.smtp.user },
          { k: "pass", label: "Password", secret: true, has: data.smtp.hasPass },
          { k: "from", label: "From address", value: data.smtp.from, wide: true },
          { k: "secure", label: "Implicit TLS (465)", value: data.smtp.secure, type: "bool" },
        ]}
        onSave={(patch) => save("smtp", "SMTP", patch)}
      />
      <IntegrationCard
        icon={Inventory2Outlined}
        title="Attachment storage"
        configured={s3 ? !!data.storage.s3Bucket : true}
        problem={s3 && !data.storage.s3Bucket ? "S3 selected without a bucket" : undefined}
        summary={s3 ? `S3 · ${data.storage.s3Bucket ?? "no bucket"}${data.storage.s3Endpoint ? ` @ ${data.storage.s3Endpoint}` : ""}` : `Local disk${data.storage.localDir ? ` · ${data.storage.localDir}` : ""}`}
        fields={[
          { k: "backend", label: "Backend", value: data.storage.backend ?? "local", type: "select", options: ["local", "s3"], wide: true },
          { k: "localDir", label: "Local directory (local backend)", value: data.storage.localDir, wide: true },
          { k: "s3Bucket", label: "S3 bucket", value: data.storage.s3Bucket },
          { k: "s3Region", label: "S3 region", value: data.storage.s3Region },
          { k: "s3Endpoint", label: "S3 endpoint (MinIO/R2/B2)", value: data.storage.s3Endpoint, wide: true },
          { k: "s3AccessKeyId", label: "S3 access key ID", value: data.storage.s3AccessKeyId },
          { k: "s3SecretAccessKey", label: "S3 secret access key", secret: true, has: data.storage.hasS3SecretAccessKey },
          { k: "s3ForcePathStyle", label: "Force path-style (MinIO/B2)", value: data.storage.s3ForcePathStyle, type: "bool" },
        ]}
        onSave={(patch) => save("storage", "Attachment storage", patch)}
      />
      <IntegrationCard
        icon={TagOutlined}
        title="Ticket numbering"
        configured
        summary={`${data.tickets.numberDigits ?? 5}-digit ticket numbers, like #${"123456".slice(0, data.tickets.numberDigits ?? 5)}`}
        fields={[
          { k: "numberDigits", label: "Ticket number digits (4–6)", value: data.tickets.numberDigits ?? 5, type: "number" },
        ]}
        onSave={(patch) => save("tickets", "Ticket numbering", patch)}
      />

      <GroupHeading>RMM · {rmmCount} of 3 connected</GroupHeading>
      <IntegrationCard
        icon={MonitorHeartOutlined}
        title="Tactical RMM"
        configured={!!data.tactical.apiUrl}
        summary={data.tactical.apiUrl ?? "Not connected"}
        fields={[
          { k: "apiUrl", label: "API URL", value: data.tactical.apiUrl, wide: true },
          { k: "apiKey", label: "API key", secret: true, has: data.tactical.hasApiKey, wide: true },
        ]}
        onSave={(patch) => save("tactical", "Tactical RMM", patch)}
      />
      <IntegrationCard
        icon={MonitorHeartOutlined}
        title="NinjaOne RMM"
        configured={!!data.ninjaone.apiUrl && !!data.ninjaone.clientId}
        summary={data.ninjaone.apiUrl ?? "Not connected"}
        fields={[
          { k: "apiUrl", label: "API URL (regional host, e.g. https://app.ninjarmm.com)", value: data.ninjaone.apiUrl, wide: true },
          { k: "clientId", label: "Client ID", value: data.ninjaone.clientId },
          { k: "clientSecret", label: "Client secret", secret: true, has: data.ninjaone.hasClientSecret },
          { k: "scope", label: "Scope (e.g. monitoring management)", value: data.ninjaone.scope, wide: true },
        ]}
        onSave={(patch) => save("ninjaone", "NinjaOne", patch)}
      />
      <IntegrationCard
        icon={MonitorHeartOutlined}
        title="Datto RMM"
        configured={!!data.datto.apiUrl && !!data.datto.apiKey}
        summary={data.datto.apiUrl ?? "Not connected"}
        fields={[
          { k: "apiUrl", label: "API URL (platform host, e.g. https://merlot-api.centrastage.net)", value: data.datto.apiUrl, wide: true },
          { k: "apiKey", label: "API key", value: data.datto.apiKey },
          { k: "apiSecretKey", label: "API secret key", secret: true, has: data.datto.hasApiSecretKey },
        ]}
        onSave={(patch) => save("datto", "Datto RMM", patch)}
      />
    </AdminPage>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" component="h2" sx={{ color: "text.secondary", pt: 1, lineHeight: 1.5 }}>
      {children}
    </Typography>
  );
}

interface IField { k: string; label: string; value?: unknown; secret?: boolean; has?: boolean; type?: "number" | "bool" | "select"; options?: string[]; wide?: boolean }

function IntegrationCard({
  icon,
  title,
  configured,
  problem,
  summary,
  fields,
  onSave,
}: {
  icon: SvgIconComponent;
  title: string;
  configured: boolean;
  problem?: string;
  summary: string;
  fields: IField[];
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  // Bumped on save/discard so uncontrolled inputs remount with server values.
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = Object.keys(draft).length;
  const bodyId = `integration-${title.replace(/\W+/g, "-").toLowerCase()}`;

  const save = async () => {
    setSaving(true);
    if (await onSave(draft)) { setDraft({}); setFormKey((k) => k + 1); }
    setSaving(false);
  };

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderColor: open ? "primary.main" : undefined, transition: "border-color 150ms" }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        sx={{
          all: "unset",
          boxSizing: "border-box",
          width: "100%",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1.5,
          "@media (hover: hover)": { "&:hover": { bgcolor: "action.hover" } },
          "&:focus-visible": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main", outlineOffset: -2 },
        }}
      >
        <IconTile icon={icon} size={36} tone={problem ? "error" : configured ? "primary" : "warning"} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="subtitle1" component="span">{title}</Typography>
            {problem
              ? <StatusChip tone="error" label={problem} />
              : configured ? <StatusChip tone="success" label="Configured" /> : <StatusChip tone="neutral" label="Not set" />}
            {dirty > 0 && <StatusChip tone="info" label="Unsaved" />}
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>{summary}</Typography>
        </Box>
        <ExpandMore sx={{ color: "text.secondary", transition: "transform 200ms", transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }} />
      </Box>
      <Collapse in={open} unmountOnExit={false}>
        <Box id={bodyId} key={formKey} sx={{ px: 2, pb: 2, pt: 1, borderTop: 1, borderColor: "divider" }}>
          <Grid container spacing={1.75} sx={{ pt: 1 }}>
            {fields.map((f) => (
              <Grid key={f.k} size={{ xs: 12, sm: f.wide || f.type === "bool" ? 12 : 6 }}>
                {f.type === "bool" ? (
                  <FormControlLabel
                    control={<Switch checked={f.k in draft ? !!draft[f.k] : !!f.value} onChange={(e) => set(f.k, e.target.checked)} />}
                    label={f.label}
                  />
                ) : f.type === "select" ? (
                  <TextField select fullWidth label={f.label} value={f.k in draft ? String(draft[f.k]) : String(f.value ?? "")} onChange={(e) => set(f.k, e.target.value)}>
                    {(f.options ?? []).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                  </TextField>
                ) : (
                  <TextField
                    fullWidth
                    label={f.label}
                    type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
                    autoComplete={f.secret ? "new-password" : undefined}
                    defaultValue={f.secret ? "" : (f.value ?? "")}
                    placeholder={f.secret ? (f.has ? "•••••• set — blank keeps it" : "not set") : undefined}
                    // Keep a secret's label raised so its set / not-set placeholder is always visible.
                    slotProps={f.secret ? { inputLabel: { shrink: true } } : undefined}
                    onChange={(e) => set(f.k, f.type === "number" ? Number(e.target.value) : e.target.value)}
                  />
                )}
              </Grid>
            ))}
          </Grid>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", alignItems: "center", mt: 2 }}>
            {dirty > 0 && <Typography variant="caption" sx={{ color: "text.secondary", mr: "auto" }}>{dirty} unsaved change{dirty === 1 ? "" : "s"}</Typography>}
            <Button disabled={!dirty || saving} onClick={() => { setDraft({}); setFormKey((k) => k + 1); }}>Discard</Button>
            <Button variant="contained" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
}
