import {
  CONNECTWISE_MAX_PAGES,
  CONNECTWISE_PAGE_SIZE,
  ConnectWiseProvider,
} from "../ConnectWiseProvider";
import { createCwm } from "../../services/connectwiseService";

jest.mock("../../services/connectwiseService", () => ({
  createCwm: jest.fn(),
}));

const getServiceTickets = jest.fn();
const getServiceTicketsByParentIdNotes = jest.fn();
const mockedCreateCwm = createCwm as jest.MockedFunction<typeof createCwm>;

function ticket(id: number, summary = `Ticket ${id}`) {
  return {
    id,
    summary,
    initialDescription: `Description ${id}`,
    status: { name: "New" },
    priority: { name: "Medium" },
    company: { name: "Example" },
    resources: "",
  };
}

function note(id: number, text = `Note ${id}`) {
  return {
    id,
    text,
    member: { firstName: "Pat", lastName: "Tech" },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedCreateCwm.mockReturnValue({
    ServiceAPI: {
      getServiceTickets,
      getServiceTicketsByParentIdNotes,
    },
  } as never);
});

describe("ConnectWise pagination", () => {
  it("uses the last ticket id as the next request cursor", async () => {
    const firstPage = Array.from(
      { length: CONNECTWISE_PAGE_SIZE },
      (_, index) => ticket(index + 1),
    );
    getServiceTickets
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([ticket(1001)])
      .mockResolvedValueOnce([]);

    const rows = await new ConnectWiseProvider("Support").fetchTickets();

    expect(rows).toHaveLength(1001);
    expect(getServiceTickets).toHaveBeenCalledTimes(3);
    const [firstParams] = getServiceTickets.mock.calls[0]!;
    const [secondParams] = getServiceTickets.mock.calls[1]!;
    expect(firstParams).toEqual(
      expect.objectContaining({
        conditions: expect.not.stringContaining("id >"),
        orderBy: "id asc",
        page: 1,
        pageSize: CONNECTWISE_PAGE_SIZE,
      }),
    );
    expect(secondParams).toEqual(
      expect.objectContaining({
        conditions: expect.stringContaining(`id > ${CONNECTWISE_PAGE_SIZE}`),
        orderBy: "id asc",
        page: 1,
        pageSize: CONNECTWISE_PAGE_SIZE,
      }),
    );
    expect(getServiceTickets.mock.calls[2]![0]).toEqual(
      expect.objectContaining({
        conditions: expect.stringContaining("id > 1001"),
      }),
    );
    expect(mockedCreateCwm).toHaveBeenCalledTimes(1);
  });

  it("uses the last note id as the next request cursor", async () => {
    const firstPage = Array.from(
      { length: CONNECTWISE_PAGE_SIZE },
      (_, index) => note(index + 1),
    );
    getServiceTicketsByParentIdNotes
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([note(1001)])
      .mockResolvedValueOnce([]);

    const rows = await new ConnectWiseProvider("Support").fetchNotes("42");

    expect(rows).toHaveLength(1001);
    expect(getServiceTicketsByParentIdNotes).toHaveBeenCalledTimes(3);
    expect(getServiceTicketsByParentIdNotes.mock.calls).toEqual([
      [
        42,
        expect.objectContaining({
          conditions: undefined,
          orderBy: "id asc",
          page: 1,
          pageSize: CONNECTWISE_PAGE_SIZE,
        }),
      ],
      [
        42,
        expect.objectContaining({
          conditions: `id > ${CONNECTWISE_PAGE_SIZE}`,
          orderBy: "id asc",
          page: 1,
          pageSize: CONNECTWISE_PAGE_SIZE,
        }),
      ],
      [
        42,
        expect.objectContaining({
          conditions: "id > 1001",
          orderBy: "id asc",
          page: 1,
          pageSize: CONNECTWISE_PAGE_SIZE,
        }),
      ],
    ]);
  });

  it("exposes only an explicitly external detail note to requesters", async () => {
    getServiceTicketsByParentIdNotes
      .mockResolvedValueOnce([
        {
          ...note(1, "Customer update"),
          detailDescriptionFlag: true,
          internalAnalysisFlag: false,
        },
        {
          ...note(2, "Private analysis"),
          detailDescriptionFlag: true,
          internalAnalysisFlag: true,
        },
        note(3, "Unknown legacy bucket"),
      ])
      .mockResolvedValueOnce([]);

    const rows = await new ConnectWiseProvider("Support").fetchNotes("42");

    expect(rows.map((row) => row.visibility)).toEqual([
      "public",
      "internal",
      "internal",
    ]);
  });

  it("continues after short non-empty pages in case the server clamps page size", async () => {
    getServiceTickets
      .mockResolvedValueOnce([ticket(1), ticket(2)])
      .mockResolvedValueOnce([ticket(3)])
      .mockResolvedValueOnce([]);

    const rows = await new ConnectWiseProvider("Support").fetchTickets();

    expect(rows.map((row) => row.externalId)).toEqual(["1", "2", "3"]);
    expect(getServiceTickets).toHaveBeenCalledTimes(3);
    expect(getServiceTickets.mock.calls[1]![0].conditions).toContain("id > 2");
    expect(getServiceTickets.mock.calls[2]![0].conditions).toContain("id > 3");
  });

  it("does not hide terminal statuses from incremental sync or job filters", async () => {
    getServiceTickets
      .mockResolvedValueOnce([
        {
          ...ticket(7),
          status: { name: "Closed" },
        },
      ])
      .mockResolvedValueOnce([]);

    const [row] = await new ConnectWiseProvider("Support").fetchTickets(
      new Date("2026-07-25T12:00:00Z"),
    );

    expect(row.status).toBe("Closed");
    const conditions = getServiceTickets.mock.calls[0]![0].conditions as string;
    expect(conditions).not.toContain("status/name not in");
    expect(conditions).toContain("_info/lastUpdated >");
  });

  it("fails closed when a ticket page repeats or regresses the cursor", async () => {
    const firstPage = Array.from(
      { length: CONNECTWISE_PAGE_SIZE },
      (_, index) => ticket(index + 1),
    );
    getServiceTickets
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        ticket(CONNECTWISE_PAGE_SIZE),
        ticket(CONNECTWISE_PAGE_SIZE + 1),
      ]);

    await expect(
      new ConnectWiseProvider("Support").fetchTickets(),
    ).rejects.toThrow(
      `ConnectWise tickets page 2 id ${CONNECTWISE_PAGE_SIZE} did not advance past cursor ${CONNECTWISE_PAGE_SIZE}`,
    );
  });

  it("fails closed when notes regress within a page", async () => {
    getServiceTicketsByParentIdNotes.mockResolvedValueOnce([note(2), note(1)]);

    await expect(
      new ConnectWiseProvider("Support").fetchNotes("42"),
    ).rejects.toThrow(
      "ConnectWise notes for ticket 42 page 1 id 1 did not advance past cursor 2",
    );
  });

  it("rejects malformed records instead of advancing past them", async () => {
    getServiceTickets.mockResolvedValueOnce([
      ticket(1),
      { summary: "Missing id" },
    ]);

    await expect(
      new ConnectWiseProvider("Support").fetchTickets(),
    ).rejects.toThrow(
      "ConnectWise tickets page 1 contained a record with an invalid id",
    );
  });

  it("rejects malformed page responses instead of treating them as complete", async () => {
    getServiceTicketsByParentIdNotes.mockResolvedValueOnce({ id: 1 });

    await expect(
      new ConnectWiseProvider("Support").fetchNotes("42"),
    ).rejects.toThrow(
      "ConnectWise notes for ticket 42 page 1 returned a non-array response",
    );
  });

  it("throws instead of returning a partial ticket prefix at the page cap", async () => {
    let nextId = 1;
    getServiceTickets.mockImplementation(async () =>
      Array.from({ length: CONNECTWISE_PAGE_SIZE }, () => ticket(nextId++)),
    );

    await expect(
      new ConnectWiseProvider("Support").fetchTickets(),
    ).rejects.toThrow(
      new RegExp(
        `tickets pagination reached the safety cap of ${CONNECTWISE_MAX_PAGES} pages`,
      ),
    );
    expect(getServiceTickets).toHaveBeenCalledTimes(CONNECTWISE_MAX_PAGES);
  });

  it("throws instead of returning partial notes at the page cap", async () => {
    let nextId = 1;
    getServiceTicketsByParentIdNotes.mockImplementation(async () =>
      Array.from({ length: CONNECTWISE_PAGE_SIZE }, () => note(nextId++)),
    );

    await expect(
      new ConnectWiseProvider("Support").fetchNotes("42"),
    ).rejects.toThrow(
      new RegExp(
        `notes for ticket 42 pagination reached the safety cap of ${CONNECTWISE_MAX_PAGES} pages`,
      ),
    );
    expect(getServiceTicketsByParentIdNotes).toHaveBeenCalledTimes(
      CONNECTWISE_MAX_PAGES,
    );
  });
});

describe("ConnectWise board scope", () => {
  it.each([undefined, null, "", "   "])(
    "rejects missing or blank board %p before creating a client",
    (board) => {
      expect(() => new ConnectWiseProvider(board as unknown as string)).toThrow(
        "requires an explicit nonblank board name",
      );
      expect(mockedCreateCwm).not.toHaveBeenCalled();
    },
  );

  it("trims the explicit board before building the remote condition", async () => {
    getServiceTickets.mockResolvedValueOnce([]);

    await new ConnectWiseProvider("  Support  ").fetchTickets();

    expect(getServiceTickets.mock.calls[0]![0].conditions).toContain(
      'board/name = "Support"',
    );
  });
});
