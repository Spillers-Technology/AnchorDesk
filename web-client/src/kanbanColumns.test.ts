import { describe, expect, it } from "vitest";
import { reorderKanbanColumns } from "./kanbanColumns";

describe("reorderKanbanColumns", () => {
  it("moves a column to its new left-to-right position", () => {
    expect(reorderKanbanColumns(["New", "Assigned", "Waiting"], 2, 0)).toEqual([
      "Waiting",
      "New",
      "Assigned",
    ]);
  });

  it("does not mutate the saved vocabulary", () => {
    const columns = ["New", "Assigned", "Waiting"];
    const reordered = reorderKanbanColumns(columns, 0, 2);

    expect(columns).toEqual(["New", "Assigned", "Waiting"]);
    expect(reordered).toEqual(["Assigned", "Waiting", "New"]);
  });

  it("returns an unchanged copy when the destination is invalid", () => {
    const columns = ["New", "Assigned"];
    const reordered = reorderKanbanColumns(columns, 0, 3);

    expect(reordered).toEqual(columns);
    expect(reordered).not.toBe(columns);
  });
});
