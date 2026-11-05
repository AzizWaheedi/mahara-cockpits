/**
 * The editor desk's first picture: the app shell mirror and the Jobs home
 * skeletons. Rendered on the server, so nothing here signs in, reads a
 * database or reaches the network.
 *
 * bun test scripts/editor-skeleton.test.tsx
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShellSkeleton } from "../src/components/ShellSkeleton";
import {
  JobsBoardSectionSkeleton,
  JobsBoardSkeleton,
  JobsGroupsSkeleton,
  JobsSkeleton,
  JobsTallySkeleton,
  PageHeaderSkeleton,
} from "../src/components/skeletons/JobsSkeleton";

const render = (node: Parameters<typeof createElement>[0]) =>
  renderToStaticMarkup(createElement(node));

function noControls(html: string) {
  expect(html).not.toContain('role="status"');
  expect(html).not.toContain('aria-live="polite"');
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("<select");
  expect(html).not.toContain("<textarea");
}

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("JobsSkeleton", () => {
  const html = render(JobsSkeleton);

  test("is one decorative page picture", () => {
    expect(html).toContain('aria-hidden="true" data-page-skeleton="jobs"');
    expect(html.startsWith("<div")).toBe(true);
  });

  test("draws no status, button, link or field", () => {
    noControls(html);
  });

  test("keeps the fixed words of the list", () => {
    for (const words of [
      "Jobs",
      "Ready",
      "Waiting",
      "Late",
      "Due today",
      "Your tasks",
      "Ready to start",
      "Waiting on something",
      "In review",
    ]) {
      expect(html).toContain(words);
    }
  });

  test("stacks its sections in the order the page draws them", () => {
    const order = ["jobs-header", "jobs-tally", "your-tasks", "jobs-filters"];
    const at = order.map(name => html.indexOf(`data-section="${name}"`));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i - 1]).toBeLessThan(at[i]);
    }
    expect(html.indexOf('data-section="jobs-groups"')).toBeGreaterThan(
      at.at(-1) ?? -1,
    );
  });
});

describe("JobsTallySkeleton", () => {
  const html = render(JobsTallySkeleton);

  test("holds the tally section the live page draws", () => {
    expect(html.startsWith("<div")).toBe(true);
    expect(html).toContain('data-section="jobs-tally"');
    expect(html).toContain("grid grid-cols-4 gap-2 sm:gap-4");
  });

  test("keeps the four real labels", () => {
    for (const label of ["Ready", "Waiting", "Late", "Due today"]) {
      expect(html).toContain(label);
    }
  });

  test("draws no status, button, link or field", () => {
    noControls(html);
  });
});

describe("JobsBoardSkeleton", () => {
  const html = render(JobsBoardSkeleton);

  test("is one decorative board picture", () => {
    expect(html).toContain(
      'aria-hidden="true" data-page-skeleton="jobs-board"',
    );
    expect(html.startsWith("<div")).toBe(true);
  });

  test("draws no status, button, link or field", () => {
    noControls(html);
  });

  test("keeps the fixed words of the board", () => {
    expect(html).toContain("Jobs");
    expect(html).toContain("Ready to start");
    expect(html).toContain("Waiting on someone");
  });

  test("puts the header before the columns", () => {
    const header = html.indexOf('data-section="jobs-header"');
    const board = html.indexOf('data-section="jobs-board"');
    expect(header).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(header);
  });
});

describe("PageHeaderSkeleton", () => {
  test("is a decorative header only, at the requested size", () => {
    const html = render(PageHeaderSkeleton);
    expect(html).toContain(
      'aria-hidden="true" data-page-skeleton="page-header"',
    );
    expect(html).toContain("h-8 w-48");
    expect(html).toContain("h-4 w-64");
    noControls(html);
  });
});

describe("ShellSkeleton", () => {
  const html = renderToStaticMarkup(
    createElement(ShellSkeleton, null, createElement(JobsSkeleton)),
  );

  test("is one decorative shell with the page inside", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-page-skeleton="jobs"');
    expect(html).toContain("Editor desk");
    expect(html).toContain("lg:block");
  });

  test("draws no status, button, link or field", () => {
    noControls(html);
  });
});

describe("the page sections draw their own skeletons", () => {
  test("the list groups keep the loaded stack and height", () => {
    const html = render(JobsGroupsSkeleton);
    expect(html.startsWith("<div")).toBe(true);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-section="jobs-groups"');
    expect(html).toContain("space-y-6");
    expect(html).toContain("Ready to start");
    expect(html).toContain("Waiting on something");
    expect(html).toContain("In review");
    noControls(html);
  });

  test("the board strip keeps the loaded scroll width", () => {
    const html = render(JobsBoardSectionSkeleton);
    expect(html.startsWith("<div")).toBe(true);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-section="jobs-board"');
    expect(html).toContain("min-w-max");
    noControls(html);
  });
});

describe("JobsPage", () => {
  const page = source("../src/pages/JobsPage.tsx");

  test("names its sections in the order the skeleton stacks them", () => {
    const order = [
      "jobs-header",
      "jobs-tally",
      "your-tasks",
      "jobs-filters",
      "jobs-groups",
    ];
    const at = order.map(name => page.indexOf(`data-section="${name}"`));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i - 1]).toBeLessThan(at[i]);
    }
  });

  test("draws the groups skeleton while the jobs are read", () => {
    expect(page).toContain("<JobsGroupsSkeleton");
    expect(page).toContain("Reading the board");
    expect(page).not.toContain("LoadingSkeleton");
  });

  test("holds the tally with the same skeleton while the jobs are read", () => {
    expect(page).toContain("<JobsTallySkeleton");
  });
});

describe("PipelinePage", () => {
  const page = source("../src/pages/PipelinePage.tsx");

  test("names the header and the board in the skeleton's order", () => {
    const header = page.indexOf('data-section="jobs-header"');
    const board = page.indexOf('data-section="jobs-board"');
    expect(header).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(header);
  });

  test("draws the board skeleton while the jobs are read", () => {
    expect(page).toContain("<JobsBoardSectionSkeleton");
    expect(page).toContain("Reading the board");
    expect(page).not.toContain("LoadingSkeleton");
  });
});

describe("the app wires the same picture", () => {
  test("Places chooses the home skeleton for both views", () => {
    const places = source("../src/components/Places.tsx");
    expect(places).toContain("<JobsSkeleton");
    expect(places).toContain("<JobsBoardSkeleton");
    expect(places).toContain("JobsHomeSkeleton");
  });

  test("App draws the shell and the one loading label", () => {
    const app = source("../src/App.tsx");
    expect(app).toContain("<ShellSkeleton");
    expect(app).toContain("Opening the editor desk");
    expect(app).toContain('aria-live="polite"');
  });

  test("the skeleton file names its route and sections", () => {
    const file = source("../src/components/skeletons/JobsSkeleton.tsx");
    for (const name of [
      "jobs",
      "jobs-board",
      "JOBS_SKELETON_PATHS",
      'data-section="jobs-header"',
      'data-section="jobs-tally"',
      'data-section="your-tasks"',
      'data-section="jobs-filters"',
      'data-section="jobs-groups"',
      'data-section="jobs-board"',
    ]) {
      expect(file).toContain(name);
    }
  });
});
