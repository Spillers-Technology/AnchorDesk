import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Stack,
  Chip,
  CircularProgress,
  Alert,
  MenuItem,
  TextField,
  Divider,
} from "@mui/material";
import * as api from "../api/client";

/**
 * Network view — a port of NetViz's radial "firewall hierarchy" over
 * MaterialTicket's local Device inventory. A central node represents the
 * network/probe; devices orbit it, sized by open-port count and colored by
 * status. Click a node for details. Data comes from the local Device table
 * (populated by netviz probes, Tactical sync, or manual entry) — no live
 * NetViz instance required.
 */
interface Device {
  id: number;
  hostname?: string | null;
  displayName?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  vendor?: string | null;
  os?: string | null;
  deviceType?: string | null;
  openPorts?: number[] | null;
  status: string;
  companyName?: string | null;
  source: string;
  probeId?: number | null;
  lastSeenAt?: string | null;
}

interface Probe {
  id: number;
  name: string;
  companyName?: string | null;
  status: string;
  cidr?: string | null;
}

const CENTER = { x: 500, y: 310 };
const VIEW = { w: 1000, h: 620 };

const statusColor = (s: string) =>
  s === "online" ? "#2e7d32" : s === "offline" ? "#9e9e9e" : "#ed6c02";

export default function NetworkView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>("all");
  const [selected, setSelected] = useState<Device | null>(null);

  useEffect(() => {
    Promise.all([api.listDevices({ pageSize: 500 }), api.listProbes()])
      .then(([d, p]) => {
        setDevices(d as Device[]);
        setProbes(p as Probe[]);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Group options: each probe, plus companies that have devices.
  const groups = useMemo(() => {
    const companies = Array.from(
      new Set(devices.map((d) => d.companyName).filter((c): c is string => !!c))
    );
    return { companies, probes };
  }, [devices, probes]);

  const filtered = useMemo(() => {
    if (group === "all") return devices;
    if (group.startsWith("probe:")) {
      const id = Number(group.slice(6));
      return devices.filter((d) => d.probeId === id);
    }
    if (group.startsWith("company:")) {
      const name = group.slice(8);
      return devices.filter((d) => d.companyName === name);
    }
    return devices;
  }, [devices, group]);

  const layout = useMemo(() => radialLayout(filtered), [filtered]);
  const centerLabel =
    group.startsWith("probe:")
      ? probes.find((p) => `probe:${p.id}` === group)?.name ?? "Network"
      : group.startsWith("company:")
      ? group.slice(8)
      : "Network";

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Typography variant="h5">Network</Typography>
        <TextField select size="small" label="View" value={group} onChange={(e) => setGroup(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="all">All devices ({devices.length})</MenuItem>
          {groups.probes.length > 0 && <Divider />}
          {groups.probes.map((p) => (
            <MenuItem key={`probe:${p.id}`} value={`probe:${p.id}`}>Probe: {p.name}</MenuItem>
          ))}
          {groups.companies.map((c) => (
            <MenuItem key={`company:${c}`} value={`company:${c}`}>Company: {c}</MenuItem>
          ))}
        </TextField>
      </Stack>

      {devices.length === 0 ? (
        <Alert severity="info">
          No devices yet. Register a netviz probe (Admin → Probes), sync from Tactical RMM, or add a device manually — they'll appear here as a network map.
        </Alert>
      ) : (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <Paper variant="outlined" sx={{ flex: 1, p: 1, position: "relative", bgcolor: "#0b1020", borderRadius: 2, minHeight: 420 }}>
            <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} width="100%" style={{ display: "block" }}>
              {/* edges */}
              {layout.map((n) => (
                <line key={`e-${n.device.id}`} x1={CENTER.x} y1={CENTER.y} x2={n.x} y2={n.y} stroke="#27314f" strokeWidth={1} />
              ))}
              {/* center node */}
              <g>
                <circle cx={CENTER.x} cy={CENTER.y} r={38} fill="#1976d2" stroke="#90caf9" strokeWidth={2} />
                <text x={CENTER.x} y={CENTER.y - 2} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700}>
                  {centerLabel.length > 10 ? centerLabel.slice(0, 9) + "…" : centerLabel}
                </text>
                <text x={CENTER.x} y={CENTER.y + 14} textAnchor="middle" fill="#bbdefb" fontSize={11}>
                  {filtered.length} hosts
                </text>
              </g>
              {/* device nodes */}
              {layout.map((n) => {
                const isSel = selected?.id === n.device.id;
                const r = n.size / 2;
                return (
                  <g key={n.device.id} style={{ cursor: "pointer" }} onClick={() => setSelected(n.device)}>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={r}
                      fill={statusColor(n.device.status)}
                      stroke={isSel ? "#fff" : "#0b1020"}
                      strokeWidth={isSel ? 3 : 1.5}
                      opacity={n.device.status === "offline" ? 0.55 : 1}
                    >
                      <title>{`${label(n.device)} — ${n.device.ipAddress ?? ""} (${n.device.status})`}</title>
                    </circle>
                    <text x={n.x} y={n.y + 4} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>
                      {initial(n.device)}
                    </text>
                    {!!(n.device.openPorts?.length) && (
                      <text x={n.x + r - 1} y={n.y - r + 3} textAnchor="middle" fill="#fff" fontSize={9}>
                        {n.device.openPorts.length}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <LegendOverlay />
          </Paper>

          <DeviceDetail device={selected ?? layout[0]?.device ?? null} probes={probes} />
        </Stack>
      )}
    </Box>
  );
}

function LegendOverlay() {
  const items = [
    { c: "#2e7d32", l: "online" },
    { c: "#ed6c02", l: "unknown" },
    { c: "#9e9e9e", l: "offline" },
  ];
  return (
    <Box sx={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 1.5 }}>
      {items.map((i) => (
        <Box key={i.l} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: i.c }} />
          <Typography variant="caption" sx={{ color: "#cfd8ec" }}>{i.l}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function DeviceDetail({ device, probes }: { device: Device | null; probes: Probe[] }) {
  if (!device) return null;
  const probe = probes.find((p) => p.id === device.probeId);
  const rows: [string, string | number | null | undefined][] = [
    ["IP", device.ipAddress],
    ["Hostname", device.hostname],
    ["MAC", device.macAddress],
    ["Vendor", device.vendor],
    ["OS", device.os],
    ["Type", device.deviceType],
    ["Open ports", device.openPorts?.length ? device.openPorts.join(", ") : "none"],
    ["Company", device.companyName],
    ["Source", device.source],
    ["Probe", probe?.name],
    ["Last seen", device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "—"],
  ];
  return (
    <Paper variant="outlined" sx={{ width: { xs: "100%", md: 320 }, p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h6" noWrap>{label(device)}</Typography>
        <Chip size="small" label={device.status} sx={{ bgcolor: statusColor(device.status), color: "#fff" }} />
      </Stack>
      <Divider sx={{ my: 1 }} />
      <Stack spacing={0.75}>
        {rows.map(([k, v]) => (
          <Box key={k} sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
            <Typography variant="body2" color="text.secondary">{k}</Typography>
            <Typography variant="body2" sx={{ textAlign: "right", wordBreak: "break-all" }}>{v ?? "—"}</Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function label(d: Device): string {
  return d.displayName || d.hostname || d.ipAddress || `device ${d.id}`;
}
function initial(d: Device): string {
  const t = (d.deviceType || label(d)).replace(/[^a-z0-9]/gi, "");
  return (t[0] || "?").toUpperCase();
}
function deviceScore(d: Device): number {
  return (d.openPorts?.length ?? 0) * 2 + (d.status === "online" ? 3 : 0) + (d.macAddress ? 1 : 0);
}

/** Radial ring layout — ported from netviz's hierarchyLayout. */
function radialLayout(devices: Device[]) {
  const sorted = [...devices].sort((a, b) => deviceScore(b) - deviceScore(a));
  return sorted.map((device, index) => {
    const ringIndex = Math.floor((Math.sqrt(index + 1) - 1) / 1.55);
    const ringStart = Math.max(0, Math.floor((ringIndex * 1.55 + 1) ** 2) - 1);
    const ringCapacity = Math.max(12, Math.ceil(18 + ringIndex * 14));
    const position = index - ringStart;
    const angle = (position / ringCapacity) * Math.PI * 2 - Math.PI / 2 + ringIndex * 0.21;
    const radius = Math.min(286, 92 + ringIndex * 44);
    const size = Math.max(20, Math.min(40, 22 + (device.openPorts?.length ?? 0) * 3));
    return {
      device,
      x: CENTER.x + Math.cos(angle) * radius,
      y: CENTER.y + Math.sin(angle) * radius,
      size,
    };
  });
}
