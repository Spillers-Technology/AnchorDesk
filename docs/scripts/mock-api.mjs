// Shared capture-time mock API + Playwright helpers for the product media
// scripts (capture-product-media.mjs, capture-mobile-media.mjs). Every /api/*
// request a capture page makes is answered from the in-file dataset below, so
// screenshots need no backend, database, or credentials — just the Vite dev
// server.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const baseUrl = process.env.ANCHORDESK_CAPTURE_BASE_URL || "http://127.0.0.1:5173";
export const debugCapture = process.env.ANCHORDESK_CAPTURE_DEBUG === "1";

export function loadPlaywright() {
  // Accept either the full `playwright` (bundled Chromium) or the lighter
  // `playwright-core` (no browser download — drive an installed browser via a
  // channel; see PLAYWRIGHT_CHANNEL below). Both expose the same `chromium` API.
  const base = process.env.PLAYWRIGHT_NODE_MODULES;
  const candidates = [
    base ? path.join(base, "playwright") : null,
    base ? path.join(base, "playwright-core") : null,
    path.join(repoRoot, "web-client", "node_modules", "playwright"),
    "playwright",
    "playwright-core",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next location
    }
  }

  throw new Error(
    [
      "Playwright is required to capture product media.",
      "Option A — full package (downloads Chromium):",
      "  npm install --prefix %TEMP%\\anchordesk-playwright playwright",
      "  set PLAYWRIGHT_NODE_MODULES=%TEMP%\\anchordesk-playwright\\node_modules",
      "Option B — no download, drive installed Edge/Chrome:",
      "  npm install --prefix %TEMP%\\anchordesk-playwright playwright-core",
      "  set PLAYWRIGHT_NODE_MODULES=%TEMP%\\anchordesk-playwright\\node_modules",
      "  set PLAYWRIGHT_CHANNEL=msedge",
      "Start the web client first: cd web-client && npm run dev",
      "  node docs/scripts/capture-product-media.mjs",
    ].join("\n")
  );
}

