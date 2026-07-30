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
  // Filter-aware so the hidden-draft probe (`published: false`) is not answered
  // with the published list, which would fake a draft count in every test.
  api.listKbArticles.mockImplementation((options: { published?: boolean } = {}) =>
    Promise.resolve({ items: options.published === false ? [] : [articleSummary] }),
  );
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

  // The 2.7.0 shipping behaviour: an author saves an article, it defaults to a
  // draft, Browse lists published rows only, and the article is simply gone with
  // no explanation. The count is the explanation.
  it("tells an author how many drafts Browse is hiding and switches to Manage", async () => {
    const user = userEvent.setup();
    const draft: KbArticleSummary = {
      ...articleSummary,
      id: 9,
      slug: "nn",
      title: "nn",
      published: false,
    };
    // A store holding exactly one draft and nothing published: the author
    // listing sees it, the published-only browse listing does not.
    api.listKbArticles.mockImplementation(
      (options: { includeUnpublished?: boolean; published?: boolean } = {}) => {
        if (!options.includeUnpublished) return Promise.resolve({ items: [] });
        return Promise.resolve({ items: options.published === true ? [] : [draft] });
      },
    );

    renderInTheme(<KnowledgeBaseView canWrite />);

    await waitFor(() => expect(api.listKbArticles).toHaveBeenCalledWith({
      includeUnpublished: true,
      published: false,
      visibility: undefined,
    }));
    await screen.findByText(/1 unpublished draft is hidden from Browse/);
    // Browse must not blame the wording when nothing is published.
    expect(screen.queryByText(/Try different wording/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Review drafts" }));
    await screen.findByText(draft.title);
    expect(screen.queryByText(/hidden from Browse/)).toBeNull();
  });

  it("stays quiet when every article is already published", async () => {
    renderInTheme(<KnowledgeBaseView canWrite />);

    await screen.findByText(article.title);
    expect(screen.queryByText(/hidden from Browse/)).toBeNull();
  });

  it("never probes drafts for a reader who cannot author", async () => {
    renderInTheme(<KnowledgeBaseView canWrite={false} />);

    await screen.findByText(article.title);
    expect(api.listKbArticles).not.toHaveBeenCalledWith(
      expect.objectContaining({ published: false }),
    );
    expect(screen.queryByText(/hidden from Browse/)).toBeNull();
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
