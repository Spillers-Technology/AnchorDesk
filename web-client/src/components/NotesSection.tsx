// ./components/NotesSection.tsx
import React, { useState } from "react";
import {
  Box,
  List,
  ListItem,
  Typography,
  IconButton,
  TextField,
  Paper,
  Chip,
  Button,
  Stack,
} from "@mui/material";
import { ArrowDownward, ArrowUpward, Edit, Save, Undo } from "@mui/icons-material";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMadeIcon from "@mui/icons-material/CallMade";
import ReplyIcon from "@mui/icons-material/Reply";
import DOMPurify from "dompurify";
import { Note } from "../interfaces";

interface NotesSectionProps {
  notes: Note[];
  sortAscending: boolean;
  toggleSort: () => void;
  canEditNote: (note: Note) => boolean;
  currentUser: any;
  /** When provided, email notes show a Reply action that opens the composer. */
  onReply?: (note: Note) => void;
}

const NotesSection: React.FC<NotesSectionProps> = ({
  notes,
  sortAscending,
  toggleSort,
  canEditNote,
  onReply,
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
          Activity
          {sortAscending ? (
            <ArrowUpward fontSize="small" />
          ) : (
            <ArrowDownward fontSize="small" />
          )}
        </Typography>
      </Box>

      {notes.length > 0 ? (
        <List>
          {sortedNotes.map((note) =>
            note.type === "email" ? (
              <EmailBubble key={note.id} note={note} onReply={onReply} />
            ) : (
              <ListItem key={note.id} divider>
                <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                  <Box sx={{ minWidth: 150 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {new Date(note.dateCreated).toLocaleTimeString()}{" "}
                      {new Date(note.dateCreated).toLocaleDateString()}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {note.authorName}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
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
                      <NoteBody note={note} />
                    )}
                  </Box>
                  {canEditNote(note) && editingNotes[note.id] === undefined && (
                    <IconButton onClick={() => handleEditNote(note.id)}>
                      <Edit />
                    </IconButton>
                  )}
                </Box>
              </ListItem>
            )
          )}
        </List>
      ) : (
        <Typography variant="body2" color="textSecondary">
          No activity yet on this ticket.
        </Typography>
      )}
    </Box>
  );
};

// Shared style for rendered HTML bodies: images never overflow and load lazily,
// so a big inline image doesn't break the timeline layout while it loads.
const HTML_BODY_SX = {
  "& img": { maxWidth: "100%", height: "auto", borderRadius: 1 },
  "& a": { color: "primary.main" },
  "& pre": { whiteSpace: "pre-wrap", overflowX: "auto", bgcolor: "grey.100", p: 1, borderRadius: 1 },
} as const;

/** Render an internal note body: sanitized HTML (script logs, inline images)
 *  when present, else plain text. */
function NoteBody({ note }: { note: Note }) {
  if (note.html) {
    const safe = DOMPurify.sanitize(note.html, { ADD_ATTR: ["loading"] });
    return <Box sx={{ ...HTML_BODY_SX, color: "text.primary" }} dangerouslySetInnerHTML={{ __html: safe }} />;
  }
  return (
    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", color: "text.primary" }}>
      {note.text}
    </Typography>
  );
}

/** A single email rendered as a conversation bubble. Inbound mail aligns left
 *  (neutral), outbound aligns right (accent), so a thread reads like a chat. */
function EmailBubble({ note, onReply }: { note: Note; onReply?: (note: Note) => void }) {
  const outbound = note.direction === "outbound";
  const safeHtml = note.html ? DOMPurify.sanitize(note.html, { ADD_ATTR: ["loading"] }) : null;

  return (
    <ListItem sx={{ display: "flex", justifyContent: outbound ? "flex-end" : "flex-start", px: 0 }}>
      <Paper
        variant="outlined"
        sx={{
          maxWidth: "85%",
          width: "fit-content",
          p: 1.5,
          borderRadius: 2,
          bgcolor: outbound ? "primary.50" : "grey.50",
          borderColor: outbound ? "primary.100" : "divider",
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <Chip
            size="small"
            icon={outbound ? <CallMadeIcon /> : <CallReceivedIcon />}
            label={outbound ? "Sent" : "Received"}
            color={outbound ? "primary" : "default"}
            variant="outlined"
          />
          <Typography variant="caption" color="text.secondary">
            {new Date(note.dateCreated).toLocaleString()}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          <strong>From:</strong> {note.emailFrom || note.authorName}
        </Typography>
        {note.emailTo && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            <strong>To:</strong> {note.emailTo}
          </Typography>
        )}
        {note.subject && (
          <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
            {note.subject}
          </Typography>
        )}
        <Box sx={{ mt: 1, ...HTML_BODY_SX, color: "text.primary" }}>
          {safeHtml ? (
            <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
          ) : (
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              {note.text}
            </Typography>
          )}
        </Box>
        {onReply && (
          <Box sx={{ mt: 1, textAlign: "right" }}>
            <Button size="small" startIcon={<ReplyIcon />} onClick={() => onReply(note)}>
              Reply
            </Button>
          </Box>
        )}
      </Paper>
    </ListItem>
  );
}

export default NotesSection;
