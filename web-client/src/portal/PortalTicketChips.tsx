import { Chip, Stack } from "@mui/material";
import { priorityColor, statusColor } from "../ticketVocab";

export default function PortalTicketChips({
  status,
  priority,
}: {
  status: string;
  priority: string | null;
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
      <Chip size="small" label={status} color={statusColor(status)} />
      {priority && <Chip size="small" variant="outlined" label={priority} color={priorityColor(priority)} />}
    </Stack>
  );
}

