/**
 * MCP checklist parity is tested through the protocol itself. This catches a
 * tool that exists in source but is missing from tools/list, has the wrong
 * JSON schema, or is not callable by a real MCP client.
 */
jest.mock("../repositories/ticketRepository", () => ({
  listPaged: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  search: jest.fn(),
}));
jest.mock("../repositories/noteRepository", () => ({
  listForTicket: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../repositories/auditRepository", () => ({ getHistory: jest.fn() }));
jest.mock("../repositories/labelRepository", () => ({
  list: jest.fn(),
  applyToTicket: jest.fn(),
  removeFromTicket: jest.fn(),
}));
jest.mock("../repositories/teamRepository", () => ({ list: jest.fn() }));
jest.mock("../repositories/customFieldRepository", () => ({ list: jest.fn() }));
jest.mock("../repositories/savedViewRepository", () => ({
  listForUser: jest.fn(),
}));
jest.mock("../repositories/checklistRepository", () => ({
  listForTicket: jest.fn(),
  applyTemplate: jest.fn(),
  add: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));
jest.mock("../repositories/checklistTemplateRepository", () => ({
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));
jest.mock("../repositories/kbArticleRepository", () => ({
  KbArticleValidationError: class KbArticleValidationError extends Error {},
  searchPublishedStaff: jest.fn(),
  getPublishedForStaffBySlug: jest.fn(),
  getForAuthorBySlug: jest.fn(),
  listPublishedForStaff: jest.fn(),
  listForAuthors: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));
jest.mock("../services/mail/ticketMail", () => ({
  sendTicketEmail: jest.fn(),
}));
jest.mock("../services/mail/SmtpMailTransport", () => ({
  mailTransport: { isConfigured: jest.fn(), send: jest.fn() },
}));
jest.mock("../middleware/auth", () => ({
  actorFor: (username: string, channel: string) => `${username} (${channel})`,
}));
jest.mock("../services/auth/mcpOAuth", () => ({
  buildMcpProtectedResourceMetadata: jest.fn(() => ({})),
}));

import type { UserRole } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as tickets from "../repositories/ticketRepository";
import * as notes from "../repositories/noteRepository";
import * as checklist from "../repositories/checklistRepository";
import * as checklistTemplates from "../repositories/checklistTemplateRepository";
import * as kbArticles from "../repositories/kbArticleRepository";
import { buildMcpServer, MCP_SERVER_VERSION } from "./mcp";

type ToolCallResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

type Harness = { client: Client; server: McpServer };
const harnesses: Harness[] = [];
const actor = "alice (mcp)";

const mockedTickets = {
  getById: tickets.getById as jest.Mock,
  listPaged: tickets.listPaged as jest.Mock,
};
const mockedNotes = {
  create: notes.create as jest.Mock,
};
const mockedChecklist = {
  listForTicket: checklist.listForTicket as jest.Mock,
  update: checklist.update as jest.Mock,
  remove: checklist.remove as jest.Mock,
};
const mockedTemplates = {
  list: checklistTemplates.list as jest.Mock,
  create: checklistTemplates.create as jest.Mock,
  update: checklistTemplates.update as jest.Mock,
  remove: checklistTemplates.remove as jest.Mock,
};
const mockedKb = {
  searchPublishedStaff: kbArticles.searchPublishedStaff as jest.Mock,
  getPublishedForStaffBySlug:
    kbArticles.getPublishedForStaffBySlug as jest.Mock,
  getForAuthorBySlug: kbArticles.getForAuthorBySlug as jest.Mock,
  listPublishedForStaff: kbArticles.listPublishedForStaff as jest.Mock,
  listForAuthors: kbArticles.listForAuthors as jest.Mock,
  create: kbArticles.create as jest.Mock,
  update: kbArticles.update as jest.Mock,
  remove: kbArticles.remove as jest.Mock,
};

async function connect(role: UserRole = "admin") {
  const server = buildMcpServer(actor, 7, role);
  const client = new Client({ name: "anchordesk-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  harnesses.push({ client, server });
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  return (await client.callTool({ name, arguments: args })) as ToolCallResult;
}

function resultText(result: ToolCallResult) {
  return result.content.find((part) => part.type === "text")?.text ?? "";
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedTickets.getById.mockResolvedValue({ id: 42, title: "Test ticket" });
  mockedChecklist.listForTicket.mockResolvedValue([]);
  mockedTemplates.list.mockResolvedValue([]);
  mockedKb.searchPublishedStaff.mockResolvedValue([]);
  mockedKb.listPublishedForStaff.mockResolvedValue([]);
  mockedKb.listForAuthors.mockResolvedValue([]);
});

afterEach(async () => {
  const open = harnesses.splice(0);
  for (const { client, server } of open) {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});

describe("MCP checklist protocol surface", () => {
  it("preserves portal provenance in get_ticket and list_tickets", async () => {
    const portalTicket = {
      id: 42,
      title: "Portal request",
      source: "portal",
      contactId: 9,
      companyId: 7,
    };
    mockedTickets.getById.mockResolvedValue(portalTicket);
    mockedTickets.listPaged.mockResolvedValue({
      items: [portalTicket],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    const client = await connect("technician");

    const detail = JSON.parse(resultText(await call(client, "get_ticket", {
      id: 42,
    })));
    const listed = JSON.parse(resultText(await call(client, "list_tickets", {})));

    expect(detail.ticket.source).toBe("portal");
    expect(listed.items[0].source).toBe("portal");
  });

  it("advertises the backend package version and complete checklist schemas", async () => {
    const client = await connect();
    const packageVersion = (
      require("../../package.json") as { version: string }
    ).version;
    expect(MCP_SERVER_VERSION).toBe(packageVersion);
    expect(client.getServerVersion()).toMatchObject({
      name: "anchordesk",
      version: packageVersion,
    });

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const checklistToolNames = [
      "list_checklist_templates",
      "create_checklist_template",
      "update_checklist_template",
      "delete_checklist_template",
      "list_ticket_checklist",
      "apply_checklist_template",
      "add_checklist_item",
      "update_checklist_item",
      "toggle_checklist_item",
      "delete_checklist_item",
    ];

    expect([...byName.keys()]).toEqual(
      expect.arrayContaining(checklistToolNames),
    );
    for (const name of checklistToolNames) {
      expect(byName.get(name)?.description).toEqual(expect.any(String));
      expect(byName.get(name)?.inputSchema.type).toBe("object");
    }

    expect(
      byName.get("list_checklist_templates")?.inputSchema.properties,
    ).toHaveProperty("includeInactive");
    expect(byName.get("update_checklist_item")?.inputSchema.properties).toEqual(
      expect.objectContaining({
        ticketId: expect.any(Object),
        itemId: expect.any(Object),
        text: expect.any(Object),
        done: expect.any(Object),
        dueAt: expect.any(Object),
        sortOrder: expect.any(Object),
      }),
    );
    expect(
      byName.get("create_checklist_template")?.inputSchema.properties,
    ).toEqual(
      expect.objectContaining({
        name: expect.any(Object),
        description: expect.any(Object),
        active: expect.any(Object),
        items: expect.any(Object),
      }),
    );
    expect(byName.get("list_ticket_checklist")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(
      byName.get("delete_checklist_item")?.annotations?.destructiveHint,
    ).toBe(true);
  });

  // MCP parity is a release invariant, so the 2.6 relation tools are guarded at
  // the protocol level the same way the checklist tools are.
  it("advertises the merge and hierarchy tools with their consent contract", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const relationToolNames = [
      "preview_ticket_merge",
      "merge_tickets",
      "unmerge_ticket",
      "set_ticket_parent",
      "list_ticket_children",
    ];
    expect([...byName.keys()]).toEqual(
      expect.arrayContaining(relationToolNames),
    );
    for (const name of relationToolNames) {
      expect(byName.get(name)?.description).toEqual(expect.any(String));
      expect(byName.get(name)?.inputSchema.type).toBe("object");
    }

    // The acknowledgement channel must exist on the tool itself — without it an
    // agent has no way to consent, and the merge can never succeed.
    expect(byName.get("merge_tickets")?.inputSchema.properties).toEqual(
      expect.objectContaining({
        sourceId: expect.any(Object),
        targetId: expect.any(Object),
        acknowledge: expect.any(Object),
      }),
    );
    // The description has to state that this does NOT touch the external system,
    // because that is the property an agent would otherwise assume it has.
    expect(byName.get("merge_tickets")?.description).toMatch(/LOCAL record/);
    expect(byName.get("merge_tickets")?.description).toMatch(/stops syncing/);

    expect(byName.get("preview_ticket_merge")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(byName.get("merge_tickets")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("list_ticket_children")?.annotations?.readOnlyHint).toBe(
      true,
    );

    // Hierarchy is one level and local-only; both must be said out loud, since
    // an agent cannot discover either from the schema.
    expect(byName.get("set_ticket_parent")?.description).toMatch(
      /one level of hierarchy/,
    );
    expect(byName.get("set_ticket_parent")?.description).toMatch(/local only/);
  });

  it("advertises and records a backdated workedAt through log_time", async () => {
    const client = await connect("technician");
    const { tools } = await client.listTools();
    const logTime = tools.find((tool) => tool.name === "log_time");
    expect(logTime?.inputSchema.properties).toHaveProperty("workedAt");

    mockedNotes.create.mockResolvedValue({
      id: 91,
      ticketId: 42,
      noteType: "time_entry",
      minutes: 45,
      workedAt: new Date("2026-07-24T13:00:00-04:00"),
    });
    const result = await call(client, "log_time", {
      ticketId: 42,
      minutes: 45,
      workedAt: "2026-07-24T13:00:00-04:00",
      note: "Friday maintenance",
      author: "Alice",
    });

    expect(result.isError).toBeUndefined();
    expect(mockedNotes.create).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        author: "Alice",
        authorId: 7,
        noteType: "time_entry",
        minutes: 45,
        workedAt: new Date("2026-07-24T17:00:00.000Z"),
      }),
      actor,
    );

    mockedNotes.create.mockClear();
    const invalid = await call(client, "log_time", {
      ticketId: 42,
      minutes: 45,
      workedAt: "last Friday",
    });
    expect(invalid.isError).toBe(true);
    expect(mockedNotes.create).not.toHaveBeenCalled();
  });

  it("lists, fully updates, and deletes ticket checklist items through MCP", async () => {
    const client = await connect("technician");
    const rows = [{ id: 9, ticketId: 42, text: "Call customer", done: false }];
    mockedChecklist.listForTicket.mockResolvedValue(rows);

    const listed = await call(client, "list_ticket_checklist", {
      ticketId: 42,
    });
    expect(listed.isError).toBeUndefined();
    expect(JSON.parse(resultText(listed))).toEqual(rows);
    expect(mockedTickets.getById).toHaveBeenCalledWith(42);
    expect(mockedChecklist.listForTicket).toHaveBeenCalledWith(42);

    mockedChecklist.update.mockResolvedValue({
      ...rows[0],
      text: "Contact customer",
      done: true,
      sortOrder: 3,
    });
    const updated = await call(client, "update_checklist_item", {
      ticketId: 42,
      itemId: 9,
      text: "  Contact customer  ",
      done: true,
      dueAt: null,
      sortOrder: 3,
    });
    expect(updated.isError).toBeUndefined();
    expect(mockedChecklist.update).toHaveBeenCalledWith(
      42,
      9,
      {
        text: "Contact customer",
        done: true,
        dueAt: null,
        sortOrder: 3,
      },
      actor,
    );

    mockedChecklist.remove.mockResolvedValue(true);
    const removed = await call(client, "delete_checklist_item", {
      ticketId: 42,
      itemId: 9,
    });
    expect(removed.isError).toBeUndefined();
    expect(JSON.parse(resultText(removed))).toEqual({
      ok: true,
      ticketId: 42,
      itemId: 9,
    });
    expect(mockedChecklist.remove).toHaveBeenCalledWith(42, 9, actor);
  });

  it("passes template options and allows an admin to create, update, and delete templates", async () => {
    const client = await connect("admin");
    mockedTemplates.list.mockResolvedValue([
      { id: 3, name: "Inactive", active: false },
    ]);

    await call(client, "list_checklist_templates", { includeInactive: true });
    expect(mockedTemplates.list).toHaveBeenCalledWith({
      includeInactive: true,
    });

    mockedTemplates.create.mockResolvedValue({ id: 4, name: "Onboarding" });
    const created = await call(client, "create_checklist_template", {
      name: "  Onboarding  ",
      items: [{ text: "  Join domain  ", dueOffsetMinutes: 60 }],
    });
    expect(created.isError).toBeUndefined();
    expect(mockedTemplates.create).toHaveBeenCalledWith(
      {
        name: "Onboarding",
        description: undefined,
        active: undefined,
        items: [{ text: "Join domain", dueOffsetMinutes: 60 }],
      },
      actor,
    );

    mockedTemplates.update.mockResolvedValue({
      id: 4,
      name: "Onboarding",
      active: false,
    });
    const updated = await call(client, "update_checklist_template", {
      templateId: 4,
      active: false,
    });
    expect(updated.isError).toBeUndefined();
    expect(mockedTemplates.update).toHaveBeenCalledWith(
      4,
      { active: false },
      actor,
    );

    mockedTemplates.remove.mockResolvedValue(true);
    const removed = await call(client, "delete_checklist_template", {
      templateId: 4,
    });
    expect(removed.isError).toBeUndefined();
    expect(mockedTemplates.remove).toHaveBeenCalledWith(4, actor);
  });

  it.each([
    ["create_checklist_template", { name: "Blocked" }],
    ["update_checklist_template", { templateId: 4, active: false }],
    ["delete_checklist_template", { templateId: 4 }],
  ])("denies non-admin calls to %s", async (name, args) => {
    const client = await connect("technician");
    const result = await call(client, name, args);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Requires role: admin");
    expect(mockedTemplates.create).not.toHaveBeenCalled();
    expect(mockedTemplates.update).not.toHaveBeenCalled();
    expect(mockedTemplates.remove).not.toHaveBeenCalled();
  });

  it("returns a useful conflict error for duplicate template names", async () => {
    const client = await connect("admin");
    mockedTemplates.create.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );

    const result = await call(client, "create_checklist_template", {
      name: "Existing",
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("A template with that name already exists");
  });
});

describe("MCP knowledge-base parity", () => {
  it("advertises search/read and the complete authoring workflow with truthful annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const names = [
      "search_kb_articles",
      "read_kb_article",
      "list_kb_articles",
      "create_kb_article",
      "update_kb_article",
      "delete_kb_article",
    ];
    expect([...byName.keys()]).toEqual(expect.arrayContaining(names));
    for (const name of names) {
      expect(byName.get(name)?.description).toEqual(expect.any(String));
      expect(byName.get(name)?.inputSchema.type).toBe("object");
    }
    expect(byName.get("search_kb_articles")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(byName.get("read_kb_article")?.annotations?.readOnlyHint).toBe(true);
    expect(
      byName.get("delete_kb_article")?.annotations?.destructiveHint,
    ).toBe(true);
    expect(byName.get("update_kb_article")?.description).toMatch(/stable slug/);
  });

  it("searches, reads, and authors as a technician under the connection actor", async () => {
    const client = await connect("technician");
    mockedKb.searchPublishedStaff.mockResolvedValue([
      {
        id: 4,
        slug: "reset-password",
        title: "Reset password",
        excerpt: "Use the reset page.",
        score: 0.9,
      },
    ]);
    const searched = await call(client, "search_kb_articles", {
      q: " password reset ",
      visibility: "internal",
      limit: 5,
    });
    expect(searched.isError).toBeUndefined();
    expect(mockedKb.searchPublishedStaff).toHaveBeenCalledWith(
      "password reset",
      { visibility: "internal", limit: 5 },
    );

    const published = {
      id: 4,
      slug: "reset-password",
      title: "Reset password",
      bodyHtml: "<p>Use the reset page.</p>",
    };
    mockedKb.getPublishedForStaffBySlug.mockResolvedValue(published);
    const read = await call(client, "read_kb_article", {
      slug: "reset-password",
    });
    expect(read.isError).toBeUndefined();
    expect(JSON.parse(resultText(read))).toEqual(published);
    expect(mockedKb.getPublishedForStaffBySlug).toHaveBeenCalledWith(
      "reset-password",
    );

    mockedKb.create.mockResolvedValue({ ...published, id: 5 });
    const created = await call(client, "create_kb_article", {
      title: "  Reset password  ",
      bodyHtml: " <p>Use the reset page.</p> ",
      category: " Accounts ",
      visibility: "portal",
      published: true,
    });
    expect(created.isError).toBeUndefined();
    expect(mockedKb.create).toHaveBeenCalledWith(
      {
        title: "Reset password",
        bodyHtml: "<p>Use the reset page.</p>",
        category: "Accounts",
        visibility: "portal",
        published: true,
      },
      actor,
    );

    mockedKb.update.mockResolvedValue({ ...published, title: "New title" });
    await call(client, "update_kb_article", {
      articleId: 4,
      title: " New title ",
    });
    expect(mockedKb.update).toHaveBeenCalledWith(
      4,
      {
        title: "New title",
        bodyHtml: undefined,
        category: undefined,
        visibility: undefined,
        published: undefined,
      },
      actor,
    );

    mockedKb.remove.mockResolvedValue(true);
    const removed = await call(client, "delete_kb_article", { articleId: 4 });
    expect(removed.isError).toBeUndefined();
    expect(mockedKb.remove).toHaveBeenCalledWith(4, actor);
  });

  it.each([
    ["create_kb_article", {
      title: "Blocked",
      bodyHtml: "<p>Body</p>",
      category: "Test",
    }],
    ["update_kb_article", { articleId: 4, published: true }],
    ["delete_kb_article", { articleId: 4 }],
  ])("denies readonly calls to %s", async (name, args) => {
    const client = await connect("readonly");
    const result = await call(client, name, args);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Requires role: admin or technician");
    expect(mockedKb.create).not.toHaveBeenCalled();
    expect(mockedKb.update).not.toHaveBeenCalled();
    expect(mockedKb.remove).not.toHaveBeenCalled();
  });
});
