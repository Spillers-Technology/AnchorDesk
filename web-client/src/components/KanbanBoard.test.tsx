// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KanbanBoard from "./KanbanBoard";

afterEach(cleanup);

describe("KanbanBoard column order", () => {
  it("exposes an accessible keyboard handle and reports the reordered vocabulary", async () => {
    const onColumnsReorder = vi.fn();
    const { getByRole } = render(
      <KanbanBoard
        tickets={[]}
        columns={["New", "Assigned", "Waiting"]}
        onColumnsReorder={onColumnsReorder}
        onStatusChange={vi.fn()}
        onTicketClick={vi.fn()}
        onTicketClose={vi.fn()}
      />,
    );

    const handle = getByRole("button", { name: "Drag to reorder Waiting column" });
    handle.focus();
    fireEvent.keyDown(handle, { key: " ", code: "Space", keyCode: 32 });
    fireEvent.keyDown(handle, { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 });
    fireEvent.keyDown(handle, { key: " ", code: "Space", keyCode: 32 });

    await waitFor(() => {
      expect(onColumnsReorder).toHaveBeenCalledWith(["New", "Waiting", "Assigned"]);
    });
  });
});
