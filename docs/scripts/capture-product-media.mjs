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

async function assertNoHorizontalPageScroll(page, view) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body?.scrollWidth ?? 0,
  }));
  const pageWidth = Math.max(metrics.documentWidth, metrics.bodyWidth);
  if (pageWidth > metrics.viewportWidth + 1) {
    throw new Error(
      `${view} has horizontal page scroll: ${pageWidth}px content in a ${metrics.viewportWidth}px viewport`
    );
  }
}

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

    console.log("Rendering Reports...");
    await openDrawer(page, "Reports");
    const reportsRoot = page.getByTestId("reports-view");
    await reportsRoot.waitFor({ timeout: 20_000 });
    await reportsRoot
      .getByText("Includes reconstructed history", { exact: false })
      .first()
      .waitFor({ timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoHorizontalPageScroll(page, "reports");
    await page.screenshot({ path: path.join(outDir, "anchordesk-reports.jpg"), type: "jpeg", quality: 90 });

    console.log("Rendering Customer satisfaction report...");
    const feedbackCard = reportsRoot.getByTestId("report-feedback");
    await feedbackCard.scrollIntoViewIfNeeded();
    await feedbackCard.getByText("Customer satisfaction", { exact: true }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(300);
    await assertNoHorizontalPageScroll(page, "reports-feedback");
    await feedbackCard.screenshot({ path: path.join(outDir, "anchordesk-feedback.jpg"), type: "jpeg", quality: 90 });
    await page.evaluate(() => window.scrollTo(0, 0));

    console.log("Rendering TIME day spread...");
    await openDrawer(page, "TIME calendar");
    const daySpread = page.getByTestId("time-day-spread");
    await daySpread.waitFor({ timeout: 20_000 });
    await daySpread.getByText("Visible workday gaps", { exact: true }).waitFor({ timeout: 20_000 });
    await daySpread.getByText("50%", { exact: true }).waitFor({ timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoHorizontalPageScroll(page, "time-day");
    // Preserve the pre-2.7 My Day media path for documentation links while the
    // explicit TIME filename becomes the release proof.
    await page.screenshot({ path: path.join(outDir, "anchordesk-my-day.jpg"), type: "jpeg", quality: 90 });
    await page.screenshot({ path: path.join(outDir, "anchordesk-time-day.jpg"), type: "jpeg", quality: 90 });

    console.log("Rendering TIME ticket SLA timeline...");
    await page.getByRole("tab", { name: "Ticket SLA timeline" }).click();
    const timeline = page.getByTestId("time-sla-timeline");
    await timeline.waitFor({ timeout: 20_000 });
    const ticketSearch = timeline.getByLabel("Find a ticket");
    await ticketSearch.fill("10482");
    const ticketOption = page.getByRole("option", {
      name: /#10482 · VPN drops every 12 minutes/,
    });
    await ticketOption.waitFor({ timeout: 20_000 });
    const timelineResponse = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/tickets/101/sla-timeline"
    );
    await ticketOption.click();
    await timelineResponse;
    await timeline.getByLabel(/SLA breached at/).first().waitFor({ timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoHorizontalPageScroll(page, "time-sla");
    await page.screenshot({ path: path.join(outDir, "anchordesk-time-sla.jpg"), type: "jpeg", quality: 90 });

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

    console.log("Rendering Ticket sync...");
    await openDrawer(page, "Admin console");
    await page.getByText("Open tickets", { exact: false }).waitFor({ timeout: 20_000 });
    await page.getByText("Ticket Sync", { exact: true }).first().click();
    await page.getByText("Sync jobs", { exact: true }).waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(outDir, "anchordesk-sync.jpg"), type: "jpeg", quality: 90 });
    await page
      .getByRole("button", { name: "View run history for SpillersTech — Jira helpdesk" })
      .click();
    await page
      .getByRole("heading", { name: "SpillersTech — Jira helpdesk — run history" })
      .waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(outDir, "anchordesk-sync-history.jpg"), type: "jpeg", quality: 90 });

    console.log(`Captured screenshots in ${path.relative(repoRoot, outDir)}`);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
