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
];

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

const syncProviders = [
  { id: 1, name: "ConnectWise Manage", type: "connectwise", enabled: true, lastSyncedAt: daysFromNow(0, 8, 50), createdAt: daysFromNow(-30, 9) },
  { id: 2, name: "Jira Cloud", type: "jira", enabled: true, lastSyncedAt: daysFromNow(0, 9, 10), createdAt: daysFromNow(-20, 9) },
];

const syncLog = [
  {
    id: "9001",
    externalId: "OPS-712",
    direction: "inbound",
    status: "skipped",
    message: "Conflict flagged; waiting for keep-local or keep-remote.",
    syncedAt: daysFromNow(0, 9, 10),
    provider: { name: "Jira Cloud", type: "jira" },
  },
  {
    id: "9002",
    externalId: "CW-88231",
    direction: "outbound",
    status: "success",
    message: "Local status and notes pushed.",
    syncedAt: daysFromNow(0, 8, 50),
    provider: { name: "ConnectWise Manage", type: "connectwise" },
  },
];

function ticketWithRelations(id) {
  const ticket = ticketRows.find((t) => t.id === id);
  if (!ticket) return null;
  return {
    ...ticket,
    company: companies.find((c) => c.id === ticket.companyId) ?? null,
    contact: companies.flatMap((c) => c.contacts ?? []).find((c) => c.id === ticket.contactId) ?? null,
    team: teams.find((team) => team.id === ticket.teamId) ?? null,
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

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function handleApi(route) {
  const request = route.request();
  const url = new URL(request.url());
  const apiPath = url.pathname.replace(/^\/api/, "");
  const method = request.method();
  const body = request.postData() ? request.postDataJSON() : {};
  if (debugCapture) console.log(`API ${method} ${apiPath}`);

  if (method === "GET" && apiPath === "/auth/me") return json(route, { user: demoUser });
  if (method === "PUT" && apiPath === "/auth/kanban-columns") {
    demoUser.kanbanColumns = Array.isArray(body.kanbanColumns) ? body.kanbanColumns : null;
    return json(route, { kanbanColumns: demoUser.kanbanColumns });
  }
  if (method === "GET" && apiPath === "/auth/config") return json(route, { local: true, oidc: true, saml: false });
  if (method === "GET" && apiPath === "/ui-settings") return json(route, { legacyTableView: false });
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
    const q = (url.searchParams.get("q") || "").toLowerCase();
    let items = ticketRows.filter((t) => includeClosed || t.status !== "Closed");
    if (status) items = items.filter((t) => t.status === status);
    if (teamId) items = items.filter((t) => t.teamId === Number(teamId));
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

  let match = apiPath.match(/^\/tickets\/(\d+)\/notes$/);
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
 * `authenticated: false` makes /auth/me return 401 so the login screen renders.
 */
export function installApiMock(page, options = {}) {
  return page.route("**/*", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    if (options.authenticated === false && pathname === "/api/auth/me") {
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
