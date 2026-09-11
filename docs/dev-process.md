# Dev Process Log

Records every round where implementation or review work is routed to Codex CLI
(`codex exec`, tiers Luna/Terra/Sol — see `.claude/agents/codex-{luna,terra,sol}.agent.md`), so the
routing policy below stays derived from measurements on *this* repo rather than imported wholesale
from another project. The tiering itself, the dispatcher-agent shape, and the standing-rules
discipline are adapted from the same pattern already proven on PartnerCenterBridge
(`docs/dev-process.md`) and player-2 (`docs/DEV-PROCESS.md`) — Claude orchestrates (plans, dispatches,
adjudicates findings, decides fixes); Codex CLI implements and reviews. This file starts empty and
accrues real entries from here forward — it is not a retroactive account of AnchorDesk's history
before this file existed.

## Routing

- **Luna** — mechanical work: tightly-specified, tests or an exact shape already given, an
  established pattern to mirror (a new repository method shaped like an existing one, a Prisma
  field mirrored across a DTO and its serializer, a React component following an existing
  admin-panel pattern). Never ship unreviewed.
- **Terra** — default consultant: real implementation work without a from-scratch design decision,
  and the default adversarial reviewer for anything Claude or Luna authored.
- **Terra/high** — escalation: nontrivial logic, more than a couple files, anything Terra/medium
  would be guessing on.
- **Sol/high** — architecture, security, tricky debugging, and anything touching:
  - auth, sessions, RBAC, or the OAuth/OIDC/SAML surfaces
  - the portal's requester/session boundary or the serialization allowlist that keeps it from
    leaking staff-only fields
  - two-way sync, merge/unmerge, or parent/child hierarchy invariants
  - a Postgres migration, a trigger, or any raw `$queryRaw`/`Prisma.sql` statement
  - the SLA/event spine's append-only or immutable-by-trigger tables

  regardless of diff size.
- **Sol/ultra** — multi-file implementation (5+ files) or a broad review pass. As an
  *implementer*, requires the user's explicit approval in-session before dispatch — never
  self-initiated.

These are starting priors, not fixed law — revise whichever rule the log below stops supporting.

## Worktrees

Parallel workstreams already run as separate git worktrees (see `git worktree list`) rather than
branches switched in place — for example `ad-2.7-spine`, `ad-2.7-portal`, `ad-2.7-reporting`, and
`ad-2.7-kb` for the 2.7.0 breadth-first push. A Codex dispatch for one workstream must pass that
worktree's own path as `-C`, never the main checkout, so two parallel dispatches never race on the
same working tree. Each `.claude/agents/codex-*.agent.md` file defaults to the main repo path;
override it explicitly in the task you hand the dispatcher when a worktree is in play.

A completed workstream's worktree is stale once its branch merges — `git worktree list` currently
shows old workstream worktrees under `.claude/worktrees/` alongside the active `ad-2.7-*` ones;
confirm a branch is actually merged (`git branch --merged main`) before treating its worktree as
safe to remove, and prefer `git worktree remove` over deleting the directory by hand.

## Standing rules carried over

These are drawn from real incidents already on record in this repo's own `CLAUDE.md` release
history and memory files — not imported from the other two projects. New rules get added here the
same way: after a real defect, not speculatively.

- **Raw SQL is only proven by executing it.** 2.7.2 shipped `LEFT(body_text, ${EXCERPT_LENGTH +
  1})` — Prisma sends a JS number as `int8`, and Postgres defines only `left(text, integer)`, so
  both knowledge-base list endpoints 500'd at *plan time* for every caller, for two full releases.
  826 unit tests stayed green throughout: they mock `$queryRaw`, and a mock accepts any string as
  SQL — asserting `query.text` contains the right fragment proves the query was composed, never
  that Postgres will run it. **Rule: any change to a `$queryRaw`/`Prisma.sql` statement needs a
  case in a `*.postgres.test.ts` suite, run against a real Postgres service container in CI, not
  just a composed-SQL string assertion.**
