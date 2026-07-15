#!/usr/bin/env node
// Mobile verification matrix: screenshots every key view across phone and
// foldable viewports (touch-enabled contexts). This is the working gate for
// mobile support — see docs/mobile.md. Output is gitignored by default; the
// curated marketing shots in docs/assets/screenshots/ are copied by hand.
//
// Usage:  cd web-client && npm run dev   (backend not required — mock API)
//         node docs/scripts/capture-mobile-media.mjs
// Env:    ANCHORDESK_CAPTURE_OUT      override output directory
//         ANCHORDESK_CAPTURE_DEVICES  comma list to filter (e.g. "galaxy,pixel")
//         ANCHORDESK_CAPTURE_VIEWS    comma list to filter (e.g. "board,ticket")
import fs from "node:fs";
import path from "node:path";
import {
  repoRoot,
  baseUrl,
  debugCapture,
  loadPlaywright,
  waitForServer,
  openDrawer,
  installApiMock,
  freezeAnimations,
} from "./mock-api.mjs";

const outDir =
  process.env.ANCHORDESK_CAPTURE_OUT ||
  path.join(repoRoot, "docs", "assets", "screenshots", "mobile");

// Representative device classes, not exhaustive models: a 360px Galaxy-class
// phone, the current iPhone/Pixel sizes, a folded foldable (narrowest real
// viewport we support) and an unfolded foldable (lands in the sm–md band).
const DEVICES = [
  { name: "galaxy", viewport: { width: 360, height: 780 } },
  { name: "iphone", viewport: { width: 393, height: 852 } },
  { name: "pixel", viewport: { width: 412, height: 915 } },
  { name: "fold-closed", viewport: { width: 344, height: 882 } },
  { name: "fold-open", viewport: { width: 717, height: 512 } },
];

function wanted(envVar, name) {
  const filter = process.env[envVar];
  if (!filter) return true;
  return filter.split(",").map((s) => s.trim()).includes(name);
}

