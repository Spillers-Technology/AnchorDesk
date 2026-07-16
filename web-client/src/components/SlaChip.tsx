import { useEffect, useState } from "react";
import { Chip, Tooltip } from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";

/**
 * Reactive SLA indicator. Shows the soonest active deadline (response until the
 * first reply, then resolution) as a live countdown that recolors as it nears
 * and passes due. Renders nothing when no SLA applies or the ticket is closed.
 */
interface SlaChipProps {
  responseDueAt?: string | null;
  resolutionDueAt?: string | null;
  /** Manual deadline; overrides only the resolution clock, not response SLA. */
  dueAt?: string | null;
  firstRespondedAt?: string | null;
  status?: string;
  size?: "small" | "medium";
}

const TERMINAL = ["Closed", "Resolved", "Completed", "Cancelled", "Deleted"];

function fmtDelta(ms: number): string {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h < 24) return `${h}h${min ? ` ${min}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export interface ActiveDeadline {
  kind: "Response" | "Resolution" | "Deadline";
  due: string;
  manual: boolean;
}

/** Pick the active clock while keeping the response SLA independent. */
export function activeDeadline({
  responseDueAt,
  resolutionDueAt,
  dueAt,
  firstRespondedAt,
}: Pick<SlaChipProps, "responseDueAt" | "resolutionDueAt" | "dueAt" | "firstRespondedAt">): ActiveDeadline | null {
  if (!firstRespondedAt && responseDueAt) {
    return { kind: "Response", due: responseDueAt, manual: false };
  }
  if (dueAt) return { kind: "Deadline", due: dueAt, manual: true };
  if (resolutionDueAt) return { kind: "Resolution", due: resolutionDueAt, manual: false };
  return null;
}

export default function SlaChip({ responseDueAt, resolutionDueAt, dueAt, firstRespondedAt, status, size = "small" }: SlaChipProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (status && TERMINAL.includes(status)) return null;

  // Active clock: response until the first reply lands, then the manual
  // deadline when present, otherwise the policy-derived resolution target.
  const clock = activeDeadline({ responseDueAt, resolutionDueAt, dueAt, firstRespondedAt });
  if (!clock) return null;

  const dueTime = new Date(clock.due).getTime();
  if (!Number.isFinite(dueTime)) return null;
  const remaining = dueTime - now;
  const breached = remaining < 0;
  const warning = !breached && remaining < 60 * 60_000; // within an hour

  const color = breached ? "error" : warning ? "warning" : "success";
  const label = breached ? `${clock.kind} overdue ${fmtDelta(remaining)}` : `${clock.kind} ${fmtDelta(remaining)}`;
  const tip = `${clock.manual ? "Manual deadline" : `${clock.kind} SLA`} ${breached ? "breached" : "due"} ${new Date(clock.due).toLocaleString()}`;

  return (
    <Tooltip title={tip}>
      <Chip size={size} color={color} variant={breached ? "filled" : "outlined"} icon={<AccessTimeIcon />} label={label} />
    </Tooltip>
  );
}
