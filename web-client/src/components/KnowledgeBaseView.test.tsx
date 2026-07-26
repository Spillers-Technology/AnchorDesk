// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import type { KbArticle, KbArticleSummary } from "../api/client";
import KnowledgeBaseView, { KbArticleEditorDialog } from "./KnowledgeBaseView";

const api = vi.hoisted(() => ({
  listKbArticles: vi.fn(),
  searchKbArticles: vi.fn(),
  getKbArticle: vi.fn(),
  createKbArticle: vi.fn(),
  updateKbArticle: vi.fn(),
  deleteKbArticle: vi.fn(),
}));

vi.mock("../api/client", () => api);
vi.mock("./RichTextEditor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Article body editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const article: KbArticle = {
  id: 1,
  slug: "reset-vpn-profile",
  title: "Reset a stale VPN profile",
  bodyHtml: "<p>Remove the stale profile, then reconnect.</p>",
  category: "Connectivity",
  visibility: "internal",
  published: true,
  author: "priya",
  createdAt: "2026-07-25T12:00:00.000Z",
  updatedAt: "2026-07-26T12:00:00.000Z",
};

const articleSummary: KbArticleSummary = {
  id: article.id,
  slug: article.slug,
  title: article.title,
  excerpt: "Remove the stale profile, then reconnect.",
  category: article.category,
  visibility: article.visibility,
  published: article.published,
  author: article.author,
  createdAt: article.createdAt,
  updatedAt: article.updatedAt,
};

let phone = false;
function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width:599.95px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={buildTheme("default-light")}>{ui}</ThemeProvider>);
}

beforeEach(() => {
  phone = false;
  installMatchMedia();
  vi.clearAllMocks();
  api.listKbArticles.mockResolvedValue({ items: [articleSummary] });
  api.searchKbArticles.mockResolvedValue({ items: [] });
  api.getKbArticle.mockResolvedValue(article);
  api.createKbArticle.mockResolvedValue(article);
  api.updateKbArticle.mockResolvedValue(article);
  api.deleteKbArticle.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("KnowledgeBaseView", () => {
  it("keeps author controls out of the readonly view", async () => {
    renderInTheme(<KnowledgeBaseView canWrite={false} />);

    await screen.findByText(article.title);
    expect(screen.queryByRole("button", { name: "New article" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
    expect(screen.queryByRole("button", { name: `Edit ${article.title}` })).toBeNull();
    expect(screen.queryByRole("button", { name: `Delete ${article.title}` })).toBeNull();
  });

  it("shows management actions to technicians and admins", async () => {
    renderInTheme(<KnowledgeBaseView canWrite />);

    await screen.findByText(article.title);
    expect(screen.getByRole("button", { name: "New article" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Manage" })).not.toBeNull();
    expect(screen.getByRole("button", { name: `Edit ${article.title}` })).not.toBeNull();
    expect(screen.getByRole("button", { name: `Delete ${article.title}` })).not.toBeNull();
  });

  it("preserves the backend's ranked search order and renders article HTML safely", async () => {
    const user = userEvent.setup();
    const best = {
      id: 2,
      slug: "vpn-drops-every-twelve-minutes",
      title: "VPN drops every twelve minutes",
      excerpt: "Reset the stale IKE profile and reconnect.",
      score: 0.98,
    };
    const weaker = {
      id: 3,
      slug: "general-vpn-checks",
      title: "General VPN checks",
      excerpt: "Confirm internet access before escalating.",
      score: 0.42,
    };
    const bestArticle: KbArticle = {
      ...article,
      id: best.id,
      slug: best.slug,
      title: best.title,
      bodyHtml: "<p>Use the IKE reset procedure.</p><script>window.bad = true</script>",
    };
    api.searchKbArticles.mockResolvedValue({ items: [best, weaker] });
    api.getKbArticle.mockResolvedValue(bestArticle);

    renderInTheme(<KnowledgeBaseView canWrite={false} />);
    await screen.findByText(article.title);
    fireEvent.change(screen.getByLabelText("Search articles"), { target: { value: "vpn drops" } });

    await waitFor(() => expect(api.searchKbArticles).toHaveBeenCalledWith({
      q: "vpn drops",
      visibility: undefined,
      limit: 50,
    }));
    const bestTitle = await screen.findByText(best.title);
    const weakerTitle = screen.getByText(weaker.title);
    expect(bestTitle.compareDocumentPosition(weakerTitle) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await user.click(bestTitle);
    await screen.findByRole("heading", { name: best.title });
    expect(screen.getByText("Use the IKE reset procedure.")).not.toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("KbArticleEditorDialog", () => {
  it("renders full-screen at phone width", () => {
    phone = true;
    installMatchMedia();

    renderInTheme(
      <KbArticleEditorDialog
        open
        article={null}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );

    expect(document.querySelector(".MuiDialog-paperFullScreen")).not.toBeNull();
  });
});
