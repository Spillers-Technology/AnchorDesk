// ./components/NotesSection.tsx
import React, { useState } from "react";
import {
  Box,
  List,
  ListItem,
  Typography,
  IconButton,
  TextField,
} from "@mui/material";
import { ArrowDownward, ArrowUpward, Edit, Save, Undo } from "@mui/icons-material";
import { Note } from "../interfaces";

interface NotesSectionProps {
  notes: Note[];
  sortAscending: boolean;
  toggleSort: () => void;
  canEditNote: (note: Note) => boolean;
  currentUser: any;
}

const NotesSection: React.FC<NotesSectionProps> = ({
  notes,
  sortAscending,
  toggleSort,
  canEditNote,
}) => {
  const [editingNotes, setEditingNotes] = useState<{ [key: string]: string }>({});

  const sortedNotes = [...notes].sort((a, b) => {
    const dateA = new Date(a.dateCreated).getTime();
    const dateB = new Date(b.dateCreated).getTime();
    return sortAscending ? dateA - dateB : dateB - dateA;
  });

  const handleEditNote = (noteId: string) => {
    setEditingNotes((prev) => ({
      ...prev,
      [noteId]: notes.find((n) => n.id === noteId)?.text || "",
    }));
  };

  const handleSaveNote = (noteId: string) => {
    const newText = editingNotes[noteId];
    console.log(`Saving note ${noteId}:`, newText);
    // Save to backend
    setEditingNotes((prev) => {
      const updated = { ...prev };
      delete updated[noteId];
      return updated;
    });
  };

  const handleRevertNote = (noteId: string) => {
    setEditingNotes((prev) => {
      const updated = { ...prev };
      delete updated[noteId];
      return updated;
    });
  };

  return (
    <Box>
      <Box
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography
          variant="h6"
          onClick={toggleSort}
          sx={{ cursor: "pointer", display: "flex", alignItems: "center" }}
        >
          Notes
          {sortAscending ? (
            <ArrowUpward fontSize="small" />
          ) : (
            <ArrowDownward fontSize="small" />
          )}
        </Typography>
      </Box>

      {notes.length > 0 ? (
        <List>
          {sortedNotes.map((note) => (
            <ListItem key={note.id} divider>
              <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <Box sx={{ minWidth: 150 }}>
                  <Typography variant="body2" sx={{ color: "#333" }}>
                    {new Date(note.dateCreated).toLocaleTimeString()}{" "}
                    {new Date(note.dateCreated).toLocaleDateString()}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#333" }}>
                    {note.authorName}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#333" }}>
                    {note.type === "timeEntry"
                      ? `Time: ${note.minutes != null ? `${note.minutes}m` : `${note.timeStart} - ${note.timeStop}`}`
                      : "Note"}
                  </Typography>
                </Box>
                <Box sx={{ maxWidth: "70%" }}>
                  {editingNotes[note.id] !== undefined ? (
                    <>
                      <TextField
                        multiline
                        fullWidth
                        variant="outlined"
                        value={editingNotes[note.id]}
                        onChange={(e) =>
                          setEditingNotes((prev) => ({
                            ...prev,
                            [note.id]: e.target.value,
                          }))
                        }
                      />
                      <IconButton onClick={() => handleSaveNote(note.id)}>
                        <Save />
                      </IconButton>
                      <IconButton onClick={() => handleRevertNote(note.id)}>
                        <Undo />
                      </IconButton>
                    </>
                  ) : (
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap", color: "#000" }}
                    >
                      {note.text}
                    </Typography>
                  )}
                </Box>
                {canEditNote(note) && editingNotes[note.id] === undefined && (
                  <IconButton onClick={() => handleEditNote(note.id)}>
                    <Edit />
                  </IconButton>
                )}
              </Box>
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="textSecondary">
          No notes available for this ticket.
        </Typography>
      )}
    </Box>
  );
};

export default NotesSection;
