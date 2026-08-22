# AnchorDesk 1.17.0 — Fair Copy (minor)

A polish pass on the daily surface: the ticket modal. Descriptions, notes, and
email now share one rich-text editor with a visual/source-HTML toggle; notes are
a first-class composer separate from customer email; you can update a page of
tickets at once; and picking a company's contact is the same fast, searchable
pick-or-create interaction as picking the company itself.

## Added

- **Rich-text ticket modal.** The description renders as formatted HTML when
  markup is present (plain text preserved otherwise) and edits through the shared
  rich-text editor with a visual ⇄ HTML-source toggle. The email composer shares
  the same editor and toggle.
- **Notes as a distinct rich composer.** The activity card has its own note editor
  separate from email — saved notes become normal ticket notes with no mail
  config, recipients, or subject required. **Editing an existing note now actually
  persists;** the previous handler only wrote to the console.
- **Bulk updates (`web-client/src/App.tsx`).** A write-capable user selects visible
  tickets from cards, table, or Kanban and sets **status / priority / assignee** in
  one operation. Updates are optimistic with a partial-failure toast and a refetch
  to reconcile. Selection is page/board-scoped (the loaded tickets), not "all
  tickets matching this filter".
- **Unified contact picker (`web-client/src/components/TicketDialog.tsx`).** The
  Contact field is now a searchable `freeSolo` autocomplete matching the Company
  field — type to filter, or type a new name to create the contact on the company.
  The selected contact's email/phone renders inline so you're not choosing blind.

## Changed

- Ticket descriptions and note HTML are sanitized **server-side** on save
  (`ticketRepository`, `routes/tickets.ts`), reusing the shared email sanitizer.
- List and card previews strip HTML to plain text (`web-client/src/html.ts`); the
  printable ticket export renders sanitized formatted bodies instead of escaping
  raw tags.
- The Vite dev proxy defaults `BACKEND_ORIGIN` to `http://localhost:8060`
  (host-local dev is the common path). Set `BACKEND_ORIGIN=http://backend:8060`
  for containerized dev.
- Backend and web-client package versions are now `1.17.0`.

## Upgrade notes

- **No schema change.** The rich description continues to live in the existing
  `tickets.description` text column; there is no separate versioned rich-text
  document model in this pass. Server-side search still indexes the stored
  description, which may include sanitized HTML tags; previews strip them.
- Bulk selection is intentionally limited to the loaded page/board and does not
  include delete, merge, label, or free-text changes.

## Validation

- Backend and web-client TypeScript builds pass; web-client production build (`tsc
  -b && vite build`) succeeds.
- Backend test suite: **94 tests pass**.
- Manual review: rich-text visual/source content stays in sync across mode
  switches; bulk update reconciles partial failures; contact pick-or-create matches
  the company field's create-on-type behavior.

## Images

- `ghcr.io/spillers-technology/anchordesk-backend:1.17.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:1.17.0`
