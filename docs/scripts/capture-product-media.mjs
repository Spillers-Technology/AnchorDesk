#!/usr/bin/env node
// Desktop product screenshots for README / docs. The mock API + Playwright
// helpers live in mock-api.mjs (shared with capture-mobile-media.mjs).
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

const outDir = path.join(repoRoot, "docs", "assets", "screenshots");

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();

  let browser;
  try {
    console.log(`Using AnchorDesk web client at ${baseUrl}...`);
    await waitForServer();
    console.log("Launching Chromium...");
    // PLAYWRIGHT_CHANNEL (e.g. "msedge"/"chrome") drives an installed browser so
    // playwright-core works without a bundled-Chromium download.
    const launchOpts = { headless: true };
    if (process.env.PLAYWRIGHT_CHANNEL) launchOpts.channel = process.env.PLAYWRIGHT_CHANNEL;
    browser = await chromium.launch(launchOpts);
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    if (debugCapture) {
      page.on("console", (message) => console.log(`BROWSER ${message.type()}: ${message.text()}`));
      page.on("pageerror", (error) => console.log(`BROWSER pageerror: ${error.message}`));
    }
    await installApiMock(page);

    console.log("Rendering board...");
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await freezeAnimations(page);
    try {
      await page.getByText("VPN drops every 12 minutes", { exact: false }).waitFor({ timeout: 20_000 });
    } catch (error) {
      if (debugCapture) {
        console.log("Board wait failed. Body text:");
        console.log(await page.locator("body").innerText({ timeout: 2000 }).catch((e) => e.message));
        await page.screenshot({ path: path.join(outDir, "debug-board-failure.jpg"), type: "jpeg", quality: 85 });
      }
      throw error;
    }
    await page.screenshot({ path: path.join(outDir, "anchordesk-board.jpg"), type: "jpeg", quality: 90 });

    console.log("Rendering ticket modal...");
    await page.getByText("VPN drops every 12 minutes", { exact: false }).click();
    await page.locator('[role="dialog"]').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, "anchordesk-ticket-modal.jpg"), type: "jpeg", quality: 90 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);

    console.log("Rendering My Day...");
    await openDrawer(page, "My Day");
    await page.getByText("Duration-only", { exact: false }).waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(outDir, "anchordesk-my-day.jpg"), type: "jpeg", quality: 90 });

    console.log("Rendering Companies...");
    await openDrawer(page, "Companies");
    await page.getByText("ACME Manufacturing", { exact: false }).first().waitFor({ timeout: 20_000 });
    await page.getByText("ACME Manufacturing", { exact: false }).first().click();
    await page.getByText("Contacts", { exact: false }).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, "anchordesk-companies.jpg"), type: "jpeg", quality: 90 });

    console.log("Rendering Network...");
    await openDrawer(page, "Network");
    // Device names render on the canvas map, so wait on the HTML chrome instead.
    await page.getByText("Device type, open services", { exact: false }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800); // let the canvas settle
    await page.screenshot({ path: path.join(outDir, "anchordesk-network.jpg"), type: "jpeg", quality: 90 });

    console.log("Rendering Sync...");
    await openDrawer(page, "Sync");
    await page.getByText("Configured Providers", { exact: false }).waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(outDir, "anchordesk-sync.jpg"), type: "jpeg", quality: 90 });

    console.log(`Captured screenshots in ${path.relative(repoRoot, outDir)}`);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