- **A filter or empty state that silently does nothing is indistinguishable from a broken
  feature.** 2.7.1's knowledge-base fix made Browse correctly published-only, but the empty state
  told authors to reword their search even when the real cause was "nothing published yet" — a
  cause the wording couldn't have been about. **Rule: when an empty result can have more than one
  real cause, the empty state has to be able to say which one, or it reads as the feature being
  broken.**
- **The safe default is the one that costs a false negative, not a false positive — and check
  which one shipped.** Before 2.8.0, `POST /tickets/:id/notes` inferred customer visibility from
  `noteType` alone; because the composer had no visibility control, an ordinary internal note
  silently became customer-visible and eligible to sync outward. The fix flipped the default to
  `internal` and made the polarity a visible, labelled toggle rather than an inferred one. **Rule:
  wherever a default controls exposure (customer-visible, published, portal-readable, externally
  synced), the unreviewed/no-input case must fail closed, and the UI must show which way it's
  currently set — not just be correct in code.**
- **Trust the live repro over a plausible static root cause.** The email-signature dialog crash
  (resolved in 1.12.0) was first diagnosed as a duplicate TipTap `Link` extension from StarterKit
  bundling — a real hygiene issue, convincing on static inspection of the installed dist, and
  *not* the actual crash. The real cause (`editorProps: undefined` when no `onImageUpload` handler
  is supplied) only surfaced running the actual dialog in a live browser. **Rule: for a UI crash or
  hang, a static/plausible theory is a hypothesis, not a fix, until it's confirmed by driving the
  real thing — headless Edge via `playwright-core`, seeded data, watch the console.**
- **Mobile-first is enforced by a capture, not a claim.** Every view has to stay usable on a
  360px-wide touch screen (`docs/mobile.md`); this is checked by screenshotting the real dev
  server across a 5-device matrix (`docs/scripts/capture-mobile-media.mjs`) plus a vitest guard
  asserting full-screen dialog chrome at phone width — not by eyeballing a desktop browser resize.
  **Rule: a new dialog or view is not done until it's in the capture matrix and has been looked at
  at 360px, not just built to the spec.**
- **MCP parity is a release invariant, not a follow-up.** Every ticket workflow shipped through
  web/REST ships with an equivalent MCP tool in the *same* change — checklist apply/add/toggle,
  team/custom-field data on ticket tools, and so on all landed paired, not staged across releases.
  **Rule: a task that adds or changes a ticket-facing REST endpoint isn't reviewable as complete
  without checking whether an MCP tool needs the matching change.**
