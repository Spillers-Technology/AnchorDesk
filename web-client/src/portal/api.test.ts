// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  searchPortalKnowledgeBase,
  uploadPortalAttachments,
  verifyMagicLink,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("portal API", () => {
  it("verifies the magic secret through a JSON POST, never a query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      requester: { displayName: "Maya Chen", email: "maya@example.com" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyMagicLink("single-use-secret");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portal/auth/verify");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ token: "single-use-secret" }));
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("uses the exact portal KB search contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [{ id: 1, slug: "vpn", title: "VPN help", excerpt: "Try this", score: 0.9 }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchPortalKnowledgeBase("vpn drops")).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/kb/search?q=vpn+drops&visibility=portal&limit=5");
    expect(init.credentials).toBe("same-origin");
  });

  it("silently hides KB results on non-200, malformed, or network failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: "not installed" }, 404))
      .mockResolvedValueOnce(response({ unexpected: [] }))
      .mockResolvedValueOnce(response({
        items: [{ id: 1, slug: "printer", title: null, excerpt: "Help", score: 1 }],
      }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchPortalKnowledgeBase("printer")).resolves.toBeNull();
    await expect(searchPortalKnowledgeBase("printer")).resolves.toBeNull();
    await expect(searchPortalKnowledgeBase("printer")).resolves.toBeNull();
    await expect(searchPortalKnowledgeBase("printer")).resolves.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("uploads multipart files without setting a JSON content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["log"], "diagnostic.txt", { type: "text/plain" });

    await uploadPortalAttachments(42, [file]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portal/tickets/42/attachments");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });
});
