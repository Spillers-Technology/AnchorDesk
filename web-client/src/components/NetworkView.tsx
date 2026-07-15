import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Chip, CircularProgress, Divider, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import * as api from "../api/client";
import { serviceName } from "../deviceServices";
import { NetworkMap, type NetworkMapDevice } from "./NetworkMap";
import { StatusChip } from "./TicketSignals";

interface LinkedTicket { id: number; title: string; status: string }

interface Device {
  id: number;
  hostname?: string | null;
  displayName?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  vendor?: string | null;
  deviceType?: string | null;
  openPorts?: unknown;
  status: string;
  companyName?: string | null;
  source: string;
  probeId?: number | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

interface Probe {
  id: number;
  name: string;
  companyName?: string | null;
  status: string;
  cidr?: string | null;
}

function portNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === "number" ? entry : Number((entry as { port?: unknown })?.port))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

function toMapDevice(device: Device): NetworkMapDevice | null {
  if (!device.ipAddress) return null;
  const ports = portNumbers(device.openPorts);
  return {
    ip: device.ipAddress,
    hostname: device.displayName || device.hostname || undefined,
    mac_address: device.macAddress || undefined,
    vendor: device.vendor || undefined,
    alive: device.status === "online",
    open_ports: ports.map((port) => ({ port, service: serviceName(port) })),
    device_type: device.deviceType || "unknown",
    first_seen: device.firstSeenAt || device.lastSeenAt || new Date(0).toISOString(),
    last_updated: device.lastSeenAt || device.firstSeenAt || new Date(0).toISOString(),
  };
}

export default function NetworkView({ initialCompany }: { initialCompany?: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState(initialCompany ? `company:${initialCompany}` : "all");
  const [selected, setSelected] = useState<Device | null>(null);
  const [deviceTickets, setDeviceTickets] = useState<LinkedTicket[]>([]);

  useEffect(() => {
    if (initialCompany) setGroup(`company:${initialCompany}`);
  }, [initialCompany]);

  useEffect(() => {
    Promise.all([api.listDevices({ pageSize: 500 }), api.listProbes()])
      .then(([deviceRows, probeRows]) => {
        setDevices(deviceRows as Device[]);
        setProbes(probeRows as Probe[]);
      })
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => ({
    companies: Array.from(new Set(devices.map((device) => device.companyName).filter((name): name is string => !!name))),
    probes,
  }), [devices, probes]);

  const filtered = useMemo(() => {
    if (group.startsWith("probe:")) {
      const id = Number(group.slice(6));
      return devices.filter((device) => device.probeId === id);
    }
    if (group.startsWith("company:")) {
      const name = group.slice(8);
      return devices.filter((device) => device.companyName === name);
    }
    return devices;
  }, [devices, group]);

  const mapped = useMemo(
    () => filtered.map(toMapDevice).filter((device): device is NetworkMapDevice => device !== null),
    [filtered],
  );

  const mapLabel = group.startsWith("probe:")
    ? probes.find((probe) => `probe:${probe.id}` === group)?.cidr
      || probes.find((probe) => `probe:${probe.id}` === group)?.name
      || "Network"
    : group.startsWith("company:") ? group.slice(8) : "All networks";

  const selectDevice = useCallback((ip: string | null) => {
    setSelected(ip ? filtered.find((device) => device.ipAddress === ip) ?? null : null);
  }, [filtered]);

  useEffect(() => {
    if (!selected) {
      setDeviceTickets([]);
      return;
    }
    api.getDevice(selected.id)
      .then((row) => {
        const links = (row as unknown as { ticketLinks?: { ticket: LinkedTicket }[] }).ticketLinks ?? [];
        setDeviceTickets(links.map((link) => link.ticket));
      })
      .catch(() => setDeviceTickets([]));
  }, [selected]);

  if (loading) return <CircularProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5">Network</Typography>
          <Typography variant="body2" color="text.secondary">
            Device type, open services, and availability at a glance
          </Typography>
        </Box>
        <TextField select size="small" label="View" value={group} onChange={(event) => { setGroup(event.target.value); setSelected(null); }} sx={{ minWidth: { xs: "100%", sm: 230 } }}>
          <MenuItem value="all">All devices ({devices.length})</MenuItem>
          {groups.probes.length > 0 && <Divider />}
          {groups.probes.map((probe) => <MenuItem key={`probe:${probe.id}`} value={`probe:${probe.id}`}>Probe: {probe.name}</MenuItem>)}
          {groups.companies.map((company) => <MenuItem key={`company:${company}`} value={`company:${company}`}>Company: {company}</MenuItem>)}
        </TextField>
      </Stack>

      {devices.length === 0 ? (
        <Alert severity="info">No devices yet. Register a netviz probe, sync an RMM, or add a device manually.</Alert>
      ) : mapped.length === 0 ? (
        <Alert severity="warning">The devices in this view do not have IP addresses, so they cannot be placed on the map.</Alert>
      ) : (
        <>
          <NetworkMap devices={mapped} cidr={mapLabel} onSelectDevice={selectDevice} />
          {selected && (
            <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
              <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={2}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={700}>{selected.displayName || selected.hostname || selected.ipAddress}</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                    <Chip size="small" label={selected.companyName || "Unassigned company"} />
                    <Chip size="small" label={selected.source} variant="outlined" />
                  </Stack>
                </Box>
                <Box sx={{ minWidth: { sm: 320 } }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Linked tickets {deviceTickets.length > 0 && `(${deviceTickets.length})`}
                  </Typography>
                  {deviceTickets.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No linked tickets.</Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {deviceTickets.map((ticket) => (
                        <Stack key={ticket.id} direction="row" alignItems="center" spacing={1}>
                          <StatusChip status={ticket.status} />
                          <Typography variant="body2" noWrap>#{ticket.id} {ticket.title}</Typography>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
