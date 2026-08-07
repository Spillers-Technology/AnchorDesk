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

async function newDeviceContext(
  browser,
  device,
  {
    authenticated = true,
    portalAuthenticated = true,
    startPath = "/",
  } = {}
) {
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
  await installApiMock(page, { authenticated, portalAuthenticated });
  await page.goto(`${baseUrl}${startPath}`, { waitUntil: "domcontentloaded" });
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

async function assertNoHorizontalPageScroll(page, view) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body?.scrollWidth ?? 0,
  }));
  const pageWidth = Math.max(metrics.documentWidth, metrics.bodyWidth);
  // A single CSS pixel can be introduced by fractional device-scale rounding.
  if (pageWidth > metrics.viewportWidth + 1) {
    throw new Error(
      `${view} has horizontal page scroll: ${pageWidth}px content in a ${metrics.viewportWidth}px viewport`
    );
  }
}

async function shootWithoutPageOverflow(page, device, view) {
  await assertNoHorizontalPageScroll(page, view);
  await shoot(page, device, view);
}

async function shootSection(page, device, view, testId) {
  const section = page.getByTestId(testId);
  await section.waitFor({ timeout: 20_000 });
  await section.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest" })
  );
  await page.waitForTimeout(150);
  await shootWithoutPageOverflow(page, device, view);
}

async function assertWideArticleContentScrollable(page, view) {
  const metrics = await page.locator("article .html-table-scroll").first().evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  if (metrics.scrollWidth <= metrics.clientWidth + 1) {
    throw new Error(
      `${view} wide table is clipped or collapsed instead of internally scrollable: ` +
      `${metrics.scrollWidth}px content in a ${metrics.clientWidth}px container`
    );
  }
}

