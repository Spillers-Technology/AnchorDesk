# AnchorDesk 2.7.1 — Drafts you can find (patch)

The first report from a real 2.7 install was "the knowledge base doesn't work."

It did work. The deployment was healthy — both images on 2.7.0, the schema
converged, every FTS and trigram index in place, the portal-facing search
answering correctly. The knowledge base was fine too: creating, listing,
publishing, and searching all behaved exactly as designed.

What was broken was that the knowledge base told the author nothing true about
why their shelf was empty.

## What actually happened

Two articles had been written on that install, a day apart. Both `internal`,
both `published = false`, and both with `updated_at == created_at` — written
once and never opened again.

The sequence explains itself:

1. Open Knowledge base. It lands in **Browse**, which lists published articles
   only. Empty.
2. Write an article. New articles default to a **draft** — the safe default,
   and the right one.
3. Come back later. Browse again. Empty again — with the empty state advising
   *"Try different wording or clear the visibility filter."*

That advice could not possibly have helped, because nothing was published at
all. Nothing on screen said the drafts existed, and nothing said that Browse
was the reason they were absent. The shelf looked broken, so the work stopped.

## The fix

Browse stays published-only. That is correct for a reader, and changing it
would have been the wrong fix. What was missing was never the listing — it was
the *reason*.

- **Authors are told how many drafts Browse is hiding**, with a jump to Manage.
  The count is scoped to the same visibility filter as the list, so the number
  always matches what Manage will actually show.
- **The empty state stops blaming the wording** when the real cause is that
  nothing has been published.
- **"Create article" works from both modes**, not only from Manage.
- **The editor says what a draft means before it is saved**, rather than leaving
  the author to infer it from the article seeming to vanish.

## API and MCP

`GET /kb/articles` gains a `published` filter. The repository already supported
it; only the route could not express it.

It is **rejected** without `includeUnpublished` rather than silently ignored.
The staff listing is hard-coded to published rows, so honouring `published=false`
there would answer "show me only drafts" with an empty list — which reads as
"no drafts exist." That is precisely the class of quiet lie this release exists
to fix, so the route refuses instead.

`list_kb_articles` takes the same filter with the same refusal, keeping MCP at
parity per the release invariant.

## Upgrading

Pull and restart. **No schema change and no data migration** — existing drafts
become visible to their authors immediately, with no action required.

Verified at 344px and 360px through the mobile capture matrix. The mock API
learned the new parameter, so the count the harness screenshots is real rather
than faked.

Node.js 22.12+ and the local-first PostgreSQL model are unchanged.
