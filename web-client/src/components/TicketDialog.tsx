import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  TextField,
  Chip,
} from "@mui/material";
import { Ticket } from "../interfaces";
import NotesSection from "./NotesSection";
import EditableField from "./EditableField";

const priorityColors = {
  "High": "#f44336",
  "Medium": "#ff9800",
  "Low": "#4caf50",
};

const statusColors = {
  "New": "#1976d2",
  "In Progress": "#ff9800",
  "Waiting on Customer": "#f44336",
  "Closed": "#4caf50",
  "Escalated": "#9c27b0",
};

interface TicketDialogProps {
  ticket: Ticket | null;
  open: boolean;
  onClose: () => void;
  shortenedSummary: string;
  notes: any[];
}

const TicketDialog: React.FC<TicketDialogProps> = ({
  ticket,
  open,
  onClose,
  shortenedSummary,
  notes,
}) => {
  if (!ticket) return null;

  const priorityColor = priorityColors[ticket.priority] || "#1976d2";
  const statusColor = statusColors[ticket.status] || "#1976d2";

  const [editableTitle, setEditableTitle] = useState(ticket.ticketTitle);
  const [editableFields, setEditableFields] = useState({
    priority: ticket.priority,
    company: ticket.company.CompanyName,
  });

  const [contacts, setContacts] = useState<string[]>([ticket.submitterEmail || ""]);
  const [newNote, setNewNote] = useState<string>("");

  const [isEditing, setIsEditing] = useState({
    title: false,
    priority: false,
    company: false,
  });

  const [sortAscending, setSortAscending] = useState(true);

  useEffect(() => {
    if (ticket) {
      setEditableFields({
        priority: ticket.priority,
        company: ticket.company.CompanyName,
      });
      setEditableTitle(ticket.ticketTitle);
      setContacts([ticket.submitterEmail || ""]);
    }
  }, [ticket]);

  const handleEdit = (field: keyof typeof isEditing) => setIsEditing((prev) => ({ ...prev, [field]: true }));

  const handleRevert = (field: keyof typeof isEditing) => {
    if (field === "title") {
      setEditableTitle(ticket.ticketTitle);
    } else {
      setEditableFields((prev) => ({
        ...prev,
        [field]: ticket[field as keyof typeof editableFields],
      }));
    }
    setIsEditing((prev) => ({ ...prev, [field]: false }));
  };

  const handleSave = (field: keyof typeof editableFields) => {
    setIsEditing((prev) => ({ ...prev, [field]: false }));
    console.log(`Saved ${field}:`, field === "title" ? editableTitle : editableFields[field]);
  };

  const toggleSort = () => setSortAscending(!sortAscending);

  const handleAddContact = (newContact: string) => {
    setContacts((prev) => [...prev, newContact]);
  };

  const handleSubmitNote = () => {
    console.log("Submitting new note:", newNote);
    console.log("Sending to contacts:", contacts);
    setNewNote("");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      sx={{ "& .MuiDialog-paper": { minHeight: "90vh", maxHeight: "95vh" } }}
    >
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Ticket Info */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <EditableField
              label="Title"
              value={editableTitle}
              isEditing={isEditing.title}
              onEdit={() => handleEdit("title")}
              onSave={() => handleSave("title")}
              onRevert={() => handleRevert("title")}
              onChange={setEditableTitle}
            />
            <Chip label={ticket.status} sx={{ backgroundColor: statusColor, color: "#fff", fontWeight: "bold" }} />
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
            <EditableField
              label="Priority"
              value={editableFields.priority}
              color={priorityColor}
              isEditing={isEditing.priority}
              onEdit={() => handleEdit("priority")}
              onSave={() => handleSave("priority")}
              onRevert={() => handleRevert("priority")}
              onChange={(value) => setEditableFields((prev) => ({ ...prev, priority: value }))}
            />

            <EditableField
              label="Company"
              value={editableFields.company}
              isEditing={isEditing.company}
              onEdit={() => handleEdit("company")}
              onSave={() => handleSave("company")}
              onRevert={() => handleRevert("company")}
              onChange={(value) => setEditableFields((prev) => ({ ...prev, company: value }))}
            />
          </Box>
        </Box>

        {/* Notes Section (Single Scrollable Area) */}
        <Box sx={{ flex: 1, overflowY: "auto", mb: 2 }}>
          <NotesSection notes={notes} sortAscending={sortAscending} toggleSort={toggleSort} />
        </Box>

        {/* New Note Section */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            Add New Note
          </Typography>
          <TextField
            label="New Note"
            multiline
            rows={4}
            fullWidth
            variant="outlined"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            sx={{ mb: 2 }}
          />
        </Box>

        {/* Contacts Section with Submit Button */}
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <TextField
            label="Add Contact"
            variant="outlined"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.currentTarget.value) {
                handleAddContact(e.currentTarget.value);
                e.currentTarget.value = ""; // Clear input after adding
              }
            }}
            sx={{ mr: 2 }}
          />
          <Button variant="contained" color="primary" onClick={handleSubmitNote}>
            Submit Note
          </Button>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TicketDialog;
