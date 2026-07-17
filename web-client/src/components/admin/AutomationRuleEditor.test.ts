import { describe, expect, it } from "vitest";
import {
  conditionsToDrafts,
  defaultAction,
  draftsToConditions,
  normalizeActions,
} from "./AutomationRuleEditor";

describe("condition draft ⇄ JSON converters", () => {
  it("round-trips typical rule JSON through drafts", () => {
    const rule = [
      { field: "priority", op: "eq", value: "Urgent" },
      { field: "labelIds", op: "in", value: [2, 3] },
      { field: "dueAt", op: "set" },
    ];
    const drafts = conditionsToDrafts(rule);
    expect(drafts).toEqual([
      { field: "priority", op: "eq", value: "Urgent" },
      { field: "labelIds", op: "in", value: "2, 3" },
      { field: "dueAt", op: "set", value: "" },
    ]);
    expect(draftsToConditions(drafts)).toEqual([
      { field: "priority", op: "eq", value: "Urgent" },
      { field: "labelIds", op: "in", value: ["2", "3"] },
      { field: "dueAt", op: "set" },
    ]);
  });

  it("numbers gte/lte values but keeps datetime fields as ISO strings", () => {
    expect(draftsToConditions([{ field: "teamId", op: "gte", value: "4" }])).toEqual([
      { field: "teamId", op: "gte", value: 4 },
    ]);
    expect(draftsToConditions([{ field: "effectiveDueAt", op: "lte", value: "2026-08-01T00:00:00Z" }])).toEqual([
      { field: "effectiveDueAt", op: "lte", value: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("drops values from set/unset and empties from in-lists", () => {
    expect(draftsToConditions([{ field: "assignee", op: "unset", value: "stale" }])).toEqual([
      { field: "assignee", op: "unset" },
    ]);
    expect(draftsToConditions([{ field: "status", op: "in", value: "Open, , Waiting," }])).toEqual([
      { field: "status", op: "in", value: ["Open", "Waiting"] },
    ]);
  });

  it("tolerates malformed stored JSON without throwing", () => {
    expect(conditionsToDrafts(null)).toEqual([]);
    expect(conditionsToDrafts([{}])).toEqual([{ field: "status", op: "eq", value: "" }]);
  });
});

describe("action drafts", () => {
  it("switching type yields clean defaults with no stale keys", () => {
    expect(defaultAction("assign_team")).toEqual({ type: "assign_team", teamId: 0 });
    expect(defaultAction("nonsense")).toEqual({ type: "add_note", content: "Automated update" });
  });

  it("strips empty optional notification messages on save", () => {
    expect(normalizeActions([
      { type: "notify_team", teamId: 3, message: "  " },
      { type: "notify_user", userId: 2, message: "Escalated" },
    ])).toEqual([
      { type: "notify_team", teamId: 3 },
      { type: "notify_user", userId: 2, message: "Escalated" },
    ]);
  });
});
