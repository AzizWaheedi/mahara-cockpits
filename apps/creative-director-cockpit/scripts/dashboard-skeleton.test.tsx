import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CalendarSectionSkeleton,
  CreativePerformanceSectionSkeleton,
  DASHBOARD_SKELETON_PATHS,
  DashboardSkeleton,
} from "../src/components/skeletons/DashboardSkeleton";

/**
 * The dashboard and its scripting calendar draw the loaded page with the
 * data held back, so nothing changes shape when the snapshot arrives.
 * Fictional data only; no network or authentication is used.
 *
 * Run: bun test scripts/dashboard-skeleton.test.tsx
 */

const count = (html: string, needle: string) => html.split(needle).length - 1;

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

const dashboard = render(createElement(DashboardSkeleton));
const calendar = render(createElement(CalendarSectionSkeleton));
const performance = render(createElement(CreativePerformanceSectionSkeleton));

const DASHBOARD_SECTIONS = [
  "page-header",
  "on-this-page",
  "morning",
  "scripting",
  "videos",
  "touchpoints",
];

const CALENDAR_SECTIONS = [
  "calendar-header",
  "plan-script",
  "script-queue",
  "calendar-filter",
  "calendar-grid",
  "undated",
  "drive-folders",
];

describe("DashboardSkeleton", () => {
  test("is one hidden page skeleton for /dashboard", () => {
    expect(DASHBOARD_SKELETON_PATHS).toEqual(["/dashboard"]);

    const root = dashboard.slice(0, dashboard.indexOf(">") + 1);
    expect(root).toContain('aria-hidden="true"');
    expect(root).toContain('data-page-skeleton="dashboard"');
    expect(root).toContain("mx-auto w-full max-w-6xl space-y-6");
  });

  test("speaks nothing and draws no control", () => {
    expect(count(dashboard, 'role="status"')).toBe(0);
    expect(count(dashboard, "aria-live=")).toBe(0);
    expect(count(dashboard, "sr-only")).toBe(0);
    expect(dashboard).not.toContain("<button");
    expect(dashboard).not.toContain("<a ");
    expect(dashboard).not.toContain("<input");
    expect(dashboard).not.toContain("<select");
    expect(dashboard).not.toContain("<textarea");
  });

  test("keeps every fixed title as real text", () => {
    for (const title of [
      "Today",
      "Morning",
      "Scripting",
      "Videos",
      "Touchpoints",
      "Your tasks",
      "WhatsApp",
      "Before you produce anything",
      "The sweep",
      "Scripting calendar",
      "Brand DNA board rows",
      "Script requests",
      "Video pipeline",
      "Editors",
      "The rule",
      "Every template in the SOP",
    ]) {
      expect(dashboard).toContain(title);
    }
  });

  test("draws the sections in the page's order", () => {
    let last = -1;
    for (const name of DASHBOARD_SECTIONS) {
      const at = dashboard.indexOf(`data-section="${name}"`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  test("draws a shimmer block, not a real value", () => {
    expect(dashboard).toContain("motion-safe:animate-pulse");
    expect(dashboard).toContain("bg-muted");
  });
});

describe("CalendarSectionSkeleton", () => {
  test("is hidden and draws no control", () => {
    expect(count(calendar, 'aria-hidden="true"')).toBeGreaterThanOrEqual(1);
    expect(count(calendar, 'role="status"')).toBe(0);
    expect(calendar).not.toContain("<button");
    expect(calendar).not.toContain("<a ");
    expect(calendar).not.toContain("<input");
    expect(calendar).not.toContain("<select");
    expect(calendar).not.toContain("<textarea");
  });

  test("keeps the calendar's fixed titles", () => {
    for (const title of [
      "Scripting calendar",
      "Plan a script",
      "What to script next",
      "No date on them yet",
      "Client Drive folders",
      "Show",
    ]) {
      expect(calendar).toContain(title);
    }
  });

  test("draws the calendar sections in order", () => {
    let last = -1;
    for (const name of CALENDAR_SECTIONS) {
      const at = calendar.indexOf(`data-section="${name}"`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });
});

describe("CreativePerformanceSectionSkeleton", () => {
  test("is hidden, keeps its titles and draws no control", () => {
    expect(count(performance, 'aria-hidden="true"')).toBeGreaterThanOrEqual(1);
    expect(performance).toContain("What to make more of");
    expect(performance).toContain("Winning creatives");
    expect(performance).toContain("Frequency watch");
    expect(performance).not.toContain("<button");
    expect(performance).not.toContain("<a ");
    expect(performance).not.toContain("<input");
  });
});

describe("the pages use their skeletons", () => {
  const dashboardPage = readFileSync(
    new URL("../src/pages/DashboardPage.tsx", import.meta.url),
    "utf8",
  );
  const calendarPage = readFileSync(
    new URL("../src/pages/CalendarPage.tsx", import.meta.url),
    "utf8",
  );

  test("the dashboard names its sections and draws the skeleton", () => {
    for (const name of DASHBOARD_SECTIONS) {
      expect(dashboardPage).toContain(`data-section="${name}"`);
    }
    expect(dashboardPage).toContain("<DashboardSkeleton />");
    expect(dashboardPage).toContain("<CreativePerformanceSectionSkeleton />");
    expect(dashboardPage).not.toContain("LoadingSkeleton");
  });

  test("the scripting calendar names its sections and draws the skeleton", () => {
    for (const name of CALENDAR_SECTIONS) {
      expect(calendarPage).toContain(`data-section="${name}"`);
    }
    expect(calendarPage).toContain("<CalendarSectionSkeleton />");
    expect(calendarPage).not.toContain("LoadingSkeleton");
  });
});
