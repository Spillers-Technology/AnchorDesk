import DOMPurify from "dompurify";

const HTML_TAG_RE = /<\/?[a-z][\s\S]*>/i;
const MEDIA_OR_STRUCTURAL_TAG_RE = /<(img|hr|table|thead|tbody|tr|td|th|ul|ol|li|blockquote)\b/i;

export function hasRenderableHtml(value = ""): boolean {
  return HTML_TAG_RE.test(value);
}

export function sanitizeHtml(value = ""): string {
  return DOMPurify.sanitize(value, {
    ADD_ATTR: ["loading", "target", "rel"],
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textToHtml(value = ""): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${block.split("\n").map(escapeHtml).join("<br>")}</p>`)
    .join("");
}

export function toEditorHtml(value = ""): string {
  return hasRenderableHtml(value) ? value : textToHtml(value);
}

function stripHtmlFallback(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function htmlToPlainText(value = ""): string {
  if (!hasRenderableHtml(value)) {
    return value.replace(/\u00a0/g, " ").trim();
  }

  if (typeof document !== "undefined") {
    const el = document.createElement("div");
    el.innerHTML = sanitizeHtml(value);
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  return stripHtmlFallback(sanitizeHtml(value)).replace(/\u00a0/g, " ").trim();
}

export function htmlToPreviewText(value = ""): string {
  return htmlToPlainText(value).replace(/\s+/g, " ").trim();
}

export function isRichTextEmpty(value = ""): boolean {
  const safe = sanitizeHtml(value);
  if (MEDIA_OR_STRUCTURAL_TAG_RE.test(safe)) return false;
  return htmlToPlainText(safe).trim() === "";
}
