# AnchorDesk 1.13.0 — Clear Deck (minor)

The board clears the deck of finished work and gets out of your way: **"Closed"
is no longer a column**, resolved tickets fall off a **page-filling** board, and
a new **regex advanced search** plus a **denser ticket cockpit** sharpen the
daily loop. Email-to-ticket also gets materially more resilient.

## Added

- **Advanced search with regex.** The ticket filter panel is now an **Advanced
  search**: a case-insensitive **POSIX regular expression** matched server-side
  across title, summary, description, company, ticket number, and priority —
  beside the existing status / company / assignee / label facets and a new
  **include-closed** toggle. A pattern is validated as you type (Apply disables
  on a bad one), and a pattern Postgres rejects returns a clean **400**
  (SQLSTATE `2201B`, unwrapped from Prisma's `P2010`) rather than a 500.
  - Implemented as a raw pre-pass that resolves matching ticket ids, which then
    compose with the normal where-clause and pagination — Prisma has no POSIX
    regex operator.

- **Fall-off close animation.** Each Kanban card carries a hover **Close**
  action. Closing tips the card up and drops it off the bottom of the board,
  then removes it — closing reads as one continuous motion instead of a card
  silently vanishing.

## Changed

- **A board built for live work.** **"Closed" is no longer a Kanban column.**
  Closed tickets are hidden from the default working views (board, cards, table)
  and surfaced on demand via the advanced-search *include closed* toggle. A
  Closed column reappears only when closed tickets are actually loaded, so a
  closed card is never orphaned with nowhere to render. Server-side, the default
  list excludes `Closed` (and `Deleted`) via opt-in flags, so MCP and internal
  callers are unchanged.

- **The board fills the page.** Columns flex to share the full width with no
  `240px` floor and no horizontal scrollbar; cards wrap/truncate so even a narrow
  viewport fits without scrolling sideways.

- **Denser ticket cockpit.** The ticket modal was tightened to stop wasting
  space: status + priority pair on one row, card padding is reduced, and every
  field (status, priority, contact, assignee, labels) uses a consistent
  floating-label control matching the company picker.

- **No flash on background refresh.** List views only blank to a spinner on the
  first load (nothing to show yet). Live WebSocket updates, an optimistic close,
  and drag-between-columns now swap data in place — the board never flashes out
  from under you.

## Fixed

- **Duplicate / wedged IMAP ingest (`P2002`).** Email-to-ticket is now
  **idempotent on Message-ID**. A message's own Message-ID is stored as the new
  ticket's `external_id`, but ingest previously only deduped on threading refs
  and the `[#NNNNN]` subject token — never on the message's own id. So the same
  email delivered to two monitored mailboxes (one Message-ID, two deliveries) or
  replayed on a re-poll hit the `(external_id, external_provider)` unique index,
  threw `P2002`, failed the whole poll, and — because `lastUid` never advanced —
  wedged the mailbox on that "poison" message forever. Ingest now skips a
  Message-ID it has already stored (counted in the poll log), and a residual
  collision recovers by appending to the existing ticket instead of throwing.

- **Opaque IMAP errors.** A failed poll now surfaces ImapFlow's real reason
  (`responseText` / `serverResponseCode` / `authenticationFailed`) in the log
  and the mailbox's last error, instead of a bare `Command failed` — the
  difference between guessing and seeing "Authentication failed".

## Upgrade notes

- No schema changes. Drop-in from 1.12.x. `prisma db push` is a no-op.
- Closed tickets disappear from the default board/list after upgrade — this is
  intentional. Use **Advanced search → Include closed tickets** (or pick the
  `Closed` status) to see them.

## Validation

- Backend and web-client: TypeScript builds pass.
- Verified against a live local stack: the default list excludes closed tickets
  while `includeClosed=true` reveals them; a `(vpn|wifi).*down` regex matches as
  expected and an invalid pattern returns 400; the board fills the width with no
  horizontal scroll and a card plays the fall-off animation on close without the
  follow-on refresh flashing the board.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.13.0`
- `ghcr.io/spilloid/anchordesk-web-client:1.13.0`
