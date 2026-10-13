import { describe, expect, test } from "bun:test";
import { isStaleBuild } from "./PageBoundary";

describe("isStaleBuild", () => {
  test("treats a failed CSS preload as a stale build", () => {
    expect(
      isStaleBuild(
        new Error(
          "Unable to preload CSS for /sales/assets/DeckPage-BartvRIJ.css",
        ),
      ),
    ).toBe(true);
  });
  test("treats a failed page script as a stale build", () => {
    expect(
      isStaleBuild(
        new Error(
          "Failed to fetch dynamically imported module: /sales/assets/DeckPage-C7TMsKEV.js",
        ),
      ),
    ).toBe(true);
  });
  test("leaves real page errors alone", () => {
    expect(isStaleBuild(new Error("Cannot read properties of undefined"))).toBe(
      false,
    );
  });
});
