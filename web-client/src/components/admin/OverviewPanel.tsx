import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { SvgIconComponent } from "@mui/icons-material";
import ConfirmationNumberOutlined from "@mui/icons-material/ConfirmationNumberOutlined";
import DevicesOutlined from "@mui/icons-material/DevicesOutlined";
import RouterOutlined from "@mui/icons-material/RouterOutlined";
import PeopleOutlined from "@mui/icons-material/PeopleOutlined";
import EmailOutlined from "@mui/icons-material/EmailOutlined";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import AddCircleOutline from "@mui/icons-material/AddCircleOutlineOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import SyncOutlined from "@mui/icons-material/SyncOutlined";
import BoltOutlined from "@mui/icons-material/BoltOutlined";
import ChevronRight from "@mui/icons-material/ChevronRight";
import * as api from "../../api/client";
import { AdminPage, EmptyState, IconTile, Meter, PanelError, PanelLoading, StatusChip, When, actorLabel, useAsync, type Tone } from "./kit";
import type { AdminSection } from "./nav";

type Check = {
  id: string;
  title: string;
  detail: string;
  tone: Tone;
  /** Optional checks never count against readiness. */
  optional?: boolean;
  go: AdminSection;
  fix: string;
};

export type SetupData = {
  integrations: api.IntegrationsView | null;
  auth: api.AuthSettings | null;
  sla: api.SlaPolicy[] | null;
  mailboxes: api.Mailbox[] | null;
};

/**
 * Derived purely from the admin endpoints the panels already use; a source
 * that fails to load degrades its checks to "unknown" instead of failing the
 * overview.
 */
