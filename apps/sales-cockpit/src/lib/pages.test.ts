// bun test src/lib/pages.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCK, PAGES, pageTitle } from "./pages";

/**
 * One name per page (the simplification audit, 2026-10-06): the sidebar,
 * the menu bar, the dock and the search box read lib/pages.ts, and the menu
 * bar used to call Today "Today's Agenda".
 */
const routes = [
  ...readFileSync(join(import.meta.dir, "..", "App.tsx"), "utf8").matchAll(
    /<Route\s+path="([^"]+)"/g,
  ),
]
  .map(m => m[1])
  .filter(p => p !== "*");

describe("page names", () => {
  test("every page in the app has its one name", () => {
    // /dashboard is the portal's door, sent on to Today.
    for (const path of routes.filter(p => p !== "/dashboard")) {
      const sample = path.replace(/:[A-Za-z]+/g, "x");
      expect(`${path} ${pageTitle(sample)}`).not.toBe(`${path} Sales`);
    }
  });

  test("every listed page is a page the app has", () => {
    for (const p of PAGES) expect(routes).toContain(p.to);
  });

  test("no two pages share a name", () => {
    const names = PAGES.map(p => p.label);
    expect(new Set(names).size).toBe(names.length);
  });

  test("the menu bar says what the sidebar says", () => {
    expect(pageTitle("/")).toBe("Today");
    expect(pageTitle("/dialer")).toBe("Dialer");
    expect(pageTitle("/lead/abc")).toBe("Lead");
  });

  test("the pitch deck is in the sidebar", () => {
    expect(PAGES.some(p => p.to === "/deck")).toBe(true);
  });
});

describe("the phone's dock", () => {
  test("every dock page is a listed page", () => {
    for (const to of DOCK) expect(PAGES.some(p => p.to === to)).toBe(true);
  });

  test("it fits a 360px phone with the More button beside it", () => {
    // MacOSDock at baseSize 36: 8px between icons, 10px padding each side;
    // then a 6px gap and the 40px More button, inside 8px side margins.
    const n = DOCK.length;
    const dock = n * 36 + (n - 1) * 8 + 2 * 10;
    expect(dock + 6 + 40).toBeLessThanOrEqual(360 - 2 * 8);
  });
});
