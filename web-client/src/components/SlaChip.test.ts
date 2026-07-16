import { describe, expect, it } from "vitest";
import { activeDeadline } from "./SlaChip";

describe("activeDeadline", () => {
  it("keeps response SLA active before the first response", () => {
    expect(activeDeadline({
      responseDueAt: "2026-07-15T15:00:00.000Z",
      resolutionDueAt: "2026-07-16T15:00:00.000Z",
      dueAt: "2026-07-15T18:00:00.000Z",
      firstRespondedAt: null,
    })).toEqual({ kind: "Response", due: "2026-07-15T15:00:00.000Z", manual: false });
  });

  it("uses a manual deadline instead of the resolution target after response", () => {
    expect(activeDeadline({
      responseDueAt: "2026-07-15T15:00:00.000Z",
      resolutionDueAt: "2026-07-16T15:00:00.000Z",
      dueAt: "2026-07-15T18:00:00.000Z",
      firstRespondedAt: "2026-07-15T14:00:00.000Z",
    })).toEqual({ kind: "Deadline", due: "2026-07-15T18:00:00.000Z", manual: true });
  });

  it("falls back to the resolution SLA when no manual deadline exists", () => {
    expect(activeDeadline({ resolutionDueAt: "2026-07-16T15:00:00.000Z" }))
      .toEqual({ kind: "Resolution", due: "2026-07-16T15:00:00.000Z", manual: false });
  });
});