export function buildChecks(o: api.AdminOverview, s: SetupData): Check[] {
  const checks: Check[] = [];
  const smtp = s.integrations?.smtp;
  checks.push(!s.integrations
    ? { id: "smtp", title: "Outbound email", detail: "Couldn't read integration settings.", tone: "neutral", go: "integrations", fix: "Open" }
    : smtp?.host
      ? { id: "smtp", title: "Outbound email", detail: `Sending through ${smtp.host}${smtp.port ? `:${smtp.port}` : ""}.`, tone: "success", go: "integrations", fix: "Review" }
      : { id: "smtp", title: "Outbound email", detail: "No SMTP relay — replies and notifications can't be sent.", tone: "error", go: "integrations", fix: "Set up" });

  if (!s.mailboxes) {
    checks.push({ id: "imap", title: "Inbound email", detail: "Couldn't read mailboxes.", tone: "neutral", go: "mailboxes", fix: "Open" });
  } else {
    const failing = s.mailboxes.filter((m) => m.enabled && m.lastError);
    const enabled = s.mailboxes.filter((m) => m.enabled);
    checks.push(failing.length
      ? { id: "imap", title: "Inbound email", detail: `${failing.map((m) => m.name).join(", ")} failed on the last poll.`, tone: "error", go: "mailboxes", fix: "Investigate" }
      : enabled.length
        ? { id: "imap", title: "Inbound email", detail: `${enabled.length} mailbox${enabled.length === 1 ? "" : "es"} turning email into tickets.`, tone: "success", go: "mailboxes", fix: "Review" }
        : { id: "imap", title: "Inbound email", detail: "No mailbox is polling — customers can't open tickets by email.", tone: "warning", go: "mailboxes", fix: "Add mailbox" });
  }

  if (!s.sla) {
    checks.push({ id: "sla", title: "SLA targets", detail: "Couldn't read SLA policies.", tone: "neutral", go: "sla", fix: "Open" });
  } else {
    const enabled = s.sla.filter((p) => p.enabled);
    const fallback = enabled.some((p) => p.priority == null && p.companyId == null);
    checks.push(fallback
      ? { id: "sla", title: "SLA targets", detail: `${enabled.length} polic${enabled.length === 1 ? "y" : "ies"} including a catch-all default.`, tone: "success", go: "sla", fix: "Review" }
      : enabled.length
        ? { id: "sla", title: "SLA targets", detail: "No catch-all default — tickets outside your policies get no deadlines.", tone: "warning", go: "sla", fix: "Add default" }
        : { id: "sla", title: "SLA targets", detail: "No policies — tickets carry no response or resolution clock.", tone: "warning", go: "sla", fix: "Add policy" });
  }

  if (!s.auth) {
    checks.push({ id: "mfa", title: "Multi-factor sign-in", detail: "Couldn't read authentication settings.", tone: "neutral", go: "auth", fix: "Open" });
  } else {
    checks.push(s.auth.mfa.required
      ? { id: "mfa", title: "Multi-factor sign-in", detail: "TOTP is required for local accounts.", tone: "success", go: "auth", fix: "Review" }
      : { id: "mfa", title: "Multi-factor sign-in", detail: "MFA is optional — a stolen password is enough to sign in.", tone: "warning", go: "auth", fix: "Require MFA" });
    const sso = [s.auth.oidc.enabled && "OIDC", s.auth.saml.enabled && "SAML"].filter(Boolean);
    checks.push({
      id: "sso",
      title: "Single sign-on",
      detail: sso.length ? `${sso.join(" and ")} enabled.` : "Not configured. Optional — local accounts work on their own.",
      tone: sso.length ? "success" : "neutral",
      optional: true,
      go: "auth",
      fix: sso.length ? "Review" : "Configure",
    });
  }

  const storage = s.integrations?.storage;
  if (storage) {
    const s3 = storage.backend === "s3";
    checks.push(s3 && !storage.s3Bucket
      ? { id: "storage", title: "Attachment storage", detail: "S3 is selected but no bucket is set — uploads will fail.", tone: "error", go: "integrations", fix: "Fix" }
      : { id: "storage", title: "Attachment storage", detail: s3 ? `S3 bucket ${storage.s3Bucket}.` : `Local disk${storage.localDir ? ` at ${storage.localDir}` : ""}.`, tone: "success", go: "integrations", fix: "Review" });
  }

  checks.push(o.probes.total === 0
    ? { id: "probes", title: "Network discovery", detail: "No netviz probe registered. Optional — feeds the Network map.", tone: "neutral", optional: true, go: "probes", fix: "Register" }
    : o.probes.online < o.probes.total
      ? { id: "probes", title: "Network discovery", detail: `${o.probes.total - o.probes.online} of ${o.probes.total} probes aren't reporting.`, tone: "warning", optional: true, go: "probes", fix: "Check" }
      : { id: "probes", title: "Network discovery", detail: `All ${o.probes.total} probe${o.probes.total === 1 ? "" : "s"} reporting.`, tone: "success", optional: true, go: "probes", fix: "Review" });

  return checks;
}

