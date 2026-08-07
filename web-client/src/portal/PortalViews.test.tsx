// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTheme } from "../theme";
import * as portalApi from "./api";
import PortalLoginView from "./PortalLoginView";
import PortalNewTicketView from "./PortalNewTicketView";
import PortalTicketDetailView from "./PortalTicketDetailView";
import PortalTicketsView from "./PortalTicketsView";
import type {
  PortalAttachment,
  PortalNote,
  PortalTicket,
} from "./types";

const { refreshAuth } = vi.hoisted(() => ({
  refreshAuth: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    requestMagicLink: vi.fn(),
    listPortalTickets: vi.fn(),
    getPortalTicket: vi.fn(),
    createPortalTicket: vi.fn(),
    addPortalComment: vi.fn(),
    uploadPortalAttachments: vi.fn(),
    searchPortalKnowledgeBase: vi.fn(),
  };
});

vi.mock("./PortalAuthContext", () => ({
  usePortalAuth: () => ({ refresh: refreshAuth }),
}));

const mockedApi = vi.mocked(portalApi);
const theme = buildTheme("default-light");

const baseTicket: PortalTicket = {
  id: 42,
  ticketNumber: "10482",
  title: "VPN disconnects",
  summary: "VPN disconnects",
  description: "The VPN drops during every call.",
  status: "In Progress",
  priority: "High",
  createdAt: "2026-07-20T14:00:00.000Z",
  updatedAt: "2026-07-21T15:00:00.000Z",
  closedAt: null,
  notes: [],
  attachments: [],
};

function renderAt(
  element: React.ReactElement,
  routePath: string,
  initialEntry: string,
) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="*" element={<div>navigated</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  refreshAuth.mockReset();
  refreshAuth.mockResolvedValue(undefined);
  mockedApi.requestMagicLink.mockReset();
  mockedApi.listPortalTickets.mockReset();
  mockedApi.getPortalTicket.mockReset();
  mockedApi.createPortalTicket.mockReset();
  mockedApi.addPortalComment.mockReset();
  mockedApi.uploadPortalAttachments.mockReset();
  mockedApi.searchPortalKnowledgeBase.mockReset();
  mockedApi.searchPortalKnowledgeBase.mockResolvedValue(null);
});

afterEach(cleanup);

