import { Box, SxProps, Theme, Typography } from "@mui/material";
import { hasRenderableHtml, sanitizeHtml } from "../html";

export const HTML_CONTENT_SX: SxProps<Theme> = {
  color: "text.primary",
  lineHeight: 1.6,
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
  "& pre": { whiteSpace: "pre-wrap", overflowX: "auto", bgcolor: "grey.100", p: 1, borderRadius: 1 },
  "& code": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.9em" },
  "& table": { width: "100%", borderCollapse: "collapse", my: 1, display: "block", overflowX: "auto" },
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

export default function HtmlContent({ value, emptyText = "No content yet.", sx }: HtmlContentProps) {
  const body = value ?? "";
  if (!body.trim()) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    );
  }

  if (hasRenderableHtml(body)) {
    return (
      <Box
        sx={mergeSx(HTML_CONTENT_SX, sx)}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
      />
    );
  }

  return (
    <Box sx={mergeSx(PLAIN_TEXT_SX, sx)}>
      {body}
    </Box>
  );
}
