# Relations 2.6 — merge and parent/child

Status: **shipped in 2.6.0** (2026-07-25).

Two features that helpdesks are expected to have and AnchorDesk does not: **merging
a duplicate ticket into the one you're keeping**, and **parent/child hierarchy**.

Both are easy to build badly. The failure mode is the same one 2.5 spent its whole
budget fixing: an operation that looks like it worked, quietly diverges from the
external system, and tells nobody. A merge that pushes a half-understood close into
Jira, or a hierarchy that a sync run silently flattens, is worse than not having the
feature.

So the governing decision is deliberately conservative:

> **Merge and hierarchy are local-record operations. They never push. A merged
> ticket stops syncing, and the product says so in plain language at the moment
> you merge.**

That is not a permanent ceiling — [Long term](#long-term-30) maps both onto real
provider link types. It is the version that can ship without a class of bug we
cannot detect.

---

## The model

### Hierarchy — a scalar, not a graph

```prisma
parentId Int?  @map("parent_id")
parent   Ticket?  @relation("TicketHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
children Ticket[] @relation("TicketHierarchy")
```

A column rather than a join table, because hierarchy has cardinality and acyclicity
constraints that a generic link table cannot cheaply enforce, and because "list the
children of #123" should be one indexed lookup.

**Short-term invariant: exactly one level.** A ticket that has a parent may not
itself be a parent. This removes cycle detection entirely — the constraint is
local and checkable in one query — and matches what JSM subtasks actually allow.
Arbitrary depth is a long-term item with a real cycle check behind it.

Enforced twice, on purpose:

1. In `ticketRepository`, inside the transaction that sets `parentId`, with the
   candidate parent and child rows locked.
2. By a Postgres trigger created in `db/pgExtras.ts`, alongside the existing
   fail-closed startup invariants. A repository check protects the application
   path; the trigger protects everything else, including the `prisma studio`
   session and the direct `psql` fix at 2am that is how this data actually gets
   corrupted.

Hierarchy is **never pushed and never pulled** in 2.6. Jira subtasks and
ConnectWise parent-child stay invisible to it, in both directions.

### Merge — a link plus a ledger

```prisma
mergedIntoId Int?      @map("merged_into_id")
mergedAt     DateTime? @map("merged_at")
```

The source ticket is **not deleted**. It stays as a resolvable tombstone, because
its ticket number is already loose in the world — in email subject tokens, in
external references, in somebody's browser history — and every one of those must
still land somewhere sensible.

The source's `status` becomes `Closed` (an existing vocabulary value — merge adds
nothing to `ticketVocab.ts`, so Kanban columns, saved views, and automation
conditions are untouched). `mergedIntoId != null` is the predicate that drives
merge-specific rendering and filtering. Status stays honest; the relation carries
the meaning.

Reversibility is the reason for the second record:

```prisma
model TicketMerge {
  id         Int       @id @default(autoincrement())
  sourceId   Int       @map("source_id")
  targetId   Int       @map("target_id")
  actor      String    @db.VarChar(255)
  mergedAt   DateTime  @default(now()) @map("merged_at")
  unmergedAt DateTime? @map("unmerged_at")
  /// Exact inventory of what moved, so unmerge restores precisely this and
  /// nothing else. Versioned shape; see `mergeLedger.ts`.
  undoPlan   Json      @map("undo_plan")
}
```

Unmerge that works by re-deriving "what probably came from #123" is a guess that
gets worse every day the merged ticket keeps living. The ledger records the exact
note, attachment, checklist-item, child, and label ids that moved, plus the
source's prior status and sync state. Unmerge replays that list. Anything added to
the target *after* the merge stays on the target, which is the behaviour people
expect and the only one the ledger can honestly promise.

---

## What a merge moves

