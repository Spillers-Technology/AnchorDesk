# Ticket Modal UX Notes

These notes document the current ticket modal editing model and the limits chosen
for the July 2026 rich-text pass.

## Editing Model

- **Description** renders as formatted HTML when markup is present and as
  preserved plain text otherwise. Editing uses the shared rich-text editor with a
  visual/source HTML toggle.
- **Title** uses an explicit edit state with save/cancel actions. Failed saves
  keep the draft open so the user can retry or copy text.
- **Status and priority** remain fast autosave fields because they are short,
  reversible workflow values. The modal shows the existing save indicator and
  reverts the local selection if the save fails.
- **Notes** are separate from email. The activity card has its own rich note
  composer, and saved notes become normal ticket notes without requiring mail
  configuration, recipients, or a subject.
- **Email** remains a distinct composer for customer-facing communication.
  It shares the rich-text editor, attachment/image flow, and visual/source HTML
  toggle, but keeps send-specific fields isolated.
- **Bulk updates** are page-scoped from the ticket views. A write-capable user can
  select visible tickets from cards, table, or Kanban and update status,
  priority, and assignee in one operation.

## HTML Handling

- The browser sanitizes rendered ticket descriptions, notes, and email bodies.
- The backend sanitizes saved ticket descriptions when they contain HTML tags.
- The backend sanitizes `htmlContent` on note create/update.
- Printable ticket export renders sanitized formatted descriptions and rich note
  bodies instead of escaping them as raw tags.

## Hard Limits

- Rich fields do **not** autosave on every keystroke. Description, notes, and
  note edits use explicit Save to avoid accidental destructive edits and noisy
  external sync.
- The sanitizer allows common formatting, links, tables, and images, but strips
  scripts, unsafe attributes, and unsafe URL schemes.
- The description still lives in the existing `tickets.description` text column.
  There is no separate versioned rich-text document model in this pass.
- Bulk selection is intentionally limited to the currently loaded page/board. It
  does not mean "all tickets matching this filter"; that would need a backend
  bulk endpoint and stronger confirmation copy.
- Bulk updates do not include delete, merge, label changes, or free-text fields
  in this pass.
- Server-side search still indexes the stored description text, which may include
  sanitized HTML tags. List/card previews strip tags client-side.
- Normal note edits are exposed to write-capable users (`admin` and
  `technician`). Time entries stay editable through the time card, and email
  correspondence is not edited from the activity timeline.
