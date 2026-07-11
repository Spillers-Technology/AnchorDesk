# Product media capture

`capture-product-media.mjs` drives the AnchorDesk web client with a full set of
mocked `/api/*` responses (no backend or database needed) and screenshots the key
views into [`docs/assets/screenshots/`](../assets/screenshots/). Those images are the
hero shots used by the README and the docs site (with the lightbox in
`docs/assets/lightbox.js`).

Captured views: **board**, **ticket modal**, **My Day**, **Companies**, **Network**,
**Sync**.

## Regenerating the screenshots

1. **Start the web client** (the script talks to it over HTTP; it intercepts and
   mocks every `/api/*` call, so no backend is required):

   ```bash
   cd web-client && npm run dev        # serves http://localhost:5173
   ```

2. **Make Playwright available.** Two options:

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

3. **Run the capture** from the repo root:

   ```bash
   node docs/scripts/capture-product-media.mjs
   ```

   Output lands in `docs/assets/screenshots/`. Review the diff before committing.

### Environment variables

| Variable | Purpose |
|---|---|
| `PLAYWRIGHT_NODE_MODULES` | Folder holding a `playwright` or `playwright-core` install |
| `PLAYWRIGHT_CHANNEL` | Browser channel for `playwright-core` (e.g. `msedge`, `chrome`) |
| `ANCHORDESK_CAPTURE_BASE_URL` | Web-client URL (default `http://127.0.0.1:5173`) |
| `ANCHORDESK_CAPTURE_DEBUG` | Set `1` for browser console logs + a failure screenshot |

> On Windows PowerShell, set variables with `$env:NAME = "value"` instead of `export`.

## Adding a new view

Add its mock responses in `handleApi()` (match the real endpoint shapes) and a drive
step in `main()` that opens the view and screenshots it — follow the existing steps as
a template.