function daysFromNow(days, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

// Report provenance is stable for the lifetime of one capture run. The default
// 30-day window overlaps reconstructed event history, while immutable SLA
// snapshots begin later. That lets the UI prove both warnings without claiming
// an inferred historical promise was recorded.
const REPORT_RECONSTRUCTED_FROM = daysFromNow(-365, 0);
const REPORT_RECONSTRUCTED_THROUGH = daysFromNow(-10, 23, 59);
const REPORT_SLA_COVERAGE_FROM = daysFromNow(-14, 9);

const demoUser = {
  id: 1,
  username: "jess",
  displayName: "Jess Spillers",
  email: "jess@example.com",
  role: "admin",
  authProvider: "local",
  themePref: "default-light",
  kanbanColumns: ["New", "Assigned", "In Progress", "Waiting", "Resolved"],
};

const portalRequester = {
  displayName: "Morgan Lee",
  email: "morgan@acme.example",
};

const portalTickets = [
  {
    id: 801,
    ticketNumber: "10501",
    title: "Conference room display will not connect",
    summary: "Conference room display will not connect",
    description:
      "The display in Cedar Room says “No signal” when I connect my laptop over USB-C.",
    status: "In Progress",
    priority: "Medium",
    createdAt: daysFromNow(-2, 9, 20),
    updatedAt: daysFromNow(0, 10, 35),
    closedAt: null,
    notes: [
      {
        id: 8101,
        content: "I tried both USB-C cables from the cabinet.",
        htmlContent: null,
        direction: null,
        authorKind: "you",
        createdAt: daysFromNow(-2, 9, 22),
      },
      {
        id: 8102,
        content:
          "Thanks, Morgan. We are checking the room controller and will update you shortly.",
        htmlContent: null,
        direction: "outbound",
        authorKind: "support",
        // Exercises the Phase 5 named-technician rendering (portal.technicianIdentity
        // = named, opted-in): a small inline SVG avatar so the mobile capture proves
        // real layout, not just a URL that resolves elsewhere.
        authorName: "Jess",
        authorAvatarUrl:
          "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBmaWxsPSIjNGY0NmU1Ii8+PHRleHQgeD0iNTAlIiB5PSI1NSUiIGZvbnQtc2l6ZT0iMjIiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIj5KPC90ZXh0Pjwvc3ZnPg==",
        createdAt: daysFromNow(0, 10, 35),
      },
    ],
    attachments: [
      {
        id: 8201,
        filename: "display-error.jpg",
        contentType: "image/jpeg",
        size: 184320,
        createdAt: daysFromNow(-2, 9, 23),
        downloadUrl: "/api/portal/attachments/8201/download",
      },
    ],
  },
  {
    id: 802,
    ticketNumber: "10476",
    title: "Access to the quarterly planning folder",
    summary: "Access to the quarterly planning folder",
    description: "Please add me to the Finance planning folder before Thursday.",
    status: "Waiting",
    priority: null,
    createdAt: daysFromNow(-8, 14, 5),
    updatedAt: daysFromNow(-1, 16, 10),
    closedAt: null,
    notes: [],
    attachments: [],
  },
  {
    id: 803,
    ticketNumber: "10421",
    title: "Replace damaged laptop charger",
    summary: "Replace damaged laptop charger",
    description: null,
    status: "Closed",
    priority: "Low",
    createdAt: daysFromNow(-24, 11, 30),
    updatedAt: daysFromNow(-20, 15, 45),
    closedAt: daysFromNow(-20, 15, 45),
    notes: [],
    attachments: [],
  },
];

const portalKbItems = [
  {
    id: 901,
    slug: "conference-room-display-usb-c",
    title: "Connect a laptop to a conference-room display",
    excerpt: "Check the room input, reconnect USB-C, and wake the display controller.",
    score: 0.94,
  },
  {
    id: 902,
    slug: "usb-c-display-no-signal",
    title: "Troubleshoot a USB-C “No signal” message",
    excerpt: "A quick checklist for cables, adapters, display input, and laptop permissions.",
    score: 0.87,
  },
];

const labels = [
  { id: 1, name: "help@", color: "#2563eb" },
  { id: 2, name: "vip", color: "#dc2626" },
  { id: 3, name: "field", color: "#059669" },
];

const companies = [
  {
    id: 1,
    name: "ACME Manufacturing",
    domain: "acme.example",
    phone: "555-0102",
    email: "it@acme.example",
    website: "https://acme.example",
    address: "42 Foundry Lane",
    notes: "Priority support customer.",
    createdAt: daysFromNow(-120, 9),
    contacts: [
      {
        id: 1,
        companyId: 1,
        name: "Maya Chen",
        email: "maya.chen@acme.example",
        phone: "555-0198",
        title: "Operations Manager",
        isPrimary: true,
      },
      {
        id: 2,
        companyId: 1,
        name: "Noah Patel",
        email: "noah.patel@acme.example",
        phone: "555-0144",
        title: "Plant IT",
        isPrimary: false,
      },
    ],
    _count: { tickets: 5, contacts: 2, devices: 6 },
  },
  {
    id: 2,
    name: "Northwind Clinic",
    domain: "northwind.example",
    phone: "555-0180",
    email: "service@northwind.example",
    website: "https://northwind.example",
    address: "10 Harbor Road",
    notes: null,
    createdAt: daysFromNow(-80, 9),
    contacts: [
      {
        id: 3,
        companyId: 2,
        name: "Lena Brooks",
        email: "lena@northwind.example",
        phone: "555-0181",
        title: "Office Manager",
        isPrimary: true,
      },
    ],
    _count: { tickets: 2, contacts: 1, devices: 4 },
  },
];

const ticketRows = [
  {
    id: 101,
    ticketNumber: "10482",
    title: "VPN drops every 12 minutes on ACME-FW-01",
    summary: "Users lose access to the ERP tunnel during shift change. Firewall is online and linked from the ticket.",
    description:
      "<p>Users lose ERP access during shift change. The firewall stays online, but the tunnel renegotiates every 12 minutes.</p><ul><li>Started after ISP failover test</li><li>Impacts shipping and receiving</li><li>Linked firewall is reporting clean health</li></ul>",
    status: "In Progress",
    priority: "High",
    companyName: "ACME Manufacturing",
    companyId: 1,
    contactId: 1,
    assignee: "Jess Spillers",
    assigneeId: 1,
    teamId: 1,
    customFields: { impact: "Production", change_window: "2026-07-16" },
    source: "local",
    externalProvider: null,
    externalId: null,
    syncState: null,
    responseDueAt: daysFromNow(0, 18),
    resolutionDueAt: daysFromNow(1, 15),
    dueAt: daysFromNow(0, 17, 30),
    firstRespondedAt: daysFromNow(0, 9, 14),
    createdAt: daysFromNow(0, 8, 42),
    labels: [{ label: labels[1] }],
  },
  {
    id: 102,
    ticketNumber: "10483",
    title: "Shared mailbox replies missing signatures",
    summary: "Outbound messages from support@ need the shared template and personal signature toggle reviewed.",
    description: "<p>Shared identity works, but the template insert has inconsistent spacing for this mailbox.</p>",
    status: "New",
    priority: "Medium",
    companyName: "Northwind Clinic",
    companyId: 2,
    contactId: 3,
    assignee: "",
    assigneeId: null,
    source: "imap",
    externalProvider: "imap",
    externalId: "<mail-10483@example>",
    syncState: null,
    responseDueAt: daysFromNow(0, 13),
    resolutionDueAt: daysFromNow(2, 17),
    firstRespondedAt: null,
    createdAt: daysFromNow(0, 10, 5),
    labels: [{ label: labels[0] }],
  },
  {
    id: 103,
    ticketNumber: "10484",
    title: "Jira change request waiting on approval",
    summary: "Remote issue changed while local notes were added; sync is holding for a human choice.",
    description: "<p>Jira status changed remotely after local implementation notes were added.</p>",
    status: "Waiting",
    priority: "Critical",
    companyName: "ACME Manufacturing",
    companyId: 1,
    contactId: 2,
    assignee: "Priya Shah",
    assigneeId: 2,
    source: "jira",
    externalProvider: "jira",
    externalId: "OPS-712",
    syncState: "conflict",
    responseDueAt: null,
    resolutionDueAt: daysFromNow(0, 16),
    firstRespondedAt: daysFromNow(-1, 11),
    createdAt: daysFromNow(-1, 16, 20),
    labels: [{ label: labels[2] }],
  },
  {
    id: 104,
    ticketNumber: "10485",
    title: "Patch reboot window for accounting PCs",
    summary: "NinjaOne devices synced; schedule reboot script after payroll export completes.",
    description: "<p>Accounting workstations need a post-patch reboot after the payroll export.</p>",
    status: "Assigned",
    priority: "Low",
    companyName: "Northwind Clinic",
    companyId: 2,
    contactId: 3,
    assignee: "Sam Rivera",
    assigneeId: 3,
    source: "connectwise",
    externalProvider: "connectwise",
    externalId: "CW-88231",
    syncState: "pending",
    responseDueAt: null,
    resolutionDueAt: daysFromNow(3, 17),
    firstRespondedAt: daysFromNow(-1, 14),
    createdAt: daysFromNow(-1, 12, 10),
    labels: [],
  },
  {
    id: 105,
    ticketNumber: "10486",
    title: "Conference room display offline",
    summary: "Netviz probe sees the display but the open-port set changed after a VLAN move.",
    description: "<p>Probe still sees the display, but it moved to a new VLAN without the expected management port.</p>",
    status: "Resolved",
    priority: "Medium",
    companyName: "ACME Manufacturing",
    companyId: 1,
    contactId: null,
    assignee: "Jess Spillers",
    assigneeId: 1,
    source: "local",
    externalProvider: null,
    externalId: null,
    syncState: null,
    responseDueAt: null,
    resolutionDueAt: daysFromNow(2, 12),
    firstRespondedAt: daysFromNow(-1, 10),
    createdAt: daysFromNow(-2, 13, 45),
    labels: [],
  },
  {
    id: 106,
    ticketNumber: "10487",
    title: "Datto quick job queued for kiosk",
    summary: "Datto RMM picked up the kiosk and queued a component run against the linked device.",
    description: "<p>Component UID queued from the ticket after the kiosk stopped checking in.</p>",
    status: "In Progress",
    priority: "High",
    companyName: "Northwind Clinic",
    companyId: 2,
    contactId: 3,
    assignee: "Priya Shah",
    assigneeId: 2,
    source: "local",
    externalProvider: null,
    externalId: null,
    syncState: null,
    responseDueAt: null,
    resolutionDueAt: daysFromNow(1, 10),
    firstRespondedAt: daysFromNow(0, 8),
    createdAt: daysFromNow(-1, 9, 12),
    labels: [{ label: labels[2] }],
  },
  {
    id: 107,
    ticketNumber: "10488",
    title: "ERP outage coordination",
    summary: "Parent incident coordinating application recovery and customer communication.",
    description: "<p>Coordinate the technical recovery and customer-facing work for the ERP outage.</p>",
    status: "In Progress",
    priority: "Critical",
    companyName: "ACME Manufacturing",
    companyId: 1,
    contactId: 1,
    assignee: "Jess Spillers",
    assigneeId: 1,
    teamId: 1,
    source: "local",
    externalProvider: null,
    externalId: null,
    syncState: null,
    parentId: null,
    mergedIntoId: null,
    mergedAt: null,
    responseDueAt: daysFromNow(0, 12, 30),
    resolutionDueAt: daysFromNow(0, 18),
    firstRespondedAt: daysFromNow(0, 10, 10),
    createdAt: daysFromNow(0, 9, 55),
    labels: [{ label: labels[2] }],
  },
  {
    id: 108,
    ticketNumber: "10489",
    title: "Restore ERP database replica",
    summary: "Database recovery work tracked under the ERP outage.",
    description: "<p>Promote the healthy replica and validate application connectivity.</p>",
    status: "In Progress",
    priority: "Critical",
    companyName: "ACME Manufacturing",
    companyId: 1,
    contactId: 1,
    assignee: "Priya Shah",
    assigneeId: 2,
    teamId: 1,
    source: "local",
    externalProvider: null,
    externalId: null,
    syncState: null,
    parentId: 107,
    mergedIntoId: null,
    mergedAt: null,
    responseDueAt: null,
    resolutionDueAt: daysFromNow(0, 16),
    firstRespondedAt: daysFromNow(0, 10, 12),
    createdAt: daysFromNow(0, 10),
    labels: [],
  },
  {
    id: 109,
    ticketNumber: "10490",
    title: "Notify warehouse leads after ERP recovery",
    summary: "Customer communication work tracked under the ERP outage.",
    description: "<p>Confirm service recovery with shipping and receiving leads.</p>",
    status: "Resolved",
    priority: "High",
    companyName: "ACME Manufacturing",
    companyId: 1,
    contactId: 2,
    assignee: "Sam Rivera",
    assigneeId: 3,
    teamId: 2,
    source: "local",
    externalProvider: null,
    externalId: null,
    syncState: null,
    parentId: 107,
    mergedIntoId: null,
    mergedAt: null,
    responseDueAt: null,
    resolutionDueAt: daysFromNow(0, 15),
    firstRespondedAt: daysFromNow(0, 10, 20),
    createdAt: daysFromNow(0, 10, 5),
    labels: [{ label: labels[0] }],
  },
  {
    id: 110,
    ticketNumber: "10491",
    title: "Duplicate report of ACME VPN drops",
    summary: "Closed tombstone retained after this duplicate was merged into #10482.",
    description: "<p>This ticket remains resolvable after its conversation moved to the surviving incident.</p>",
    status: "Closed",
    priority: "High",
    companyName: "ACME Manufacturing",
    companyId: 1,
    contactId: 2,
    assignee: "Jess Spillers",
    assigneeId: 1,
    teamId: 1,
    source: "jira",
    externalProvider: "jira",
    externalId: "HELP-731",
    syncState: "synced",
    parentId: null,
    mergedIntoId: 101,
    mergedAt: daysFromNow(0, 10, 25),
    responseDueAt: null,
    resolutionDueAt: daysFromNow(1, 15),
    firstRespondedAt: daysFromNow(0, 10, 5),
    closedAt: daysFromNow(0, 10, 25),
    createdAt: daysFromNow(0, 9, 48),
    labels: [{ label: labels[1] }],
  },
];

const mergeUndoStatusByTicket = new Map([[110, "New"]]);

const notesByTicket = {
  101: [
    {
      id: 501,
      ticketId: 101,
      createdAt: daysFromNow(0, 9, 14),
      content: "Confirmed the firewall never drops from RMM. The tunnel renegotiates while WAN2 is preferred.",
      htmlContent:
        "<p>Confirmed the firewall never drops from RMM. The tunnel renegotiates while <strong>WAN2</strong> is preferred.</p>",
      author: "Jess Spillers",
      authorId: 1,
      noteType: "note",
    },
    {
      id: 502,
      ticketId: 101,
      createdAt: daysFromNow(0, 9, 40),
      content: "We can reproduce it when shipping starts the batch scanner.",
      htmlContent:
        "<p>We can reproduce it when shipping starts the batch scanner. Please keep the tunnel up until the 2 PM run finishes.</p>",
      author: "Maya Chen",
      authorId: null,
      noteType: "email",
      direction: "inbound",
      emailFrom: "maya.chen@acme.example",
      emailTo: "support@example.com",
      subject: "Re: [#10482] VPN drops every 12 minutes",
    },
    {
      id: 503,
      ticketId: 101,
      createdAt: daysFromNow(0, 10, 15),
      content: "RMM script checked tunnel counters and exported a snapshot.",
      htmlContent: "<p>RMM script checked tunnel counters and exported a snapshot.</p>",
      author: "Jess Spillers",
      authorId: 1,
      noteType: "time_entry",
      minutes: 35,
      timeStart: daysFromNow(0, 9, 40),
      timeStop: daysFromNow(0, 10, 15),
    },
    {
      id: 504,
      ticketId: 101,
      createdAt: daysFromNow(0, 10, 18),
      content: "Raised priority and routed the ticket to Network Operations.",
      htmlContent: "<p>Raised priority and routed the ticket to <strong>Network Operations</strong>.</p>",
      author: "automation:Escalate production impact",
      authorId: null,
      noteType: "internal",
    },
  ],
};

const devices = [
  {
    id: 201,
    hostname: "ACME-FW-01",
    displayName: "ACME edge firewall",
    ipAddress: "10.42.0.1",
    macAddress: "00:1A:2B:3C:4D:5E",
    vendor: "Fortinet",
    os: "FortiOS 7.2",
    deviceType: "Firewall",
    openPorts: [22, 53, 80, 443, 500, 4500, 8443],
    status: "online",
    companyName: "ACME Manufacturing",
    companyId: 1,
    source: "tactical_rmm",
    probeId: 301,
    externalId: "trmm-acme-fw-01",
    externalProvider: "tactical_rmm",
    assetTag: "NET-0042",
    serialNumber: "FGT-ACME-001",
    manufacturer: "Fortinet",
    model: "FortiGate 100F",
    location: "ACME MDF",
    purchaseDate: "2024-02-12",
    warrantyExpiresAt: "2029-02-12",
    notes: "Primary edge appliance; config backup runs nightly.",
    externalRefs: [
      { id: 1001, deviceId: 201, provider: "tactical_rmm", externalId: "trmm-acme-fw-01", metadata: null, firstSeenAt: daysFromNow(-90, 9), lastSeenAt: daysFromNow(0, 10, 34), createdAt: daysFromNow(-90, 9), updatedAt: daysFromNow(0, 10, 34) },
      { id: 1002, deviceId: 201, provider: "ninjaone", externalId: "ninja-acme-fw-01", metadata: null, firstSeenAt: daysFromNow(-60, 9), lastSeenAt: daysFromNow(0, 10, 31), createdAt: daysFromNow(-60, 9), updatedAt: daysFromNow(0, 10, 31) },
    ],
    lastSeenAt: daysFromNow(0, 10, 34),
  },
  {
    id: 202,
    hostname: "ACME-SHIP-02",
    displayName: "Shipping scanner host",
    ipAddress: "10.42.18.22",
    macAddress: "00:AA:7D:20:1C:19",
    vendor: "Dell",
    os: "Windows 11 Pro",
    deviceType: "Workstation",
    openPorts: [135, 445, 3389],
    status: "online",
    companyName: "ACME Manufacturing",
    companyId: 1,
    source: "netviz",
    probeId: 301,
    externalId: "netviz-acme-ship-02",
    externalProvider: "netviz",
    lastSeenAt: daysFromNow(0, 10, 28),
  },
  {
    id: 203,
    hostname: "ACME-NAS-01",
    displayName: "Production NAS",
    ipAddress: "10.42.8.12",
    macAddress: "00:AA:7D:20:1C:40",
    vendor: "Synology",
    os: "DSM",
    deviceType: "Storage",
    openPorts: [22, 80, 443, 5000, 5001],
    status: "online",
    companyName: "ACME Manufacturing",
    companyId: 1,
    source: "netviz",
    probeId: 301,
    externalId: "netviz-acme-nas-01",
    externalProvider: "netviz",
    lastSeenAt: daysFromNow(0, 10, 30),
  },
  {
    id: 204,
    hostname: "NW-KIOSK-04",
    displayName: "Lobby kiosk",
    ipAddress: "10.77.4.21",
    macAddress: "00:9C:02:44:18:88",
    vendor: "Lenovo",
    os: "Windows 11 IoT",
    deviceType: "Kiosk",
    openPorts: [3389],
    status: "offline",
    companyName: "Northwind Clinic",
    companyId: 2,
    source: "datto_rmm",
    probeId: 302,
    externalId: "datto-nw-kiosk-04",
    externalProvider: "datto_rmm",
    externalRefs: [{ id: 1003, deviceId: 204, provider: "datto_rmm", externalId: "datto-nw-kiosk-04", metadata: null, firstSeenAt: daysFromNow(-40, 9), lastSeenAt: daysFromNow(-1, 17, 20), createdAt: daysFromNow(-40, 9), updatedAt: daysFromNow(-1, 17, 20) }],
    lastSeenAt: daysFromNow(-1, 17, 20),
  },
  {
    id: 205,
    hostname: "NW-DC-01",
    displayName: "Northwind DC",
    ipAddress: "10.77.1.10",
    macAddress: "00:9C:02:44:18:90",
    vendor: "HPE",
    os: "Windows Server 2022",
    deviceType: "Server",
    openPorts: [53, 88, 135, 389, 445, 3389],
    status: "online",
    companyName: "Northwind Clinic",
    companyId: 2,
    source: "ninjaone",
    probeId: 302,
    externalId: "ninja-nw-dc-01",
    externalProvider: "ninjaone",
    externalRefs: [{ id: 1004, deviceId: 205, provider: "ninjaone", externalId: "ninja-nw-dc-01", metadata: null, firstSeenAt: daysFromNow(-75, 9), lastSeenAt: daysFromNow(0, 10, 31), createdAt: daysFromNow(-75, 9), updatedAt: daysFromNow(0, 10, 31) }],
    lastSeenAt: daysFromNow(0, 10, 31),
  },
  {
    id: 206,
    hostname: "ACME-PRN-03",
    displayName: "Shipping label printer",
    ipAddress: "10.42.18.42",
    macAddress: "00:80:77:24:08:11",
    vendor: "Zebra",
    os: "Link-OS",
    deviceType: "Printer",
    openPorts: [80, 9100],
    status: "unknown",
    companyName: "ACME Manufacturing",
    companyId: 1,
    source: "netviz",
    probeId: 301,
    externalId: "netviz-acme-prn-03",
    externalProvider: "netviz",
    lastSeenAt: daysFromNow(0, 9, 50),
  },
];

const probes = [
  {
    id: 301,
    name: "ACME plant netviz",
    companyName: "ACME Manufacturing",
    companyId: 1,
    status: "online",
    cidr: "10.42.0.0/16",
  },
  {
    id: 302,
    name: "Northwind clinic netviz",
    companyName: "Northwind Clinic",
    companyId: 2,
    status: "online",
    cidr: "10.77.0.0/16",
  },
];

const assignees = [
  { id: 1, username: "jess", displayName: "Jess Spillers", role: "admin" },
  { id: 2, username: "priya", displayName: "Priya Shah", role: "technician" },
  { id: 3, username: "sam", displayName: "Sam Rivera", role: "technician" },
];

const managedUsers = assignees.map((user) => ({
  ...user,
  email: `${user.username}@example.com`,
  authProvider: "local",
  themePref: null,
  kanbanColumns: null,
  isActive: true,
  hasPassword: true,
  mfaEnabled: user.id === 1,
  lastSeenAt: daysFromNow(0, 10),
  createdAt: daysFromNow(-90, 9),
}));

const teams = [
  {
    id: 1,
    name: "Network Operations",
    description: "Firewalls, switching, VPN, and connectivity incidents.",
    createdAt: daysFromNow(-60, 9),
    updatedAt: daysFromNow(-2, 15),
    members: [1, 2].map((userId) => ({ teamId: 1, userId, user: assignees.find((user) => user.id === userId) })),
    _count: { tickets: 3 },
  },
  {
    id: 2,
    name: "Service Desk",
    description: "Front-line triage and customer requests.",
    createdAt: daysFromNow(-45, 9),
    updatedAt: daysFromNow(-1, 12),
    members: [1, 3].map((userId) => ({ teamId: 2, userId, user: assignees.find((user) => user.id === userId) })),
    _count: { tickets: 2 },
  },
];

const customFields = [
  { id: 1, key: "impact", label: "Business impact", type: "select", options: ["Low", "Department", "Production"], required: true, sortOrder: 10, archived: false, createdAt: daysFromNow(-30, 9), updatedAt: daysFromNow(-5, 9) },
  { id: 2, key: "change_window", label: "Change window", type: "date", options: null, required: false, sortOrder: 20, archived: false, createdAt: daysFromNow(-30, 9), updatedAt: daysFromNow(-5, 9) },
  { id: 3, key: "customer_visible", label: "Customer visible", type: "boolean", options: null, required: false, sortOrder: 30, archived: false, createdAt: daysFromNow(-20, 9), updatedAt: daysFromNow(-5, 9) },
];

const automations = [
  {
    id: 1,
    name: "Escalate critical tickets",
    enabled: true,
    trigger: "ticket_created",
    conditions: [{ field: "priority", op: "eq", value: "Critical" }],
    actions: [{ type: "assign_team", teamId: 1 }, { type: "notify_team", teamId: 1, message: "Critical ticket received" }],
    runCount: 14,
    lastRunAt: daysFromNow(-1, 14),
    createdAt: daysFromNow(-20, 9),
    updatedAt: daysFromNow(-2, 11),
  },
];

const savedViews = [
  { id: 1, userId: 1, name: "My urgent queue", filters: { teamId: 1, status: "In Progress" }, shared: false, sortOrder: 0, createdAt: daysFromNow(-7, 9) },
  { id: 2, userId: null, name: "Unassigned work", filters: { assignee: "" }, shared: true, sortOrder: 10, createdAt: daysFromNow(-10, 9) },
];

// Knowledge-base fixtures deliberately cover both visibility values, a draft,
// ranked-search relevance, and hostile-width article content. The long VPN
// runbook is selected by the mobile reader capture to exercise table/pre/image
// containment without needing a database.
const kbArticles = [
  {
    id: 401,
    slug: "diagnose-vpn-tunnel-renegotiation",
    title: "Diagnose VPN tunnel renegotiation every 12 minutes",
    bodyHtml: [
      "<p><strong>Use this runbook when a site-to-site VPN stays online but renegotiates on a predictable interval.</strong> The usual cause is a phase-one lifetime mismatch after an ISP or firewall change.</p>",
      "<h2>Before you change anything</h2>",
      "<ol><li>Confirm which WAN path is active.</li><li>Export the current phase-one and phase-two settings from both peers.</li><li>Schedule a five-minute validation window with the requester.</li></ol>",
      "<blockquote>Do not clear every tunnel on a production firewall. Reset only the affected security association after the values match.</blockquote>",
      "<h2>Compare both peers</h2>",
      '<table style="min-width: 940px"><thead><tr><th>Peer</th><th>IKE version</th><th>Phase-one lifetime</th><th>Phase-two lifetime</th><th>DPD interval</th><th>Observed symptom</th></tr></thead><tbody><tr><td>ACME-FW-01 / WAN1</td><td>IKEv2</td><td>28,800 seconds</td><td>3,600 seconds</td><td>10 seconds, retry 3</td><td>Stable during the primary circuit test</td></tr><tr><td>Upstream managed peer / WAN2</td><td>IKEv2</td><td>720 seconds</td><td>3,600 seconds</td><td>10 seconds, retry 3</td><td>Deletes and rebuilds the phase-one SA every 12 minutes</td></tr></tbody></table>',
      "<h2>Collect a narrow diagnostic</h2>",
      "<p>Capture the active peer, negotiated lifetime, byte counters, and the final two rekey events. This intentionally wide command is part of the phone-layout regression fixture:</p>",
      "<pre><code>Get-NetIPsecMainModeSA | Select-Object LocalEndpoint,RemoteEndpoint,KeyModule,AuthenticationMethod,EncryptionAlgorithm,HashAlgorithm,DHGroup,LifeTimeSeconds,QuickModeLimit | ConvertTo-Json -Depth 8 -Compress</code></pre>",
      "<h2>Expected topology</h2>",
      `<img loading="lazy" width="1280" height="260" alt="Wide VPN topology showing users, ACME firewall, two WAN paths, and the managed peer" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1280' height='260' viewBox='0 0 1280 260'%3E%3Crect width='1280' height='260' rx='24' fill='%23e8eef7'/%3E%3Cg fill='%231d4ed8'%3E%3Crect x='40' y='82' width='190' height='96' rx='16'/%3E%3Crect x='420' y='82' width='210' height='96' rx='16'/%3E%3Crect x='1030' y='82' width='210' height='96' rx='16'/%3E%3C/g%3E%3Cg stroke='%23475569' stroke-width='8'%3E%3Cpath d='M230 112 H420'/%3E%3Cpath d='M630 112 C780 112 870 45 1030 100'/%3E%3Cpath d='M630 150 C780 150 870 220 1030 160'/%3E%3C/g%3E%3Cg fill='white' font-family='Arial,sans-serif' font-size='24' text-anchor='middle'%3E%3Ctext x='135' y='138'%3EPlant users%3C/text%3E%3Ctext x='525' y='138'%3EACME-FW-01%3C/text%3E%3Ctext x='1135' y='138'%3EManaged peer%3C/text%3E%3C/g%3E%3Cg fill='%23334155' font-family='Arial,sans-serif' font-size='20'%3E%3Ctext x='770' y='73'%3EWAN1 primary%3C/text%3E%3Ctext x='770' y='219'%3EWAN2 failover%3C/text%3E%3C/g%3E%3C/svg%3E">`,
      "<h2>Resolution</h2>",
      "<p>Match the phase-one lifetime on both peers, save each side, and clear only the affected SA. Watch through two full lifetime windows. A healthy result has no delete/recreate pair, increasing byte counters, and no fresh disconnect report.</p>",
      "<h2>Close-out evidence</h2>",
      "<ul><li>Attach the before/after peer configuration.</li><li>Record the exact SA cleared and the validation window.</li><li>Ask the requester to keep one ERP session open through the second interval.</li></ul>",
    ].join(""),
    category: "Network",
    visibility: "internal",
    published: true,
    author: "Jess Spillers",
    createdAt: daysFromNow(-24, 9),
    updatedAt: daysFromNow(0, 10, 30),
  },
  {
    id: 402,
    slug: "reset-microsoft-365-password-and-mfa",
    title: "Reset your Microsoft 365 password and MFA",
    bodyHtml:
      "<p>If your password or authenticator phone changed, start at the company sign-in page and choose <strong>Forgot my password</strong>.</p><ol><li>Verify your identity with the recovery method shown.</li><li>Create a unique password.</li><li>Open Security info and register the new authenticator.</li></ol><p>If no recovery method is available, contact the service desk. We will verify your identity before resetting MFA.</p>",
    category: "Accounts",
    visibility: "portal",
    published: true,
    author: "Priya Shah",
    createdAt: daysFromNow(-18, 11),
    updatedAt: daysFromNow(0, 9, 45),
  },
  {
    id: 403,
    slug: "reconnect-wifi-after-password-change",
    title: "Reconnect to company Wi-Fi after a password change",
    bodyHtml:
      "<p>Forget the saved company network, reconnect, and enter your new password. On Windows, open Settings → Network &amp; internet → Wi-Fi → Manage known networks. On iPhone or Android, tap the network details and choose Forget.</p><p>If the device still offers the old credentials, restart it once before contacting support.</p>",
    category: "Getting connected",
    visibility: "portal",
    published: true,
    author: "Sam Rivera",
    createdAt: daysFromNow(-12, 14),
    updatedAt: daysFromNow(-1, 16),
  },
  {
    id: 404,
    slug: "replace-edge-firewall-without-downtime",
    title: "Replace an edge firewall without downtime",
    bodyHtml:
      "<p>Draft cutover sequence for the next hardware refresh.</p><ul><li>Pre-stage firmware and configuration.</li><li>Verify HA heartbeat on an isolated switch.</li><li>Move the standby unit first.</li></ul>",
    category: "Network",
    visibility: "internal",
    published: false,
    author: "Jess Spillers",
    createdAt: daysFromNow(-2, 15),
    updatedAt: daysFromNow(0, 10, 45),
  },
  {
    id: 405,
    slug: "triage-a-shared-mailbox-delivery-delay",
    title: "Triage a shared mailbox delivery delay",
    bodyHtml:
      "<p>Check message trace before changing mailbox permissions. Compare the transport timestamp with the client sync timestamp, then test in Outlook on the web to separate delivery from desktop caching.</p>",
    category: "Email",
    visibility: "internal",
    published: true,
    author: "Priya Shah",
    createdAt: daysFromNow(-9, 10),
    updatedAt: daysFromNow(-2, 13),
  },
];

function plainKbText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function kbSearchScore(article, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 0;
  const title = article.title.toLowerCase();
  const category = article.category.toLowerCase();
  const body = plainKbText(article.bodyHtml).toLowerCase();
  const tokens = [...new Set(query.split(/\s+/).filter((token) => token.length > 1))];
  let score = 0;
  if (title === query) score += 150;
  else if (title.includes(query)) score += 90;
  if (body.includes(query)) score += 35;
  for (const token of tokens) {
    if (title.includes(token)) score += 14;
    if (category.includes(token)) score += 5;
    const occurrences = body.split(token).length - 1;
    score += Math.min(occurrences, 4) * 2.5;
  }
  return score;
}

function kbExcerpt(article, rawQuery, maxLength = 220) {
  const text = plainKbText(article.bodyHtml);
  if (text.length <= maxLength) return text;
  const query = rawQuery.trim().toLowerCase();
  const lowered = text.toLowerCase();
  const tokens = query.split(/\s+/).filter((token) => token.length > 1);
  let matchAt = lowered.indexOf(query);
  if (matchAt < 0) {
    const positions = tokens.map((token) => lowered.indexOf(token)).filter((index) => index >= 0);
    matchAt = positions.length ? Math.min(...positions) : 0;
  }
  let start = Math.max(0, matchAt - 65);
  let end = Math.min(text.length, start + maxLength);
  if (end === text.length) start = Math.max(0, end - maxLength);
  if (start > 0) {
    const nextSpace = text.indexOf(" ", start);
    if (nextSpace >= 0 && nextSpace < matchAt) start = nextSpace + 1;
  }
  if (end < text.length) {
    const previousSpace = text.lastIndexOf(" ", end);
    if (previousSpace > start) end = previousSpace;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function kbSlugBase(title) {
  return String(title)
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200) || "article";
}

function uniqueKbSlug(title) {
  const base = kbSlugBase(title);
  const used = new Set(kbArticles.map((article) => article.slug));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const marker = `-${suffix}`;
    const candidate = `${base.slice(0, 200 - marker.length).replace(/-+$/g, "")}${marker}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Mock KB slug space exhausted");
}

const connections = [
  {
    id: 1,
    name: "SpillersTech Jira",
    type: "jira",
    enabled: true,
    config: { baseUrl: "https://spillerstech.atlassian.net", email: "sync@spillerstech.com", hasApiToken: true },
    lastTestAt: daysFromNow(0, 7, 30),
    lastTestOk: true,
    lastTestMessage: "Connected as Sync Bot. 2 project(s) visible: HELP, SCRUM.",
    configured: true,
  },
  {
    id: 2,
    name: "Contoso Jira",
    type: "jira",
    enabled: true,
    config: { baseUrl: "https://contoso.atlassian.net", email: "sync@contoso.com", hasApiToken: true },
    lastTestAt: daysFromNow(-1, 16, 5),
    lastTestOk: false,
    lastTestMessage: "Authentication rejected — check the account email and API token.",
    configured: true,
  },
];

const syncRuns = [
  {
    id: 101,
    providerId: 1,
    configRevision: 1,
    provider: { name: "ConnectWise Manage", type: "connectwise" },
    trigger: "scheduled",
    status: "success",
    initiatedBy: "system",
    startedAt: daysFromNow(0, 8, 49),
    completedAt: daysFromNow(0, 8, 50),
    durationMs: 612,
    ticketsCreated: 0,
    ticketsUpdated: 3,
    notesUpserted: 2,
    ticketsFiltered: 0,
    ticketsSkipped: 0,
    ticketsConflicted: 0,
    errorCount: 0,
    latestError: null,
  },
  {
    id: 102,
    providerId: 2,
    configRevision: 2,
    provider: { name: "SpillersTech — Jira helpdesk", type: "jira" },
    trigger: "manual",
    status: "degraded",
    initiatedBy: "joey",
    startedAt: daysFromNow(0, 9, 9),
    completedAt: daysFromNow(0, 9, 10),
    durationMs: 1048,
    ticketsCreated: 2,
    ticketsUpdated: 1,
    notesUpserted: 2,
    ticketsFiltered: 4,
    ticketsSkipped: 0,
    ticketsConflicted: 1,
    errorCount: 1,
    latestError: "OPS-712 is held for manual conflict resolution.",
  },
  {
    id: 103,
    providerId: 3,
    configRevision: 1,
    provider: { name: "Contoso — Jira helpdesk", type: "jira" },
    trigger: "scheduled",
    status: "error",
    initiatedBy: "system",
    startedAt: daysFromNow(-1, 16, 4),
    completedAt: daysFromNow(-1, 16, 5),
    durationMs: 301,
    ticketsCreated: 0,
    ticketsUpdated: 0,
    notesUpserted: 0,
    ticketsFiltered: 0,
    ticketsSkipped: 0,
    ticketsConflicted: 0,
    errorCount: 1,
    latestError: "Authentication rejected — check the account email and API token.",
  },
];

const syncProviders = [
  {
    id: 1,
    name: "ConnectWise Manage",
    type: "connectwise",
    enabled: true,
    lastSyncedAt: daysFromNow(0, 8, 50),
    configRevision: 1,
    createdAt: daysFromNow(-30, 9),
    connectionId: null,
    config: { board: "Service Board" },
    health: {
      status: "healthy",
      lastAttemptAt: syncRuns[0].startedAt,
      lastSuccessAt: syncRuns[0].completedAt,
      consecutiveFailures: 0,
      latestError: null,
      latestRun: syncRuns[0],
    },
  },
  {
    id: 2,
    name: "SpillersTech — Jira helpdesk",
    type: "jira",
    enabled: true,
    lastSyncedAt: daysFromNow(0, 9, 10),
    configRevision: 2,
    createdAt: daysFromNow(-20, 9),
    connectionId: 1,
    config: { projectKey: "HELP", filter: { status: ["To Do", "In Progress"] } },
    health: {
      status: "degraded",
      lastAttemptAt: syncRuns[1].startedAt,
      lastSuccessAt: daysFromNow(-1, 9, 10),
      consecutiveFailures: 0,
      latestError: syncRuns[1].latestError,
      latestRun: syncRuns[1],
    },
  },
  {
    id: 3,
    name: "Contoso — Jira helpdesk",
    type: "jira",
    enabled: false,
    lastSyncedAt: null,
    configRevision: 1,
    createdAt: daysFromNow(-1, 16),
    connectionId: 2,
    config: {},
    health: {
      status: "failing",
      lastAttemptAt: syncRuns[2].startedAt,
      lastSuccessAt: null,
      consecutiveFailures: 3,
      latestError: syncRuns[2].latestError,
      latestRun: syncRuns[2],
    },
  },
];

const syncLog = [
  {
    id: "9001",
    runId: 102,
    externalId: "OPS-712",
    internalId: 104,
    direction: "inbound",
    status: "skipped",
    message: "Conflict flagged; waiting for keep-local or keep-remote.",
    syncedAt: daysFromNow(0, 9, 10),
    provider: { name: "SpillersTech — Jira helpdesk", type: "jira" },
  },
  {
    id: "9003",
    runId: 103,
    externalId: null,
    internalId: null,
    direction: "inbound",
    status: "error",
    message: "Jira returned no issues and the credentials failed verification — Jira GET /rest/api/3/myself → 401: Unauthorized.",
    syncedAt: daysFromNow(-1, 16, 5),
    provider: { name: "Contoso — Jira helpdesk", type: "jira" },
  },
  {
    id: "9002",
    runId: 101,
    externalId: "CW-88231",
    internalId: 103,
    direction: "outbound",
    status: "success",
    message: "Local status and notes pushed.",
    syncedAt: daysFromNow(0, 8, 50),
    provider: { name: "ConnectWise Manage", type: "connectwise" },
  },
];

function relatedTicketSummary(ticket) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    companyName: ticket.companyName,
  };
}

function ticketWithRelations(id) {
  const ticket = ticketRows.find((t) => t.id === id);
  if (!ticket) return null;
  const parent = ticketRows.find((candidate) => candidate.id === ticket.parentId);
  const children = ticketRows.filter((candidate) => candidate.parentId === ticket.id);
  const mergedInto = ticketRows.find((candidate) => candidate.id === ticket.mergedIntoId);
  return {
    ...ticket,
    parentId: ticket.parentId ?? null,
    mergedIntoId: ticket.mergedIntoId ?? null,
    mergedAt: ticket.mergedAt ?? null,
    parent: parent ? relatedTicketSummary(parent) : null,
    children: children.map(relatedTicketSummary),
    mergedInto: mergedInto ? relatedTicketSummary(mergedInto) : null,
    company: companies.find((c) => c.id === ticket.companyId) ?? null,
    contact: companies.flatMap((c) => c.contacts ?? []).find((c) => c.id === ticket.contactId) ?? null,
    team: teams.find((team) => team.id === ticket.teamId) ?? null,
  };
}

function mergePreviewFor(sourceId, targetId) {
  const source = ticketRows.find((ticket) => ticket.id === sourceId);
  const target = ticketRows.find((ticket) => ticket.id === targetId);
  if (!source || !target) return null;

  const warnings = [];
  if (source.externalId && ["connectwise", "jira"].includes(source.externalProvider)) {
    warnings.push({
      code: "sync-stop",
      message:
        `${source.externalId} stays open in ${source.externalProvider}. AnchorDesk will stop syncing it. ` +
        "The remote issue is not closed, commented on, or linked by this merge.",
    });
  }
  if (source.companyId && target.companyId && source.companyId !== target.companyId) {
    warnings.push({
      code: "cross-company",
      message:
        `These tickets belong to different companies (${source.companyName} → ${target.companyName}). ` +
        `The conversation will move to ${target.companyName}.`,
    });
  }

  const targetLabelIds = new Set((target.labels ?? []).map((item) => item.label.id));
  return {
    source: relatedTicketSummary(source),
    target: relatedTicketSummary(target),
    moves: {
      notes: (notesByTicket[source.id] ?? []).length,
      attachments: source.id === 101 ? 1 : 0,
      checklistItems: source.id === 101 ? 4 : 0,
      children: ticketRows.filter((ticket) => ticket.parentId === source.id).length,
      labels: (source.labels ?? []).filter((item) => !targetLabelIds.has(item.label.id)).length,
      deviceLinks: source.id === 101 ? 2 : 0,
    },
    warnings,
    blockers: source.id === target.id
      ? [{ code: "same-ticket", message: "a ticket cannot be merged into itself" }]
      : [],
  };
}

function myDayData(searchParams) {
  const from = new Date(searchParams.get("from") || Date.now());
  const day = new Date(from);
  const at = (hour, minute) => {
    const d = new Date(day);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const entries = [
    {
      id: 701,
      ticketId: 101,
      ticketNumber: "10482",
      ticketTitle: "VPN drops every 12 minutes on ACME-FW-01",
      content: "Tunnel investigation",
      minutes: 35,
      timeStart: at(9, 40),
      timeStop: at(10, 15),
      placed: true,
    },
    {
      id: 702,
      ticketId: 103,
      ticketNumber: "10484",
      ticketTitle: "Jira change request waiting on approval",
      content: "Conflict review",
      minutes: 55,
      timeStart: at(11, 15),
      timeStop: at(12, 10),
      placed: true,
    },
    {
      id: 703,
      ticketId: 106,
      ticketNumber: "10487",
      ticketTitle: "Datto quick job queued for kiosk",
      content: "Component run follow-up",
      minutes: 45,
      timeStart: at(14, 10),
      timeStop: at(14, 55),
      placed: true,
    },
    {
      id: 704,
      ticketId: 102,
      ticketNumber: "10483",
      ticketTitle: "Shared mailbox replies missing signatures",
      content: "Template review",
      minutes: 25,
      timeStart: null,
      timeStop: null,
      placed: false,
    },
  ];
  return {
    from: from.toISOString(),
    to: new Date(searchParams.get("to") || from.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    entries,
    summary: {
      loggedMinutes: 160,
      placedMinutes: 135,
      unplacedMinutes: 25,
      firstStart: at(9, 40),
      lastStop: at(14, 55),
      count: entries.length,
    },
  };
}

function reportRequestContext(searchParams) {
  const defaultTo = new Date();
  defaultTo.setUTCHours(0, 0, 0, 0);
  defaultTo.setUTCDate(defaultTo.getUTCDate() + 1);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);

  const from = new Date(searchParams.get("from") || defaultFrom);
  const to = new Date(searchParams.get("to") || defaultTo);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from >= to
  ) {
    return { error: "report range must be valid and from must be before to" };
  }

  const context = { from, to };
  for (const name of ["companyId", "teamId", "assigneeId"]) {
    const raw = searchParams.get(name);
    if (raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      return { error: `${name} must be a positive integer` };
    }
    context[name] = value;
  }

  const reconstructedFrom = new Date(REPORT_RECONSTRUCTED_FROM);
  const reconstructedThrough = new Date(REPORT_RECONSTRUCTED_THROUGH);
  context.meta = {
    from: from.toISOString(),
    to: to.toISOString(),
    includesReconstructed:
      to > reconstructedFrom && from <= reconstructedThrough,
    reconstructedFrom: reconstructedFrom.toISOString(),
    reconstructedThrough: reconstructedThrough.toISOString(),
  };
  return context;
}

const REPORT_DIMENSION_WEIGHTS = {
  companyId: new Map([[1, 0.62], [2, 0.28]]),
  teamId: new Map([[1, 0.57], [2, 0.34]]),
  assigneeId: new Map([[1, 0.37], [2, 0.31], [3, 0.24]]),
};

function reportScale(context, ignoredDimensions = []) {
  const ignored = new Set(ignoredDimensions);
  let scale = 1;
  for (const name of ["companyId", "teamId", "assigneeId"]) {
    if (ignored.has(name) || context[name] === undefined) continue;
    scale *= REPORT_DIMENSION_WEIGHTS[name].get(context[name]) ?? 0;
  }
  return scale;
}

function scaledCount(value, scale) {
  if (value === 0 || scale <= 0) return 0;
  return Math.max(1, Math.round(value * scale));
}

function volumeReportData(context) {
  const createdByWeekday = [5, 19, 21, 18, 20, 16, 7];
  const resolvedByWeekday = [2, 15, 18, 17, 16, 14, 4];
  const scale = reportScale(context);
  const rows = [];
  const cursor = new Date(Date.UTC(
    context.from.getUTCFullYear(),
    context.from.getUTCMonth(),
    context.from.getUTCDate(),
  ));
  let index = 0;
  while (cursor < context.to) {
    const weekday = cursor.getUTCDay();
    const created = createdByWeekday[weekday] +
      (index % 9 === 4 ? 7 : (index * 3) % 4);
    const resolved = resolvedByWeekday[weekday] +
      (index % 11 === 7 ? 5 : (index * 5) % 3);
    rows.push({
      day: cursor.toISOString().slice(0, 10),
      created: scaledCount(created, scale),
      resolved: scaledCount(resolved, scale),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    index += 1;
  }
  return rows;
}

function durationReportData(context) {
  const scale = reportScale(context);
  if (scale <= 0) {
    return {
      firstResponse: { count: 0, p50Minutes: null, p90Minutes: null },
      resolution: { count: 0, p50Minutes: null, p90Minutes: null },
    };
  }
  const latencyFactor =
    (context.companyId === 2 ? 1.18 : 1) *
    (context.teamId === 1 ? 0.92 : 1) *
    (context.assigneeId === 3 ? 1.24 : 1);
  return {
    firstResponse: {
      count: scaledCount(284, scale),
      p50Minutes: Math.round(24 * latencyFactor),
      // Deliberately long-tailed: the p90 is the management signal a mean
      // would blur, not a cosmetically nearby companion to the median.
      p90Minutes: Math.round(214 * latencyFactor),
    },
    resolution: {
      count: scaledCount(237, scale),
      p50Minutes: Math.round(318 * latencyFactor),
      p90Minutes: Math.round(2_946 * latencyFactor),
    },
  };
}

function slaComplianceReport(context) {
  const scale = reportScale(context);
  return [
    {
      kind: "response",
      met: scaledCount(211, scale),
      breached: scaledCount(31, scale),
      atRisk: scaledCount(14, scale),
      onTrack: scaledCount(28, scale),
    },
    {
      kind: "resolution",
      met: scaledCount(163, scale),
      breached: scaledCount(47, scale),
      atRisk: scaledCount(19, scale),
      onTrack: scaledCount(36, scale),
    },
  ];
}

function backlogReportData(context) {
  const scale = reportScale(context);
  return [
    { bucket: "<1d", count: scaledCount(18, scale) },
    { bucket: "1-3d", count: scaledCount(26, scale) },
    { bucket: "3-7d", count: scaledCount(21, scale) },
    { bucket: "7-30d", count: scaledCount(34, scale) },
    // A visible rotten tail is intentional: a spotless demo fixture would not
    // exercise the report's actual management question.
    { bucket: "30d+", count: scaledCount(17, scale) },
  ];
}

function teamThroughputReport(context) {
  const scale = reportScale(context, ["teamId"]);
  const rows = [
    { teamId: 1, teamName: "Network Operations", resolved: 96 },
    { teamId: 2, teamName: "Service Desk", resolved: 72 },
    { teamId: null, teamName: null, resolved: 11 },
  ];
  return rows
    .filter((row) => context.teamId === undefined || row.teamId === context.teamId)
    .map((row) => ({ ...row, resolved: scaledCount(row.resolved, scale) }));
}

function assigneeThroughputReport(context) {
  const scale = reportScale(context, ["assigneeId"]);
  const rows = [
    { assigneeId: 1, assigneeName: "Jess Spillers", resolved: 68 },
    { assigneeId: 2, assigneeName: "Priya Shah", resolved: 61 },
    { assigneeId: 3, assigneeName: "Sam Rivera", resolved: 43 },
    { assigneeId: null, assigneeName: null, resolved: 7 },
  ];
  return rows
    .filter((row) =>
      context.assigneeId === undefined || row.assigneeId === context.assigneeId
    )
    .map((row) => ({ ...row, resolved: scaledCount(row.resolved, scale) }));
}

function companyTimeReport(context) {
  const scale = reportScale(context, ["companyId"]);
  const rows = [
    { companyId: 1, companyName: "ACME Manufacturing", minutes: 6_840 },
    { companyId: 2, companyName: "Northwind Clinic", minutes: 3_270 },
    { companyId: null, companyName: null, minutes: 480 },
  ];
  return rows
    .filter((row) =>
      context.companyId === undefined || row.companyId === context.companyId
    )
    .map((row) => ({
      ...row,
      minutes: scaledCount(row.minutes, scale),
    }));
}

function daySpreadReport(context) {
  const technician = assignees.find((user) =>
    user.id === (context.assigneeId ?? demoUser.id)
  );
  if (!technician) {
    return {
      data: {
        assigneeId: context.assigneeId ?? demoUser.id,
        entries: [],
        target: {
          minutes: 480,
          source: "default_8h",
          label: "Default 8-hour day (no staff schedule is configured)",
        },
        summary: {
          count: 0,
          loggedMinutes: 0,
          placedMinutes: 0,
          coveredMinutes: 0,
          unplacedMinutes: 0,
          unloggedMinutes: 480,
          uncoveredMinutes: 480,
          firstStart: null,
          lastStop: null,
        },
      },
      meta: context.meta,
    };
  }

  const at = (minutesAfterMidnight) =>
    new Date(context.from.getTime() + minutesAfterMidnight * 60_000).toISOString();
  const firstStart = at(10 * 60);
  const firstStop = at(12 * 60);
  const secondStart = at(13 * 60);
  const secondStop = at(15 * 60);
  return {
    data: {
      assigneeId: technician.id,
      entries: [
        {
          id: 2_701,
          ticketId: 101,
          ticketNumber: "10482",
          ticketTitle: "VPN drops every 12 minutes on ACME-FW-01",
          content: "Packet capture, tunnel-lifetime comparison, and vendor review",
          minutes: 120,
          timeStart: firstStart,
          timeStop: firstStop,
          workedAt: firstStart,
          placed: true,
        },
        {
          id: 2_702,
          ticketId: 103,
          ticketNumber: "10484",
          ticketTitle: "Jira change request waiting on approval",
          content: "Change-plan review and customer coordination",
          minutes: 120,
          timeStart: secondStart,
          timeStop: secondStop,
          workedAt: secondStart,
          placed: true,
        },
      ],
      target: {
        minutes: 480,
        source: "default_8h",
        label: "Default 8-hour day (no staff schedule is configured)",
      },
      summary: {
        count: 2,
        loggedMinutes: 240,
        placedMinutes: 240,
        coveredMinutes: 240,
        unplacedMinutes: 0,
        unloggedMinutes: 240,
        uncoveredMinutes: 240,
        firstStart,
        lastStop: secondStop,
      },
    },
    meta: context.meta,
  };
}

function ticketSlaTimelineReport() {
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - 2);
  createdAt.setHours(8, 20, 0, 0);
  const at = (minutesAfterCreation) =>
    new Date(createdAt.getTime() + minutesAfterCreation * 60_000).toISOString();
  const now = new Date();

  return {
    data: {
      ticket: {
        id: 101,
        ticketNumber: "10482",
        title: "VPN drops every 12 minutes on ACME-FW-01",
        status: "In Progress",
        createdAt: createdAt.toISOString(),
        updatedAt: now.toISOString(),
      },
      events: [
        {
          id: "8101",
          ticketId: 101,
          kind: "created",
          fromValue: null,
          toValue: "New",
          actor: "Maya Chen (email)",
          companyId: 1,
          teamId: 2,
          assigneeId: null,
          priority: "High",
          occurredAt: at(0),
          sourceAuditId: "9101",
        },
        {
          id: "8102",
          ticketId: 101,
          kind: "assigned",
          fromValue: null,
          toValue: "Jess Spillers",
          actor: "Priya Shah",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "High",
          occurredAt: at(12),
          sourceAuditId: "9102",
        },
        {
          id: "8103",
          ticketId: 101,
          kind: "first_response",
          fromValue: null,
          toValue: null,
          actor: "Jess Spillers",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "High",
          occurredAt: at(45),
          sourceAuditId: "9103",
        },
        {
          id: "8104",
          ticketId: 101,
          kind: "status_changed",
          fromValue: "New",
          toValue: "In Progress",
          actor: "Jess Spillers",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "High",
          occurredAt: at(50),
          sourceAuditId: "9104",
        },
        {
          id: "8105",
          ticketId: 101,
          kind: "status_changed",
          fromValue: "In Progress",
          toValue: "Waiting",
          actor: "Jess Spillers",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "High",
          occurredAt: at(280),
          sourceAuditId: "9105",
        },
        {
          id: "8106",
          ticketId: 101,
          kind: "sla_breached",
          fromValue: null,
          toValue: "resolution",
          actor: "sla-scheduler",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "High",
          occurredAt: at(480),
          sourceAuditId: null,
        },
        {
          id: "8107",
          ticketId: 101,
          kind: "resolved",
          fromValue: "Waiting",
          toValue: "Resolved",
          actor: "Jess Spillers",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "High",
          occurredAt: at(1_495),
          sourceAuditId: "9107",
        },
        {
          id: "8108",
          ticketId: 101,
          kind: "reopened",
          fromValue: "Resolved",
          toValue: "In Progress",
          actor: "Maya Chen (email)",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "Critical",
          occurredAt: at(1_570),
          sourceAuditId: "9108",
        },
        {
          id: "8109",
          ticketId: 101,
          kind: "sla_breached",
          fromValue: null,
          toValue: "resolution",
          actor: "sla-scheduler",
          companyId: 1,
          teamId: 1,
          assigneeId: 1,
          priority: "Critical",
          occurredAt: at(1_810),
          sourceAuditId: null,
        },
      ],
      targets: [
        {
          id: "5101",
          ticketId: 101,
          policyId: 12,
          policyName: "ACME priority support — High",
          responseMinutes: 60,
          resolutionMinutes: 480,
          responseDueAt: at(60),
          resolutionDueAt: at(480),
          establishedAt: at(0),
          supersededAt: at(1_570),
        },
        {
          id: "5102",
          ticketId: 101,
          policyId: 4,
          policyName: "Production incident — Critical",
          responseMinutes: 30,
          resolutionMinutes: 240,
          responseDueAt: at(1_600),
          resolutionDueAt: at(1_810),
          establishedAt: at(1_570),
          supersededAt: null,
        },
      ],
    },
    meta: {
      from: createdAt.toISOString(),
      to: now.toISOString(),
      includesReconstructed: false,
      reconstructedFrom: REPORT_RECONSTRUCTED_FROM,
      reconstructedThrough: REPORT_RECONSTRUCTED_THROUGH,
      rangeDerived: true,
    },
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function companyTimeCsv(route, context) {
  const rows = companyTimeReport(context);
  const body = [
    ["company_id", "company_name", "minutes", "hours"],
    ...rows.map((row) => [
      row.companyId,
      row.companyName ?? "Unattributed",
      row.minutes,
      (row.minutes / 60).toFixed(2),
    ]),
  ].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return route.fulfill({
    status: 200,
    contentType: "text/csv; charset=utf-8",
    headers: {
      "Content-Disposition": 'attachment; filename="anchordesk-time-by-company.csv"',
      "X-AnchorDesk-Report-From": context.meta.from,
      "X-AnchorDesk-Report-To": context.meta.to,
      "X-AnchorDesk-Includes-Reconstructed":
        String(context.meta.includesReconstructed),
    },
    body,
  });
}

export async function handleApi(route) {
  const request = route.request();
  const url = new URL(request.url());
  const apiPath = url.pathname.replace(/^\/api/, "");
  const method = request.method();
  let body = {};
  const contentType = request.headers()["content-type"] ?? "";
  if (request.postData() && contentType.includes("application/json")) {
    try {
      body = request.postDataJSON();
    } catch {
      body = {};
    }
  }
  if (debugCapture) console.log(`API ${method} ${apiPath}`);

  // Phase 6 feature gates included with the authenticated portal bootstrap —
  // captured "on" so the feedback widget and solve button are exercised by
  // the mobile matrix, not left in an untested hidden state.
  const portalClientConfig = { feedbackEnabled: true, promptOnSolve: true, allowSelfSolve: true };
  if (method === "GET" && apiPath === "/portal/auth/me") {
    return json(route, { requester: portalRequester, config: portalClientConfig });
  }
  if (method === "POST" && apiPath === "/portal/auth/magic-link") {
    return json(
      route,
      {
        ok: true,
        message: "If that email address is registered, a sign-in link will arrive shortly.",
      },
      202
    );
  }
  if (method === "POST" && apiPath === "/portal/register") {
    return json(route, {
      ok: true,
      message: "Check your email for an update on your portal access request.",
    }, 202);
  }
  if (method === "POST" && apiPath === "/portal/auth/verify") {
    return json(route, { requester: portalRequester, config: portalClientConfig });
  }
  if (method === "POST" && apiPath === "/portal/auth/logout") {
    return json(route, { ok: true });
  }
  // Portal deflection only. Scoped to visibility=portal so it does not shadow
  // the ranked staff KB search defined further down — both workstreams added a
  // /kb/search handler, and an unscoped one here silently made every staff
  // search return the portal fixtures.
  if (
    method === "GET" &&
    apiPath === "/kb/search" &&
    url.searchParams.get("visibility") === "portal"
  ) {
    return json(route, { items: portalKbItems });
  }
  if (method === "GET" && apiPath === "/portal/tickets") {
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("pageSize") || 20))
    );
    const start = (page - 1) * pageSize;
    return json(route, {
      items: portalTickets
        .slice(start, start + pageSize)
        .map(({ notes: _notes, attachments: _attachments, ...ticket }) => ({
          ...ticket,
          notes: [],
          attachments: [],
        })),
      total: portalTickets.length,
      page,
      pageSize,
    });
  }
  if (method === "POST" && apiPath === "/portal/tickets") {
    const now = new Date().toISOString();
    return json(
      route,
      {
        id: 804,
        ticketNumber: "10502",
        title: body.summary,
        summary: body.summary,
        description: body.description || null,
        status: "New",
        priority: "Medium",
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        notes: [],
        attachments: [],
      },
      201
    );
  }
  let portalMatch = apiPath.match(/^\/portal\/tickets\/(\d+)$/);
  if (method === "GET" && portalMatch) {
    const ticket = portalTickets.find((item) => item.id === Number(portalMatch[1]));
    return ticket
      ? json(route, ticket)
      : json(route, { error: "Ticket not found" }, 404);
  }
  portalMatch = apiPath.match(/^\/portal\/tickets\/(\d+)\/comments$/);
  if (method === "POST" && portalMatch) {
    return json(
      route,
      {
        id: 8103,
        content: body.content,
        htmlContent: null,
        direction: null,
        authorKind: "you",
        createdAt: new Date().toISOString(),
      },
      201
    );
  }
  portalMatch = apiPath.match(/^\/portal\/tickets\/(\d+)\/feedback$/);
  if (method === "POST" && portalMatch) {
    return json(
      route,
      {
        id: 9001,
        rating: body.rating,
        comment: body.comment ?? null,
        submittedAt: new Date().toISOString(),
      },
      201
    );
  }
  portalMatch = apiPath.match(/^\/portal\/tickets\/(\d+)\/solve$/);
  if (method === "POST" && portalMatch) {
    return json(route, {
      id: Number(portalMatch[1]),
      status: "Resolved",
      updatedAt: new Date().toISOString(),
    });
  }
  portalMatch = apiPath.match(/^\/portal\/tickets\/(\d+)\/attachments$/);
  if (method === "POST" && portalMatch) {
    return json(
      route,
      [
        {
          id: 8202,
          filename: "room-controller.jpg",
          contentType: "image/jpeg",
          size: 13724,
          createdAt: new Date().toISOString(),
          downloadUrl: "/api/portal/attachments/8202/download",
        },
      ],
      201
    );
  }

  if (method === "GET" && apiPath === "/auth/me") return json(route, { user: demoUser });
  if (method === "PUT" && apiPath === "/auth/kanban-columns") {
    demoUser.kanbanColumns = Array.isArray(body.kanbanColumns) ? body.kanbanColumns : null;
    return json(route, { kanbanColumns: demoUser.kanbanColumns });
  }
  if (method === "GET" && apiPath === "/auth/setup-status") return json(route, { needed: false });
  if (method === "GET" && apiPath === "/auth/config") return json(route, { local: true, oidc: true, saml: false });
  if (method === "GET" && apiPath === "/ui-settings") return json(route, { legacyTableView: false });
  // Captured in its default state: off is what a fresh install actually looks
  // like, and the panel's warning copy differs between the two.
  const defaultPortalSettings = { enabled: false, ticketScope: "own", technicianIdentity: "anonymous", allowAttachments: true, allowSelfSolve: true };
  if (method === "GET" && apiPath === "/portal-settings") return json(route, defaultPortalSettings);
  if (method === "PATCH" && apiPath === "/portal-settings") return json(route, { ...defaultPortalSettings, enabled: true });
  const portalRegistrations = [{
    id: 7301,
    email: "rita@acme.example",
    companyId: 101,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    contactId: null,
    createdAt: "2026-08-01T14:30:00.000Z",
    company: { id: 101, name: "ACME Manufacturing", domain: "acme.example" },
    contact: null,
  }];
  if (method === "GET" && apiPath === "/portal-registrations") return json(route, portalRegistrations);
  if (method === "POST" && /^\/portal-registrations\/\d+\/(approve|reject)$/.test(apiPath)) {
    return json(route, { ...portalRegistrations[0], status: apiPath.endsWith("/approve") ? "approved" : "rejected" });
  }
  if (method === "GET" && apiPath === "/feedback-settings") return json(route, { enabled: true, promptOnSolve: true });
  if (method === "PATCH" && apiPath === "/feedback-settings") return json(route, { enabled: true, promptOnSolve: true });

  const reportPaths = new Set([
    "/reports/volume",
    "/reports/durations",
    "/reports/sla-compliance",
    "/reports/backlog-age",
    "/reports/throughput/team",
    "/reports/throughput/assignee",
    "/reports/time-by-company",
    "/reports/time-by-company.csv",
  ]);
  if (method === "GET" && reportPaths.has(apiPath)) {
    const context = reportRequestContext(url.searchParams);
    if (context.error) return json(route, { error: context.error }, 400);
    if (apiPath === "/reports/volume") {
      return json(route, { data: volumeReportData(context), meta: context.meta });
    }
    if (apiPath === "/reports/durations") {
      return json(route, { data: durationReportData(context), meta: context.meta });
    }
    if (apiPath === "/reports/sla-compliance") {
      const coverageFrom = new Date(REPORT_SLA_COVERAGE_FROM);
      return json(route, {
        data: slaComplianceReport(context),
        meta: {
          ...context.meta,
          slaSnapshotCoverageFrom: coverageFrom.toISOString(),
          includesUnrecordedSlaHistory: context.from < coverageFrom,
        },
      });
    }
    if (apiPath === "/reports/backlog-age") {
      return json(route, { data: backlogReportData(context), meta: context.meta });
    }
    if (apiPath === "/reports/throughput/team") {
      return json(route, { data: teamThroughputReport(context), meta: context.meta });
    }
    if (apiPath === "/reports/throughput/assignee") {
      return json(route, { data: assigneeThroughputReport(context), meta: context.meta });
    }
    if (apiPath === "/reports/time-by-company") {
      return json(route, { data: companyTimeReport(context), meta: context.meta });
    }
    return companyTimeCsv(route, context);
  }

  if (method === "GET" && apiPath === "/time/day-spread") {
    const context = reportRequestContext(url.searchParams);
    return context.error
      ? json(route, { error: context.error }, 400)
      : json(route, daySpreadReport(context));
  }

  if (method === "GET" && apiPath === "/tickets/101/sla-timeline") {
    return json(route, ticketSlaTimelineReport());
  }

  if (method === "GET" && apiPath === "/assignees") return json(route, assignees);
  if (method === "GET" && apiPath === "/users") return json(route, managedUsers);
  if (method === "GET" && apiPath === "/labels") return json(route, labels);
  if (method === "GET" && apiPath === "/teams") return json(route, teams);
  if (method === "POST" && apiPath === "/teams") {
    const team = { id: Math.max(0, ...teams.map((item) => item.id)) + 1, name: body.name, description: body.description ?? null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), members: [], _count: { tickets: 0 } };
    teams.push(team);
    return json(route, team, 201);
  }
  let resourceMatch = apiPath.match(/^\/teams\/(\d+)$/);
  if (resourceMatch && method === "PATCH") {
    const team = teams.find((item) => item.id === Number(resourceMatch[1]));
    if (!team) return json(route, { error: "not found" }, 404);
    Object.assign(team, body, { updatedAt: new Date().toISOString() });
    return json(route, team);
  }
  if (resourceMatch && method === "DELETE") {
    const index = teams.findIndex((item) => item.id === Number(resourceMatch[1]));
    if (index >= 0) teams.splice(index, 1);
    return json(route, {}, 204);
  }
  resourceMatch = apiPath.match(/^\/teams\/(\d+)\/members$/);
  if (resourceMatch && method === "POST") {
    const team = teams.find((item) => item.id === Number(resourceMatch[1]));
    const user = assignees.find((item) => item.id === Number(body.userId));
    if (team && user && !team.members.some((member) => member.userId === user.id)) team.members.push({ teamId: team.id, userId: user.id, user });
    return json(route, team ?? { error: "not found" }, team ? 201 : 404);
  }
  resourceMatch = apiPath.match(/^\/teams\/(\d+)\/members\/(\d+)$/);
  if (resourceMatch && method === "DELETE") {
    const team = teams.find((item) => item.id === Number(resourceMatch[1]));
    if (team) team.members = team.members.filter((member) => member.userId !== Number(resourceMatch[2]));
    return json(route, team ?? { error: "not found" }, team ? 200 : 404);
  }

  if (method === "GET" && apiPath === "/custom-fields") {
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    return json(route, customFields.filter((field) => includeArchived || !field.archived));
  }
  if (method === "POST" && apiPath === "/custom-fields") {
    const field = { id: Math.max(0, ...customFields.map((item) => item.id)) + 1, ...body, options: body.options ?? null, required: body.required ?? false, sortOrder: body.sortOrder ?? 0, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    customFields.push(field);
    return json(route, field, 201);
  }
  resourceMatch = apiPath.match(/^\/custom-fields\/(\d+)$/);
  if (resourceMatch && method === "PATCH") {
    const field = customFields.find((item) => item.id === Number(resourceMatch[1]));
    if (!field) return json(route, { error: "not found" }, 404);
    Object.assign(field, body, { updatedAt: new Date().toISOString() });
    return json(route, field);
  }
  if (resourceMatch && method === "DELETE") {
    const index = customFields.findIndex((item) => item.id === Number(resourceMatch[1]));
    if (index >= 0) customFields.splice(index, 1);
    return json(route, {}, 204);
  }

  if (method === "GET" && apiPath === "/automations") return json(route, automations);
  if (method === "POST" && apiPath === "/automations") {
    const rule = { id: Math.max(0, ...automations.map((item) => item.id)) + 1, enabled: true, runCount: 0, lastRunAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...body };
    automations.push(rule);
    return json(route, rule, 201);
  }
  resourceMatch = apiPath.match(/^\/automations\/(\d+)$/);
  if (resourceMatch && method === "PATCH") {
    const rule = automations.find((item) => item.id === Number(resourceMatch[1]));
    if (!rule) return json(route, { error: "not found" }, 404);
    Object.assign(rule, body, { updatedAt: new Date().toISOString() });
    return json(route, rule);
  }
  if (resourceMatch && method === "DELETE") {
    const index = automations.findIndex((item) => item.id === Number(resourceMatch[1]));
    if (index >= 0) automations.splice(index, 1);
    return json(route, {}, 204);
  }

  if (method === "GET" && apiPath === "/views") return json(route, savedViews);
  if (method === "POST" && apiPath === "/views") {
    const view = { id: Math.max(0, ...savedViews.map((item) => item.id)) + 1, userId: body.shared ? null : demoUser.id, name: body.name, filters: body.filters ?? {}, shared: body.shared ?? false, sortOrder: body.sortOrder ?? 0, createdAt: new Date().toISOString() };
    savedViews.push(view);
    return json(route, view, 201);
  }
  resourceMatch = apiPath.match(/^\/views\/(\d+)$/);
  if (resourceMatch && method === "PATCH") {
    const view = savedViews.find((item) => item.id === Number(resourceMatch[1]));
    if (!view) return json(route, { error: "not found" }, 404);
    Object.assign(view, body);
    return json(route, view);
  }
  if (resourceMatch && method === "DELETE") {
    const index = savedViews.findIndex((item) => item.id === Number(resourceMatch[1]));
    if (index >= 0) savedViews.splice(index, 1);
    return json(route, {}, 204);
  }

  if (method === "GET" && apiPath === "/kb/search") {
    const q = (url.searchParams.get("q") || "").trim();
    const visibility = url.searchParams.get("visibility");
    const requestedLimit = Number(url.searchParams.get("limit") || 20);
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 100))
      : 20;
    const items = kbArticles
      .filter((article) =>
        article.published &&
        (!visibility || article.visibility === visibility)
      )
      .map((article) => ({ article, score: kbSearchScore(article, q) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.article.id - b.article.id)
      .slice(0, limit)
      .map(({ article, score }) => ({
        id: article.id,
        slug: article.slug,
        title: article.title,
        excerpt: kbExcerpt(article, q),
        score: Number(score.toFixed(4)),
      }));
    return json(route, { items });
  }

  if (method === "GET" && apiPath === "/kb/articles") {
    const includeUnpublished = url.searchParams.get("includeUnpublished") === "true";
    const visibility = url.searchParams.get("visibility");
    // Mirrors the route: `published` narrows the author listing only, and is
    // rejected without includeUnpublished rather than silently ignored.
    const publishedParam = url.searchParams.get("published");
    if (publishedParam !== null && !includeUnpublished) {
      return json(route, { error: "published requires includeUnpublished=true" }, 400);
    }
    const items = kbArticles
      .filter((article) =>
        (includeUnpublished || article.published) &&
        (publishedParam === null || article.published === (publishedParam === "true")) &&
        (!visibility || article.visibility === visibility)
      )
      .sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
        b.id - a.id
      )
      .map((article) => ({
        id: article.id,
        slug: article.slug,
        title: article.title,
        excerpt: kbExcerpt(article, ""),
        category: article.category,
        visibility: article.visibility,
        published: article.published,
        author: article.author,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      }));
    return json(route, { items });
  }

  if (method === "POST" && apiPath === "/kb/articles") {
    const now = new Date().toISOString();
    const article = {
      id: Math.max(0, ...kbArticles.map((item) => item.id)) + 1,
      slug: uniqueKbSlug(body.title),
      title: body.title,
      bodyHtml: body.bodyHtml,
      category: body.category,
      visibility: body.visibility ?? "internal",
      published: body.published ?? false,
      author: demoUser.displayName,
      createdAt: now,
      updatedAt: now,
    };
    kbArticles.push(article);
    return json(route, article, 201);
  }

  resourceMatch = apiPath.match(/^\/kb\/articles\/(\d+)$/);
  if (resourceMatch && method === "GET") {
    const article = kbArticles.find((item) => item.id === Number(resourceMatch[1]));
    return article ? json(route, article) : json(route, { error: "Article not found" }, 404);
  }
  if (resourceMatch && method === "PATCH") {
    const article = kbArticles.find((item) => item.id === Number(resourceMatch[1]));
    if (!article) return json(route, { error: "Article not found" }, 404);
    for (const field of ["title", "bodyHtml", "category", "visibility", "published"]) {
      if (body[field] !== undefined) article[field] = body[field];
    }
    // Slugs are server-owned and remain stable across title edits.
    article.updatedAt = new Date().toISOString();
    return json(route, article);
  }
  if (resourceMatch && method === "DELETE") {
    const index = kbArticles.findIndex((item) => item.id === Number(resourceMatch[1]));
    if (index < 0) return json(route, { error: "Article not found" }, 404);
    kbArticles.splice(index, 1);
    return route.fulfill({ status: 204, body: "" });
  }

  resourceMatch = apiPath.match(/^\/kb\/portal\/([a-z0-9-]+)$/);
  if (resourceMatch && method === "GET") {
    // Mirror the real portal boundary instead of relying on callers to filter.
    const article = kbArticles.find((item) =>
      item.slug === resourceMatch[1] &&
      item.visibility === "portal" &&
      item.published
    );
    return article ? json(route, article) : json(route, { error: "Article not found" }, 404);
  }

  if (method === "GET" && apiPath === "/notifications") {
    return json(route, {
      unread: 2,
      items: [
        {
          id: 1,
          type: "assignment",
          ticketId: 101,
          title: "High priority ticket assigned",
          body: "VPN drops every 12 minutes on ACME-FW-01",
          readAt: null,
          createdAt: daysFromNow(0, 9, 5),
        },
        {
          id: 2,
          type: "sla",
          ticketId: 103,
          title: "Resolution SLA at risk",
          body: "Jira change request waiting on approval",
          readAt: null,
          createdAt: daysFromNow(0, 9, 50),
        },
      ],
    });
  }

  if (method === "GET" && apiPath === "/tickets") {
    const includeClosed = url.searchParams.get("includeClosed") === "true";
    const status = url.searchParams.get("status");
    const teamId = url.searchParams.get("teamId");
    const customFieldFilters = [...url.searchParams.entries()].filter(([key]) => key.startsWith("cf."));
    const q = (url.searchParams.get("q") || "").toLowerCase();
    let items = ticketRows.filter((t) => includeClosed || t.status !== "Closed");
    if (status) items = items.filter((t) => t.status === status);
    if (teamId) items = items.filter((t) => t.teamId === Number(teamId));
    for (const [param, value] of customFieldFilters) {
      const key = param.slice(3);
      items = items.filter((ticket) => String(ticket.customFields?.[key] ?? "") === value);
    }
    if (q) {
      items = items.filter((t) =>
        [t.title, t.summary, t.description, t.companyName, t.ticketNumber, t.priority]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return json(route, {
      items,
      total: items.length,
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 200),
    });
  }

  if (method === "GET" && apiPath === "/tickets/search") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const limit = Number(url.searchParams.get("limit") || 100);
    const rows = ticketRows
      .filter((ticket) =>
        [ticket.ticketNumber, ticket.title, ticket.summary, ticket.companyName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      )
      .slice(0, limit)
      .map((ticket) => ({
        ...relatedTicketSummary(ticket),
        mergedIntoId: ticket.mergedIntoId ?? null,
      }));
    return json(route, rows);
  }

  if (method === "GET" && apiPath === "/checklist-templates") {
    return json(route, [
      {
        id: 1,
        name: "New user onboarding",
        description: "Standard runbook for a new hire's first day",
        active: true,
        items: [
          { id: 11, templateId: 1, text: "Create AD / M365 account", sortOrder: 0, dueOffsetMinutes: 60 },
          { id: 12, templateId: 1, text: "Assign licenses", sortOrder: 1, dueOffsetMinutes: 120 },
          { id: 13, templateId: 1, text: "Image and enroll workstation", sortOrder: 2, dueOffsetMinutes: 1440 },
        ],
      },
      {
        id: 2,
        name: "Workstation offboarding",
        description: null,
        active: true,
        items: [
          { id: 21, templateId: 2, text: "Disable accounts", sortOrder: 0, dueOffsetMinutes: 30 },
          { id: 22, templateId: 2, text: "Collect hardware", sortOrder: 1, dueOffsetMinutes: null },
        ],
      },
    ]);
  }

  let match = apiPath.match(/^\/tickets\/(\d+)\/checklist$/);
  if (method === "GET" && match) {
    const id = Number(match[1]);
    if (id !== 101) return json(route, []);
    return json(route, [
      { id: 501, ticketId: 101, text: "Create AD / M365 account", done: true, doneBy: "sam.rivera", doneAt: "2026-07-15T14:05:00Z", dueAt: "2026-07-15T15:00:00Z", sortOrder: 0, templateId: 1 },
      { id: 502, ticketId: 101, text: "Assign licenses", done: false, doneBy: null, doneAt: null, dueAt: "2026-07-15T16:00:00Z", sortOrder: 1, templateId: 1 },
      { id: 503, ticketId: 101, text: "Image and enroll workstation", done: false, doneBy: null, doneAt: null, dueAt: "2026-07-30T14:00:00Z", sortOrder: 2, templateId: 1 },
      { id: 504, ticketId: 101, text: "Confirm VPN access with the user", done: false, doneBy: null, doneAt: null, dueAt: null, sortOrder: 3, templateId: null },
    ]);
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/notes$/);
  if (method === "GET" && match) return json(route, notesByTicket[Number(match[1])] ?? []);

  match = apiPath.match(/^\/tickets\/(\d+)\/devices$/);
  if (method === "GET" && match) {
    const id = Number(match[1]);
    return json(route, id === 101 ? devices.filter((d) => [201, 202].includes(d.id)) : []);
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/time$/);
  if (method === "GET" && match) return json(route, { minutes: Number(match[1]) === 101 ? 35 : 0 });

  match = apiPath.match(/^\/tickets\/(\d+)\/script-jobs$/);
  if (method === "GET" && match) {
    return json(route, [
      {
        id: 801,
        deviceId: 201,
        ticketId: 101,
        runner: "tactical_rmm",
        scriptName: "Export VPN counters",
        status: "success",
        output: "Tunnel stable on WAN1; renegotiation observed on WAN2.",
        createdAt: daysFromNow(0, 10, 5),
      },
    ]);
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/attachments$/);
  if (method === "GET" && match) {
    return json(route, [
      {
        id: 601,
        ticketId: Number(match[1]),
        noteId: null,
        filename: "vpn-counters.html",
        contentType: "text/html",
        size: 18432,
        storageBackend: "local",
        createdBy: "Jess Spillers",
        createdAt: daysFromNow(0, 10, 6),
      },
    ]);
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/history$/);
  if (method === "GET" && match) {
    return json(route, [
      {
        id: "9002",
        entityType: "ticket",
        entityId: Number(match[1]),
        action: "update",
        changedBy: "automation:Escalate production impact",
        oldValue: { priority: "Medium", teamId: null },
        newValue: { priority: "High", teamId: 1 },
        occurredAt: daysFromNow(0, 10, 18),
      },
      {
        id: "9001",
        entityType: "ticket",
        entityId: Number(match[1]),
        action: "create",
        changedBy: "Jess Spillers",
        oldValue: null,
        newValue: { status: "New", priority: "Medium" },
        occurredAt: daysFromNow(0, 8, 42),
      },
    ]);
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/merge-preview$/);
  if (method === "GET" && match) {
    const sourceId = Number(match[1]);
    const targetId = Number(url.searchParams.get("targetId"));
    const preview = mergePreviewFor(sourceId, targetId);
    return preview ? json(route, preview) : json(route, { error: "ticket not found" }, 404);
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/merge$/);
  if (method === "POST" && match) {
    const sourceId = Number(match[1]);
    const targetId = Number(body.targetId);
    const source = ticketRows.find((ticket) => ticket.id === sourceId);
    const target = ticketRows.find((ticket) => ticket.id === targetId);
    const preview = mergePreviewFor(sourceId, targetId);
    if (!source || !target || !preview) return json(route, { error: "ticket not found" }, 404);
    if (preview.blockers.length) {
      return json(route, { error: preview.blockers[0].message, blockers: preview.blockers }, 409);
    }
    const acknowledged = new Set(Array.isArray(body.acknowledge) ? body.acknowledge : []);
    const missing = preview.warnings
      .map((warning) => warning.code)
      .filter((code) => !acknowledged.has(code));
    if (missing.length) {
      return json(route, {
        error: "merge requires acknowledgement",
        requiresAcknowledgement: missing,
      }, 400);
    }

    if (!mergeUndoStatusByTicket.has(sourceId)) mergeUndoStatusByTicket.set(sourceId, source.status);
    source.mergedIntoId = targetId;
    source.mergedAt = new Date().toISOString();
    source.closedAt = source.mergedAt;
    source.status = "Closed";
    for (const child of ticketRows.filter((ticket) => ticket.parentId === sourceId)) {
      child.parentId = targetId;
    }
    return json(route, ticketWithRelations(sourceId));
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/unmerge$/);
  if (method === "POST" && match) {
    const sourceId = Number(match[1]);
    const source = ticketRows.find((ticket) => ticket.id === sourceId);
    if (!source) return json(route, { error: "ticket not found" }, 404);
    if (source.mergedIntoId == null) {
      return json(route, { error: "ticket is not merged" }, 409);
    }
    source.status = mergeUndoStatusByTicket.get(sourceId) ?? "New";
    source.mergedIntoId = null;
    source.mergedAt = null;
    source.closedAt = null;
    return json(route, ticketWithRelations(sourceId));
  }

  match = apiPath.match(/^\/tickets\/(\d+)\/children$/);
  if (method === "GET" && match) {
    const parentId = Number(match[1]);
    if (!ticketRows.some((ticket) => ticket.id === parentId)) {
      return json(route, { error: "ticket not found" }, 404);
    }
    return json(
      route,
      ticketRows
        .filter((ticket) => ticket.parentId === parentId)
        .map(relatedTicketSummary)
    );
  }

  match = apiPath.match(/^\/tickets\/(\d+)$/);
  if (method === "PATCH" && match) {
    const ticket = ticketRows.find((item) => item.id === Number(match[1]));
    if (!ticket) return json(route, { error: "not found" }, 404);
    if (body.customFields) ticket.customFields = { ...(ticket.customFields ?? {}), ...body.customFields };
    Object.assign(ticket, { ...body, customFields: ticket.customFields });
    return json(route, ticketWithRelations(ticket.id));
  }
  if (method === "GET" && match) {
    const ticket = ticketWithRelations(Number(match[1]));
    return ticket ? json(route, ticket) : json(route, { error: "not found" }, 404);
  }

  if (method === "GET" && apiPath === "/mail/status") {
    return json(route, { configured: true, from: "support@example.com", host: "smtp.example.com", port: 587, secure: false });
  }

  if (method === "GET" && apiPath === "/mail/identities") {
    return json(route, [
      { id: 1, address: "support@example.com", displayName: "AnchorDesk Support", shared: true, userId: null, enabled: true },
      { id: 2, address: "jess@example.com", displayName: "Jess Spillers", shared: false, userId: 1, enabled: true },
    ]);
  }

  if (method === "GET" && apiPath === "/mail/templates") {
    return json(route, [{ id: 1, name: "Follow-up", subject: null, bodyHtml: "<p>Thanks for the update. I am checking this now.</p>" }]);
  }

  if (method === "GET" && apiPath === "/auth/signature") {
    return json(route, { signatureHtml: "<p>Jess Spillers<br>Spillers Technology</p>" });
  }

  if (method === "GET" && apiPath === "/companies") return json(route, companies);

  match = apiPath.match(/^\/companies\/(\d+)\/tickets$/);
  if (method === "GET" && match) {
    const id = Number(match[1]);
    const name = companies.find((c) => c.id === id)?.name;
    return json(route, ticketRows.filter((t) => t.companyName === name));
  }

  match = apiPath.match(/^\/companies\/(\d+)\/devices$/);
  if (method === "GET" && match) {
    const id = Number(match[1]);
    const name = companies.find((c) => c.id === id)?.name;
    return json(route, devices.filter((d) => d.companyName === name));
  }

  match = apiPath.match(/^\/companies\/(\d+)\/time$/);
  if (method === "GET" && match) return json(route, { minutes: 390 });

  match = apiPath.match(/^\/companies\/(\d+)$/);
  if (method === "GET" && match) {
    const company = companies.find((c) => c.id === Number(match[1]));
    return company ? json(route, company) : json(route, { error: "not found" }, 404);
  }

  if (method === "GET" && apiPath === "/devices") return json(route, devices);
  if (method === "GET" && apiPath === "/rmm/status") {
    return json(route, {
      providers: [
        { key: "tactical_rmm", label: "Tactical RMM", configured: true, hasScriptCatalog: true },
        { key: "ninjaone", label: "NinjaOne", configured: true, hasScriptCatalog: true },
        { key: "datto_rmm", label: "Datto RMM", configured: true, hasScriptCatalog: false },
      ],
      tactical: { configured: true },
    });
  }

  match = apiPath.match(/^\/devices\/(\d+)\/external-refs$/);
  if (method === "GET" && match) {
    const device = devices.find((item) => item.id === Number(match[1]));
    return device ? json(route, device.externalRefs ?? []) : json(route, { error: "not found" }, 404);
  }
  if (method === "POST" && match) {
    const device = devices.find((item) => item.id === Number(match[1]));
    if (!device) return json(route, { error: "not found" }, 404);
    const ref = {
      id: Math.max(1000, ...devices.flatMap((item) => item.externalRefs ?? []).map((item) => item.id)) + 1,
      deviceId: device.id,
      provider: body.provider,
      externalId: body.externalId,
      metadata: body.metadata ?? null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    device.externalRefs = [...(device.externalRefs ?? []), ref];
    return json(route, ref, 201);
  }
  match = apiPath.match(/^\/devices\/(\d+)\/external-refs\/(\d+)$/);
  if (method === "DELETE" && match) {
    const device = devices.find((item) => item.id === Number(match[1]));
    if (device) device.externalRefs = (device.externalRefs ?? []).filter((ref) => ref.id !== Number(match[2]));
    return json(route, {}, 204);
  }

  match = apiPath.match(/^\/devices\/(\d+)\/live$/);
  if (method === "GET" && match) {
    const device = devices.find((d) => d.id === Number(match[1]));
    const provider = url.searchParams.get("provider") || device?.externalProvider || device?.source || "tactical_rmm";
    const ref = (device?.externalRefs ?? []).find((item) => item.provider === provider);
    return json(route, {
      provider,
      fetchedAt: new Date().toISOString(),
      externalId: ref?.externalId ?? device?.externalId ?? "unknown",
      hostname: device?.hostname ?? null,
      status: device?.status ?? "unknown",
      operatingSystem: device?.os ?? null,
      platform: "x64",
      localIps: device?.ipAddress ? [device.ipAddress] : [],
      publicIp: "198.51.100.24",
      siteName: device?.companyName ?? null,
      lastSeen: device?.lastSeenAt ?? null,
      clientName: device?.companyName ?? null,
      monitoringType: "server",
      makeModel: "FortiGate appliance",
      serialNumber: "FGT-ACME-001",
      cpuModel: "ARM",
    });
  }

  match = apiPath.match(/^\/devices\/(\d+)$/);
  if (method === "PATCH" && match) {
    const device = devices.find((item) => item.id === Number(match[1]));
    if (!device) return json(route, { error: "not found" }, 404);
    Object.assign(device, body);
    return json(route, device);
  }
  if (method === "GET" && match) {
    const device = devices.find((d) => d.id === Number(match[1]));
    return device
      ? json(route, {
          ...device,
          ticketLinks: ticketRows
            .filter((t) => (device.id === 201 ? [101] : device.id === 204 ? [106] : []).includes(t.id))
            .map((ticket) => ({ ticket: { id: ticket.id, title: ticket.title, status: ticket.status } })),
        })
      : json(route, { error: "not found" }, 404);
  }

  if (method === "GET" && apiPath === "/probes") return json(route, probes);
  if (method === "GET" && apiPath === "/me/time-entries") return json(route, myDayData(url.searchParams));
  if (method === "GET" && apiPath === "/sync/providers") return json(route, syncProviders);
  if (method === "GET" && apiPath === "/sync/log") return json(route, syncLog);
  if (method === "GET" && apiPath === "/sync/runs") {
    const providerName = url.searchParams.get("provider");
    const limit = Number(url.searchParams.get("limit") || 50);
    const rows = providerName
      ? syncRuns.filter((run) => run.provider.name === providerName)
      : syncRuns;
    return json(route, rows.slice(0, limit));
  }
  match = apiPath.match(/^\/sync\/runs\/(\d+)$/);
  if (method === "GET" && match) {
    const run = syncRuns.find((item) => item.id === Number(match[1]));
    if (!run) return json(route, { error: "sync run not found" }, 404);
    return json(route, {
      ...run,
      logCount: syncLog.filter((entry) => entry.runId === run.id).length,
      logsTruncated: false,
      logs: syncLog.filter((entry) => entry.runId === run.id),
    });
  }
  if (method === "POST" && apiPath === "/sync/run") {
    const providerName = url.searchParams.get("provider");
    const selected = providerName
      ? syncProviders.filter((provider) => provider.name === providerName)
      : syncProviders.filter((provider) => provider.enabled);
    const results = selected.map((provider) => ({
      runId: 200 + provider.id,
      providerId: provider.id,
      providerName: provider.name,
      status: "success",
      ticketsCreated: provider.type === "jira" ? 2 : 0,
      ticketsUpdated: provider.type === "connectwise" ? 3 : 1,
      notesUpserted: 2,
      ticketsFiltered: provider.config.filter ? 4 : 0,
      ticketsSkipped: 0,
      ticketsConflicted: 0,
      errorCount: 0,
      errors: [],
      durationMs: 428,
    }));
    return json(route, providerName ? results[0] ?? { error: "not found" } : results, results.length ? 200 : 404);
  }
  if (method === "GET" && apiPath === "/connections") {
    const type = url.searchParams.get("type");
    return json(route, type ? connections.filter((c) => c.type === type) : connections);
  }
  if (method === "POST" && apiPath === "/connections/1/test") {
    return json(route, {
      ok: true,
      category: "ok",
      identity: "Sync Bot",
      message: "Connected as Sync Bot. 2 project(s) visible: HELP, SCRUM.",
      testedAt: new Date().toISOString(),
    });
  }
  if (method === "GET" && apiPath === "/integrations") {
    return json(route, {
      connectwise: { server: "na.myconnectwise.net", company: "spillerstech", publicKey: "PUBKEY123", hasPrivateKey: true, hasClientId: true },
      jira: { baseUrl: "https://spillerstech.atlassian.net", email: "sync@spillerstech.com", hasApiToken: true },
      smtp: { host: "smtp.spillerstech.com", port: 587, secure: false, user: "helpdesk", from: "helpdesk@spillerstech.com", hasPass: true },
      tactical: {}, ninjaone: {}, datto: {}, storage: { backend: "local" }, tickets: { numberDigits: 5 },
    });
  }

  if (method === "GET" && apiPath === "/admin/overview") {
    return json(route, {
      tickets: { open: 5, total: 6 },
      devices: { total: devices.length, online: devices.filter((d) => d.status === "online").length },
      probes: { total: probes.length, online: probes.filter((p) => p.status === "online").length },
      users: assignees.length,
      mailboxes: 3,
      recentAudit: [
        { id: "1", entityType: "ticket", entityId: 101, action: "update", changedBy: "jess (web)", oldValue: {}, newValue: {}, occurredAt: daysFromNow(0, 10, 15) },
        { id: "2", entityType: "ticket", entityId: 103, action: "sync", changedBy: "system", oldValue: {}, newValue: {}, occurredAt: daysFromNow(0, 9, 10) },
      ],
    });
  }

  return json(route, {});
}

/**
 * Route every /api/* request on the page into the mock dataset.
 * `authenticated: false` makes /auth/me return 401 so the staff login renders.
 * `portalAuthenticated: false` does the same for the requester portal.
 */
export function installApiMock(page, options = {}) {
  return page.route("**/*", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    if (options.authenticated === false && pathname === "/api/auth/me") {
      return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    }
    if (
      options.portalAuthenticated === false
      && pathname === "/api/portal/auth/me"
    ) {
      return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    }
    return handleApi(route);
  });
}

/** Kill transitions/animations/carets so screenshots are deterministic. */
export async function freezeAnimations(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition-duration: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
}

export async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

export async function openDrawer(page, label) {
  await page.locator('button:has(svg[data-testid="MenuIcon"])').click();
  await page.getByText(label, { exact: true }).click();
}