- **When corruption risk is real, enforce the invariant twice.** The one-level parent/child
  hierarchy rule (a ticket with a parent can't itself be a parent) is checked both under a row lock
  in `ticketRepository.setParent` *and* by a Postgres trigger in `db/pgExtras.ts` — the repository
  protects the application path, the trigger protects a `psql` session run by hand. **Rule: an
  invariant that would corrupt data if violated belongs at the database layer too, not only in the
  code path that's supposed to be the only writer.**
- **A review finding can be right about the problem and wrong about the fix.** Adjudicate the
  problem, choose the fix yourself.
- **Re-read diffs after a fix round** — regressions enter there as often as anywhere else.
- **When a reviewer indicts the spec/design rather than the code, believe it.**
- **Review reads diffs, so it finds defects that live in diffs.** Bugs in lifetime, deployment,
  startup/shutdown ordering, or cross-run state (a scheduler that only misbehaves after several
  ticks, a WebSocket hub that leaks a listener on reconnect) need live verification against the
  running app, not just a diff read — budget for that separately.
- **Verify before trusting, in both directions.** Reproduce a reviewer's finding directly before
  accepting it; reproduce a fix's effect directly before calling it closed.
- **A dispatcher's own report is a claim, not proof the underlying tool call happened.** If a
  dispatch's summary contains any hint the tool call didn't work as expected (an error, a
  fallback, "manual verification instead"), stop and reproduce the underlying command directly
  before trusting anything else in that report.
- **A sandboxed/restricted run can itself produce a false "pre-existing failure" claim.** Confirm
  a claimed permission block or pre-existing test failure by running the same command directly,
  unsandboxed, before accepting it as the explanation.

## Log

_Empty. Add a row per unit once real Codex-routed work starts landing on this repo — task type,
author tier, reviewer tier, defects found/real, tests-instead-of-review count, token/time cost, and
a verdict note, matching the table shape in `docs/DEV-PROCESS.md` (player-2) and
`docs/dev-process.md` (PartnerCenterBridge)._

| Unit | Task type | Author | Reviewer | Defects found | Defects real | Caught by tests instead | Est. tokens | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | CI / Test config | Luna | Terra/high | 0 | 0 | 0 | ~61k | Pass; postgres-tests CI runs test:postgres instead of mocked unit suite and covers all *.postgres.test.ts |
| 1 | Versioned Prisma migrations baseline (14 files: baseline migration + lock file, apply-schema.mjs, entrypoint/CI wiring, 7 docs) | Sol/ultra | Claude (controller, direct) | 2 | 2 | 0 | ~165k (implementer dispatch, 2 sessions) + controller verification | Sol/ultra correctly self-halted on a real spec ambiguity (unit1-spec.md section 4.4's forbidden-object list wrongly named two schema-declared unique indexes, ticket_events_source_key_key/source_audit_kind_key, that Prisma can express and that were already correctly present in its own generated migration) rather than silently picking a side — adjudicated by the controller directly (Prisma-expressible + schema-declared beats "pgExtras.ts references it"), spec's own checklist corrected in practice. Implementer then hit Codex's own sandbox fighting nested container permissions (bubblewrap-in-bubblewrap via podman) without resolving it; controller took over gate execution directly rather than let it keep spinning, standing up disposable Postgres via bare `podman run` (no docker/docker-compose available in this environment) and running every gate for real: Gate A (no drift) exit 0, Gate B (bare db-push vs migrations — the gate the spec's own author said to defend hardest) exit 0, Gate C (postgres integration suite incl. new pgExtras.postgres.test.ts) 3/3 suites, section 9.4 negative control confirmed exit 2 then reverted, Gate D (backend+web-client test/lint/build) all green, plus direct empirical verification beyond the spec's own gates: all four apply-schema.mjs branches (fresh install, pre-2.9 db-push baseline, idempotent re-run, fail-closed on unknown state) run against real databases, and a real Docker/podman image build confirming migrations ship in it. Two real defects found and fixed by the controller, not by a separate reviewer dispatch: (1) the new pgExtras.postgres.test.ts had no describePostgres guard unlike every other *.postgres.test.ts in this repo, so it broke the default `npm test` by trying to reach a nonexistent localhost:5432 — fixed by adding the same ANCHORDESK_POSTGRES_INTEGRATION guard pattern; (2) docs/upgrading.md's "expected drift on a live install" list was stale from before the spec-conflict resolution and additionally wrong on its own terms — empirically re-derived by booting ensurePgExtras against a real migrated database and diffing it, which found Prisma's diff engine is blind to extensions/partial/functional/GIN indexes/CHECK constraints/triggers entirely (they never show as drift, contrary to the original spec's assumption) and the *only* real drift is two plain B-tree indexes (idx_ticket_events_assignee_occurred, idx_ticket_events_team_occurred) — doc rewritten with the tested, not assumed, list. Uncommitted on feat/prisma-migrations-baseline pending operator review, per this session's explicit choice not to auto-commit Sol/ultra implementer output. |
| 1b | Rework of Unit 1 after operator review blocked it (#51): fingerprint-gated 2.8.x-only baseline adoption in `apply-schema.mjs`, frozen `schema-2.8.prisma`, real-install fixtures from the published 2.7.2/2.8.0/2.8.2 images, `verify-baseline-upgrade.mjs` (23 checks) wired into CI | Claude (direct, no Codex dispatch) | **Pending — Sol/high required** (Postgres migration surface per Routing) | — | — | — | not tracked | Not reviewable as complete until Sol/high reviews it. Negative controls run: sabotaging the gate fails exactly the 2.7.2 and tampered cases (6 checks); planting a model in the frozen datamodel fails the 0_init-equality step. Rebuilding #51's review finding with the gate removed reproduced it exactly: a 2.7.2 database left missing 2.8 tables while `_prisma_migrations` recorded 0_init. |
