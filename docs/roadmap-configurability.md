# Configurability pass — which opinions get a toggle

Status: **pass 1, opened for review** (2026-07-26).

2.7 shipped a lot of opinions as hard defaults: technicians are anonymous to
customers, notes are internal unless published, reports use percentiles rather
than averages, merged tickets vanish from the portal. Each was defensible in
isolation. Taken together they add up to a product telling every shop how to run
their desk, which is not what we're building.

This is the pass that asks, for each one: **is this a safety property, or is it
my taste?**

## The rule for deciding

A hard default is right when the wrong setting is **unsafe or silently
corrupting**. A toggle is right when **reasonable shops genuinely differ and
both settings are honest**.

Three questions, in order:

1. **Can the non-default choice leak data or lose it?** If yes, it is not a
   toggle. "Configurable" is not a defence when someone's private note reaches a
   customer.
2. **Does the wrong setting silently make something else wrong?** A setting that
   corrupts a metric, an SLA clock, or a report is worse than no setting,
   because the damage is invisible.
3. **Would two competent MSPs actually disagree?** If not, a toggle is just
   surface area — another thing to document, test at both values, and get wrong.

Anything that clears all three becomes a toggle. Everything else stays
opinionated **and says why in the UI**, because an unexplained restriction reads
as a missing feature.

## A — Admin / tenant toggles

| Setting | Default | Why it's a real disagreement |
|---|---|---|
| `portal.enabled` | **off** | Already a 2.7 release gate. Nobody should acquire a customer portal by upgrading. |
| `portal.technicianIdentity` | anonymous | Settled: some shops sell "your engineer is Jess", others protect techs from direct contact. Per-technician opt-in sits underneath it. |
| `portal.ticketScope` | own tickets | Company-wide is what most customers expect, but a shop with several unrelated contacts at one client may not want them reading each other's tickets. |
| `portal.allowAttachments` | on | Some shops refuse inbound customer files outright. |
| `portal.allowSelfSolve` | on | "Mark my case as solved" is not universally wanted. |
| `kb.publicHelpCenter` | **off** | A genuinely public, unauthenticated KB is a real product some MSPs want — and it is the honest home for the anonymous read that Workstream D left behind a seam. Off by default; when on, it is a stated decision. |
| `feedback.enabled` / `feedback.promptOnSolve` | on / on | Plenty of shops do not want to ask, or want to ask elsewhere. |
| `reports.perTechnicianVisibility` | admins only | Whether ordinary techs can see each other's throughput is culture, not security. Some teams are transparent by design; others would find it toxic. |
| `tickets.defaultPriority` | Medium | Forcing *a* priority stays mandatory (a null priority renders as an unset chip everywhere). *Which* one is taste. |

## B — Per-user profile

Today a user gets `themePref`, `kanbanColumns`, and `signatureHtml`. That is a
thin profile for a tool people live in all day.

| Setting | Why |
|---|---|
| **`timezone`** | The most valuable item in this document. Workstream A buckets reports by **UTC calendar day** — correctly, so results don't shift with the database session — but a technician in UTC−7 asking "how did we do today?" is shown a day that ends at 5pm their time. Reports make this visible for the first time; without it, every daily number is subtly wrong for anyone not on UTC. Display-only: storage stays UTC. |
| `portalProfile` | Display name, avatar, optional public email/phone. Already designed; the technician's half of the identity consent. |
| `notificationPrefs` | Which events actually notify you. There is no per-user control today, so the bell is all-or-nothing and people learn to ignore it. |
| `defaultView` | Board vs cards vs table. Currently a global admin choice; it is obviously personal. |
| `density` | Comfortable vs compact rows. Cheap, and people feel strongly. |

## C — Deliberately NOT toggles

The important half. Each of these is a place where I will refuse the setting and
explain instead.

- **Note visibility default (internal).** A `notes.publicByDefault` option is a
  loaded gun. The failure is unrecoverable — you cannot un-show a note — and it
  fires precisely when someone is busy, which is always. Shops that want fast
  customer-visible replies get a better answer: make publishing one obvious
  click, not a default.
- **Percentiles over averages.** Not taste. A mean response time is dominated by
  outliers and will confidently report that a desk is healthy while half its
  customers wait a day. We can *additionally* show the mean, labelled beside the
  median. We do not offer "use averages instead."
- **Append-only SLA snapshots and the event spine.** Making history editable
  would defeat the entire reason they exist. No setting.
- **Merge never pushes to Jira/ConnectWise.** Stays hard in 2.7 because the
  faithful translation is a guess. 3.0 maps it to a real `duplicates` link
  behind a per-connection policy — a toggle over a *correct* implementation,
  which is different from a toggle over a guess.
- **Merged tickets hidden from the portal.** Currently a safety measure, not
  taste: attachments carry no per-item audience data, so we cannot prove a
  merged conversation belongs to this requester. It becomes eligible for a
  toggle only once that ledger exists.
- **Audit logging.** Never optional.

## Cost

Cheap (a settings row, a read, a conditional): `portal.*`, `kb.publicHelpCenter`,
`feedback.*`, `tickets.defaultPriority`, `defaultView`, `density`.

Real work: `timezone` (every report boundary and every rendered timestamp),
`notificationPrefs` (a preference model plus filtering in `notificationService`),
`reports.perTechnicianVisibility` (an authorization rule, so it needs tests).

## Open questions for review

1. Is `portal.ticketScope` worth having, or should company-wide simply be
   correct and the per-contact grant be the only control?
2. Should `timezone` be per-user, per-tenant, or both — and does a tenant-level
   "business timezone" belong to SLA calculation rather than display?
3. Is there a fourth question missing from the deciding rule — something about
   whether a toggle's two states can be *tested* affordably?
