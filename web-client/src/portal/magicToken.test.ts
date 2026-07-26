// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readAndScrubMagicToken } from "./magicToken";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("readAndScrubMagicToken", () => {
  it("returns the fragment token and removes it from browser history immediately", () => {
    window.history.replaceState(null, "", "/portal/login?from=email#token=single-use-secret");

    expect(readAndScrubMagicToken()).toBe("single-use-secret");
    expect(window.location.pathname).toBe("/portal/login");
    expect(window.location.search).toBe("?from=email");
    expect(window.location.hash).toBe("");
  });

  it("also scrubs an empty token without attempting verification", () => {
    window.history.replaceState(null, "", "/portal/login#token=");

    expect(readAndScrubMagicToken()).toBeNull();
    expect(window.location.hash).toBe("");
  });
});

