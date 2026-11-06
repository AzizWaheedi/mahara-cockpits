/**
 * The sales cockpit's first-frame pictures. Rendered on the server: nothing
 * here signs in, reads a database or reaches the network.
 *
 * bun test scripts/sales-skeleton.test.tsx
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ShellSkeleton } from "../src/components/ShellSkeleton";
import {
  TODAY_SKELETON_PATHS,
  TodaySkeleton,
} from "../src/components/skeletons/TodaySkeleton";

const today = renderToStaticMarkup(<TodaySkeleton />);
const shell = renderToStaticMarkup(
  <ShellSkeleton>
    <TodaySkeleton />
  </ShellSkeleton>,
);
const page = readFileSync(
  new URL("../src/pages/TodayPage.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const skeletonSource = readFileSync(
  new URL("../src/components/skeletons/TodaySkeleton.tsx", import.meta.url),
  "utf8",
);

const SECTIONS = [
  "header",
  "your-day",
  "owed",
  "after-call",
  "week",
  "your-tasks",
  "coming-up",
  "waiting-replies",
  "new-leads",
];

describe("TodaySkeleton", () => {
  test("is one decorative page skeleton for the home route", () => {
    expect(today).toContain('data-page-skeleton="today"');
    expect(today).toContain('aria-hidden="true"');
    expect(TODAY_SKELETON_PATHS).toEqual(["/"]);
  });

  test("has no live status or interactive controls", () => {
    expect(today).not.toContain('role="status"');
    expect(today).not.toContain("<button");
    expect(today).not.toContain("<a ");
    expect(today).not.toContain("<input");
    expect(today).not.toContain("<select");
    expect(today).not.toContain("<textarea");
  });

  test("keeps the fixed card titles as real text", () => {
    for (const text of [
      "Mark these calls",
      "Rate these leads",
      "This week",
      "Your tasks",
      "Coming up",
      "Waiting on a reply",
      "New leads",
      "Scheduled",
      "Shown",
      "Closes",
      "Deposits typed",
    ]) {
      expect(today).toContain(text);
    }
  });

  test("draws the sections in the page order", () => {
    const positions = SECTIONS.map(name =>
      today.indexOf(`data-section="${name}"`),
    );
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("uses the page frame and the two columns", () => {
    expect(today).toContain(
      'class="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6"',
    );
    expect(today).toContain("lg:col-span-7");
    expect(today).toContain("lg:col-span-5");
  });

  test("replays a remembered layout only when this device has one", () => {
    expect(today).toContain('data-page-skeleton="today"');
    expect(today).not.toContain("data-remembered");
  });

  test("gives the replay root the same page box as the page", () => {
    expect(skeletonSource).toContain("className: page");
  });

  test("the page keeps the same section names and draws this skeleton", () => {
    for (const name of SECTIONS) {
      expect(page).toContain(`data-section="${name}"`);
    }
    expect(page).toContain("<TodaySkeleton />");
    expect(page).toContain("<AfterCallSectionSkeleton />");
  });
});

describe("ShellSkeleton", () => {
  test("is one decorative shell with the home skeleton inside", () => {
    expect(shell).toContain('aria-hidden="true"');
    expect(shell).toContain("w-60");
    expect(shell).toContain("floating-dock");
    expect(shell).toContain('data-page-skeleton="today"');
  });

  test("has no live status or interactive controls", () => {
    expect(shell).not.toContain('role="status"');
    expect(shell).not.toContain("<button");
    expect(shell).not.toContain("<a ");
    expect(shell).not.toContain("<input");
  });

  test("App.tsx opens with the shell and the same label", () => {
    expect(app).toContain("<ShellSkeleton");
    expect(app).toContain("Opening the sales cockpit");
  });

  test("App.tsx gives the status wrapper the screen's full height", () => {
    expect(app).toMatch(
      /role="status"[\s\S]{0,120}className="h-full"[\s\S]{0,400}<ShellSkeleton/,
    );
  });
});

describe("remembered layout", () => {
  test("the signed-in layout records each page's settled shape", () => {
    expect(app).toContain("<LayoutRecorder");
  });
});
