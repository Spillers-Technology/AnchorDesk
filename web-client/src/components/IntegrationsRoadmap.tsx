import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import DevicesIcon from "@mui/icons-material/Devices";

/**
 * Presentational roadmap of sync integrations — what's available today and what's
 * coming next. Purely informational (no wiring): it advertises the planned PSA /
 * RMM connectors so the Sync view shows direction, not just current providers.
 *
 * All targets expose public/official APIs, which is what makes them tractable.
 */

type Status = "available" | "alpha" | "soon";
interface Integration {
  name: string;
  status: Status;
  note?: string;
}

const TICKET_SYNC: Integration[] = [
  { name: "ConnectWise Manage", status: "available" },
  { name: "Jira Cloud", status: "alpha" },
  { name: "Autotask PSA", status: "soon" },
];

const RMM_SYNC: Integration[] = [
  { name: "Tactical RMM", status: "available" },
  { name: "NinjaOne", status: "alpha" },
  { name: "Datto RMM", status: "alpha" },
  { name: "ConnectWise Automate", status: "soon" },
];

function StatusChip({ status }: { status: Status }) {
  if (status === "available") {
    return <Chip size="small" color="success" variant="outlined" label="Available" />;
  }
  if (status === "alpha") {
    return <Chip size="small" color="warning" variant="outlined" label="Alpha" />;
  }
  return <Chip size="small" color="default" variant="outlined" label="Coming soon" />;
}

function Group({ title, icon, items }: { title: string; icon: React.ReactNode; items: Integration[] }) {
  return (
    <Box sx={{ flex: "1 1 320px", minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          mb: 1
        }}>
        {icon}
        <Typography variant="subtitle2" sx={{
          fontWeight: 600
        }}>{title}</Typography>
      </Stack>
      <Stack spacing={1}>
        {items.map((it) => (
          <Stack
            key={it.name}
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              px: 1.5,
              py: 1,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              opacity: it.status === "soon" ? 0.85 : 1
            }}>
            <Typography variant="body2">{it.name}</Typography>
            <StatusChip status={it.status} />
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export default function IntegrationsRoadmap() {
  return (
    <Paper variant="outlined" sx={{ mt: 3, p: 2 }}>
      <Typography variant="subtitle1" sx={{
        fontWeight: 600
      }}>
        Integrations roadmap
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 2
        }}>
        AnchorDesk syncs over public, official APIs. Here's what's live, alpha, and next.
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
        <Group title="Ticket sync (PSA)" icon={<SyncIcon fontSize="small" color="action" />} items={TICKET_SYNC} />
        <Group title="RMM sync" icon={<DevicesIcon fontSize="small" color="action" />} items={RMM_SYNC} />
      </Stack>
    </Paper>
  );
}
