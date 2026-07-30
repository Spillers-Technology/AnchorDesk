import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import * as api from "../api/client";
import { isRichTextEmpty } from "../html";
import { useIsPhone } from "../theme/useIsPhone";
import HtmlContent from "./HtmlContent";
import RichTextEditor from "./RichTextEditor";
import ConfirmDialog from "./admin/ConfirmDialog";

type VisibilityFilter = "all" | api.KbVisibility;

interface ResultRow extends api.KbSearchItem {
  summary?: api.KbArticleSummary;
}

export interface KnowledgeBaseViewProps {
  canWrite: boolean;
  /** Admin opens directly in management; the normal staff destination opens in browse mode. */
  initialManageMode?: boolean;
}

function summaryToResult(article: api.KbArticleSummary): ResultRow {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    score: 0,
    summary: article,
  };
}

function authorLabel(author: api.KbArticle["author"]): string {
  return author || "Unknown author";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function articleMatches(article: api.KbArticleSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [article.title, article.category, article.excerpt]
    .some((value) => value.toLowerCase().includes(needle));
}

export default function KnowledgeBaseView({
  canWrite,
  initialManageMode = false,
}: KnowledgeBaseViewProps) {
  const isPhone = useIsPhone();
  const [manageMode, setManageMode] = useState(canWrite && initialManageMode);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [selected, setSelected] = useState<api.KbArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [articleLoading, setArticleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorArticle, setEditorArticle] = useState<api.KbArticle | "new" | null>(null);
  const [deleting, setDeleting] = useState<{ id: number; title: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [draftCount, setDraftCount] = useState(0);

  const selectedVisibility = visibility === "all" ? undefined : visibility;

  useEffect(() => {
    if (!canWrite && manageMode) {
      setManageMode(false);
      setSelected(null);
    }
  }, [canWrite, manageMode]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        let next: ResultRow[];
        if (manageMode) {
          const response = await api.listKbArticles({
            includeUnpublished: true,
            visibility: selectedVisibility,
          });
          next = response.items
            .filter((article) => articleMatches(article, query))
            .map(summaryToResult);
        } else if (query.trim()) {
          const response = await api.searchKbArticles({
            q: query.trim(),
            visibility: selectedVisibility,
            limit: 50,
          });
          // Preserve the server's descending relevance order.
          next = response.items;
        } else {
          const response = await api.listKbArticles({ visibility: selectedVisibility });
          next = response.items.map(summaryToResult);
        }
        if (active) setRows(next);
      } catch (err) {
        if (active) {
          setRows([]);
          setError(err instanceof Error ? err.message : "Could not load knowledge base articles");
        }
      } finally {
        if (active) setLoading(false);
      }
    }, query.trim() ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [manageMode, query, refreshKey, selectedVisibility]);

  // Browse mode lists published articles only, which is right for a reader and
  // silently wrong for the author who just saved a draft: the article they wrote
  // is simply absent, and nothing on screen says why. Count the drafts hidden by
  // the current filter so we can say so. Scoped to the same visibility filter as
  // the list, so the number always matches what Manage would show.
  useEffect(() => {
    if (!canWrite || manageMode) {
      setDraftCount(0);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await api.listKbArticles({
          includeUnpublished: true,
          published: false,
          visibility: selectedVisibility,
        });
        if (active) setDraftCount(response.items.length);
      } catch {
        // A hint is not worth surfacing an error over; the list has its own.
        if (active) setDraftCount(0);
      }
    })();
    return () => {
      active = false;
    };
  }, [canWrite, manageMode, refreshKey, selectedVisibility]);

  const openArticle = async (row: ResultRow) => {
    setArticleLoading(true);
    setError(null);
    try {
      const article = await api.getKbArticle(row.id);
      setSelected(article);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open article");
    } finally {
      setArticleLoading(false);
    }
  };

  const editArticle = async (row: ResultRow) => {
    setArticleLoading(true);
    setError(null);
    try {
      setEditorArticle(await api.getKbArticle(row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open article editor");
    } finally {
      setArticleLoading(false);
    }
  };

  const changeMode = (next: "browse" | "manage") => {
    setManageMode(next === "manage");
    setSelected(null);
    setQuery("");
  };

  const refresh = () => setRefreshKey((key) => key + 1);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteKbArticle(deleting.id);
      if (selected?.id === deleting.id) setSelected(null);
      setDeleting(null);
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete article");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ width: "100%", minWidth: 0 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Knowledge base</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Search proven answers, read runbooks, and keep repeat fixes in one place.
          </Typography>
        </Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ width: { xs: "100%", sm: "auto" }, flexShrink: 0 }}
        >
          {canWrite && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={manageMode ? "manage" : "browse"}
              onChange={(_event, next: "browse" | "manage" | null) => next && changeMode(next)}
              fullWidth={isPhone}
              aria-label="Knowledge base mode"
            >
              <ToggleButton value="browse">Browse</ToggleButton>
              <ToggleButton value="manage">Manage</ToggleButton>
            </ToggleButtonGroup>
          )}
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditorArticle("new")}
              sx={{ width: { xs: "100%", sm: "auto" }, minHeight: { xs: 40 } }}
            >
              New article
            </Button>
          )}
        </Stack>
      </Stack>

      <Paper
        variant="outlined"
        sx={{
          p: 1.25,
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1,
          minWidth: 0,
        }}
      >
        <TextField
          fullWidth
          label={manageMode ? "Filter articles" : "Search articles"}
          placeholder={manageMode ? "Title, category, or article text…" : "What are you trying to solve?"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          select
          label="Visibility"
          value={visibility}
          onChange={(event) => {
            setVisibility(event.target.value as VisibilityFilter);
            setSelected(null);
          }}
          sx={{ width: { xs: "100%", sm: 170 }, flexShrink: 0 }}
        >
          <MenuItem value="all">All visibility</MenuItem>
          <MenuItem value="internal">Internal</MenuItem>
          <MenuItem value="portal">Portal</MenuItem>
        </TextField>
      </Paper>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {draftCount > 0 && (
        <Alert
          severity="info"
          action={
            <Button
              size="small"
              color="inherit"
              onClick={() => changeMode("manage")}
              sx={{ whiteSpace: "nowrap" }}
            >
              Review drafts
            </Button>
          }
        >
          {draftCount === 1
            ? "1 unpublished draft is hidden from Browse."
            : `${draftCount} unpublished drafts are hidden from Browse.`}{" "}
          Readers only see published articles.
        </Alert>
      )}

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{ alignItems: "flex-start", minWidth: 0 }}
      >
        <Box
          sx={{
            width: { xs: "100%", md: 360 },
            minWidth: 0,
            flexShrink: 0,
            display: isPhone && selected ? "none" : "block",
          }}
        >
          {loading ? (
            <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
              <CircularProgress size={30} />
            </Box>
          ) : rows.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
              <Typography variant="body1" gutterBottom>
                {manageMode ? "No articles match this filter." : "No published answers found."}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {manageMode
                  ? "Try a broader filter or create a new article."
                  : draftCount > 0
                    // Never tell an author to reword the search when the real
                    // reason the shelf is empty is that nothing is published.
                    ? "Nothing is published yet — everything written so far is still a draft."
                    : "Try different wording or clear the visibility filter."}
              </Typography>
              {canWrite && (
                <Button
                  sx={{ mt: 2 }}
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => setEditorArticle("new")}
                >
                  Create article
                </Button>
              )}
            </Paper>
          ) : (
            <Stack spacing={1}>
              {rows.map((row) => (
                <ArticleResultCard
                  key={row.id}
                  row={row}
                  selected={selected?.id === row.id}
                  canWrite={canWrite}
                  onOpen={() => void openArticle(row)}
                  onEdit={() => void editArticle(row)}
                  onDelete={() => {
                    setDeleteError(null);
                    setDeleting({ id: row.id, title: row.title });
                  }}
                />
              ))}
            </Stack>
          )}
        </Box>

        <Box
          sx={{
            flexGrow: 1,
            width: "100%",
            minWidth: 0,
            display: isPhone && !selected ? "none" : "block",
          }}
        >
          {articleLoading && !selected ? (
            <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
              <CircularProgress size={30} />
            </Box>
          ) : selected ? (
            <ArticleReader
              article={selected}
              canWrite={canWrite}
              showBack={isPhone}
              onBack={() => setSelected(null)}
              onEdit={() => setEditorArticle(selected)}
              onDelete={() => {
                setDeleteError(null);
                setDeleting({ id: selected.id, title: selected.title });
              }}
            />
          ) : (
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
              <Typography variant="body1">Choose an article to read it.</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                Search by the problem, symptom, or service name.
              </Typography>
            </Paper>
          )}
        </Box>
      </Stack>

      {editorArticle !== null && (
        <KbArticleEditorDialog
          open
          article={editorArticle === "new" ? null : editorArticle}
          onClose={() => setEditorArticle(null)}
          onSaved={(article) => {
            setEditorArticle(null);
            if (!article.published) setManageMode(true);
            setSelected(article);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete "${deleting.title}"?` : "Delete article?"}
        body={deleteError ?? "This permanently removes the article. Existing links to its stable slug will stop working."}
        confirmLabel="Delete article"
        busy={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </Stack>
  );
}

function ArticleResultCard({
  row,
  selected,
  canWrite,
  onOpen,
  onEdit,
  onDelete,
}: {
  row: ResultRow;
  selected: boolean;
  canWrite: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        minWidth: 0,
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "action.selected" : "background.paper",
      }}
    >
      <CardActionArea onClick={onOpen}>
        <CardContent sx={{ pb: canWrite ? 1 : 2, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", mb: 0.5 }}>
            {row.summary && (
              <>
                <Chip size="small" label={row.summary.category} variant="outlined" />
                <Chip
                  size="small"
                  label={row.summary.visibility === "portal" ? "Portal" : "Internal"}
                  color={row.summary.visibility === "portal" ? "info" : "default"}
                />
                {!row.summary.published && <Chip size="small" label="Draft" color="warning" />}
              </>
            )}
          </Stack>
          <Typography sx={{ fontWeight: 650, overflowWrap: "anywhere" }}>{row.title}</Typography>
          {row.excerpt && (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mt: 0.5,
                overflowWrap: "anywhere",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 3,
                overflow: "hidden",
              }}
            >
              {row.excerpt}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
      {canWrite && (
        <CardActions sx={{ justifyContent: "flex-end", pt: 0 }}>
          <Button size="small" startIcon={<EditIcon />} onClick={onEdit} aria-label={`Edit ${row.title}`}>
            Edit
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={onDelete}
            aria-label={`Delete ${row.title}`}
          >
            Delete
          </Button>
        </CardActions>
      )}
    </Card>
  );
}

function ArticleReader({
  article,
  canWrite,
  showBack,
  onBack,
  onEdit,
  onDelete,
}: {
  article: api.KbArticle;
  canWrite: boolean;
  showBack: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{ p: { xs: 1.5, sm: 2.5 }, width: "100%", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}
    >
      <Stack spacing={1.5} sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "flex-start" }, justifyContent: "space-between" }}
        >
          <Box sx={{ minWidth: 0 }}>
            {showBack && (
              <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 1, minHeight: 40 }}>
                Back to articles
              </Button>
            )}
            <Typography variant="h4" sx={{ fontWeight: 650, overflowWrap: "anywhere" }}>
              {article.title}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 1 }}>
              <Chip size="small" label={article.category} variant="outlined" />
              <Chip
                size="small"
                label={article.visibility === "portal" ? "Portal" : "Internal"}
                color={article.visibility === "portal" ? "info" : "default"}
              />
              {!article.published && <Chip size="small" label="Draft" color="warning" />}
            </Stack>
          </Box>
          {canWrite && (
            <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
              <Button startIcon={<EditIcon />} onClick={onEdit} sx={{ minHeight: { xs: 40 } }}>Edit</Button>
              <Button color="error" startIcon={<DeleteIcon />} onClick={onDelete} sx={{ minHeight: { xs: 40 } }}>
                Delete
              </Button>
            </Stack>
          )}
        </Stack>

        <Typography variant="caption" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
          By {authorLabel(article.author)} · Updated {formatDate(article.updatedAt)} · Slug: {article.slug}
        </Typography>

        <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5, minWidth: 0, maxWidth: "100%" }}>
          <HtmlContent
            value={article.bodyHtml}
            emptyText="This article has no content."
            sx={{
              maxWidth: "100%",
              minWidth: 0,
              "& pre, & table": { maxWidth: "100%" },
            }}
          />
        </Box>
      </Stack>
    </Paper>
  );
}

export function KbArticleEditorDialog({
  open,
  article,
  onClose,
  onSaved,
}: {
  open: boolean;
  article: api.KbArticle | null;
  onClose: () => void;
  onSaved: (article: api.KbArticle) => void;
}) {
  const isPhone = useIsPhone();
  const [title, setTitle] = useState(article?.title ?? "");
  const [category, setCategory] = useState(article?.category ?? "");
  const [visibility, setVisibility] = useState<api.KbVisibility>(article?.visibility ?? "internal");
  const [published, setPublished] = useState(article?.published ?? false);
  const [bodyHtml, setBodyHtml] = useState(article?.bodyHtml ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(article?.title ?? "");
    setCategory(article?.category ?? "");
    setVisibility(article?.visibility ?? "internal");
    setPublished(article?.published ?? false);
    setBodyHtml(article?.bodyHtml ?? "");
    setSaving(false);
    setError(null);
  }, [article, open]);

  const input = useMemo<api.KbArticleInput>(() => ({
    title: title.trim(),
    bodyHtml,
    category: category.trim(),
    visibility,
    published,
  }), [bodyHtml, category, published, title, visibility]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = article
        ? await api.updateKbArticle(article.id, input)
        : await api.createKbArticle(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save article");
      setSaving(false);
    }
  };

  const canSave = !!input.title && !!input.category && !isRichTextEmpty(input.bodyHtml);

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="md"
      fullScreen={isPhone}
    >
      <DialogTitle>{article ? "Edit knowledge base article" : "New knowledge base article"}</DialogTitle>
      <DialogContent dividers sx={{ minWidth: 0 }}>
        <Stack spacing={2} sx={{ mt: 0.5, minWidth: 0 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {article && (
            <Alert severity="info" variant="outlined">
              Stable slug: {article.slug}. Changing the title will not change it.
            </Alert>
          )}
          <TextField
            autoFocus
            required
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              required
              fullWidth
              label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              select
              fullWidth
              label="Visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as api.KbVisibility)}
            >
              <MenuItem value="internal">Internal — staff only</MenuItem>
              <MenuItem value="portal">Portal — requester-visible</MenuItem>
            </TextField>
          </Stack>
          <Box>
            <FormControlLabel
              control={<Checkbox checked={published} onChange={(event) => setPublished(event.target.checked)} />}
              label={published ? "Published" : "Draft"}
            />
            {/* Drafts are the safe default, but saving one is invisible in Browse.
                Say so here rather than letting the article seem to vanish. */}
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
              {published
                ? visibility === "portal"
                  ? "Visible to staff and to requesters in the portal."
                  : "Visible to staff in the knowledge base."
                : "Drafts are visible only in Manage — not to readers browsing or searching."}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Article body</Typography>
            <RichTextEditor value={bodyHtml} onChange={setBodyHtml} minHeight={260} />
          </Box>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Article HTML is sanitized by the server when it is saved and sanitized again when rendered.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          flexDirection: { xs: "column-reverse", sm: "row" },
          alignItems: "stretch",
          "& > :not(style) ~ :not(style)": { ml: { xs: 0, sm: 1 }, mb: { xs: 1, sm: 0 } },
        }}
      >
        <Button disabled={saving} onClick={onClose} sx={{ minHeight: { xs: 40 } }}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !canSave}
          onClick={() => void save()}
          sx={{ minHeight: { xs: 40 } }}
        >
          {saving ? "Saving…" : article ? "Save changes" : "Create article"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