describe("portal views", () => {
  it("keeps magic-link request messaging neutral to contact existence", async () => {
    mockedApi.requestMagicLink.mockResolvedValue({
      ok: true,
      message: "server copy must not disclose identity",
    });
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <PortalLoginView />
        </MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: "unknown@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));

    expect(await screen.findByText(/If that email belongs to a contact/i)).toBeTruthy();
    expect(screen.queryByText(/unknown email/i)).toBeNull();
    expect(mockedApi.requestMagicLink).toHaveBeenCalledWith("unknown@example.com");
  });

  it("lists only the safe ticket summary fields and handles nullable values honestly", async () => {
    const item: PortalTicket = {
      ...baseTicket,
      ticketNumber: null,
      priority: null,
      title: "",
    };
    mockedApi.listPortalTickets.mockResolvedValue({
      items: [item],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    renderAt(<PortalTicketsView />, "/tickets", "/tickets");

    expect(await screen.findByText("VPN disconnects")).toBeTruthy();
    expect(screen.getByText("Support request")).toBeTruthy();
    expect(screen.queryByText("null")).toBeNull();
    expect(mockedApi.listPortalTickets).toHaveBeenCalledWith(1, 20);
  });

  it("debounces the exact KB query and renders non-clickable suggestion cards", async () => {
    mockedApi.searchPortalKnowledgeBase.mockResolvedValue([
      {
        id: 7,
        slug: "vpn-stability",
        title: "Improve VPN stability",
        excerpt: "Check your local connection first.",
        score: 0.92,
      },
    ]);
    renderAt(<PortalNewTicketView />, "/tickets/new", "/tickets/new");

    const summary = screen.getByLabelText(/Summary/);
    fireEvent.change(summary, { target: { value: "vp" } });
    fireEvent.change(summary, { target: { value: "vpn disconnects" } });
    expect(mockedApi.searchPortalKnowledgeBase).not.toHaveBeenCalled();

    await waitFor(
      () => expect(mockedApi.searchPortalKnowledgeBase).toHaveBeenCalledTimes(1),
      { timeout: 1_200 },
    );
    expect(mockedApi.searchPortalKnowledgeBase).toHaveBeenCalledWith(
      "vpn disconnects",
      expect.any(AbortSignal),
    );
    expect(await screen.findByText("Does this answer it?")).toBeTruthy();
    expect(screen.getByText("Improve VPN stability")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Improve VPN stability" })).toBeNull();
  });

  it("creates with only summary/description, then uploads selected files", async () => {
    mockedApi.createPortalTicket.mockResolvedValue(baseTicket);
    mockedApi.uploadPortalAttachments.mockResolvedValue([]);
    renderAt(<PortalNewTicketView />, "/tickets/new", "/tickets/new");

    expect(screen.queryByLabelText(/company/i)).toBeNull();
    expect(screen.queryByLabelText(/priority/i)).toBeNull();
    expect(screen.queryByLabelText(/status/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Summary/), {
      target: { value: "  VPN disconnects  " },
    });
    fireEvent.change(screen.getByLabelText(/Details/), {
      target: { value: "  Drops every five minutes.  " },
    });
    const file = new File(["trace"], "vpn-trace.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose attachments"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(mockedApi.createPortalTicket).toHaveBeenCalledWith({
        summary: "VPN disconnects",
        description: "Drops every five minutes.",
      });
    });
    const payload = mockedApi.createPortalTicket.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(["description", "summary"]);
    await waitFor(() => expect(mockedApi.uploadPortalAttachments).toHaveBeenCalledWith(42, [file]));
  });

  it("renders detail, posts a content-only comment, and appends uploaded attachments", async () => {
    const supportNote: PortalNote = {
      id: 1,
      content: "We are checking the VPN gateway.",
      htmlContent: null,
      direction: "outbound",
      authorKind: "support",
      createdAt: "2026-07-21T14:00:00.000Z",
    };
    const requesterNote: PortalNote = {
      id: 2,
      content: "It just disconnected again.",
      htmlContent: null,
      direction: "inbound",
      authorKind: "you",
      createdAt: "2026-07-21T16:00:00.000Z",
    };
    const uploaded: PortalAttachment = {
      id: 9,
      filename: "vpn-screen.png",
      contentType: "image/png",
      size: 2048,
      createdAt: "2026-07-21T16:01:00.000Z",
      downloadUrl: "/api/portal/attachments/9/download",
    };
    mockedApi.getPortalTicket.mockResolvedValue({
      ...baseTicket,
      ticketNumber: null,
      priority: null,
      description: null,
      notes: [supportNote],
    });
    mockedApi.addPortalComment.mockResolvedValue(requesterNote);
    mockedApi.uploadPortalAttachments.mockResolvedValue([uploaded]);

    renderAt(<PortalTicketDetailView />, "/tickets/:ticketId", "/tickets/42");

    expect(await screen.findByText("We are checking the VPN gateway.")).toBeTruthy();
    expect(screen.getByText("Support request")).toBeTruthy();
    expect(screen.queryByText("null")).toBeNull();

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "  It just disconnected again.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    await waitFor(() => {
      expect(mockedApi.addPortalComment).toHaveBeenCalledWith(42, "It just disconnected again.");
    });
    expect(await screen.findByText("It just disconnected again.")).toBeTruthy();

    const file = new File(["image"], "vpn-screen.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload attachments"), {
      target: { files: [file] },
    });
    await waitFor(() => {
      expect(mockedApi.uploadPortalAttachments).toHaveBeenCalledWith(42, [file]);
    });
    const attachmentLink = await screen.findByRole("link", { name: "vpn-screen.png" });
    expect(attachmentLink.getAttribute("href")).toBe("/api/portal/attachments/9/download");
  });
});
