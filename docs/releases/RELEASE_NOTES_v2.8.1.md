# AnchorDesk 2.8.1 — Ledger & Log (patch)

No code paths changed. This release is process infrastructure — the kind of thing that's easy to
keep deferring until the mess it prevents has already happened once.

## A dev-process log, adapted from what already works elsewhere

Two sibling projects (PartnerCenterBridge, player-2) have been running the same discipline for a
while: Claude orchestrates, Codex CLI implements and reviews at one of three tiers (Luna for
mechanical work, Terra as the default consultant and adversarial reviewer, Sol for anything
touching auth, sync invariants, migrations, or concurrency), and every real defect a review round
catches gets written down as a standing rule instead of relearned next time.

AnchorDesk gets the same shape now: `docs/dev-process.md` plus three dispatcher agents
(`.claude/agents/codex-{luna,terra,sol}.agent.md`). The routing table and the standing rules aren't
imported wholesale — the rules are drawn from incidents already on record in this repo's own
history: the 2.7.2 outage where a mocked `$queryRaw` let 826 green tests hide a query that failed
at plan time against real Postgres, 2.7.1's empty state that blamed the wrong cause, 2.8.0's
note-visibility default that shipped the wrong polarity, and the 1.12.0 email-signature crash that
a plausible static theory got wrong until someone actually drove the dialog live. The log itself
starts empty — it records real dispatches from here forward, not a backfilled history.

## Release notes, off the root

24 `RELEASE_NOTES_vX.Y.Z.md` files were sitting loose at the repo root. They're now under
`docs/releases/`, with an index. `.github/workflows/publish-images.yml` read that filename by exact
path on every tag push — moving the files without fixing the workflow would have made every future
release silently fall back to auto-generated notes, so that path is updated too, along with the 16
relative links in `CHANGELOG.md`, the one stale link in `README.md` that still pointed at 2.4.1, and
the absolute GitHub link in the documentation site.

## Upgrading

Pull and restart. No schema change, no API change, no data migration. Nothing about how AnchorDesk
behaves is different — only where its release history lives and how future work on it gets
reviewed.
