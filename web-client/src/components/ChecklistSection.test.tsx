// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChecklistSection from "./ChecklistSection";
import * as api from "../api/client";

vi.mock("../api/client", () => ({
  listChecklist: vi.fn(),
  listChecklistTemplates: vi.fn(),
  addChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  applyChecklistTemplate: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const items = [
  { id: 1, ticketId: 7, text: "Create account", done: true, doneBy: "sam", doneAt: "2026-07-15T14:00:00Z", dueAt: null, sortOrder: 0, templateId: 1 },
  // Midday UTC so the rendered local date is Jan 1 in any offset within ±11h.
  { id: 2, ticketId: 7, text: "Assign licenses", done: false, doneBy: null, doneAt: null, dueAt: "2026-01-01T12:00:00Z", sortOrder: 1, templateId: 1 },
];

afterEach(cleanup);

describe("ChecklistSection", () => {
  it("renders progress, items, and an overdue deadline chip", async () => {
    mockedApi.listChecklist.mockResolvedValue(items);
    mockedApi.listChecklistTemplates.mockResolvedValue([]);

    const { getByText } = render(<ChecklistSection ticketId={7} />);
    await waitFor(() => {
      expect(getByText("Checklist — 1 of 2")).toBeTruthy();
      expect(getByText("Assign licenses")).toBeTruthy();
    });
    // The 2026-01-01 deadline is in the past on an undone item → error chip.
    const chip = getByText(/Jan 1/).closest(".MuiChip-root");
    expect(chip?.className).toContain("colorError");
  });

  it("toggles an item through the API", async () => {
    mockedApi.listChecklist.mockResolvedValue(items);
    mockedApi.listChecklistTemplates.mockResolvedValue([]);
    mockedApi.updateChecklistItem.mockResolvedValue({ ...items[1], done: true });

    const { getByRole } = render(<ChecklistSection ticketId={7} />);
    await waitFor(() => getByRole("checkbox", { name: 'Mark "Assign licenses" done' }));
    fireEvent.click(getByRole("checkbox", { name: 'Mark "Assign licenses" done' }));
    await waitFor(() => {
      expect(mockedApi.updateChecklistItem).toHaveBeenCalledWith(7, 2, { done: true });
    });
  });

  it("applies a template through the API", async () => {
    mockedApi.listChecklist.mockResolvedValue([]);
    mockedApi.listChecklistTemplates.mockResolvedValue([
      { id: 3, name: "Onboarding", description: null, active: true, items: [] },
    ]);
    mockedApi.applyChecklistTemplate.mockResolvedValue(items);

    const { getByRole, getByLabelText } = render(<ChecklistSection ticketId={7} />);
    await waitFor(() => getByLabelText("Template"));
    fireEvent.mouseDown(getByRole("combobox", { name: "Template" }));
    fireEvent.click(getByRole("option", { name: /Onboarding/ }));
    fireEvent.click(getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(mockedApi.applyChecklistTemplate).toHaveBeenCalledWith(7, 3);
    });
  });
});
