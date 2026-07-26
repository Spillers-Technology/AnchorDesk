# Portal v2 — self-registration, approval, and the customer conversation

Status: **design accepted, awaiting Workstream C landing** (2026-07-26).

Workstream C ([roadmap-2.7.md](roadmap-2.7.md)) builds the portal substrate:
magic-link auth, Contact-bound sessions, and the field-allowlist serializer.
This document is the layer on top — how a customer *gets* access, what they can
see, and how they tell us whether we did a good job.

## The principle this design extends

Workstream C's substrate is built on one idea, and it is worth naming because
everything below is an application of it rather than an addition to it:

> **Portal authorization is provable state, re-derived at read time. It is never
> inherited, never implied by a row's existence, and never cached into a claim.**

That principle is visible in every choice it made: a note is unpublished until
someone publishes it (`portalVisible` defaults false); a contact who moves
company does not thereby acquire the old conversation (transfer quarantine); a
session is staff **xor** portal as a database CHECK rather than as a convention;
a magic link is a selector plus a separately-hashed verifier so it can be looked
up without being comparable.

The temptation when adding self-registration is to end it with a boolean —
`Contact.portalAccess = true` — and let every later read trust that flag. That
would quietly abandon the principle: a boolean records that access exists, not
who granted it, when it became effective, what it covers, or whether it still
should. The elegant continuation is to make **access itself a record with
provenance**, which is how this codebase already treats every other consequential
state change (`TicketMerge.undoPlan`, `SyncRun`, the audit log). The house style
is "a record of what happened," not "a flag saying it did."

---

## 1. Getting access: register, then be approved

Self-registration without a gate is an access-control hole with a friendly UI.
Domain affiliation is a *hint*, never an entitlement — anyone can buy a
lookalike domain or use a personal address that happens to match.

The flow:

1. **Register.** A visitor submits an email address. We always respond with the
   same "check your email" message regardless of whether the address, domain, or
   company exists. No enumeration of customers, contacts, or companies.
2. **Match by domain** to a `Company`, reusing the sender-domain matching
   already built for inbound IMAP (2.0.0) rather than a second implementation.
3. **If they are not already a Contact → `pending`.** They see a plain
   "pending approval" state. Nothing about the company is revealed, including
   whether it exists.
4. **A technician approves**, which adds them as a `Contact` on the company and
   sets portal access.
5. **Granting access auto-sends the login email.** Access without a way in is a
   support ticket we created for ourselves.

**Portal access is granted per contact**, never an implicit consequence of being
one. Most contacts in a CRM are billing addresses and drive-by names; they
should not silently gain the ability to read the company's whole ticket history.
Existing contacts start with **no grant** — a migration that switches on access
for every historical contact row is a data-exposure event.

In the UI this is the per-contact checkbox you'd expect. Underneath it is a
record, not a flag.

Registration is rate-limited per address and per IP, and the approval queue is
an admin surface with the requester's claimed email, matched domain, and
timestamp.

### Data shape

```prisma
model PortalRegistration {
  id          Int       @id @default(autoincrement())
  email       String    @db.VarChar(255)   // normalized lowercase
  companyId   Int?      @map("company_id") // domain match, may be null
  status      String    @db.VarChar(20)    // pending | approved | rejected
  reviewedBy  String?   @map("reviewed_by") @db.VarChar(255)
  reviewedAt  DateTime? @map("reviewed_at")
  contactId   Int?      @map("contact_id")  // set on approval
  createdAt   DateTime  @default(now()) @map("created_at")
}

/// Access as a record with provenance, replacing a `portalAccess` boolean.
/// Answers the questions you actually get asked after an incident: who let this
/// person in, when, what does it cover, and is it still live?
model PortalGrant {
  id            Int       @id @default(autoincrement())
  contactId     Int       @map("contact_id")
  companyId     Int       @map("company_id")  // denormalised: the company as at grant time
  grantedBy     String    @map("granted_by") @db.VarChar(255)
  grantedAt     DateTime  @default(now()) @map("granted_at")
  /// Tickets created before this instant are out of scope unless the contact
  /// was the requester on them. See "History scope" below.
  effectiveFrom DateTime  @map("effective_from")
  revokedBy     String?   @map("revoked_by") @db.VarChar(255)
  revokedAt     DateTime? @map("revoked_at")
}
```

A grant is never edited, only revoked and re-issued — so the sequence of grants
is a legible history rather than a mutated cell. Workstream C's
`Contact.portalAccessRevokedAt` collapses into `PortalGrant.revokedAt`, which
says the same thing and also records *who*.