export default function OverviewPanel({ onNavigate, onOpenTickets }: { onNavigate: (s: AdminSection) => void; onOpenTickets?: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api.getAdminOverview());
  const [setup, setSetup] = useState<SetupData | null>(null);

  useEffect(() => {
    const settle = <T,>(p: Promise<T>) => p.then((v) => v, () => null);
    void Promise.all([
      settle(api.getIntegrations()),
      settle(api.getAuthSettings()),
      settle(api.listSlaPolicies()),
      settle(api.listMailboxes()),
    ]).then(([integrations, auth, sla, mailboxes]) => setSetup({
      integrations,
      auth,
      // Guard shape: an unexpected body must degrade, not crash the overview.
      sla: Array.isArray(sla) ? sla : null,
      mailboxes: Array.isArray(mailboxes) ? mailboxes : null,
    }));
  }, []);

  if (loading) return <PanelLoading />;
  if (error || !data) return <PanelError message={error} onRetry={reload} />;

  const checks = setup ? buildChecks(data, setup) : null;
  const required = checks?.filter((c) => !c.optional) ?? [];
  const ready = required.filter((c) => c.tone === "success").length;
  const attention = checks?.filter((c) => c.tone === "error" || c.tone === "warning").length ?? 0;

  const stats: StatProps[] = [
    { icon: ConfirmationNumberOutlined, label: "Open tickets", value: String(data.tickets.open), sub: `${data.tickets.total} total`, onClick: onOpenTickets },
    { icon: DevicesOutlined, label: "Devices online", value: `${data.devices.online}`, of: data.devices.total, sub: `of ${data.devices.total}`, onClick: () => onNavigate("devices") },
    { icon: RouterOutlined, label: "Probes online", value: `${data.probes.online}`, of: data.probes.total, sub: `of ${data.probes.total}`, warnBelow: true, onClick: () => onNavigate("probes") },
    { icon: PeopleOutlined, label: "Active users", value: String(data.users), sub: "can sign in", onClick: () => onNavigate("users") },
    { icon: EmailOutlined, label: "Mailboxes", value: String(data.mailboxes), sub: "enabled", onClick: () => onNavigate("mailboxes") },
  ];

  return (
    <AdminPage
      icon={DashboardOutlined}
      title="Overview"
      subtitle="Health, setup and recent changes across this AnchorDesk."
      status={checks && (attention
        ? <StatusChip tone="warning" label={`${attention} need${attention === 1 ? "s" : ""} attention`} />
        : <StatusChip tone="success" label="All set" />)}
    >
      {/* Box wrapper: Stack's child-margin shorthand would zero the Grid
          container's negative margin and overflow the viewport on phones. */}
      <Box>
        <Grid container spacing={2}>
          {stats.map((s, i) => (
            // Five tiles: on phones the odd one out takes the full row.
            <Grid size={{ xs: i === stats.length - 1 && stats.length % 2 ? 12 : 6, sm: 4, lg: 2.4 }} key={s.label}>
              <StatTile {...s} />
            </Grid>
          ))}
        </Grid>
      </Box>

      <Box>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 7 }}>
            <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 1.5 }}>
                <ReadinessRing ready={ready} total={required.length} loading={!checks} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" component="h2">Setup readiness</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {!checks
                      ? "Checking your configuration…"
                      : ready === required.length
                        ? "Everything a working helpdesk needs is in place."
                        : `${required.length - ready} of ${required.length} essentials still need setting up.`}
                  </Typography>
                </Box>
              </Stack>
              <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {(checks ?? []).map((c, i) => (
                  <CheckRow key={c.id} check={c} divider={i > 0} onGo={() => onNavigate(c.go)} />
                ))}
              </Stack>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, lg: 5 }}>
            <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
              <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                <Typography variant="subtitle1" component="h2">Recent activity</Typography>
                <Button size="small" endIcon={<ChevronRight />} onClick={() => onNavigate("audit")}>View all</Button>
              </Stack>
              {data.recentAudit.length === 0
                ? <EmptyState compact title="No activity yet">Changes to tickets, users and settings will appear here.</EmptyState>
                : <ActivityTimeline events={data.recentAudit} />}
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </AdminPage>
  );
}

/** `warnBelow`: a shortfall against `of` is a problem (probes), not routine (devices switched off). */
type StatProps = { icon: SvgIconComponent; label: string; value: string; sub?: string; of?: number; warnBelow?: boolean; onClick?: () => void };

