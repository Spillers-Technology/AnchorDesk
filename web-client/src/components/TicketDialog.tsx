import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Typography,
    Box,
  } from "@mui/material";
  import { useState } from "react";
  import { Ticket } from "../interfaces";
  import CloseIcon from "@mui/icons-material/Close";
  import EditIcon from "@mui/icons-material/Edit";
  import SaveIcon from "@mui/icons-material/Save";
  import IconButton from "@mui/material/IconButton";
  
  interface TicketDialogProps {
    ticket: Ticket | null;
    open: boolean;
    onClose: () => void;
  }
  
  const TicketDialog: React.FC<TicketDialogProps> = ({ ticket, open, onClose }) => {
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [editedTitle, setEditedTitle] = useState<string>(ticket?.ticketSummary || "");
  
    if (!ticket) return null;
  
    const handleEditClick = () => {
      setIsEditing(true);
    };
  
    const handleSaveClick = () => {
      setIsEditing(false);
      console.log("New Title:", editedTitle);
    };
  
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center" }}>
          {isEditing ? (
            <TextField
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              variant="outlined"
              fullWidth
            />
          ) : (
            `Ticket #${ticket.ticketnumber} - ${editedTitle}`
          )}
          <IconButton
            aria-label="close"
            onClick={onClose}
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
          {isEditing ? (
            <Button
              variant="contained"
              color="primary"
              onClick={handleSaveClick}
              startIcon={<SaveIcon />}
              sx={{ ml: 2 }}
            >
              Save
            </Button>
          ) : (
            <IconButton aria-label="edit" onClick={handleEditClick} sx={{ ml: 2 }}>
              <EditIcon />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="h6" gutterBottom>
            {ticket.ticketSummary}
          </Typography>
          <Typography variant="body1" gutterBottom>
            Priority: {ticket.priority}
          </Typography>
          <Typography variant="body1" gutterBottom>
            Company: {ticket.company.CompanyName} (Acronym: {ticket.company.Acronym})
          </Typography>
          <Typography variant="body1" gutterBottom>
            Engagement Manager: {ticket.company.PrimaryEngagementMgr}
          </Typography>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1">Technicians:</Typography>
            {ticket.technicians?.length > 0 ? (
              ticket.technicians.map((tech) => (
                <Typography key={tech.TechnicianID} variant="body2">
                  {tech.FirstName} {tech.LastName} ({tech.Username})
                </Typography>
              ))
            ) : (
              <Typography variant="body2" color="textSecondary">
                No technicians available.
              </Typography>
            )}
          </Box>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1">Time Entries:</Typography>
            {ticket.timeEntries?.length > 0 ? (
              ticket.timeEntries.map((entry) => (
                <Box key={entry.TimeEntryID} sx={{ my: 1 }}>
                  <Typography variant="body2">{`Time Start: ${entry.TimeStart}`}</Typography>
                  <Typography variant="body2">{`Time Stop: ${entry.TimeStop}`}</Typography>
                  <Typography variant="body2">{`Note: ${
                    entry.TimeNote?.toString() || "No Note"
                  }`}</Typography>
                  <Typography variant="body2">{`Technician: ${
                    entry.Technician?.FirstName || "N/A"
                  } ${entry.Technician?.LastName || ""}`}</Typography>
                </Box>
              ))
            ) : (
              <Typography variant="body2" color="textSecondary">
                No time entries available.
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="secondary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    );
  };
  
  export default TicketDialog;
  