async function newDeviceContext(browser, device, { authenticated = true } = {}) {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  if (debugCapture) {
    page.on("console", (message) => console.log(`BROWSER ${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => console.log(`BROWSER pageerror: ${error.message}`));
  }
  await installApiMock(page, { authenticated });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await freezeAnimations(page);
  return { context, page };
}

async function shoot(page, device, view) {
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(outDir, `mobile-${device.name}-${view}.jpg`),
    type: "jpeg",
    quality: 88,
  });
  console.log(`  ✓ ${view}`);
}

async function captureDevice(browser, device) {
  console.log(`\n${device.name} (${device.viewport.width}×${device.viewport.height})`);

  // Login renders only for an unauthenticated user, so it gets its own context.
  if (wanted("ANCHORDESK_CAPTURE_VIEWS", "login")) {
    const { context, page } = await newDeviceContext(browser, device, { authenticated: false });
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor({ timeout: 20_000 });
    await shoot(page, device, "login");
    await context.close();
  }

  const { context, page } = await newDeviceContext(browser, device);
  const view = (name) => wanted("ANCHORDESK_CAPTURE_VIEWS", name);
  const ticketCard = () => page.getByText("VPN drops every 12 minutes", { exact: false }).first();

  try {
    await ticketCard().waitFor({ timeout: 20_000 });
    if (view("board")) await shoot(page, device, "board");

    if (view("saved-view")) {
      await page.getByRole("button", { name: "Save current view" }).click();
      await page.getByRole("heading", { name: "Save view" }).waitFor({ timeout: 20_000 });
      await shoot(page, device, "saved-view");
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Save view" }).waitFor({ state: "hidden", timeout: 5_000 });
    }

    if (view("kanban-columns")) {
      await page.getByRole("button", { name: "Choose board columns" }).click();
      await page.getByRole("heading", { name: "Board columns" }).waitFor({ timeout: 20_000 });
      await shoot(page, device, "kanban-columns");
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Board columns" }).waitFor({ state: "hidden", timeout: 5_000 });
    }

    if (view("ticket") || view("composer")) {
      // On phone viewports scrollIntoViewIfNeeded can park the card under the
      // fixed AppBar, which makes a real click fail actionability. Center it
      // and dispatch the click on the card itself.
      await ticketCard().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await ticketCard().dispatchEvent("click");
      await page.locator('[role="dialog"]').first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(500);
      if (view("ticket")) await shoot(page, device, "ticket");

      if (view("composer")) {
        const emailButton = page.getByRole("button", { name: "Send email" }).first();
        await emailButton.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(200);
        await emailButton.dispatchEvent("click");
        await page.getByText("Send email from ticket", { exact: false }).waitFor({ timeout: 20_000 });
        await shoot(page, device, "composer");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }

    if (view("cards")) {
      await page.locator('button[value="cards"]').click();
      await ticketCard().waitFor({ timeout: 20_000 });
      await shoot(page, device, "cards");
    }

    if (view("myday")) {
      await openDrawer(page, "My Day");
      await page.getByText("Duration-only", { exact: false }).waitFor({ timeout: 20_000 });
      await shoot(page, device, "myday");
    }

    if (view("companies")) {
      await openDrawer(page, "Companies");
      await page.getByText("ACME Manufacturing", { exact: false }).first().waitFor({ timeout: 20_000 });
      await page.getByText("ACME Manufacturing", { exact: false }).first().click();
      await page.getByText("Contacts", { exact: false }).first().waitFor({ timeout: 20_000 });
      await shoot(page, device, "companies");
    }

    if (view("network")) {
      await openDrawer(page, "Network");
      // Device names render on the canvas map, so wait on the HTML chrome instead.
      await page.getByText("Device type, open services", { exact: false }).waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800); // let the canvas settle
      await shoot(page, device, "network");
    }

    if (view("sync")) {
      await openDrawer(page, "Sync");
      await page.getByText("Configured Providers", { exact: false }).waitFor({ timeout: 20_000 });
      await shoot(page, device, "sync");
    }

    const adminViews = ["admin", "admin-teams", "admin-custom-fields", "admin-automations", "admin-devices", "device-assets"];
    if (adminViews.some(view)) {
      await openDrawer(page, "Admin console");
      await page.getByText("Open tickets", { exact: false }).waitFor({ timeout: 20_000 });
      if (view("admin")) await shoot(page, device, "admin");

      if (view("admin-teams")) {
        await page.getByText("Teams", { exact: true }).first().click();
        await page.getByText("Route tickets to queues", { exact: false }).waitFor({ timeout: 20_000 });
        await shoot(page, device, "admin-teams");
      }
      if (view("admin-custom-fields")) {
        await page.getByText("Custom Fields", { exact: true }).first().click();
        await page.getByText("Define structured fields", { exact: false }).waitFor({ timeout: 20_000 });
        await shoot(page, device, "admin-custom-fields");
      }
      if (view("admin-automations")) {
        await page.getByText("Automations", { exact: true }).first().click();
        await page.getByText("Run ordered actions", { exact: false }).waitFor({ timeout: 20_000 });
        await shoot(page, device, "admin-automations");
      }
      if (view("admin-devices") || view("device-assets")) {
        await page.getByText("Devices", { exact: true }).first().click();
        await page.getByText("ACME edge firewall", { exact: true }).waitFor({ timeout: 20_000 });
        if (view("admin-devices")) await shoot(page, device, "admin-devices");
        if (view("device-assets")) {
          await page.getByRole("button", { name: "Edit ACME edge firewall" }).click();
          await page.getByRole("heading", { name: /Device details/ }).waitFor({ timeout: 20_000 });
          await shoot(page, device, "device-assets");
          await page.keyboard.press("Escape");
        }
      }
    }
  } catch (error) {
    if (debugCapture) {
      await page.screenshot({
        path: path.join(outDir, `debug-${device.name}-failure.jpg`),
        type: "jpeg",
        quality: 85,
      });
    }
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();

  console.log(`Using AnchorDesk web client at ${baseUrl}...`);
  await waitForServer();

  const launchOpts = { headless: true };
  if (process.env.PLAYWRIGHT_CHANNEL) launchOpts.channel = process.env.PLAYWRIGHT_CHANNEL;
  const browser = await chromium.launch(launchOpts);

  try {
    for (const device of DEVICES) {
      if (!wanted("ANCHORDESK_CAPTURE_DEVICES", device.name)) continue;
      await captureDevice(browser, device);
    }
    console.log(`\nCaptured mobile matrix in ${path.relative(repoRoot, outDir)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
