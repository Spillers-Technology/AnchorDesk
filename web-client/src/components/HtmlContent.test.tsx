// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import HtmlContent from "./HtmlContent";

afterEach(cleanup);

describe("HtmlContent", () => {
  it("sanitizes hostile HTML and wraps wide tables in their own scroll region", () => {
    render(
      <HtmlContent
        value={
          '<script>window.bad = true</script>' +
          '<table style="min-width: 940px"><tbody><tr><td>First column</td><td>Last column</td></tr></tbody></table>'
        }
      />
    );

    const scroller = screen.getByRole("region", { name: "Scrollable table" });
    expect(scroller.classList.contains("html-table-scroll")).toBe(true);
    expect(scroller.querySelector("table")?.style.minWidth).toBe("940px");
    expect(document.querySelector("script")).toBeNull();
  });
});
