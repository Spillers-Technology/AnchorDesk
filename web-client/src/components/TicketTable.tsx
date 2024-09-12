import * as React from "react";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Ticket } from "../interfaces";

interface TicketTableProps {
  tickets: Ticket[];
  onRowClick: (ticket: Ticket) => void;
}

// Helper function to format date strings
const formatDate = (dateString: string | undefined) => {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const TicketTable: React.FC<TicketTableProps> = ({ tickets, onRowClick }) => {
  const columns: GridColDef[] = [
    { field: "ticketnumber", headerName: "Ticket #", width: 150 },
    { field: "ticketTitle", headerName: "Title", width: 300 },
    { field: "status", headerName: "Status", width: 150 },
    { field: "priority", headerName: "Priority", width: 150 },
    { field: "companyName", headerName: "Company", width: 200 },
    { field: "dateEntered", headerName: "Date Entered", width: 200 },
  ];

  const rows = tickets.map((ticket, idx) => ({
    id: idx,
    ticketnumber: ticket.ticketnumber,
    ticketTitle: ticket.ticketTitle,
    status: ticket.status,
    priority: ticket.priority,
    companyName: ticket.company?.CompanyName || "Unknown",
    dateEntered: formatDate(ticket.dateEntered),
    ticket,
  }));

  return (
    <div style={{ height: 400, width: "100%" }}>
      <DataGrid rows={rows} columns={columns} onRowClick={(params) => onRowClick(params.row.ticket)} />
    </div>
  );
};

export default TicketTable;
