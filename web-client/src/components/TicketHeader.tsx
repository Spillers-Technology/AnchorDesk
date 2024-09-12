import React from 'react';
import { Typography, Chip, IconButton, TextField } from '@mui/material';
import { Edit, Save, Undo } from '@mui/icons-material';

interface TicketHeaderProps {
  ticketNumber: string;
  title: string;
  status: string;
  statusColor: string;
  isEditing: boolean;
  onSave: (newTitle: string) => void;
  onRevert: () => void;
  onEdit: () => void;
  editableTitle: string;
  setEditableTitle: (value: string) => void;
}

const TicketHeader: React.FC<TicketHeaderProps> = ({
  ticketNumber,
  title,
  status,
  statusColor,
  isEditing,
  onSave,
  onRevert,
  onEdit,
  editableTitle,
  setEditableTitle,
}) => {
  return (
    <>
      <Typography variant="body1">
        <b>Ticket #{ticketNumber}</b>:
        {isEditing ? (
          <>
            <TextField
              variant="outlined"
              value={editableTitle}
              onChange={(e) => setEditableTitle(e.target.value)}
              fullWidth
            />
            <IconButton onClick={() => onSave(editableTitle)}>
              <Save />
            </IconButton>
            <IconButton onClick={onRevert}>
              <Undo />
            </IconButton>
          </>
        ) : (
          <>
            {title}
            <IconButton onClick={onEdit}>
              <Edit />
            </IconButton>
          </>
        )}
      </Typography>
      <Chip label={status} sx={{ backgroundColor: statusColor, color: "#fff", fontWeight: "bold" }} />
    </>
  );
};

export default TicketHeader;
