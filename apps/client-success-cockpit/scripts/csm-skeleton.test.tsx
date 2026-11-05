import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CLIENTS_SKELETON_PATHS,
  ClientsSkeleton,
} from "../src/components/skeletons/ClientsSkeleton";
import {
  RequestsSectionSkeleton,
  TODAY_SKELETON_PATHS,
  TodaySkeleton,
} from "../src/components/skeletons/TodaySkeleton";

/**
 * The Today and Clients page skeletons. Each one is its page with the data
 * held back: same header, cards and rows, no controls and no spoken status,
 * so the page does not move when the data arrives. No network or
 * authentication is used.
 *
 * Run: bun test scripts/csm-skeleton.test.tsx
 */

const count = (html: string, needle: string) => html.split(needle).length - 1;

const positions = (html: string, names: string[]) =>
  names.map(name => html.indexOf(`data-section="${name}"`));

const page = readFileSync(
  new URL("../src/pages/CsmPage.tsx", import.meta.url),
  "utf8",
);

describe("Today skeleton", () => {
  const html = renderToStaticMarkup(createElement(TodaySkeleton));

  test("the root names the page and hides its shapes", () => {
    expect(html).toContain('data-page-skeleton="today"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("mx-auto w-full max-w-6xl space-y-6");
    expect(TODAY_SKELETON_PATHS).toEqual(["/dashboard"]);
  });

  test("there is no spoken status and no control", () => {
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain("sr-only");
    expect(html).not.toMatch(/<button\b/i);
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/<input\b/i);
    expect(html).not.toMatch(/<select\b/i);
    expect(html).not.toMatch(/<textarea\b/i);
  });

  test("the fixed titles stay as real text", () => {
    for (const title of [
      "Today",
      "Need you today",
      "Invoices past due",
      "The rest of the numbers",
      "Onboarding, get them live",
      "Management, keep them alive",
      "Commitments from calls",
      "Requests you raised today",
      "Loose ends",
      "Client Success board",
      "Day plan",
      "Calendar and data fixes",
    ]) {
      expect(html).toContain(title);
    }
  });

  test("the top-level sections appear in page order", () => {
    const order = [
      "page-header",
      "today-summary",
      "today-stats",
      "today-bands",
      "who-needs-you",
      "commitments",
      "requests",
      "loose-ends",
      "client-success-board",
      "day-plan",
      "calendar-fold",
      "today-footer",
    ];
    const at = positions(html, order);
    expect(at.every(i => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(
      order
        .filter(name => name !== "today-bands")
        .every(name => page.includes(`data-section="${name}"`)),
    ).toBe(true);
    expect(page).toContain('section="today-bands"');
    expect(page).toContain("<TodaySkeleton />");
  });

  test("the numbers fold is closed and the bands hold their own space", () => {
    expect(html).toContain('<details class="text-sm">');
    expect(html).not.toContain('<details class="text-sm" open');
    expect(html).toContain(
      '<summary class="text-muted-foreground">The rest of the numbers</summary>',
    );
    expect(count(html, 'data-section="today-bands"')).toBe(1);
    expect(html).toContain("min-height:");
    expect(page).toContain('<HeldHeight id="cs-today-bands"');
  });

  test("the rows are bounded and each block shimmers", () => {
    expect(count(html, "motion-safe:animate-pulse")).toBeGreaterThan(20);
    expect(html).toContain('data-page-skeleton="today"');
  });
});

describe("Clients skeleton", () => {
  const html = renderToStaticMarkup(createElement(ClientsSkeleton));

  test("the root names the page and hides its shapes", () => {
    expect(html).toContain('data-page-skeleton="clients"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("mx-auto w-full max-w-6xl space-y-6");
    expect(CLIENTS_SKELETON_PATHS).toEqual(["/clients"]);
  });

  test("there is no spoken status and no control", () => {
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain("sr-only");
    expect(html).not.toMatch(/<button\b/i);
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/<input\b/i);
    expect(html).not.toMatch(/<select\b/i);
    expect(html).not.toMatch(/<textarea\b/i);
  });

  test("the fixed titles and view names stay as real text", () => {
    for (const title of [
      "Clients",
      "Every client you look after. Open one for everything about them.",
      "All",
      "Onboarding",
      "Live",
      "Results",
    ]) {
      expect(html).toContain(title);
    }
  });

  test("the filters come before the list, and the page draws both", () => {
    const at = positions(html, [
      "page-header",
      "client-filters",
      "client-list",
    ]);
    expect(at.every(i => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(count(html, "rounded-2xl border bg-card")).toBe(5);
  });

  test("the page source names the sections and draws the skeleton", () => {
    for (const name of ["client-filters", "client-list"]) {
      expect(page).toContain(`data-section="${name}"`);
    }
    expect(page).toContain("<ClientsSkeleton />");
  });
});

describe("Requests section skeleton", () => {
  test("it speaks once while the read is pending", () => {
    const html = renderToStaticMarkup(createElement(RequestsSectionSkeleton));
    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Reading your requests");
    expect(html).toContain("Requests you raised today");
    expect(html).toContain("motion-safe:animate-pulse");
  });

  test("inside the page skeleton it stays silent", () => {
    const html = renderToStaticMarkup(
      createElement(RequestsSectionSkeleton, { withStatus: false }),
    );
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("sr-only");
    expect(html).toContain("Requests you raised today");
  });
});
