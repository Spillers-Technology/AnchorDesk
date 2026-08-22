# AnchorDesk 2.7.0 — Pass the Flinch Test (minor)

The 3.0 roadmap defines readiness by one question: *if a stranger wanted to buy
AnchorDesk tomorrow, could we say yes without flinching?* Three gaps decided
that answer — a customer portal, reporting, and a knowledge base. After two
correctness releases all three were still at zero.

2.7 crosses all three at once. That is a deliberate choice: a shallow portal a
requester can actually log into teaches more than another quarter of design
docs, and it turns three unknowns into three things we can critique.

**"Badly" was allowed to mean sparse, unpolished, and missing features. It was
never allowed to mean lying to the user, skipping RBAC, audit, or the 360px
rule, or shipping a number that looks right and isn't.**

Node.js 22.12+ and the local-first PostgreSQL model are unchanged.

## Reporting you can trust — because of what came first

The visible feature is charts. The important one is underneath.

Reporting is not a charts feature, it is a data-modelling feature, and the old
schema could not honestly answer a manager's questions. `Ticket.status` was
current-state only, so "how long did tickets sit in New?" was unanswerable. SLA
targets were **retroactively mutable** — editing a policy today changed what we
claimed to have promised last quarter, and deleting one erased the answer
entirely.

So 2.7 adds a spine:

- **`TicketEvent`**, an append-only fact table fed by a second subscriber on the
  existing event bus. Company, team, assignee and priority are copied onto every
  row, so a report grouped by company reflects the company **at the time**
  rather than joining a ticket row that has since changed.
- **`TicketSlaSnapshot`**, freezing each promise at the moment it is made. No
  foreign key to the policy, so deleting a policy cannot erase provenance, and
  **database triggers reject UPDATE and DELETE** — history is immutable even
  from a direct `psql` session.
- **`Note.workedAt`**, so a technician can log Friday's work on Monday.

The backfill reconstructs what `audit_log` supports and **refuses to invent what
it doesn't**: old policy edits were never preserved, so no historical SLA
snapshots are fabricated. Those promises stay explicitly unknown rather than
plausibly wrong.

On top of that: volume created vs resolved, first-response and resolution
distributions, SLA compliance, backlog age, throughput by team and technician,
and time logged by company.

**Percentiles, never a bare mean.** Every duration reports p50/p90. A mean
response time is dominated by outliers and will confidently tell you the desk is
healthy while half your customers wait a day.

Any chart whose window overlaps reconstructed history says so, in those words.

## The TIME calendar

Time entry only pays off if someone looks at it, so the calendar is built around
the thing that actually costs money: **the gaps**.

A technician's day is laid out against the target with logged and **unlogged**
time as equally prominent figures. Entries with no start/stop cannot be placed
on a timeline, so they are reported as *unplaced coverage* rather than quietly
omitted. The per-ticket SLA timeline shows the frozen promise against what
actually happened — which is where the snapshot work becomes visible.

The 09:00–17:00 eight-hour target is labelled *"a reporting default, not a
recorded employment schedule"*, because there is no staff-schedule model and the
product should not imply it knows your shifts.

## Customer portal

Requesters sign in with an emailed link and follow their own tickets.

The requester is a **`Contact`, not a staff user with a new role** — conflating
them is exactly how someone ends up reading internal notes. Sessions carry an
explicit scope with a database constraint enforcing one principal per row, and
the portal serializer is an **allowlist with its own test**, so a new ticket
field cannot start leaking later.

Three decisions worth knowing about:

- **Duplicate contact emails fail closed.** Contact email is not unique in a
  CRM, so sign-in refuses unless exactly one contact owns the address. Guessing
  would turn an ordinary data-quality problem into an authorization decision.
- **Reassigning a ticket's contact or company quarantines it** from portal
  reads. Owning the row is not proof of entitlement to the previous requester's
  conversation.
- **Merged tickets are hidden from the portal** for the same reason — attachments
  carry no per-item audience data to prove the merged conversation belongs to
  this requester.

## Knowledge base

Articles with internal or portal visibility, authored in the existing editor
through the shared sanitizer, searched with the existing Postgres full-text and
trigram stack.

Visibility is **safe by construction**: the portal-facing repository functions
cannot express "internal", hard-code published + portal, and re-check before
serializing. Slugs stay stable across title edits so links do not rot.

## The switch: off by default

Both the portal and the knowledge base are complete and tested. They are also
**off until you turn them on**.

Without a gate, upgrading would hand you a live customer-facing surface you
never asked for: every uniquely-matching contact in your CRM could request a
sign-in link, and portal-visibility articles would answer anonymously — the
first unauthenticated endpoint in AnchorDesk's history.

`portal.enabled` lives in **Admin → Customer Portal**, defaults false, and is
enforced in three places. It is re-checked on every request, so switching it off
takes effect immediately rather than whenever sessions happen to expire.

## Known limitations

Written down now rather than discovered later:

- **Business hours are hard-coded** (09:00–17:00). Honest about being a default,
  but still an opinion that makes "unlogged time" wrong for shops working other
  hours. A toggle is designed.
- **No per-user timezone.** Reports bucket by UTC calendar day — correct, but
  "today" ends at the wrong hour outside UTC.
- **The portal is v1**: no self-registration, no approval queue, no per-contact
  access grants, and requesters see their own tickets rather than their
  company's. All designed in `docs/roadmap-portal-v2.md`.
- **Technician identity is always "Support"** to requesters. The admin-settable
  version, with per-technician consent for name, avatar and contact details, is
  designed but not built.
- No CSV export yet for the time-by-company roll-up.

## Upgrading

Pull, restart, done — see [docs/upgrading.md](docs/upgrading.md). Boot runs the
idempotent backfill and creates the new append-only triggers as fail-closed
invariants.

**One caveat for `prisma db push` deployments.** Any upgrade crossing 2.5
replaces the tickets unique constraint, and Prisma classifies adding a unique
constraint as potentially lossy, so a strict `db push` refuses. The change is
**not** destructive — the only `DROP` in the diff is the old index being
replaced — but it needs `--accept-data-loss` once, ideally as a supervised
one-time job against a verified backup rather than a permanent deployment flag.
