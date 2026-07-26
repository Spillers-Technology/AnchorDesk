import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import * as portalApi from "./api";
import { usePortalAuth } from "./PortalAuthContext";
import { formatPortalBytes } from "./format";
import type { PortalKbSearchItem } from "./types";

const KB_DEBOUNCE_MS = 350;
const KB_MIN_QUERY_LENGTH = 3;

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function PortalNewTicketView() {
  const navigate = useNavigate();
  const { refresh: refreshAuth } = usePortalAuth();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [kbItems, setKbItems] = useState<PortalKbSearchItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = summary.trim();
    if (query.length < KB_MIN_QUERY_LENGTH) {
      setKbItems([]);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      void portalApi.searchPortalKnowledgeBase(query, controller.signal).then((items) => {
        if (active) setKbItems(items ?? []);
      });
    }, KB_DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [summary]);

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      return [...current, ...selected.filter((file) => !seen.has(fileKey(file)))];
    });
    event.target.value = "";
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanSummary = summary.trim();
    if (!cleanSummary) {
      setError("Tell us briefly what you need help with.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const ticket = await portalApi.createPortalTicket({
        summary: cleanSummary,
        description: description.trim(),
      });

      if (files.length > 0) {
        try {
          await portalApi.uploadPortalAttachments(ticket.id, files);
        } catch (uploadError) {
          if (portalApi.isPortalAuthError(uploadError)) {
            await refreshAuth();
            return;
          }
          navigate(`/tickets/${ticket.id}`, {
            replace: true,
            state: {
              warning: `${
                ticket.ticketNumber ? `Ticket #${ticket.ticketNumber}` : "Your ticket"
              } was created, but some files were not uploaded. Add them again below.`,
            },
          });
          return;
        }
      }

      navigate(`/tickets/${ticket.id}`, {
        replace: true,
        state: {
          notice: `${
            ticket.ticketNumber ? `Ticket #${ticket.ticketNumber}` : "Your ticket"
          } was created.`,
        },
      });
    } catch (createError) {
      if (portalApi.isPortalAuthError(createError)) {
        await refreshAuth();
      } else {
        setError("Your request could not be submitted. Nothing was created; please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography component="h1" variant="h4">New support request</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
          Tell us what is happening. Your organization is selected from your contact record.
        </Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 }, "&:last-child": { pb: { xs: 2, sm: 3 } } }}>
          <Box component="form" onSubmit={(event) => void submit(event)}>
            <Stack spacing={2}>
              {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
              <TextField
                label="Summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                required
                autoFocus
                fullWidth
                slotProps={{ htmlInput: { maxLength: 255 } }}
                helperText="A short description of what you need help with."
              />

              {kbItems.length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5 }} aria-label="Suggested help articles">
                  <Stack spacing={1.25}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <ArticleOutlinedIcon color="primary" fontSize="small" />
                      <Typography variant="subtitle2">Does this answer it?</Typography>
                    </Stack>
                    {kbItems.map((article) => (
                      <Paper
                        component="article"
                        variant="outlined"
                        key={article.id}
                        sx={{ p: 1.5, bgcolor: "background.default" }}
                      >
                        <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere" }}>
                          {article.title}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ color: "text.secondary", mt: 0.5, overflowWrap: "anywhere" }}
                        >
                          {article.excerpt}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Paper>
              )}

              <TextField
                label="Details"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                multiline
                minRows={5}
                fullWidth
                helperText="Include any error messages and what you were doing when the problem started."
              />

              <Box>
                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AttachFileIcon />}
                  onClick={() => fileInput.current?.click()}
                  disabled={saving}
                  sx={{ minHeight: 44 }}
                >
                  Add files
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  aria-label="Choose attachments"
                  onChange={addFiles}
                />
              </Box>

              {files.length > 0 && (
                <Stack spacing={1} aria-label="Files to upload">
                  {files.map((file) => (
                    <Paper
                      variant="outlined"
                      key={fileKey(file)}
                      sx={{ px: 1.5, py: 0.75, display: "flex", alignItems: "center", gap: 1 }}
                    >
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                          {file.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {formatPortalBytes(file.size)}
                        </Typography>
                      </Box>
                      <IconButton
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
                        disabled={saving}
                        sx={{ width: 40, height: 40 }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Paper>
                  ))}
                </Stack>
              )}

              <Stack
                direction={{ xs: "column-reverse", sm: "row" }}
                spacing={1}
                sx={{ justifyContent: "flex-end" }}
              >
                <Button
                  component={RouterLink}
                  to="/tickets"
                  color="inherit"
                  disabled={saving}
                  sx={{ minHeight: 44 }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={saving ? <CircularProgress color="inherit" size={18} /> : <SendIcon />}
                  disabled={saving || !summary.trim()}
                  sx={{ minHeight: 44 }}
                >
                  {saving ? "Submitting…" : "Submit request"}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
