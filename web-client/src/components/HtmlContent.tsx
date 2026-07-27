import { Box, SxProps, Theme, Typography } from "@mui/material";
import { hasRenderableHtml, sanitizeHtml } from "../html";

export const HTML_CONTENT_SX: SxProps<Theme> = {
  color: "text.primary",
  lineHeight: 1.6,
  maxWidth: "100%",
  minWidth: 0,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  "& > :first-of-type": { mt: 0 },
  "& > :last-child": { mb: 0 },
  "& p": { my: 0.75 },
  "& a": { color: "primary.main" },
  "& img": { maxWidth: "100%", height: "auto", borderRadius: 1, verticalAlign: "middle" },
  "& ul, & ol": { pl: 3, my: 1 },
  "& li": { my: 0.25 },
  "& blockquote": { borderLeft: 3, borderColor: "divider", pl: 1.5, ml: 0, my: 1, color: "text.secondary" },
  // Preserve code formatting, but contain wide lines inside the block rather
  // than letting an article/timeline widen the whole phone viewport.
  "& pre": {
    whiteSpace: "pre",
    maxWidth: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    bgcolor: "action.hover",
    p: 1,
    borderRadius: 1,
  },
  "& code": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.9em" },
  "& .html-table-scroll": {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    my: 1,
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
  },
  "& .html-table-scroll > table": {
    width: "max-content",
    minWidth: "100%",
    maxWidth: "none",
    borderCollapse: "collapse",
    my: 0,
  },
  "& th, & td": { border: "1px solid", borderColor: "divider", px: 1, py: 0.75, textAlign: "left", verticalAlign: "top" },
};

interface HtmlContentProps {
  value?: string | null;
  emptyText?: string;
  sx?: SxProps<Theme>;
}

const PLAIN_TEXT_SX: SxProps<Theme> = {
  color: "text.primary",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

function mergeSx(base: SxProps<Theme>, extra?: SxProps<Theme>): SxProps<Theme> {
  return extra ? ([base, extra] as SxProps<Theme>) : base;
}

/**
 * Add a fixed-width scrolling viewport around sanitized tables. A table cannot
 * reliably scroll itself when authored inline width/min-width wins the CSS
 * cascade, so wide columns would otherwise be clipped by a phone reader.
 */
export function wrapSanitizedTables(value: string): string {
  const safe = sanitizeHtml(value);
  if (typeof document === "undefined" || !safe.toLowerCase().includes("<table")) {
    return safe;
  }

  const template = document.createElement("template");
  template.innerHTML = safe;
  for (const table of Array.from(template.content.querySelectorAll("table"))) {
    if (table.parentElement?.classList.contains("html-table-scroll")) continue;
    const scroller = document.createElement("div");
    scroller.className = "html-table-scroll";
    scroller.setAttribute("role", "region");
    scroller.setAttribute("aria-label", "Scrollable table");
    scroller.tabIndex = 0;
    table.parentNode?.insertBefore(scroller, table);
    scroller.appendChild(table);
  }
  return template.innerHTML;
}

export default function HtmlContent({ value, emptyText = "No content yet.", sx }: HtmlContentProps) {
  const body = value ?? "";
  if (!body.trim()) {
    return (
      <Typography variant="body2" sx={{
        color: "text.secondary"
      }}>
        {emptyText}
      </Typography>
    );
  }

  if (hasRenderableHtml(body)) {
    return (
      <Box
        sx={mergeSx(HTML_CONTENT_SX, sx)}
        dangerouslySetInnerHTML={{ __html: wrapSanitizedTables(body) }}
      />
    );
  }

  return (
    <Box sx={mergeSx(PLAIN_TEXT_SX, sx)}>
      {body}
    </Box>
  );
}