function StatTile({ icon, label, value, sub, of, warnBelow = false, onClick }: StatProps) {
  const theme = useTheme();
  const body: ReactNode = (
    <Stack spacing={1.25} sx={{ p: 2, height: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <IconTile icon={icon} size={34} />
        {onClick && <ChevronRight className="stat-go" sx={{ color: "text.secondary", opacity: 0.5, transition: "transform 150ms, opacity 150ms" }} />}
      </Stack>
      <Box>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
          <Typography variant="h4" component="p" sx={{ lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
          {sub && <Typography variant="body2" sx={{ color: "text.secondary" }}>{sub}</Typography>}
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 600, mt: 0.25 }}>{label}</Typography>
      </Box>
      {of !== undefined && <Meter value={Number(value)} total={of} tone={warnBelow && of > 0 && Number(value) < of ? "warning" : warnBelow ? "success" : "primary"} />}
    </Stack>
  );
  return (
    <Card
      sx={{
        height: "100%",
        "@media (hover: hover)": {
          "&:hover": {
            borderColor: "primary.main",
            boxShadow: `0 6px 20px ${alpha(theme.palette.primary.main, 0.14)}`,
            transform: "translateY(-1px)",
            "& .stat-go": { opacity: 1, transform: "translateX(2px)" },
          },
        },
      }}
    >
      {onClick ? <CardActionArea onClick={onClick} sx={{ height: "100%" }}>{body}</CardActionArea> : body}
    </Card>
  );
}

function ReadinessRing({ ready, total, loading }: { ready: number; total: number; loading: boolean }) {
  const theme = useTheme();
  const pct = total ? (ready / total) * 100 : 0;
  const color = pct === 100 ? "success" : pct >= 60 ? "primary" : "warning";
  return (
    <Box sx={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
      <CircularProgress variant="determinate" value={100} size={56} thickness={4.5} sx={{ color: alpha(theme.palette.text.primary, 0.08), position: "absolute" }} />
      <CircularProgress
        variant={loading ? "indeterminate" : "determinate"}
        value={pct}
        size={56}
        thickness={4.5}
        color={color}
        sx={{ position: "absolute", "& .MuiCircularProgress-circle": { strokeLinecap: "round" } }}
        aria-label={loading ? "Checking setup" : `${ready} of ${total} ready`}
      />
      {!loading && (
        <Typography variant="subtitle2" component="span" sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontVariantNumeric: "tabular-nums" }}>
          {ready}/{total}
        </Typography>
      )}
    </Box>
  );
}

function CheckRow({ check, divider, onGo }: { check: Check; divider: boolean; onGo: () => void }) {
  const label = check.tone === "success" ? "Ready" : check.tone === "error" ? "Broken" : check.tone === "warning" ? "Needs work" : check.optional ? "Optional" : "Unknown";
  return (
    <Stack
      component="li"
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.75, sm: 1.5 }}
      sx={{ alignItems: { xs: "flex-start", sm: "center" }, py: 1.1, ...(divider && { borderTop: 1, borderColor: "divider" }) }}
    >
      <Box sx={{ width: { sm: 108 }, flexShrink: 0 }}><StatusChip tone={check.tone} label={label} /></Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{check.title}</Typography>
        <Typography variant="caption" component="div" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>{check.detail}</Typography>
      </Box>
      <Button
        size="small"
        variant={check.tone === "error" || check.tone === "warning" ? "outlined" : "text"}
        onClick={onGo}
        aria-label={`${check.fix}: ${check.title}`}
        sx={{ flexShrink: 0 }}
      >
        {check.fix}
      </Button>
    </Stack>
  );
}

const ACTION_STYLE: Record<string, { icon: SvgIconComponent; tone: "success" | "info" | "error" | "primary" | "warning" }> = {
  create: { icon: AddCircleOutline, tone: "success" },
  update: { icon: EditOutlined, tone: "info" },
  delete: { icon: DeleteOutline, tone: "error" },
  sync: { icon: SyncOutlined, tone: "primary" },
};

function ActivityTimeline({ events }: { events: api.AuditEvent[] }) {
  const theme = useTheme();
  return (
    <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, position: "relative" }}>
      {events.map((a, i) => {
        const style = ACTION_STYLE[a.action] ?? { icon: BoltOutlined, tone: "primary" as const };
        const main = theme.palette[style.tone].main;
        const Icon = style.icon;
        return (
          <Stack key={a.id} component="li" direction="row" useFlexGap spacing={1.5} sx={{ position: "relative", pb: i === events.length - 1 ? 0 : 1.5 }}>
            {i < events.length - 1 && (
              <Box aria-hidden sx={{ position: "absolute", left: 13, top: 30, bottom: 2, width: 2, borderRadius: 1, bgcolor: "divider" }} />
            )}
            <Box aria-hidden sx={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", color: main, bgcolor: alpha(main, 0.14) }}>
              <Icon sx={{ fontSize: 16 }} />
            </Box>
            <Box sx={{ minWidth: 0, flexGrow: 1, pt: 0.25 }}>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                <Box component="span" sx={{ fontWeight: 600, textTransform: "capitalize" }}>{a.action}</Box>
                {" "}{a.entityType} #{a.entityId}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {a.changedBy ? `${actorLabel(a.changedBy)} · ` : ""}<When iso={a.occurredAt} />
              </Typography>
            </Box>
          </Stack>
        );
      })}
    </Box>
  );
}
