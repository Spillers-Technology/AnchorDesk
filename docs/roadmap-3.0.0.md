# Road to 3.0.0 — "the version we could genuinely sell"

Status: **planning** (opened 2026-07-17). 3.0.0 is defined by a single test:
*if a stranger wanted to buy AnchorDesk tomorrow, we could say yes without
flinching.* Everything below exists because a buyer would hit its absence in
the first demo call. Sequencing into 2.5 / 2.6 / 2.x releases is suggested,
not fixed — each workstream ships independently under the usual release flow.

The 3.0.0 acceptance checklist (the flinch test):

- [ ] A requester can submit and track their own tickets without email
- [ ] A manager can open a reports view and see SLA compliance, volume, and
      resolution metrics without exporting anything
- [ ] Techs can answer common questions from a knowledge base instead of
      retyping them
- [ ] ConnectWise and Jira two-way sync are **supported**, not alpha —
      exercised against live tenants, with documented failure behavior
- [ ] At least one real external organization runs AnchorDesk in production
      (design partner), and at least one RMM integration is validated against
      a real paid tenant
- [ ] The licensing/pricing answer to "what does it cost?" exists in writing
- [ ] Fresh install → onboarded org is documented and tested end to end
      (setup wizard exists since 2.4.0; portal/KB/report onboarding joins it)

---

## Workstream 1 — Customer portal (the biggest gap)

Every product in the 2.1 audit (Zammad, Autotask, JSM) has a requester
portal; it is usually the first checkbox on a helpdesk RFP. Today end users
can only interact by email.

- **Requester identity** rides the existing `Contact` model — a new
  `requester` principal, *not* a `User` role. Auth options, cheapest first:
  magic-link email login (no password storage, reuses the mail stack) with
  optional password upgrade later. Sessions reuse the existing server-side
  session table with a scope flag.
- **Portal scope (minimal viable):** submit a ticket (company inferred from
  contact), list *own* tickets (company-wide visibility is a per-contact
  admin toggle), view status/replies, add a comment, attach files. Public
  notes only — internal notes and time entries never render.
- **Separation:** portal is a distinct route tree (`/portal`) with its own
  slim bundle — techs' SPA stays untouched. Same 360px mobile rule.
- **Email parity:** a portal comment threads into the same conversation as
  email replies (it's a note with `via: portal`); outbound replies still go
  by mail so the requester can answer either way.
- **MCP parity:** portal-created tickets are ordinary tickets; no new tools
  needed beyond a `source` field surfacing in `get_ticket`/`list_tickets`.

## Workstream 2 — Reporting & analytics

Managers buy helpdesks partly for the charts. Nothing in the tree renders a
metric today.

- **Server-side aggregation endpoints** (`/reports/*`), not client-side
  crunching — the ticket table is already server-paginated for a reason.
  Core set: ticket volume over time (created/resolved), first-response and
  resolution time distributions, SLA compliance % (met/at-risk/breached),
  per-technician and per-company/team breakdowns, time-entry roll-ups
  (groundwork for billable hours later).
- **Reports view** in the drawer: date-range + company/team/tech filters,
  a small number of excellent charts over a big grid of mediocre ones.
- **Time-entry roll-up by company** doubles as the seed of billing export —
  explicitly *not* invoicing in 3.0.0, just a CSV a bookkeeper could use.
- **MCP parity:** the same aggregates exposed as read tools
  (`get_report_summary` or per-report tools) under normal RBAC.

## Workstream 3 — Knowledge base

Pairs with the portal; smallest of the three product gaps.

- `KbArticle` (+ category, `visibility: internal | portal`), authored in the
  existing rich-text editor, searched with the existing pg FTS + trigram
  stack. Admin/tech CRUD; portal renders published portal-visible articles.
- **Deflection hook:** portal ticket form searches articles as the requester
  types the summary ("does this answer it?") — the feature that makes KB a
  selling point instead of a wiki.
- Later (post-3.0): insert-article-link in the ticket composer, article
  usage counts.

## Workstream 4 — Two-way sync out of ALPHA (validation)

The code follows the published APIs; what's missing is live exercise. This
is a *validation* workstream, not a build workstream.

- **Jira first — it's free.** A free Atlassian Cloud site + API token costs
  nothing and can be running today. Exercise the full reconcile matrix
  (local edit → push, remote edit → pull, both → conflict flag-and-hold,
  resolve both directions, note push, batch sync) and promote JiraProvider
  to supported.
- **ConnectWise via developer program.** ConnectWise runs a developer
  network with sandbox access for integration builders — apply as exactly
  that. A vendor demo/trial tenant is the fallback (see go-to-market notes).
- **Hardening that falls out of validation:** rate-limit/backoff behavior,
  token refresh edge cases, a visible per-provider sync-health surface in
  Admin → Sync (last success, last error, consecutive failures) so "is sync
  working?" never requires reading logs.

## Workstream 5 — Real-world validation (design partner)

One real MSP tenant is worth fifty synthetic fixtures, and it converts
"I need someone to give me live keys" into a strength.

- **Design-partner offer:** free (or founder-priced-forever) production use
  in exchange for feedback, patience, and serving as the validation
  environment for their RMM/PSA stack. One partner is enough for 3.0.0.
- Their paid RMM tenant (e.g. NinjaOne) validates the OAuth flows, device
  sync, and script runner against production data volumes.
- What we owe a design partner before asking: documented backup/restore,
  versioned Prisma migrations for upgrades (`migrate deploy`, not
  `db push`) so their data survives every release, and a SECURITY.md with a
  disclosure contact. These are 3.0.0 items regardless — a buyer asks for
  all three.

## Workstream 6 — Go-to-market scaffolding

Not code, but 3.0.0 is defined by a sales conversation, so the answers have
to exist in writing.

- **Licensing: stay MIT through 3.0.0.** The auditable-source story ("read
  the code before you hand it your RMM keys") is the strongest trust asset
  a solo unknown vendor has, and there are no customers to defend yet.
  Sell hosting, support, and setup — the Zammad model. Revisit (FSL/AGPL/
  open-core) only if a hosted offering gets real traction; as sole
  copyright holder, relicensing *forward* stays possible (shipped MIT
  versions remain MIT). Require copyright assignment or a CLA before
  accepting any outside contribution, or that option quietly closes.
- **Pricing page** (even if the price is "contact me"), a hosted demo
  instance with reset-on-schedule seed data, and a support statement
  (what's covered, response expectations, how to report a vulnerability).
- **Vendor relationships:** join integration/developer programs (that's
  what they're for) rather than pitching listings; an "integrations" page
  stating exactly which APIs are used per vendor keeps the transparency
  pitch front and center.

---

## Suggested sequencing

- **2.5** — Reporting & analytics (self-contained, demos brilliantly,
  no new auth surface) + Jira live validation (free, start immediately).
- **2.6** — Customer portal (largest single lift; the requester-identity
  design deserves its own plan doc before code).
- **2.7** — Knowledge base + portal deflection; ConnectWise validation as
  sandbox access lands; sync-health surface.
- **3.0.0** — Design partner live in production, versioned migrations +
  backup/restore + SECURITY.md, go-to-market pages, promote sync to
  supported, and the flinch-test checklist all green.
