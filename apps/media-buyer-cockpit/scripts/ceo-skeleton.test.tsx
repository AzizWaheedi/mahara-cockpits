import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CEO_SKELETON_PATHS,
  CeoSkeleton,
  CeoTodayTabSkeleton,
} from "../src/components/skeletons/CeoSkeleton";

const html = renderToStaticMarkup(<CeoSkeleton />);
const today = renderToStaticMarkup(<CeoTodayTabSkeleton />);

const count = (text: string, needle: string) => text.split(needle).length - 1;

/** A source file, read from disk with one line ending. */
const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The page file and the Today view it draws. */
const pageSource = source("../src/pages/CeoPage.tsx");
const todaySource = source("../src/pages/ceo/TodayTab.tsx");

/** The top-level blocks the loaded page marks, in the order they stack. */
const SECTIONS = [
  "header",
  "today",
  "today-timeframe",
  "today-cash",
  "today-kpis",
  "today-funnels",
  "today-columns",
  "today-clients",
  "today-team",
];

/** Fixed text the loaded page always shows, kept as real text. */
const FIXED_TEXT = [
  "Your tasks",
  "Yesterday and today",
  "Client delivery and calls",
  "Client delivery funnel",
  "Mahara growth funnel",
  "Right now",
  "Clients that need you",
  "Delivery by client",
  "Newest first",
  "Live feed",
  "Team today",
  "Client ad spend yesterday",
  "Speed to lead, 7 days",
  "Cash, deals, refunds, cost per lead",
];

describe("CeoSkeleton", () => {
  test("the root is the page root, decorative and named", () => {
    expect(
      html.startsWith('<div aria-hidden="true" data-page-skeleton="ceo"'),
    ).toBe(true);
    expect(html).toContain(
      'class="ceo-root mx-auto w-full min-w-0 max-w-[1440px]"',
    );
    expect(CEO_SKELETON_PATHS).toEqual(["/ceo"]);
  });

  test("draws no status, control or link", () => {
    for (const shape of [html, today]) {
      expect(shape).not.toContain('role="status"');
      expect(shape).not.toContain("aria-live");
      expect(shape).not.toContain("<button");
      expect(shape).not.toContain("<a ");
      expect(shape).not.toContain("<input");
      expect(shape).not.toContain("<select");
      expect(shape).not.toContain("<textarea");
      expect(shape).not.toContain("sr-only");
    }
  });

  test("keeps the fixed titles as real text", () => {
    for (const text of FIXED_TEXT) expect(today).toContain(text);
  });

  test("the header is the page header, with the date, title, pill and Refresh held back", () => {
    expect(html).toContain('<header class="pb-6" data-section="header">');
    expect(count(html, "motion-safe:animate-pulse")).toBeGreaterThan(10);
    // The header alone draws the date line, the title, the pill, Refresh and
    // the one-sentence line.
    const header = html.slice(0, html.indexOf('<div class="min-w-0 pb-10"'));
    expect(count(header, "motion-safe:animate-pulse")).toBe(5);
  });

  test("the data sections are drawn in the loaded order", () => {
    let at = -1;
    for (const name of SECTIONS) {
      const next = html.indexOf(`data-section="${name}"`);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    expect(count(html, "data-section=")).toBe(SECTIONS.length);
  });

  test("the lists match the loaded page before its fold", () => {
    // The task list, the clients list, the feed and the team each show five
    // rows; the delivery table shows six, five cells wide.
    expect(count(today, 'class="tk-row"')).toBe(5);
    expect(count(today, "<td ")).toBe(30);
  });

  test("the page marks the same blocks and draws the Today skeleton", () => {
    const sources = `${pageSource}\n${todaySource}`;
    for (const name of SECTIONS) {
      expect(sources).toContain(`data-section="${name}"`);
    }
    expect(pageSource).toContain("<CeoTodayTabSkeleton");
    expect(pageSource).toContain('role="status"');
    expect(pageSource).toContain("Loading the cockpit");
    expect(pageSource).toContain('variant="page"');
  });
});