async function captureDevice(browser, device) {
  console.log(`\n${device.name} (${device.viewport.width}×${device.viewport.height})`);

  // The customer portal is a separate HTML entry and bundle. Exercise it in
  // its own contexts so a staff session can never mask requester-only states.
  if (wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-login")) {
    const { context, page } = await newDeviceContext(browser, device, {
      portalAuthenticated: false,
      startPath: "/portal/login",
    });
    await page
      .getByRole("button", { name: "Email me a sign-in link" })
      .waitFor({ timeout: 20_000 });
    await shoot(page, device, "portal-login");
    await context.close();
  }

  if (wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-register")) {
    const { context, page } = await newDeviceContext(browser, device, {
      portalAuthenticated: false,
      startPath: "/portal/register",
    });
    await page
      .getByRole("button", { name: "Request access", exact: true })
      .waitFor({ timeout: 20_000 });
    await shootWithoutPageOverflow(page, device, "portal-register");
    await context.close();
  }

  const portalViews = [
    "portal-tickets",
    "portal-new-ticket",
    "portal-ticket",
    "portal-comment",
    "portal-attachment",
  ];
  if (portalViews.some((name) => wanted("ANCHORDESK_CAPTURE_VIEWS", name))) {
    const { context, page } = await newDeviceContext(browser, device, {
      startPath: "/portal/tickets",
    });
    try {
      await page.getByRole("heading", { name: "My tickets" }).waitFor({ timeout: 20_000 });
      if (wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-tickets")) {
        await shoot(page, device, "portal-tickets");
      }

      if (wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-new-ticket")) {
        await page.goto(`${baseUrl}/portal/tickets/new`, { waitUntil: "domcontentloaded" });
        const summary = page.getByLabel("Summary");
        await summary.fill("Conference room display will not connect");
        await page
          .getByText("Does this answer it?", { exact: true })
          .waitFor({ timeout: 20_000 });
        await shoot(page, device, "portal-new-ticket");
      }

      if (
        wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-ticket")
        || wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-comment")
        || wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-attachment")
      ) {
        await page.goto(`${baseUrl}/portal/tickets/801`, { waitUntil: "domcontentloaded" });
        await page
          .getByRole("heading", { name: "Conference room display will not connect" })
          .waitFor({ timeout: 20_000 });
        if (wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-ticket")) {
          await shoot(page, device, "portal-ticket");
        }

        if (wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-comment")) {
          const comment = page.getByLabel("Comment");
          await comment.fill("The display controller is now blinking amber.");
          await comment.evaluate((element) => element.scrollIntoView({ block: "center" }));
          await shoot(page, device, "portal-comment");
        }

        if (wanted("ANCHORDESK_CAPTURE_VIEWS", "portal-attachment")) {
          const input = page.getByLabel("Upload attachments");
          await input.setInputFiles({
            name: "room-controller.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from("mock portal attachment"),
          });
          await page.getByText("File uploaded.", { exact: true }).waitFor({ timeout: 20_000 });
          await page
            .getByText("room-controller.jpg", { exact: true })
            .evaluate((element) => element.scrollIntoView({ block: "center" }));
          await shoot(page, device, "portal-attachment");
        }
      }
    } finally {
      await context.close();
    }
  }

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

    if (view("filters")) {
      await page.getByRole("button", { name: "Advanced search" }).click();
      await page.getByRole("heading", { name: "Advanced search" }).waitFor({ timeout: 20_000 });
      await shoot(page, device, "filters");
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Advanced search" }).waitFor({ state: "hidden", timeout: 5_000 });
    }

    if (view("ticket") || view("composer") || view("ticket-history")) {
      // On phone viewports scrollIntoViewIfNeeded can park the card under the
      // fixed AppBar, which makes a real click fail actionability. Center it
      // and dispatch the click on the card itself.
      await ticketCard().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await ticketCard().dispatchEvent("click");
      await page.locator('[role="dialog"]').first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(500);
      if (view("ticket")) await shoot(page, device, "ticket");

      if (view("ticket-history")) {
        const historyButton = page.getByRole("button", { name: "Show revision history" });
        await historyButton.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await historyButton.click();
        await page.getByText("Revision History", { exact: true }).waitFor({ timeout: 20_000 });
        await shoot(page, device, "ticket-history");
      }

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

    if (view("ticket-merge-dialog") || view("ticket-merge-warnings")) {
      const mergeSource = page.getByText("Patch reboot window for accounting PCs", { exact: false }).first();
      await mergeSource.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await mergeSource.dispatchEvent("click");
      await page.getByRole("dialog").first().waitFor({ timeout: 20_000 });
      await page.getByRole("button", { name: "Merge", exact: true }).click();
      await page.getByRole("heading", { name: "Merge ticket #10485" }).waitFor({ timeout: 20_000 });

      if (view("ticket-merge-dialog")) {
        await page.getByLabel("Surviving ticket").waitFor({ timeout: 20_000 });
        await shoot(page, device, "ticket-merge-dialog");
      }

      if (view("ticket-merge-warnings")) {
        await page.getByLabel("Surviving ticket").fill("10482");
        await page.getByRole("option", { name: /#10482 · VPN drops every 12 minutes/ }).click();
        await page.getByText("Acknowledgements required", { exact: true }).waitFor({ timeout: 20_000 });
        await page.getByLabel("Acknowledge sync-stop").waitFor({ timeout: 20_000 });
        await page.getByLabel("Acknowledge cross-company").waitFor({ timeout: 20_000 });
        await shoot(page, device, "ticket-merge-warnings");
      }

      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Merge ticket #10485" }).waitFor({ state: "hidden", timeout: 5_000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }

    if (view("ticket-children")) {
      const parentTicket = page.getByText("ERP outage coordination", { exact: true }).first();
      await parentTicket.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await parentTicket.dispatchEvent("click");
      await page.getByText("Ticket hierarchy", { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText("1 of 2 done", { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText("#10489 · Restore ERP database replica", { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText("#10490 · Notify warehouse leads after ERP recovery", { exact: true }).waitFor({ timeout: 20_000 });
      await shoot(page, device, "ticket-children");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }

    if (view("cards")) {
      await page.locator('button[value="cards"]').click();
      await ticketCard().waitFor({ timeout: 20_000 });
      await shoot(page, device, "cards");
    }

    const reportSections = [
      { view: "reports-volume", testId: "report-volume" },
      { view: "reports-durations", testId: "report-durations" },
      { view: "reports-sla", testId: "report-sla" },
      { view: "reports-backlog", testId: "report-backlog" },
      { view: "reports-team-throughput", testId: "report-team-throughput" },
      { view: "reports-feedback", testId: "report-feedback" },
      { view: "reports-assignee-throughput", testId: "report-assignee-throughput" },
      { view: "reports-time-company", testId: "report-time-company" },
    ];
    if (view("reports") || reportSections.some((section) => view(section.view))) {
      await openDrawer(page, "Reports");
      const reportsRoot = page.getByTestId("reports-view");
      await reportsRoot.waitFor({ timeout: 20_000 });
      await reportsRoot
        .getByText("Includes reconstructed history", { exact: false })
        .first()
        .waitFor({ timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (view("reports")) {
        await shootWithoutPageOverflow(page, device, "reports");
      }
      for (const section of reportSections) {
        if (view(section.view)) {
          await shootSection(page, device, section.view, section.testId);
        }
      }
    }

    // Keep the historical `myday` filename in the matrix while adding the two
    // explicit 2.7 TIME proof views. It now points at the consolidated TIME
    // calendar's day mode instead of the removed standalone navigation label.
    const timeViews = ["myday", "time-day", "time-sla"];
    if (timeViews.some(view)) {
      await openDrawer(page, "TIME calendar");
      const daySpread = page.getByTestId("time-day-spread");
      await daySpread.waitFor({ timeout: 20_000 });
      await daySpread.getByText("Visible workday gaps", { exact: true }).waitFor({ timeout: 20_000 });
      await daySpread.getByText("50%", { exact: true }).waitFor({ timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (view("myday")) {
        await shootWithoutPageOverflow(page, device, "myday");
      }
      if (view("time-day")) {
        await shootWithoutPageOverflow(page, device, "time-day");
      }

      if (view("time-sla")) {
        await page.getByRole("tab", { name: "Ticket SLA timeline" }).click();
        const timeline = page.getByTestId("time-sla-timeline");
        await timeline.waitFor({ timeout: 20_000 });
        const search = timeline.getByLabel("Find a ticket");
        await search.fill("10482");
        const option = page.getByRole("option", {
          name: /#10482 · VPN drops every 12 minutes/,
        });
        await option.waitFor({ timeout: 20_000 });
        const response = page.waitForResponse((candidate) =>
          new URL(candidate.url()).pathname === "/api/tickets/101/sla-timeline"
        );
        await option.click();
        await response;
        await timeline.getByLabel(/SLA breached at/).first().waitFor({ timeout: 20_000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await shootWithoutPageOverflow(page, device, "time-sla");
      }
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

    const kbViews = [
      "knowledge-base",
      "knowledge-base-article",
      "knowledge-base-editor",
    ];
    if (kbViews.some(view)) {
      const vpnTitle = "Diagnose VPN tunnel renegotiation every 12 minutes";
      await openDrawer(page, "Knowledge Base");
      await page.getByRole("heading", { name: "Knowledge base", exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText(vpnTitle, { exact: true }).first().waitFor({ timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (view("knowledge-base")) await shoot(page, device, "knowledge-base");

      if (view("knowledge-base-article") || view("knowledge-base-editor")) {
        const rankedSearch = page.waitForResponse((response) => {
          const responseUrl = new URL(response.url());
          return responseUrl.pathname === "/api/kb/search" &&
            responseUrl.searchParams.get("q") === "vpn tunnel renegotiation";
        });
        await page.getByLabel("Search articles").fill("vpn tunnel renegotiation");
        await rankedSearch;
        await page
          .getByText("Reset your Microsoft 365 password and MFA", { exact: true })
          .waitFor({ state: "hidden", timeout: 20_000 });

        const bestMatch = page.getByText(vpnTitle, { exact: true }).first();
        await bestMatch.waitFor({ timeout: 20_000 });
        const articleRequest = page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/kb/articles/401"
        );
        await bestMatch.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await bestMatch.dispatchEvent("click");
        await articleRequest;

        const article = page.locator("article");
        await article.getByRole("heading", { name: vpnTitle, exact: true }).waitFor({ timeout: 20_000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await assertNoHorizontalPageScroll(page, "knowledge-base-article");
        await assertWideArticleContentScrollable(page, "knowledge-base-article");
        if (view("knowledge-base-article")) {
          await shoot(page, device, "knowledge-base-article");
        }

        if (view("knowledge-base-editor")) {
          await article.getByRole("button", { name: "Edit", exact: true }).click();
          await page.getByRole("heading", { name: "Edit knowledge base article" }).waitFor({ timeout: 20_000 });
          await page.getByRole("textbox", { name: "Title" }).waitFor({ timeout: 20_000 });
          await shoot(page, device, "knowledge-base-editor");
          await page.keyboard.press("Escape");
          await page.getByRole("heading", { name: "Edit knowledge base article" }).waitFor({ state: "hidden", timeout: 5_000 });
        }
      }
    }

    const adminViews = ["admin", "admin-teams", "admin-custom-fields", "admin-checklists", "checklist-template-editor", "admin-automations", "admin-ticket-sync", "ticket-sync-connection-editor", "ticket-sync-job-editor", "ticket-sync-run-history", "ticket-sync-run-detail", "admin-devices", "device-assets", "admin-portal-registrations"];
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
      if (view("admin-portal-registrations")) {
        await page.getByText("Portal Requests", { exact: true }).first().click();
        await page.getByText("Portal access requests", { exact: true }).waitFor({ timeout: 20_000 });
        await shootWithoutPageOverflow(page, device, "admin-portal-registrations");
      }
      if (view("admin-checklists") || view("checklist-template-editor")) {
        await page.getByText("Checklists", { exact: true }).first().click();
        await page.getByText("Reusable boilerplate lists", { exact: false }).waitFor({ timeout: 20_000 });
        if (view("admin-checklists")) await shoot(page, device, "admin-checklists");
        if (view("checklist-template-editor")) {
          await page.getByRole("button", { name: "New template" }).click();
          await page.getByRole("heading", { name: "New checklist template" }).waitFor({ timeout: 20_000 });
          await shoot(page, device, "checklist-template-editor");
          await page.keyboard.press("Escape");
        }
      }
      if (view("admin-automations")) {
        await page.getByText("Automations", { exact: true }).first().click();
        await page.getByText("Run ordered actions", { exact: false }).waitFor({ timeout: 20_000 });
        await shoot(page, device, "admin-automations");
      }
      if (view("admin-ticket-sync") || view("ticket-sync-connection-editor") || view("ticket-sync-job-editor") || view("ticket-sync-run-history") || view("ticket-sync-run-detail")) {
        await page.getByText("Ticket Sync", { exact: true }).first().click();
        await page.getByText("Sync jobs", { exact: true }).waitFor({ timeout: 20_000 });
        if (view("admin-ticket-sync")) await shoot(page, device, "admin-ticket-sync");

        if (view("ticket-sync-connection-editor")) {
          await page.getByRole("button", { name: "Add Jira connection" }).click();
          await page.getByRole("heading", { name: "Add Jira connection" }).waitFor({ timeout: 20_000 });
          await shoot(page, device, "ticket-sync-connection-editor");
          await page.keyboard.press("Escape");
          await page.getByRole("heading", { name: "Add Jira connection" }).waitFor({ state: "hidden", timeout: 5_000 });
        }

        if (view("ticket-sync-job-editor")) {
          await page.getByRole("button", { name: "Create sync job" }).first().click();
          await page.getByRole("heading", { name: "Create sync job" }).waitFor({ timeout: 20_000 });
          await shoot(page, device, "ticket-sync-job-editor");
          await page.keyboard.press("Escape");
          await page.getByRole("heading", { name: "Create sync job" }).waitFor({ state: "hidden", timeout: 5_000 });
        }

        if (view("ticket-sync-run-history") || view("ticket-sync-run-detail")) {
          await page
            .getByRole("button", { name: "View run history for SpillersTech — Jira helpdesk" })
            .click();
          await page
            .getByRole("heading", { name: "SpillersTech — Jira helpdesk — run history" })
            .waitFor({ timeout: 20_000 });
          if (view("ticket-sync-run-history")) {
            await shoot(page, device, "ticket-sync-run-history");
          }
          if (view("ticket-sync-run-detail")) {
            // Scoped to the dialog on purpose: the job card behind it carries its
            // own "Degraded" health chip, and an unscoped .first() resolves to
            // that one — which the open dialog then intercepts the click for.
            const runHistoryDialog = page.getByRole("dialog");
            await runHistoryDialog.getByText("Degraded", { exact: true }).first().click();
            await page.getByLabel("Filter record activity").waitFor({ timeout: 20_000 });
            await shoot(page, device, "ticket-sync-run-detail");
          }
          await page.keyboard.press("Escape");
        }
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

    if (view("admin-customer-portal")) {
      const portalSettingsUrl = new URL(baseUrl);
      portalSettingsUrl.searchParams.set("admin", "customer-portal");
      await page.goto(portalSettingsUrl.href, { waitUntil: "domcontentloaded" });
      await freezeAnimations(page);
      // MUI 9's Switch exposes role="switch", not checkbox.
      await page
        .getByRole("switch", { name: "Enable the customer portal" })
        .waitFor({ timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertNoHorizontalPageScroll(page, "admin-customer-portal");
      await shoot(page, device, "admin-customer-portal");
    }

    if (view("admin-knowledge-base")) {
      const adminKnowledgeBaseUrl = new URL(baseUrl);
      adminKnowledgeBaseUrl.searchParams.set("admin", "knowledge-base");
      await page.goto(adminKnowledgeBaseUrl.href, { waitUntil: "domcontentloaded" });
      await freezeAnimations(page);
      await page.getByLabel("Filter articles").waitFor({ timeout: 20_000 });
      await page
        .getByText("Replace an edge firewall without downtime", { exact: true })
        .first()
        .waitFor({ timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await shoot(page, device, "admin-knowledge-base");
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
