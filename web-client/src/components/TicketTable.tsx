import * as React from "react";
import { Chip, Stack, Typography } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { Ticket } from "../interfaces";
import type { CustomFieldDef } from "../api/client";
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
  customFieldDefs?: CustomFieldDef[];
}

const formatDate = (dateString: string | undefined) => {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const formatCustomField = (value: unknown) => {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const customFieldColumn = (key: string) => `custom_${key}`;

function buildColumns(customFieldDefs: CustomFieldDef[]): GridColDef[] {
  return [
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
      field: "dueAt",
      headerName: "Due",
      width: 190,
      renderCell: (params) => {
        const ticket = params.row.ticket as Ticket;
        const due = ticket.dueAt ?? ticket.resolutionDueAt;
        if (!due) return "—";
        return (
          <Stack spacing={0.25} sx={{ py: 0.5 }}>
            <Typography variant="body2">{formatDate(due)}</Typography>
            {ticket.dueAt && <Chip size="small" color="info" variant="outlined" label="Manual" sx={{ width: "fit-content", height: 20 }} />}
          </Stack>
        );
      },
    },
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
            dueAt={t.dueAt}
            firstRespondedAt={t.firstRespondedAt}
            status={t.status}
          />
        );
      },
    },
    {
      field: "teamName",
      headerName: "Team",
      width: 160,
      renderCell: (params) => params.value
        ? <Chip size="small" variant="outlined" label={String(params.value)} />
        : "—",
    },
    {
      field: "sync",
      headerName: "Sync",
      width: 145,
      sortable: false,
      renderCell: (params) => <SyncBadges ticket={params.row.ticket as Ticket} />,
    },
    { field: "companyName", headerName: "Company", width: 200 },
    ...customFieldDefs.map<GridColDef>((def) => ({
      field: customFieldColumn(def.key),
      headerName: def.label,
      minWidth: def.type === "boolean" ? 110 : 150,
      flex: def.type === "text" ? 0.5 : undefined,
    })),
    { field: "dateEntered", headerName: "Created", width: 190 },
  ];
}

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
  customFieldDefs = [],
}) => {
  const rows = tickets.map((ticket) => ({
    id: (ticket as Ticket & { localId?: number }).localId ?? ticket.ticketnumber,
    ticketnumber: ticket.ticketnumber,
    ticketTitle: ticket.ticketTitle,
    status: ticket.status,
    priority: ticket.priority,
    dueAt: ticket.dueAt ?? ticket.resolutionDueAt ?? "",
    teamName: ticket.team?.name ?? "",
    companyName: ticket.company?.CompanyName || "Unknown",
    dateEntered: formatDate(ticket.dateEntered),
    ...Object.fromEntries(
      customFieldDefs.map((def) => [customFieldColumn(def.key), formatCustomField(ticket.customFields?.[def.key])])
    ),
    ticket,
  }));
  const columns = buildColumns(customFieldDefs);

  // x-data-grid v9 models selection as { type: 'include' | 'exclude', ids: Set }
  // instead of a flat id array. The parent keeps its number[] contract, so map
  // both directions here: selectedIds → an include-set, and a change event back
  // to concrete row ids (an exclude-set enumerates against the current page's
  // rows, which is all the grid can select — paging is server-side).
  const selectionModel: GridRowSelectionModel = {
    type: "include",
    ids: new Set(selectedIds),
  };
  const handleSelectionModelChange = (model: GridRowSelectionModel) => {
    if (!onSelectionChange) return;
    const ids =
      model.type === "include"
        ? Array.from(model.ids, Number)
        : rows.map((r) => Number(r.id)).filter((id) => !model.ids.has(id));
    onSelectionChange(ids);
  };

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
        rowSelectionModel={selectionModel}
        onRowSelectionModelChange={handleSelectionModelChange}
        onRowClick={(params) => onRowClick(params.row.ticket)}
        sx={{ "& .MuiDataGrid-row": { cursor: "pointer" } }}
      />
    </div>
  );
};

export default TicketTable;
