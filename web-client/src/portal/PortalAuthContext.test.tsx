// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as portalApi from "./api";
import { PortalAuthProvider, usePortalAuth } from "./PortalAuthContext";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    verifyMagicLink: vi.fn(),
    getPortalRequester: vi.fn(),
    logoutPortal: vi.fn(),
  };
});

const mockedApi = vi.mocked(portalApi);

function AuthProbe() {
  const auth = usePortalAuth();
  return (
    <div>
      <span>{auth.status}</span>
      <span>{auth.requester?.kind}</span>
      <span>{auth.requester?.displayName}</span>
      <span>{auth.notice}</span>
      <button onClick={() => void auth.refresh()}>Retry auth</button>
    </div>
  );
}

function renderAuth(initialMagicToken: string | null) {
  return render(
    <PortalAuthProvider initialMagicToken={initialMagicToken}>
      <AuthProbe />
    </PortalAuthProvider>,
  );
}

beforeEach(() => {
  mockedApi.verifyMagicLink.mockReset();
  mockedApi.getPortalRequester.mockReset();
  mockedApi.logoutPortal.mockReset();
});

afterEach(cleanup);

describe("PortalAuthProvider", () => {
  it("verifies a fragment token as a requester principal without consulting staff auth", async () => {
    mockedApi.verifyMagicLink.mockResolvedValue({
      requester: { displayName: "Maya Chen", email: "maya@example.com" },
    });

    renderAuth("one-time-token");

    await screen.findByText("authenticated");
    expect(screen.getByText("requester")).toBeTruthy();
    expect(screen.getByText("Maya Chen")).toBeTruthy();
    expect(mockedApi.verifyMagicLink).toHaveBeenCalledWith("one-time-token");
    expect(mockedApi.getPortalRequester).not.toHaveBeenCalled();
  });

  it("treats a missing portal session as anonymous", async () => {
    mockedApi.getPortalRequester.mockRejectedValue(new portalApi.PortalApiError(401, "unauthorized"));

    renderAuth(null);

    await screen.findByText("anonymous");
  });

  it("shows an outage instead of pretending a 5xx is a logged-out session, then retries the same token", async () => {
    mockedApi.verifyMagicLink
      .mockRejectedValueOnce(new portalApi.PortalApiError(503, "unavailable"))
      .mockResolvedValueOnce({
        requester: { displayName: "Maya Chen", email: "maya@example.com" },
      });

    renderAuth("one-time-token");

    await screen.findByText("unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry auth" }));
    await waitFor(() => expect(screen.getByText("authenticated")).toBeTruthy());
    expect(mockedApi.verifyMagicLink).toHaveBeenNthCalledWith(2, "one-time-token");
  });

  it("reports an expired magic link without retaining it for replay", async () => {
    mockedApi.verifyMagicLink.mockRejectedValue(new portalApi.PortalApiError(410, "expired"));

    renderAuth("expired-token");

    await screen.findByText("anonymous");
    expect(screen.getByText(/invalid or has expired/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry auth" }));
    await waitFor(() => expect(mockedApi.getPortalRequester).toHaveBeenCalledTimes(1));
    expect(mockedApi.verifyMagicLink).toHaveBeenCalledTimes(1);
  });
});

