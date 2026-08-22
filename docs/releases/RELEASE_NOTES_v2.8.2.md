# AnchorDesk 2.8.2 — First Coat (patch)

Phase one of an ongoing UX/quality pass: make the interactions people touch on every screen feel
less abrupt, without turning the app into a motion demo. No new features, no schema change.

## One motion system instead of three inconsistent ones

`theme.ts` previously defined zero transition tokens — every animated surface either rode MUI's
untouched defaults or hand-picked its own duration in a `sx` prop. Two components
(`TicketCard`, the Kanban close affordance) each had their own `0.15s` written by hand, and
`prefers-reduced-motion` was honored in exactly one place (the Network map's canvas), nowhere
else.

- **Reduced motion is now a global rule**, not a per-component afterthought — a `MuiCssBaseline`
  override collapses every transition/animation to near-zero under
  `prefers-reduced-motion: reduce`, everywhere in the app, including the customer portal (it
  shares the same `buildTheme()`).
- **Every clickable surface built on `ButtonBase`** — buttons, icon buttons, list items, menu
  items, tabs — now shares one hover/press transition defined once, instead of each component
  (or none) tuning its own.
- Cards, chips, and table rows get the same treatment: a card lifts slightly and its border/shadow
  animate in on hover instead of snapping; the two components that previously hard-coded their own
  timing now reference the shared tokens.
- The notification bell's badge gives a brief pop when a notification actually **arrives live**,
  instead of the count just silently changing underneath you.

## What's deliberately not here yet

The Network map's Canvas rendering, Kanban drag physics, route-level view transitions, and the
Reports charts are untouched — this phase is scoped to the interaction layer everyone hits
constantly (buttons, cards, list rows, the notification bell), not the flashier surfaces. Later
phases will look at those individually.

## Upgrading

Pull and restart. No schema change, no API change, no data migration — purely visual. Verified
live against a seeded local instance (headless Edge, zero console errors) and at 360px, and the
full test/lint/build suite is unchanged in shape (one new test file for the notification bell's
new behavior).
