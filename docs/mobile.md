# Mobile support — a hard requirement

AnchorDesk's web client is **mobile-first**: every view must remain usable on a
360px-wide touch screen. This is a standing engineering requirement, not a
feature that shipped once — UI changes are verified at phone widths before they
merge (see [Verifying](#verifying-the-matrix) below and the PR checklist).

## Supported device classes

| Class | Widths | Representative devices | What must hold |
|---|---|---|---|
| Phones | 360–430px | Galaxy S-class (360), iPhone 15 (393), Pixel 8 (412) | Everything usable; dialogs full-screen; no horizontal page scroll |
| Folded foldables | 344px | Galaxy Z Fold cover screen | Same as phones — this is the narrowest supported viewport |
| Unfolded foldables / small tablets | 600–900px | Z Fold open (~717), Surface Duo, iPad Mini | Windowed dialogs return; stacked ticket layout; falls out of `sm`–`md` handling with no dedicated code path |
| Desktop | 900px+ | — | Unchanged |

## Breakpoint strategy

MUI's default breakpoints, used consistently:

- **`xs` (<600px) = phone.** Dialogs go full-screen via the shared
  [`useIsPhone()`](../web-client/src/theme/useIsPhone.ts) hook
  (`fullScreen={isPhone}` on `TicketDialog`, the email composer,
  `CreateTicketDialog`, `RunScriptDialog`). Paddings compact
  (`p: { xs: 1.5, sm: 2, md: 3 }` on main), secondary actions collapse to
  icons, master/detail layouts stack.
- **`sm`–`md` (600–900px) = foldable/tablet.** Windowed dialogs with 8px
  margins (theme-level override), two-column grids where they fit.
- **`lg`+ = desktop.** Fluid Kanban columns, side-by-side ticket layout.

Division of labor: **the theme owns dialog chrome and typography scaling**
(`buildTheme()` in [`theme.ts`](../web-client/src/theme.ts) — responsive
`MuiDialog`/`MuiDialogTitle`/`MuiDialogContent` overrides plus
`responsiveFontSizes`); **components own layout** via `sx` breakpoint objects
and `useIsPhone`.

## Touch rules (apply to all future UI work)

1. **No hover-only affordances.** Anything revealed on `:hover` must also be
   reachable on touch — use `@media (hover: none)` to keep it visible (see the
   Kanban card close button in `KanbanBoard.tsx`) and wrap hover styling in
   `@media (hover: hover)` so touch devices don't get sticky hover states.
2. **Every wheel/hover interaction needs a touch equivalent.** The network map
   pairs wheel zoom with two-finger pinch *and* on-screen `+/−/reset` buttons
   (`NetworkMap.tsx`). Handle `pointercancel` in gesture code or the gesture
   wedges.
3. **Interactive targets ≥ 40px** on touch-primary layouts.
4. **No horizontal page scroll, ever.** Wide content (tables, Kanban columns)
   scrolls inside its own `overflowX: "auto"` container. Watch for the two
   classic causes: a flex item missing `minWidth: 0` (App.tsx `main`), and a
   `Grid container` as a direct `Stack` child (Stack's child-margin shorthand
   zeroes the Grid's negative margin — wrap the Grid in a `Box`).
5. **Test with touch device profiles** (`isMobile: true, hasTouch: true`), not
   just a narrow window — hover media queries and touch actionability differ.

## Verifying (the matrix)

The capture harness screenshots every key view across five touch device
profiles with a fully mocked API — no backend or database needed:

```bash
cd web-client && npm run dev        # terminal 1
node docs/scripts/capture-mobile-media.mjs   # terminal 2
```

Playwright is loaded externally (never a package.json dependency) — see
[docs/scripts/README.md](scripts/README.md) for setup. Output lands in
`docs/assets/screenshots/mobile/` (gitignored working artifacts;
`ANCHORDESK_CAPTURE_OUT` overrides). Filter while iterating:

```bash
ANCHORDESK_CAPTURE_DEVICES=galaxy ANCHORDESK_CAPTURE_VIEWS=admin-teams,device-assets \
  node docs/scripts/capture-mobile-media.mjs
```

Review every shot for: no horizontal page scroll, full-screen dialogs with a
reachable close, visible touch affordances, nothing clipped at the right edge.
A vitest guard (`dialogsFullScreen.mobile.test.tsx`) additionally asserts in CI
that the create-ticket and run-script dialogs render full-screen at phone width.

What screenshots can't show, check by hand in devtools device emulation:
map pinch-zoom, Kanban long-press drag, on-screen keyboard vs. the
full-screen composer.

## Rules for future views

- Any new view or dialog **must be added to the view list in
  `docs/scripts/capture-mobile-media.mjs`** (and its data to
  `docs/scripts/mock-api.mjs`) and pass the matrix at 360px before merge.
- UI PRs include at least one phone-width capture as evidence
  (see `.github/PULL_REQUEST_TEMPLATE.md`).

## Known limitations / future work

- The **legacy DataGrid table view** (`TicketTable.tsx`, off by default behind
  Admin → Interface) keeps its desktop-oriented fixed column widths; it
  touch-scrolls but is not a mobile surface. Cards/Kanban are the phone views.
- **No PWA manifest yet** (add-to-home-screen installs work but without
  standalone mode); candidate follow-up.
- **CI screenshot gate deferred**: the capture matrix is a local/manual gate
  for now (the self-hosted runner may not allow browser downloads); the vitest
  full-screen guard is the automated backstop.
