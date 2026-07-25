import Fastify from "fastify";
import { createCwm } from "../services/connectwiseService";
import { getConnectwise } from "../services/settingsService";
import { connectWiseErrorLogContext, cwRoutes } from "./cw";

jest.mock("../services/connectwiseService", () => ({
  createCwm: jest.fn(),
}));

jest.mock("../services/settingsService", () => ({
  getConnectwise: jest.fn(),
}));

const getServiceTickets = jest.fn();
const getServiceTicketsById = jest.fn();
const getServiceTicketsByParentIdNotes = jest.fn();
const mockedCreateCwm = jest.mocked(createCwm);
const mockedGetConnectwise = jest.mocked(getConnectwise);

async function app() {
  const server = Fastify();
  await server.register(cwRoutes);
  await server.ready();
  return server;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetConnectwise.mockResolvedValue({
    server: "connectwise.example.com",
    company: "example",
    publicKey: "public",
    privateKey: "private",
    clientId: "client",
  });
  mockedCreateCwm.mockReturnValue({
    ServiceAPI: {
      getServiceTickets,
      getServiceTicketsById,
      getServiceTicketsByParentIdNotes,
    },
  } as never);
  getServiceTickets.mockResolvedValue([]);
  getServiceTicketsById.mockResolvedValue({ id: 42 });
  getServiceTicketsByParentIdNotes.mockResolvedValue([]);
});

describe("legacy ConnectWise route board scope", () => {
  it.each(["/cw/tickets/open", "/cw/tickets/open?board=%20%20%20"])(
    "rejects a missing or blank board before loading credentials: %s",
    async (url) => {
      const server = await app();
      try {
        const response = await server.inject({ method: "GET", url });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: "board query parameter is required and must be nonblank",
        });
        expect(mockedGetConnectwise).not.toHaveBeenCalled();
        expect(mockedCreateCwm).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    },
  );

  it("uses the explicit trimmed board for the open-ticket query", async () => {
    const server = await app();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/cw/tickets/open?board=%20Support%20",
      });

      expect(response.statusCode).toBe(200);
      expect(getServiceTickets).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: expect.stringContaining('board/name = "Support"'),
        }),
      );
    } finally {
      await server.close();
    }
  });

  it("requires an explicit board for resource-filtered ticket lists", async () => {
    const server = await app();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/cw/tickets/by-resource/alice",
      });

      expect(response.statusCode).toBe(400);
      expect(mockedGetConnectwise).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("uses the explicit board for resource-filtered ticket lists", async () => {
    const server = await app();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/cw/tickets/by-resource/alice?board=Escalations",
      });

      expect(response.statusCode).toBe(200);
      const conditions = getServiceTickets.mock.calls[0]![0]
        .conditions as string;
      expect(conditions).toContain('board/name = "Escalations"');
      expect(conditions).toContain('resources like "alice%"');
    } finally {
      await server.close();
    }
  });

  it("does not require board scope for one-ticket or note reads", async () => {
    const server = await app();
    try {
      const ticketResponse = await server.inject({
        method: "GET",
        url: "/cw/tickets/42",
      });
      const notesResponse = await server.inject({
        method: "GET",
        url: "/cw/tickets/42/notes",
      });

      expect(ticketResponse.statusCode).toBe(200);
      expect(notesResponse.statusCode).toBe(200);
      expect(getServiceTicketsById).toHaveBeenCalledWith(42);
      expect(getServiceTicketsByParentIdNotes).toHaveBeenCalledWith(42, {
        page: 1,
        pageSize: 100,
      });
    } finally {
      await server.close();
    }
  });
});

describe("legacy ConnectWise route logging", () => {
  it("retains only a numeric remote status and drops response bodies", () => {
    const context = connectWiseErrorLogContext({
      status: 401,
      message: "request failed",
      data: { authorization: "Basic ECHOED_SECRET" },
    });

    expect(context).toEqual({ remoteStatus: 401 });
    expect(JSON.stringify(context)).not.toContain("ECHOED_SECRET");
    expect(JSON.stringify(context)).not.toContain("authorization");
  });

  it("returns empty metadata for non-client failures", () => {
    expect(connectWiseErrorLogContext(new Error("boom"))).toEqual({});
  });
});
