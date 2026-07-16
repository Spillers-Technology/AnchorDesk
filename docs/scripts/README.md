# Product media capture

Two Playwright scripts drive the AnchorDesk web client with a full set of
mocked `/api/*` responses (no backend or database needed):

- **`capture-product-media.mjs`** — desktop hero shots (1440×960) into
  [`docs/assets/screenshots/`](../assets/screenshots/). These are the images
  used by the README and the docs site (with the lightbox in
  `docs/assets/lightbox.js`). Captured views: **board**, **ticket modal**,
  **My Day**, **Companies**, **Network**, **Sync**.
- **`capture-mobile-media.mjs`** — the **mobile verification matrix**
  ([docs/mobile.md](../mobile.md)): **login**, **board**, **saved views**,
  **Kanban columns**, **advanced filters**, **ticket**, **ticket history**,
  **composer**, **cards**, **My Day**,
  **Companies**, **Network**, **Sync**, and the **Admin** dashboard, teams,
  custom fields, automations, devices, and device-asset editor across five
  touch device profiles (Galaxy 360, iPhone 393, Pixel 412, folded foldable
  344, unfolded foldable 717). Output lands in
  `docs/assets/screenshots/mobile/` — **gitignored** working artifacts; curated
  marketing shots (e.g. `anchordesk-mobile-board.jpg`) are copied into the
  committed folder by hand.

Both import **`mock-api.mjs`**, which owns the fixture dataset, the
`handleApi()` route handler, and shared helpers: `installApiMock(page, { authenticated })`
(pass `authenticated: false` to get a 401 from `/auth/me` so the login screen
renders), `freezeAnimations(page)` (deterministic screenshots), `loadPlaywright()`,
`waitForServer()`, and `openDrawer()`.

## Regenerating the screenshots

1. **Start the web client** (the scripts talk to it over HTTP; every `/api/*`
   call is intercepted and mocked, so no backend is required):

   ```bash
   cd web-client && npm run dev        # serves http://localhost:5173
   ```

2. **Make Playwright available.** It is deliberately *not* a package.json
   dependency. Two options:

   - **No browser download (recommended)** — use `playwright-core` and drive an
     already-installed browser via a channel:

     ```bash
     npm install --prefix "$TEMP/anchordesk-playwright" playwright-core
     export PLAYWRIGHT_NODE_MODULES="$TEMP/anchordesk-playwright/node_modules"
     export PLAYWRIGHT_CHANNEL=msedge        # or "chrome"
     ```

   - **Full package** — downloads a bundled Chromium:

     ```bash
     npm install --prefix "$TEMP/anchordesk-playwright" playwright
     export PLAYWRIGHT_NODE_MODULES="$TEMP/anchordesk-playwright/node_modules"
     ```

3. **Run the captures** from the repo root:

   ```bash
   node docs/scripts/capture-product-media.mjs   # desktop hero shots
   node docs/scripts/capture-mobile-media.mjs    # mobile matrix (95 shots)
   ```

   Review the desktop diff before committing. While iterating on a mobile fix,
   filter the matrix:

   ```bash
   ANCHORDESK_CAPTURE_DEVICES=galaxy,fold-closed ANCHORDESK_CAPTURE_VIEWS=saved-view,kanban-columns \
     node docs/scripts/capture-mobile-media.mjs
   ```

### Environment variables

| Variable | Purpose |
|---|---|
| `PLAYWRIGHT_NODE_MODULES` | Folder holding a `playwright` or `playwright-core` install |
| `PLAYWRIGHT_CHANNEL` | Browser channel for `playwright-core` (e.g. `msedge`, `chrome`) |
| `ANCHORDESK_CAPTURE_BASE_URL` | Web-client URL (default `http://127.0.0.1:5173`) |
| `ANCHORDESK_CAPTURE_DEBUG` | Set `1` for browser console logs + a failure screenshot |
| `ANCHORDESK_CAPTURE_OUT` | Mobile script only: override the output directory |
| `ANCHORDESK_CAPTURE_DEVICES` | Mobile script only: comma list of device names to capture |
| `ANCHORDESK_CAPTURE_VIEWS` | Mobile script only: comma list of views to capture |

> On Windows PowerShell, set variables with `$env:NAME = "value"` instead of `export`.

## Adding a new view

New views are **required** to join the mobile matrix (see
[docs/mobile.md](../mobile.md)):

1. Add its mock responses in `mock-api.mjs` → `handleApi()` (match the real
   endpoint shapes).
2. Add a drive step in **both** `capture-product-media.mjs` (if it deserves a
   hero shot) and `capture-mobile-media.mjs` — follow the existing steps as a
   template. Tip: on phone viewports, click targets can end up under the fixed
   AppBar; scroll with `el.scrollIntoView({ block: "center" })` and use
   `dispatchEvent("click")` as the existing steps do.
3. Run the matrix and check the new view at every width.
