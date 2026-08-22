# AnchorDesk 2.7.2 — The query nobody ran (patch)

Both knowledge-base list endpoints returned **500** in 2.7.0 and 2.7.1:

```
GET /kb/articles?includeUnpublished=true
→ 500 P2010: Raw query failed. Code: `42883`.
  ERROR: function left(text, bigint) does not exist
  HINT: No function matches the given name and argument types.
```

## The bug

`LEFT(body_text, ${EXCERPT_LENGTH + 1})` interpolates a JS number, and Prisma
binds that as `int8`. Postgres defines only `left(text, integer)`; there is no
`bigint` overload. So the statement failed at **plan time** — not on a row, not
on an edge case, but on every single request, no matter what the table held.

`listPublishedForStaff` (Browse) and `listForAuthors` (Manage) both used it. The
knowledge base had no working list view at all.

This is the real reason the knowledge base "didn't work" on a live install.
2.7.1 looked at an empty shelf and diagnosed discoverability — new articles
default to drafts, Browse lists published only, and the empty state gave advice
that could not apply. That was a genuine bug and the fix stands. But it was the
*second* bug. This one was underneath it the whole time.

The fix is a cast: `LEFT(body_text, ${EXCERPT_SQL_LENGTH})` where
`EXCERPT_SQL_LENGTH` is `Prisma.sql\`${EXCERPT_LENGTH + 1}::int\``, named and
commented so it is not later removed as clutter.

## The more useful half: why the tests were green

A full suite passed — 826 tests — while every knowledge-base list request
returned 500. That gap matters more than the missing cast.

**The unit suite mocks `$queryRaw`, and a mock accepts any string as SQL.** The
assertion was:

```ts
expect(query.text).toContain('LEFT(body_text,');
expect(query.values).toContain(221);
```

Both passed. Both would still pass against SQL Postgres cannot parse, because
nothing here ever reaches a database. A test that can only inspect the SQL it
just composed cannot distinguish valid SQL from invalid SQL — it verifies our
string-building, and string-building was never the problem.

**The suite that could have caught it never ran.**
`kbArticleRepository.postgres.test.ts` executes real statements, but it covered
`create`, `getPublishedPortalBySlug`, and `searchPublishedPortal` — not either
list function — and it is gated behind `KB_POSTGRES_TESTS=1`. Nothing in CI set
that. The backend workflow even declared a `DATABASE_URL` while providing no
database, which is precisely what made the skip invisible: it looked configured.

So both list statements now execute against real Postgres, asserting the
published/draft boundary, the `published: false` filter 2.7.1 added, and that
`LEFT()` still truncates the excerpt. The regression was confirmed the only way
worth trusting: the new test reproduces the original `42883` against the
pre-fix code, then passes with the cast.

And **CI runs it now** — a separate `postgres-tests` job with a Postgres service
container. Separate on purpose: if a runner cannot provide the service, that
should fail loudly in its own job rather than silently skip inside the unit run,
which is the failure mode that let this ship twice.

## Scope of the audit

The rest of the raw SQL was checked for the same class of error — a JS number
bound into a type-strict function overload. `date_trunc` receives a timestamp,
and `ts_rank_cd`'s normalization argument is an inline literal rather than a
bound parameter. `left()` was the only site.

## Upgrading

Pull and restart. No schema change and no data migration. Existing articles
become listable immediately.

Node.js 22.12+ and the local-first PostgreSQL model are unchanged.
