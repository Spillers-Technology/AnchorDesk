import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from "@mui/material";
import { useState } from "react";
import { Ticket } from "../interfaces";

interface FilterDialogProps {
  open: boolean;
  onClose: () => void;
  tickets: Ticket[];
  applyFilters: (filtered: Ticket[]) => void;
}

const FilterDialog: React.FC<FilterDialogProps> = ({ open, onClose, tickets, applyFilters }) => {
  const [filter, setFilter] = useState({
    ticketnumber: "",
    ticketSummary: "",
    priority: "",
    companyName: "",
    engagementManager: "",
    timeEntryFilter: "",
  });

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter({
      ...filter,
      [e.target.name]: e.target.value,
    });
  };

  const applyFilter = () => {
    const filtered = tickets.filter((ticket) => {
      // Regex filtering for each field
      try {
        const ticketNumberMatch = new RegExp(filter.ticketnumber, "i").test(ticket.ticketnumber.toString());
        const summaryMatch = new RegExp(filter.ticketSummary, "i").test(ticket.ticketSummary);
        const priorityMatch = new RegExp(filter.priority, "i").test(ticket.priority);
        const companyMatch = new RegExp(filter.companyName, "i").test(ticket.company.CompanyName);
        const engagementManagerMatch = new RegExp(filter.engagementManager, "i").test(ticket.company.PrimaryEngagementMgr);

        // Time Entry Filter
        const timeEntryMatch =
          filter.timeEntryFilter === ""
            ? true
            : ticket.timeEntries?.some((entry) =>
                new RegExp(filter.timeEntryFilter, "i").test(`${entry.TimeStart} ${entry.TimeStop} ${entry.TimeNote}`)
              ) || false;

        return ticketNumberMatch && summaryMatch && priorityMatch && companyMatch && engagementManagerMatch && timeEntryMatch;
      } catch (err) {
        console.error("Error applying filters: ", err);
        return false;
      }
    });

    applyFilters(filtered);
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Filter Tickets</DialogTitle>
      <DialogContent>
        <TextField margin="dense" name="ticketnumber" label="Ticket Number" fullWidth value={filter.ticketnumber} onChange={handleFilterChange} />
        <TextField margin="dense" name="ticketSummary" label="Ticket Summary" fullWidth value={filter.ticketSummary} onChange={handleFilterChange} />
        <TextField margin="dense" name="priority" label="Priority" fullWidth value={filter.priority} onChange={handleFilterChange} />
        <TextField margin="dense" name="companyName" label="Company Name" fullWidth value={filter.companyName} onChange={handleFilterChange} />
        <TextField
          margin="dense"
          name="engagementManager"
          label="Engagement Manager"
          fullWidth
          value={filter.engagementManager}
          onChange={handleFilterChange}
        />
        <TextField
          margin="dense"
          name="timeEntryFilter"
          label="Time Entry Info"
          fullWidth
          value={filter.timeEntryFilter}
          onChange={handleFilterChange}
          helperText="Filter by time entry details like TimeStart, TimeStop, or Notes."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={applyFilter} variant="contained" color="primary">
          Apply Filters
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FilterDialog;
