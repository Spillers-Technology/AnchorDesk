# AnchorDesk 2.8.0 — Access & Signal (minor)

2.7's Workstream C shipped the portal's *substrate* — magic-link auth,
Contact-bound sessions, a locked-down serializer — deliberately gated off by
default. Portal v2 is the layer on top: how a customer actually gets in, what
they see once they're in, who they're talking to, and whether we asked how we
did.

## Access is a record now, not an implication

Before 2.8.0, once `portal.enabled` was switched on, any Contact whose email
matched exactly one CRM record could request a sign-in link. That's not a data
leak — every read was still scoped to that Contact's own tickets — but it's an
un-asked-for capability, and this release closes it.

`PortalGrant` replaces the implicit rule with an explicit one. A technician
grants portal access from the contact's row in Companies; that creates a
timestamped, audited record of who granted it, when, and (for company-wide
scope) from what point the grant covers. Signing in now requires an active
grant. Revoking one tears down the contact's live portal sessions and any
unredeemed magic link in the same transaction as the revocation — access ends
on the next request, not whenever a stale cookie happens to expire.

Existing contacts get zero grants on upgrade. Nobody gains portal access by
this release landing; someone has to grant it.

## Self-registration, reviewed by a human

A visitor can now request access at `/portal/register` instead of a
technician having to grant it cold. The response is the same generic "check
your email" message regardless of whether the address matches anything — no
enumeration of your CRM. A domain match against an existing Company is only a
*hint* shown to the reviewer, never an entitlement; anyone can buy a
lookalike domain.

Admins work a real queue under **Ticketing → Portal Requests**: approve or
reject each request. Approval reuses an exact-one existing Contact if the
email already matches one, or creates a Contact on the matched Company if not
— and refuses (409, not a guess) when the request has no company match or the
email is ambiguous across legacy contacts. Approving sends the sign-in email
only after the access record commits, so a slow mail relay can't roll back an
audited approval.

## Company-wide scope and named technicians, both opt-in

Two more admin toggles under **Customer Portal** settings, both defaulting to
today's existing behavior:

- **Ticket scope** — `own` (unchanged) or `company`. Company-wide lets a
  requester see every ticket at their company from their grant's start date
  onward, plus anything they personally opened, at any age.
- **Technician identity** — anonymous (unchanged, renders "Support") or
  named. Even with named identity on shop-wide, a technician's real name and
  avatar only appear once *they* opt in from Account → Portal profile. Their
  login email is never published; a separate public email/phone stays blank
  until they fill it in. Avatar URLs are signed (HMAC-SHA256, timing-safe
  verification) and re-check both consents on every image request, so
  disabling either one takes effect immediately, not just for new links.

## Feedback and self-solve close the loop

A requester can leave a positive, neutral, or negative rating with an
optional comment — multiple times per ticket, since a reopened-then-resolved
ticket earns a second word. Staff can read the trail on the ticket; nobody,
including staff, can edit or delete it. It's the customer's word.

Where enabled, a requester can also mark their own ticket "solved" directly.
If the ticket has since been merged into another one, the solve resolves
through to the surviving ticket rather than writing to a tombstone nobody's
watching — and if the requester doesn't actually have access to that
survivor, it fails the same ownership check any other portal action would.

Both are admin-gated (**Feedback (CSAT)** settings) and default on.

## A report to read it back

**Reports → Customer satisfaction** groups every rating by company for the
selected date range — a chart for the top ten, a table for every row. Unlike
the other report cards, this one never shows the "reconstructed history"
banner: feedback only exists from the moment a shop starts collecting it,
so there's nothing to reconstruct.

## Fixed: a live safety bug in the note composer

While building the note-visibility toggle for Phase 1 of this release, we
found that `POST /tickets/:id/notes` had been deriving customer-visibility
from `noteType` alone — and because the ticket composer never exposed a way
to mark a note internal, *every staff note silently went out as
customer-visible* and eligible to sync to Jira/ConnectWise. `visibility` now
defaults to `internal` unless explicitly published, and the composer has a
labelled toggle: a lock icon and "Internal — not visible to customer" when
unchecked, an outward arrow and "Visible to customer" when checked. Never
color alone.

If you're running with the portal enabled, this also means any note created
through the API or an integration without an explicit `visibility` field will
now land internal by default, matching the safer polarity.

## Upgrading

Pull and restart. The schema adds four tables (`PortalRegistration`,
`PortalGrant`, `UserPortalProfile`, `TicketFeedback`) and one column
(`UserPortalProfile.avatarStorageBackend`) — all additive, no destructive
changes, applied automatically by the existing `prisma db push` init step.

`portal.enabled` stays exactly where you left it. If your shop already runs
the customer portal, existing contacts keep working (their sessions aren't
touched), but nobody new gains portal access until you grant it — the
implicit "any matching email" behavior this release replaced only affected
future sign-in attempts, not anyone already using it.

Node.js 22.12+ is unchanged.
