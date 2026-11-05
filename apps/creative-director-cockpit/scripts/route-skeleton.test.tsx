import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  ContentSkeleton,
  RouteSkeleton,
} from "../src/components/RouteSkeleton";
import { PAGE_SKELETONS } from "../src/components/skeletons/routes";

/**
 * The one loading picture before a page draws: the cockpit shell plus the
 * page's own skeleton, chosen by the address. Fictional data only; no
 * network or authentication is used.
 *
 * Run: bun test scripts/route-skeleton.test.tsx
 */

const count = (html: string, needle: string) => html.split(needle).length - 1;

const render = (path: string, element: ReactElement) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] }, element),
  );

const route = (path: string, label = "Loading the cockpit") =>
  render(path, createElement(RouteSkeleton, { label }));

const content = (path: string, label = "Loading the cockpit") =>
  render(path, createElement(ContentSkeleton, { label }));

const TestSkeleton = () => <div data-page-skeleton="test" />;

/** Register the test picture first for one check, then take it away. */
function withTestSkeleton(run: () => void) {
  PAGE_SKELETONS.unshift({ path: "/dashboard", Skeleton: TestSkeleton });
  try {
    run();
  } finally {
    PAGE_SKELETONS.shift();
  }
}

/** The real page pictures, with the name each one draws. */
const PAGE_NAMES: [string, string][] = [
  ["/dashboard", "dashboard"],
  ["/clients", "clients"],
];

describe("RouteSkeleton", () => {
  test("a public page draws its own blank page and no rail", () => {
    const html = route("/", "Loading the landing page");

    expect(html).toContain("min-h-dvh");
    expect(html).toContain("Loading the landing page");
    expect(html).not.toContain("data-sidebar");
  });

  test("a signed-in page draws the page skeleton inside the shell", () => {
    withTestSkeleton(() => {
      const html = route("/dashboard");

      expect(html).toContain('data-page-skeleton="test"');
      expect(html).toContain("data-sidebar");
    });
  });

  test("every registered page draws its own picture inside the shell", () => {
    for (const [path, name] of PAGE_NAMES) {
      expect(PAGE_SKELETONS.some(entry => entry.path === path)).toBe(true);
      const html = route(path);
      expect(html).toContain(`data-page-skeleton="${name}"`);
      expect(html).toContain("data-sidebar");
      expect(count(html, 'role="status"')).toBe(1);
    }
  });

  test("an unknown signed-in page draws the shell and the header alone", () => {
    const html = route("/zz-unknown");

    expect(html).toContain("data-sidebar");
    expect(html).not.toContain("data-page-skeleton");
  });

  test("every loading picture speaks one status and one busy flag", () => {
    withTestSkeleton(() => {
      for (const html of [
        route("/"),
        route("/dashboard"),
        route("/zz-unknown"),
      ]) {
        expect(count(html, 'role="status"')).toBe(1);
        expect(count(html, 'aria-busy="true"')).toBe(1);
      }
    });
  });
});

describe("ContentSkeleton", () => {
  test("inside the layout it draws the page skeleton without the rail", () => {
    withTestSkeleton(() => {
      const html = content("/dashboard");

      expect(html).toContain('data-page-skeleton="test"');
      expect(html).not.toContain("data-sidebar");
      expect(count(html, 'role="status"')).toBe(1);
      expect(count(html, 'aria-busy="true"')).toBe(1);
    });
  });
});

describe("theme before the first paint", () => {
  test("index.html sets dark mode before the module script runs", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );

    const toggleAt = html.indexOf('classList.toggle("dark"');
    const moduleAt = html.indexOf('type="module"');

    expect(toggleAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(-1);
    expect(toggleAt).toBeLessThan(moduleAt);
  });
});
