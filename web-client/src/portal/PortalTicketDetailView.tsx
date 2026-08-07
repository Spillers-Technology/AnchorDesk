import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import HtmlContent from "../components/HtmlContent";
import * as portalApi from "./api";
import { usePortalAuth } from "./PortalAuthContext";
import { formatPortalBytes, formatPortalDate } from "./format";
import PortalTicketChips from "./PortalTicketChips";
import type { PortalTicket } from "./types";

type LoadError = "unavailable" | "failed" | null;

interface DetailNavigationState {
  notice?: string;
  warning?: string;
}

function positiveTicketId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export default function PortalTicketDetailView() {
  const { ticketId: ticketIdParam } = useParams();
  const ticketId = positiveTicketId(ticketIdParam);
  const location = useLocation();
  const navigationState = (location.state ?? {}) as DetailNavigationState;
  const { refresh: refreshAuth } = usePortalAuth();
  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError>(null);
  const [comment, setComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [success, setSuccess] = useState<string | null>(navigationState.notice ?? null);
  const [warning, setWarning] = useState<string | null>(navigationState.warning ?? null);
  const attachmentInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (ticketId === null) {
      setTicket(null);
      setLoadError("unavailable");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setTicket(await portalApi.getPortalTicket(ticketId));
    } catch (error) {
      setTicket(null);
      if (portalApi.isPortalAuthError(error)) {
        await refreshAuth();
      } else if (error instanceof portalApi.PortalApiError && error.status === 404) {
        setLoadError("unavailable");
      } else {
        setLoadError("failed");
      }
    } finally {
      setLoading(false);
    }
  }, [refreshAuth, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    const content = comment.trim();
    if (!content || ticketId === null) return;
    setCommentBusy(true);
    setCommentError(false);
    setSuccess(null);
    try {
      const note = await portalApi.addPortalComment(ticketId, content);
      setTicket((current) => current ? { ...current, notes: [...current.notes, note] } : current);
      setComment("");
      setSuccess("Your comment was added.");
    } catch (error) {
      if (portalApi.isPortalAuthError(error)) await refreshAuth();
      else setCommentError(true);
    } finally {
      setCommentBusy(false);
    }
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || ticketId === null) return;
    setUploadBusy(true);
    setUploadError(false);
    setSuccess(null);
    try {
      const attachments = await portalApi.uploadPortalAttachments(ticketId, files);
      setTicket((current) => current
        ? { ...current, attachments: [...current.attachments, ...attachments] }
        : current);
      setSuccess(`${attachments.length === 1 ? "File" : "Files"} uploaded.`);
    } catch (error) {
      if (portalApi.isPortalAuthError(error)) await refreshAuth();
      else setUploadError(true);
    } finally {
      setUploadBusy(false);
    }
  };

  if (loading && !ticket) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress aria-label="Loading ticket" />
      </Box>
    );
  }

  if (!ticket) {
    return (
      <Stack spacing={2}>
        <Button
          component={RouterLink}
          to="/tickets"
          startIcon={<ArrowBackIcon />}
          sx={{ alignSelf: "flex-start", minHeight: 44 }}
        >
          Back to my tickets
        </Button>
        <Alert
          severity={loadError === "failed" ? "error" : "warning"}
          action={loadError === "failed" ? (
            <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={() => void load()}>
              Retry
            </Button>
          ) : undefined}
        >
          {loadError === "failed"
            ? "This ticket could not be loaded right now. Please try again."
            : "This ticket is unavailable."}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Button
        component={RouterLink}
        to="/tickets"
        startIcon={<ArrowBackIcon />}
        sx={{ alignSelf: "flex-start", minHeight: 44 }}
      >
        Back to my tickets
      </Button>

      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {warning && <Alert severity="warning" onClose={() => setWarning(null)}>{warning}</Alert>}

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 }, "&:last-child": { pb: { xs: 2, sm: 3 } } }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {ticket.ticketNumber ? `Ticket #${ticket.ticketNumber}` : "Support request"}
              </Typography>
              <Typography component="h1" variant="h4" sx={{ overflowWrap: "anywhere" }}>
                {ticket.title || ticket.summary}
              </Typography>
            </Box>
            <PortalTicketChips status={ticket.status} priority={ticket.priority} />
            {ticket.summary && ticket.summary !== ticket.title && (
              <Typography variant="body1" sx={{ overflowWrap: "anywhere" }}>
                {ticket.summary}
              </Typography>
            )}
            {ticket.description && (
              <>
                <Divider />
                <HtmlContent value={ticket.description} />
              </>
            )}
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Created {formatPortalDate(ticket.createdAt)}
              {ticket.closedAt ? ` · Closed ${formatPortalDate(ticket.closedAt)}` : ""}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography component="h2" variant="h5">Conversation</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
          Public replies appear here whether you answer in the portal or by email.
        </Typography>
      </Box>

      {ticket.notes.length > 0 ? (
        <Stack spacing={1.5}>
          {ticket.notes.map((note) => (
            <Paper
              key={note.id}
              variant="outlined"
              sx={{
                p: 2,
                ml: note.authorKind === "you" ? { xs: 2, sm: 8 } : 0,
                mr: note.authorKind === "support" ? { xs: 2, sm: 8 } : 0,
                bgcolor: note.authorKind === "you" ? "action.hover" : "background.paper",
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", gap: 1, alignItems: "center" }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                    {note.authorKind === "support" && note.authorAvatarUrl && (
                      <Avatar src={note.authorAvatarUrl} alt="" sx={{ width: 24, height: 24, flexShrink: 0 }} />
                    )}
                    <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere" }}>
                      {note.authorKind === "you" ? "You" : (note.authorName || "Support")}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "right" }}>
                    {formatPortalDate(note.createdAt)}
                  </Typography>
                </Stack>
                <HtmlContent value={note.htmlContent || note.content} />
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          No public replies yet.
        </Typography>
      )}

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 }, "&:last-child": { pb: { xs: 2, sm: 3 } } }}>
          <Box component="form" onSubmit={(event) => void submitComment(event)}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">Add a comment</Typography>
              {commentError && (
                <Alert severity="error" onClose={() => setCommentError(false)}>
                  Your comment was not added. Please try again.
                </Alert>
              )}
              <TextField
                label="Comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                multiline
                minRows={4}
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                startIcon={commentBusy ? <CircularProgress color="inherit" size={18} /> : <SendIcon />}
                disabled={commentBusy || !comment.trim()}
                sx={{ minHeight: 44, alignSelf: { xs: "stretch", sm: "flex-end" } }}
              >
                {commentBusy ? "Adding…" : "Add comment"}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 }, "&:last-child": { pb: { xs: 2, sm: 3 } } }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography component="h2" variant="h6">Attachments</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Add screenshots, documents, or other files that help explain the request.
              </Typography>
            </Box>
            {uploadError && (
              <Alert severity="error" onClose={() => setUploadError(false)}>
                Your files were not uploaded. Please try again.
              </Alert>
            )}
            {ticket.attachments.length > 0 && (
              <Stack spacing={1}>
                {ticket.attachments.map((attachment) => (
                  <Paper
                    key={attachment.id}
                    variant="outlined"
                    sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}
                  >
                    <AttachFileIcon color="action" sx={{ flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Link
                        href={attachment.downloadUrl}
                        target="_blank"
                        rel="noopener"
                        underline="hover"
                        sx={{ display: "block", overflowWrap: "anywhere" }}
                      >
                        {attachment.filename}
                      </Link>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {formatPortalBytes(attachment.size)}
                      </Typography>
                    </Box>
                  </Paper>
                ))}
              </Stack>
            )}
            <Button
              type="button"
              variant="outlined"
              startIcon={uploadBusy ? <CircularProgress size={18} /> : <AttachFileIcon />}
              onClick={() => attachmentInput.current?.click()}
              disabled={uploadBusy}
              sx={{ minHeight: 44, alignSelf: { xs: "stretch", sm: "flex-start" } }}
            >
              {uploadBusy ? "Uploading…" : "Add files"}
            </Button>
            <input
              ref={attachmentInput}
              type="file"
              multiple
              hidden
              aria-label="Upload attachments"
              onChange={(event) => void uploadFiles(event)}
            />
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

