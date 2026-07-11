import { Box, Chip, Stack, Typography, type ChipProps } from "@mui/material";
import CircleIcon from "@mui/icons-material/Circle";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import DragHandleIcon from "@mui/icons-material/DragHandle";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import PriorityHighIcon from "@mui/icons-material/PriorityHigh";
import { priorityColor, statusColor } from "../ticketVocab";

const tone = (color: ChipProps["color"]) => color === "default" ? "text.secondary" : `${color}.main`;

function PriorityIcon({ priority }: { priority: string }) {
  const props = { fontSize: "small" as const, sx: { color: tone(priorityColor(priority)) } };
  if (priority === "Critical") return <PriorityHighIcon {...props} />;
  if (priority === "High") return <ArrowUpwardIcon {...props} />;
  if (priority === "Low") return <KeyboardArrowDownIcon {...props} />;
  return <DragHandleIcon {...props} />;
}

export function StatusSignal({ status }: { status: string }) {
  return (
    <Stack component="span" direction="row" spacing={1} alignItems="center">
      <Box
        component="span"
        sx={{ width: 9, height: 9, flex: "0 0 auto", borderRadius: "50%", bgcolor: tone(statusColor(status)) }}
      />
      <Typography component="span" variant="body2">{status}</Typography>
    </Stack>
  );
}

export function PrioritySignal({ priority }: { priority: string }) {
  return (
    <Stack component="span" direction="row" spacing={0.75} alignItems="center">
      <PriorityIcon priority={priority} />
      <Typography component="span" variant="body2">{priority}</Typography>
    </Stack>
  );
}

export function StatusChip({ status, ...props }: { status: string } & Omit<ChipProps, "label" | "color">) {
  return <Chip size="small" icon={<CircleIcon sx={{ fontSize: "10px !important" }} />} label={status} color={statusColor(status)} {...props} />;
}

export function PriorityChip({ priority, ...props }: { priority: string } & Omit<ChipProps, "label" | "color">) {
  const value = priority || "Medium";
  return <Chip size="small" icon={<PriorityIcon priority={value} />} label={value} color={priorityColor(value)} {...props} />;
}
