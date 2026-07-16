// ./components/NotesSection.tsx
import React, { useState } from "react";
import {
  Box,
  List,
  ListItem,
  Typography,
  IconButton,
  Paper,
  Chip,
  Button,
  Stack,
  Alert,
  Tooltip,
} from "@mui/material";
import { ArrowDownward, ArrowUpward, Edit, Save, Undo } from "@mui/icons-material";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMadeIcon from "@mui/icons-material/CallMade";
import ReplyIcon from "@mui/icons-material/Reply";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { Note } from "../interfaces";
import { isRichTextEmpty, toEditorHtml } from "../html";
import HtmlContent from "./HtmlContent";
import RichTextEditor from "./RichTextEditor";

interface NotesSectionProps {
  notes: Note[];
  sortAscending: boolean;
  toggleSort: () => void;
  canEditNote: (note: Note) => boolean;
  currentUser: any;
  /** When provided, email notes show a Reply action that opens the composer. */
  onReply?: (note: Note) => void;
  onEditNote?: (note: Note, html: string) => Promise<void> | void;
}

const NotesSection: React.FC<NotesSectionProps> = ({
  notes,
  sortAscending,
  toggleSort,
  canEditNote,
  onReply,
  onEditNote,
}) => {
  const [editingNotes, setEditingNotes] = useState<{ [key: string]: string }>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const sortedNotes = [...notes].sort((a, b) => {
    const dateA = new Date(a.dateCreated).getTime();
    const dateB = new Date(b.dateCreated).getTime();
    return sortAscending ? dateA - dateB : dateB - dateA;
  });

  const handleEditNote = (note: Note) => {
    setEditingNotes((prev) => ({
      ...prev,
      [note.id]: toEditorHtml(note.html ?? note.text),
    }));
  };

  const handleSaveNote = async (note: Note) => {
    const html = editingNotes[note.id] ?? "";
    if (isRichTextEmpty(html)) return;
    setSavingNote(note.id);
    setEditError(null);
    try {
      await onEditNote?.(note, html);
      setEditingNotes((prev) => {
        const updated = { ...prev };
        delete updated[note.id];
        return updated;
      });
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingNote(null);
    }
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
      {editError && <Alert severity="error" sx={{ mb: 1 }}>{editError}</Alert>}
      {notes.length > 0 ? (
        <List
          disablePadding
          sx={{
            position: "relative",
            "&:before": {
              content: '""',
              position: "absolute",
              left: 7,
              top: 12,
              bottom: 12,
              width: 2,
              bgcolor: "divider",
            },
          }}
        >
          {sortedNotes.map((note) =>
            note.type === "email" ? (
              <EmailBubble key={note.id} note={note} onReply={onReply} />
            ) : (
              <ListItem
                key={note.id}
                alignItems="flex-start"
                sx={{ pl: 3, pr: 0, py: 1.5, position: "relative", borderBottom: 1, borderColor: "divider", "&:before": { content: '""', position: "absolute", left: 2, top: 23, width: 12, height: 12, borderRadius: "50%", bgcolor: note.type === "timeEntry" ? "secondary.main" : "primary.main", border: 2, borderColor: "background.paper", zIndex: 1 } }}
              >
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ width: "100%" }}>
                  <Box sx={{ width: { sm: 145 }, flexShrink: 0 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {new Date(note.dateCreated).toLocaleTimeString()}{" "}
                      {new Date(note.dateCreated).toLocaleDateString()}
                    </Typography>
                    <Typography component="div" variant="body2" sx={{ color: "text.secondary" }}>
                      {note.authorName.startsWith("automation:") ? (
                        <Chip
                          size="small"
                          color="secondary"
                          variant="outlined"
                          icon={<AutoFixHighIcon />}
                          label={`Automation · ${note.authorName.slice("automation:".length) || "Unnamed rule"}`}
                          sx={{ maxWidth: "100%", "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }}
                        />
                      ) : note.authorName}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {note.type === "timeEntry"
                        ? `Time: ${note.minutes != null ? `${note.minutes}m` : `${note.timeStart} - ${note.timeStop}`}`
                        : "Note"}
                    </Typography>
                  </Box>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    {editingNotes[note.id] !== undefined ? (
                      <Stack spacing={1}>
                        <RichTextEditor
                          value={editingNotes[note.id]}
                          onChange={(html) =>
                            setEditingNotes((prev) => ({
                              ...prev,
                              [note.id]: html,
                            }))
                          }
                          minHeight={140}
                        />
                        <Stack direction="row" spacing={1} sx={{
                          justifyContent: "flex-end"
                        }}>
                          <Button size="small" startIcon={<Undo />} onClick={() => handleRevertNote(note.id)}>
                            Cancel
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<Save />}
                            disabled={savingNote === note.id || isRichTextEmpty(editingNotes[note.id])}
                            onClick={() => handleSaveNote(note)}
                          >
                            {savingNote === note.id ? "Saving" : "Save"}
                          </Button>
                        </Stack>
                      </Stack>
                    ) : (
                      <NoteBody note={note} />
                    )}
                  </Box>
                  {canEditNote(note) && editingNotes[note.id] === undefined && (
                    <Tooltip title="Edit note">
                      <IconButton aria-label="Edit note" onClick={() => handleEditNote(note)}>
                        <Edit />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
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

/** Render an internal note body: sanitized HTML (script logs, inline images)
 *  when present, else plain text. */
function NoteBody({ note }: { note: Note }) {
  return <HtmlContent value={note.html ?? note.text} emptyText="No note text." />;
}

/** A single email rendered as a conversation bubble. Inbound mail aligns left
 *  (neutral), outbound aligns right (accent), so a thread reads like a chat. */
function EmailBubble({ note, onReply }: { note: Note; onReply?: (note: Note) => void }) {
  const outbound = note.direction === "outbound";

  return (
    <ListItem sx={{ display: "flex", justifyContent: outbound ? "flex-end" : "flex-start", pl: 3, pr: 0, position: "relative", "&:before": { content: '""', position: "absolute", left: 2, top: 24, width: 12, height: 12, borderRadius: "50%", bgcolor: outbound ? "primary.main" : "info.main", border: 2, borderColor: "background.paper", zIndex: 1 } }}>
      <Paper
        variant="outlined"
        sx={{
          maxWidth: "85%",
          width: "fit-content",
          p: 1.5,
          borderRadius: 2,
          bgcolor: outbound ? "action.selected" : "action.hover",
          borderColor: outbound ? "primary.main" : "divider",
        }}
        >
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            mb: 0.5
          }}>
          <Chip
            size="small"
            icon={outbound ? <CallMadeIcon /> : <CallReceivedIcon />}
            label={outbound ? "Sent" : "Received"}
            color={outbound ? "primary" : "default"}
            variant="outlined"
          />
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {new Date(note.dateCreated).toLocaleString()}
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            display: "block"
          }}>
          <strong>From:</strong> {note.emailFrom || note.authorName}
        </Typography>
        {note.emailTo && (
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              display: "block"
            }}>
            <strong>To:</strong> {note.emailTo}
          </Typography>
        )}
        {note.subject && (
          <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
            {note.subject}
          </Typography>
        )}
        <Box sx={{ mt: 1 }}>
          <HtmlContent value={note.html ?? note.text} emptyText="No email body." />
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