### History scope — where your design and codex's instinct meet

Widening visibility from "own tickets" to "the whole company" collides with the
transfer quarantine Workstream C built, and the collision is the interesting
part. If a contact moves from Company A to Company B, a naive company-wide read
hands them every ticket B ever filed, including years before they existed.
Codex's instinct says that is wrong. Your requirement says a client's new IT
manager genuinely does need the company's context.

Both are right, so the design makes the choice **explicit instead of picking a
side**. `effectiveFrom` defaults to the grant timestamp — a new contact sees the
company's tickets from the day they were let in, plus any older ticket where
they were personally the requester. A technician approving the grant can widen
it to the full history with one deliberate control ("give access to past
tickets"), which is recorded in the grant and therefore auditable.

That keeps the safe default, serves the real use case, and turns "should they
see the old stuff?" from an accident of implementation into a decision someone
made on the record.

### Revocation means revoked

Because every portal read re-derives authorization from the live grant, removing
access takes effect on the next request rather than whenever a session happens
to expire. Portal sessions bound to a revoked grant are rejected at the auth
hook, not merely hidden in the UI. A boolean checked at login time could not
promise that.

---

## 2. What a customer sees: the company, not just themselves

Scope widens from "own tickets" to **all tickets for their company**. That is
what customers expect and what an MSP's client contact actually needs.

It also raises the stakes on the visibility boundary, because one over-shared
note is now visible to every approved contact at that company rather than to one
person.

### Internal vs. customer-visible notes

Workstream C already landed the correct model:
`Note.portalVisible Boolean @default(false)`.

**The default polarity is the whole safety argument, and it must not be
inverted.** A note is internal unless someone deliberately publishes it. The
alternative — public by default with an "make it internal" checkbox — means
every technician's frank assessment (*"customer is being unreasonable, escalate
to billing"*) is one forgotten click from the customer reading it. Defaults are
what happens when people are busy, and the failure is unrecoverable: you cannot
un-show a note.

So the UI is **"Visible to customer" (unchecked)**, not "Internal only"
(unchecked). Same checkbox, opposite label, opposite blast radius.

**On the green-text idea:** I'd push back on green specifically. Green reads as
success/go everywhere, including this codebase's own reserved status palette
(good / warning / serious / critical), so green-for-internal fights every other
signal in the product. Internal is a *restriction*, not a good outcome.

Recommended instead, and consistent with the existing "never color alone" rule:

- Internal notes (the default): a muted/neutral tinted background with a **lock
  icon and the words "Internal — not visible to customer"**.
- Customer-visible notes: normal surface with an outward arrow icon and
  "Visible to customer".

Both states are always labelled in text. A technician should never have to
remember what a colour means to know who is about to read what they typed.

Email notes are inherently customer-visible (we already sent them) and render
that way automatically. Time entries are never portal-visible.

### Who the customer sees: technician identity

Workstream C renders every staff reply as **"Support"** with no name, and tests
that the technician's identity is never serialized. That is the right *default*
— it protects techs from being contacted directly, lets work rotate without the
customer noticing, and leaks nothing about team size or who is on shift.

But it is a business preference, not a security property, and it cuts both ways:
plenty of MSPs sell exactly the opposite ("your engineer is Jess"). So it becomes
an **admin-settable flag**, defaulting to the anonymous behaviour that ships
today.

**Two consents, not one.** The admin enables the *capability*; the technician
controls what is *published about them*. An admin flipping one switch must not
broadcast a technician's mobile number to every customer — in some jurisdictions
that is a personal-data problem, and in all of them it is rude.

So identity comes from a distinct **portal display profile** rather than reusing
account fields:

```prisma
model UserPortalProfile {
  userId       Int     @id @map("user_id")
  displayName  String? @map("display_name") @db.VarChar(150)  // "Jess S." if they prefer
  avatarId     Int?    @map("avatar_id")                       // Attachment storage seam
  publicEmail  String? @map("public_email") @db.VarChar(255)
  publicPhone  String? @map("public_phone") @db.VarChar(50)
  optedIn      Boolean @default(false) @map("opted_in")
}
```

`User.email` is a **login credential and may be a personal address**; it must
never be published implicitly. `publicEmail`/`publicPhone` are separate, opt-in,
and blank by default. Avatars reuse the existing `AttachmentStorage` strategy
(local disk or S3) rather than adding an image path.

**Recommended default when the flag is on: name and avatar, but no direct
contact details.** That delivers essentially all of the personal-touch benefit —
a face and a name make the conversation feel human — without the operational
cost the direct route brings: email and phone invite customers to bypass the
ticket, so the work stops being tracked, SLA clocks stop reflecting reality, and
the reporting Workstream B is building quietly becomes wrong. Shops that
genuinely want direct contact can still enable it per technician; it should just
be the deliberate choice rather than the automatic consequence of wanting a
friendlier portal.

Resolution order for what renders: technician opted out, or flag off → "Support".
Otherwise `displayName` (falling back to the staff display name) plus avatar,
plus whichever public contact fields that technician filled in.

Per-company overrides (named techs for premium clients, anonymous for the rest)
are a plausible later refinement and explicitly out of scope for v1.

---

## 3. Feedback: build it, don't adopt it

**Recommendation: build. Do not take a dependency.**

I looked at whether an off-the-shelf module is worth adopting, and the answer is
no, for four reasons:

1. **Hosted services are disqualified by the product's own pitch.** Frill,
   Canny, Formbricks Cloud and friends move customer-satisfaction data about an
   MSP's clients off the box. AnchorDesk's trust story is "local-first, read the
   code before you hand it your RMM keys" — shipping CSAT to a third party
   contradicts it.
2. **The credible self-hostable options are AGPL** (Formbricks, Fider).
   AnchorDesk is MIT and [roadmap-3.0.0.md](roadmap-3.0.0.md) deliberately keeps
   it MIT through 3.0 to preserve the auditable-source story and the option to
   relicense forward. Coupling to AGPL muddies that for a feature this small.
3. **The data has to live here anyway.** CSAT is only useful in the reports
   Workstream B is building — satisfaction by technician, by company, over time.
   An external store means syncing it back, which is more work than storing it.
4. **It is genuinely tiny.** One table, one portal endpoint, one staff read
   surface. MUI already provides the controls; a three-state sentiment is a
   `ToggleButtonGroup` with three icons. There is no library here worth its
   integration cost.

### Minimal shape

```prisma
model TicketFeedback {
  id          Int      @id @default(autoincrement())
  ticketId    Int      @map("ticket_id")
  rating      String   @db.VarChar(10)   // positive | neutral | negative
  comment     String?  @db.Text
  contactId   Int      @map("contact_id")
  submittedAt DateTime @default(now()) @map("submitted_at")
}
```

Design calls worth making explicitly:

- **Multiple entries per ticket are allowed**, ordered by time. A ticket that is
  resolved, reopened, and resolved again earns a second rating; forcing one row
  per ticket would either lose the second or overwrite the first. Reports read
  the latest and can show the trail.
- **Staff can read feedback but never edit or delete it.** It is the customer's
  word. Enforced at the repository, not by convention, and audited.
- **Feedback never pushes to Jira or ConnectWise**, for the same reason merge
  doesn't: it is a local record with no faithful remote equivalent.
- Ratings are stored as their own vocabulary and validated server-side, matching
  how `ticketVocab.ts` guards status and priority.

### "Mark my case as solved"

The natural moment to ask for feedback is the moment the customer says it's
fixed, so the two ship together: solving prompts for a rating, and the rating is
optional — a customer who just wants it closed can close it.

- Sets status to `Resolved` through the existing vocabulary — the portal must
  not invent a status value.
- Attributed to the contact, audited, and rendered in history as a customer
  action rather than a staff one.
- **Must respect the merge tombstone rule.** A solve arriving for a merged
  ticket resolves through `resolveMergeTarget()` to the survivor, exactly like
  inbound mail; it must never re-close a tombstone or act on a ticket the
  contact cannot see.
- Reopening stays a staff action in v1; a customer replying to a resolved ticket
  should surface it to the queue rather than flipping status by itself.

---

## Sequencing

This layer depends on Workstream C's substrate and should not start before it
merges. Suggested split, cut from the bottom:

1. Note visibility UI (the checkbox + labelling) — smallest, highest safety
   value, and useful to staff even with no portal users.
2. Per-contact portal access toggle + auto-send on grant.
3. Company-wide ticket visibility.
4. Registration + approval queue.
5. `TicketFeedback` + "mark my case as solved".
6. CSAT in reporting (folds into Workstream B).

Items 1–2 are worth doing regardless of whether registration lands, because they
make the existing portal safe to hand to a human.
