import * as React from "react";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Ticket } from "../interfaces";
import SlaChip from "./SlaChip";
import SyncBadges from "./SyncBadges";
import { PriorityChip, StatusChip } from "./TicketSignals";

interface TicketTableProps {
  tickets: Ticket[];
  /** Total rows across all pages (server-side pagination). */
  rowCount: number;
  /** 0-based current page. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onRowClick: (ticket: Ticket) => void;
  selectionEnabled?: boolean;
  selectedIds?: number[];
  onSelectionChange?: (ids: number[]) => void;
}

const formatDate = (dateString: string | undefined) => {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const columns: GridColDef[] = [
  {
    field: "ticketnumber",
    headerName: "Ticket #",
    width: 110,
    renderCell: (params) => `#${params.value}`,
  },
  { field: "ticketTitle", headerName: "Title", flex: 1, minWidth: 240 },
  { field: "status", headerName: "Status", width: 150, renderCell: (params) => <StatusChip status={String(params.value)} /> },
  { field: "priority", headerName: "Priority", width: 140, renderCell: (params) => <PriorityChip priority={String(params.value || "Medium")} variant="outlined" /> },
  {
    field: "sla",
    headerName: "SLA",
    width: 160,
    sortable: false,
    renderCell: (params) => {
      const t = params.row.ticket as Ticket;
      return (
        <SlaChip
          responseDueAt={t.responseDueAt}
          resolutionDueAt={t.resolutionDueAt}
          firstRespondedAt={t.firstRespondedAt}
          status={t.status}
        />
      );
    },
  },
  {
    field: "sync",
    headerName: "Sync",
    width: 145,
    sortable: false,
    renderCell: (params) => <SyncBadges ticket={params.row.ticket as Ticket} />,
  },
  { field: "companyName", headerName: "Company", width: 200 },
  { field: "dateEntered", headerName: "Created", width: 190 },
];

/**
 * Server-paginated, virtualized ticket table. The grid only ever holds one page
 * of rows in the DOM; paging is driven by the parent (which re-fetches), so this
 * scales to large ticket counts without rendering everything at once.
 */
const TicketTable: React.FC<TicketTableProps> = ({
  tickets,
  rowCount,
  page,
  pageSize,
  onPageChange,
  onRowClick,
  selectionEnabled = false,
  selectedIds = [],
  onSelectionChange,
}) => {
  const rows = tickets.map((ticket) => ({
    id: (ticket as Ticket & { localId?: number }).localId ?? ticket.ticketnumber,
    ticketnumber: ticket.ticketnumber,
    ticketTitle: ticket.ticketTitle,
    status: ticket.status,
    priority: ticket.priority,
    companyName: ticket.company?.CompanyName || "Unknown",
    dateEntered: formatDate(ticket.dateEntered),
    ticket,
  }));

  return (
    <div style={{ height: 640, width: "100%" }}>
      <DataGrid
        rows={rows}
        columns={columns}
        rowCount={rowCount}
        paginationMode="server"
        paginationModel={{ page, pageSize }}
        pageSizeOptions={[pageSize]}
        onPaginationModelChange={(model) => onPageChange(model.page)}
        disableColumnMenu
        checkboxSelection={selectionEnabled}
        disableRowSelectionOnClick
        rowSelectionModel={selectedIds}
        onRowSelectionModelChange={(model) => onSelectionChange?.(model.map(Number))}
        onRowClick={(params) => onRowClick(params.row.ticket)}
        sx={{ "& .MuiDataGrid-row": { cursor: "pointer" } }}
      />
    </div>
  );
};

export default TicketTable;
