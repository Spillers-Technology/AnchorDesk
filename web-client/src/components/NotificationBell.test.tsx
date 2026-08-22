// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";
import NotificationBell from "./NotificationBell";
import type { RealtimeEvent } from "../api/realtime";
import type { NotificationItem } from "../api/client";

let realtimeHandler: ((event: RealtimeEvent) => void) | undefined;

vi.mock("../api/client", () => ({
  listNotifications: vi.fn().mockResolvedValue({ items: [], unread: 0 }),
  markNotificationRead: vi.fn().mockResolvedValue({ unread: 0 }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({}),
}));

vi.mock("../api/realtime", () => ({
  subscribeRealtime: vi.fn((handler: (event: RealtimeEvent) => void) => {
    realtimeHandler = handler;
    return () => { realtimeHandler = undefined; };
  }),
}));

function renderBell() {
  return render(
    <ThemeProvider theme={buildTheme("default-light")}>
      <NotificationBell />
    </ThemeProvider>
  );
}

const notification: NotificationItem = {
  id: 1,
  type: "note.added",
  title: "New reply",
  body: "A customer replied",
  ticketId: 42,
  readAt: null,
  createdAt: new Date().toISOString(),
};

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("bumps the unread badge when a live notification arrives", async () => {
    renderBell();
    await act(async () => { await Promise.resolve(); });

    expect(realtimeHandler).toBeDefined();
    act(() => {
      realtimeHandler?.({ type: "notification", notification });
    });

    expect(screen.getByText("1")).toBeTruthy();
  });

  it("pops the badge briefly on arrival, then settles back to no animation", async () => {
    renderBell();
    await act(async () => { await Promise.resolve(); });

    act(() => {
      realtimeHandler?.({ type: "notification", notification });
    });
    const badgeDuring = screen.getByText("1");
    const classDuringPop = badgeDuring.className;

    act(() => {
      vi.advanceTimersByTime(400);
    });
    const classAfterPop = screen.getByText("1").className;

    // The pop is a transient sx change — its emotion-generated class differs
    // while animating, and changes again once the timeout clears
    // `justArrived` and the animation reverts to "none".
    expect(classDuringPop).not.toBe(classAfterPop);
  });
});