| Thing | Behaviour | Rationale |
|---|---|---|
| Notes (incl. email + time entries) | **Move** to target, stamped `originTicketId` | The conversation is the merge's whole point. Minutes ride along on the note, so time rolls up for free. |
| Attachments | Move | Follow their notes. |
| Checklist items | Move, appending, preserving done state and attribution | They are outstanding work; outstanding work survives a merge. |
| Children | Reparent to target | Never orphan a subtree. |
| Labels | Union onto target | Newly-added ids recorded for undo. |
| Device links | Union | |
| SLA clocks | Source freezes (it is closed). **Target unchanged.** | The target's promise to the customer was made independently; a merge does not renegotiate it. |
| Notifications | Stay on source | They are historical facts about who was told what, when. |

---

## Where the care goes: sync

Five rules, each with a test that fails without it.

**1. Merge never pushes.** No provider call is made by the merge path. Not a close,
not a comment, not a link.

**2. A merged source stops reconciling — unconditionally.** A guard in
`reconcileTicketWithinAccountLock` exactly parallel to the existing conflict hold:

```ts
if (ticket.mergedIntoId) {
  return { ticketId, outcome: 'merged', message: `merged into #${n}; local record only` };
}
```

and the matching guard in the batch inbound path, so `upsertExternal` cannot
resurrect a merged ticket by applying a remote status over it. The outcome is
`merged`, deliberately distinct from `skipped`: skipping is a symptom that
degrades run health, whereas a tombstone left alone is the design working, and
collapsing the two would leave every run permanently degraded for as long as one
merged ticket exists. It still rolls up into `ticketsSkipped` in the `SyncRun`
counters rather than being silently dropped.

The guard is checked once, before the provider round-trip, so the merge also
increments `syncRevision` — the write-back compare-and-set matches on
`(id, syncRevision)`, and without the bump a reconcile already past the guard
would stamp the tombstone synced or reapply a remote status over it.

**3. The stop is stated, not implied.** Merging a two-way-synced source requires
the client to echo back an acknowledgement code. Without it the route 400s. The UI
renders the sentence, not a shrug:

> **HELP-1 stays open in Jira.** AnchorDesk will stop syncing it. The Jira issue is
> not closed, commented on, or linked by this merge.

Same mechanism for a cross-company merge (`acknowledge: ['cross-company']`), which
is legitimate for an MSP consolidating a client's duplicates but should never
happen by accident.

**4. Note reparenting is push-safe by construction — with one hole to plug.**
`pushUnsyncedNotes` already selects `externalId: null AND syncPending: true`, so a
note that was already delivered to the source's remote carries an `externalId` and
can never be re-pushed to the target's. That falls out of the 2.5 outbox design and
is worth stating because it is load-bearing.

The hole: a note still queued for the *source's* remote, moved onto a target that
is **not** two-way synced, keeps `syncPending: true` forever with nothing that will
ever drain it. Merge clears `syncPending` on moved notes when the target has no
writable remote, and records the cleared ids in the ledger.

**5. Mail threading follows the merge.** All three thread-resolution paths in
`imapService` (References/In-Reply-To on a note, root ticket `externalId`, and the
`[#NNNNN]` subject token) funnel through one new `resolveMergeTarget()` that walks
`mergedIntoId` to the survivor. Chains are walked, not path-compressed, with a
depth cap that fails closed — path compression would make the ledger lie.

Without this rule, a customer replying to the thread you just merged away opens
correspondence on a closed tombstone nobody is watching. This is the single most
likely real-world regression in the whole feature.

---

## Fail closed

Rejected outright:

- merge into self
- merge into a descendant of the source (would orphan or cycle the hierarchy)
- source is already merged
- source is in `conflict` sync state — resolve the conflict first; a merge must not
  be a way to bury one

Handled rather than rejected:

- **merge into an already-merged target** follows the chain to the live survivor.
  Merging into a tombstone means the survivor, and pretending otherwise is a
  worse answer than doing it.

---

## Surface

REST, and — per the release invariant — MCP in the same change.

| Method | Path | Notes |
|---|---|---|
| GET | `/tickets/:id/merge-preview?targetId=` | What would move, plus warning codes. Modelled on the 2.4 automation preview. |
| POST | `/tickets/:id/merge` | `{ targetId, acknowledge?: string[] }` |
| POST | `/tickets/:id/unmerge` | Replays the ledger |
| PATCH | `/tickets/:id` | Accepts `parentId` (`null` detaches) |
| GET | `/tickets?parentId=` · `?hasParent=` | List filters |

MCP: `preview_ticket_merge`, `merge_tickets`, `unmerge_ticket`,
`set_ticket_parent`, `list_ticket_children`; `get_ticket` gains
`parent` / `children` / `mergedInto`.

UI: a merge dialog with target search, a preview of exactly what moves, and the
acknowledgement sentences as explicit checkboxes; a "Merged into #N" banner on the
source; a parent chip and a children section with progress on the target. All
full-screen at phone width, all added to the capture matrix
(`ticket-merge-dialog`, `ticket-merge-warnings`, `ticket-children`).

---

## Known limitations at 2.6.0

Found in the pre-release review pass, judged not worth a late refactor, and
recorded here so they are not rediscovered as surprises.

- **Preview-to-commit warning staleness.** Warnings are computed by
  `previewMerge` outside the transaction; only the blockers are re-checked under
  the row locks. A concurrent `PATCH` that moves the target to another company
  between preview and commit lets a merge through without the `cross-company`
  acknowledgement the operator would otherwise have had to tick. The blockers
  that protect data integrity (already-merged, descendant, one-level) *are*
  re-checked under the locks; it is only the consent prompts that can go stale.
  Re-evaluating warnings inside the transaction is the fix.
- **`cross-company` needs both `companyId`s.** A ticket with a null company
  never raises the warning. Since 2.0 every ticket resolves to a real company,
  so this is reachable only for pre-2.0 rows.
- **`hasWritableRemote` is an identity-presence test.** It checks for
  `externalId + externalProvider` rather than asking the provider whether it can
  actually write back, so a note queued for a source whose target is attached to
  a read-only or disabled provider can keep `syncPending` set. Asking the
  registry for `canWriteBack` is the fix.
- **`PATCH /tickets/:id` is not atomic across `parentId` + fields.**
  `setParent` commits in its own transaction before the field update runs, so a
  request that reparents *and* supplies an invalid foreign key returns 400 with
  the reparent already applied. Fixing it means threading one transaction
  through both repository calls.
- **Automations still observe the survivor.** A merge publishes `ticket.updated`
  for the target, and an automation rule matching it can change the survivor,
  which for an externally-synced survivor eventually pushes. The merge itself
  makes no provider call; this is user-configured automation reacting to a
  ticket that genuinely did change. Called out because it is the one path by
  which a merge can indirectly reach a remote system.

---

## Long term (3.0)

Carried so it is not lost:

- **`TicketLink`** — a typed graph (`relates`, `blocks`, `duplicates`) alongside
  the hierarchy scalar. Merge records a `duplicates` link, which is what makes the
  next item possible.
- **Arbitrary-depth hierarchy** with a real cycle check, replacing the one-level
  invariant.
- **Provider link mapping.** `TicketProvider` declares `supportsHierarchy` /
  `supportsLinks`; Jira maps to subtask + issue links, ConnectWise to parent-child.
  Two-way, under the same conflict-hold discipline as fields.
- **Merge that pushes.** Jira has no merge API — the faithful translation is a
  `duplicates` link plus a close, which is exactly what a careful implementation
  does by hand today. Behind a per-connection policy, off by default.
- **Rollup policy.** Optionally block closing a parent while children are open;
  roll child time onto the parent in reports.
- **Merge across connections** — currently allowed and acknowledged, but the
  provenance story for a note that changes tenant deserves better than a warning.
