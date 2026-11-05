import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CLIENTS_SKELETON_PATHS,
  ClientsSkeleton,
  MetaHealthSkeleton,
} from "../src/components/skeletons/ClientsSkeleton";

const html = renderToStaticMarkup(<ClientsSkeleton />);
const page = readFileSync(
  new URL("../src/pages/LaunchPage.tsx", import.meta.url),
  "utf8",
);

const SECTIONS = [
  "page-header",
  "client-status",
  "client-filters",
  "client-book",
  "footer-note",
];

describe("ClientsSkeleton", () => {
  test("is one decorative page skeleton for the clients route", () => {
    expect(html).toContain('data-page-skeleton="clients"');
    expect(html).toContain('aria-hidden="true"');
    expect(CLIENTS_SKELETON_PATHS).toEqual(["/clients"]);
  });

  test("has no live status or interactive controls", () => {
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
  });

  test("keeps the fixed copy as real text", () => {
    for (const text of [
      "Media buyer · Your client book",
      "Clients",
      "Every account, every stage. Open a client to manage their next move.",
      "Client",
      "Status",
      "Ad accounts",
      "Next step",
      "Inactive clients stay visible. Campaigns are created paused, then",
    ]) {
      expect(html).toContain(text);
    }
  });

  test("draws the sections in the page order", () => {
    const positions = SECTIONS.map(name =>
      html.indexOf(`data-section="${name}"`),
    );
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("uses the loaded page's root and column layout", () => {
    expect(html).toContain('class="launch-page client-directory"');
    expect(html).toContain('class="client-book-head"');
    expect(html.split('class="client-book-row"').length - 1).toBe(5);
  });

  test("the page loads it and keeps the account health status text", () => {
    expect(page).toContain("<ClientsSkeleton />");
    expect(page).toContain("<MetaHealthSkeleton />");
    expect(page).toContain('data-section="meta-health"');
    expect(page).toContain("Reading account health and campaign ownership");
    expect(page).not.toContain("<LoadingSkeleton");
  });
});

describe("MetaHealthSkeleton", () => {
  test("draws the account health list without a live status", () => {
    const markup = renderToStaticMarkup(<MetaHealthSkeleton />);
    expect(markup).toContain('data-section="meta-health"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="status"');
    expect(markup).toContain('class="launch-checks"');
  });
});
