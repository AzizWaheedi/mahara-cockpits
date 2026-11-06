import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  ContentSkeleton,
  RouteSkeleton,
} from "../src/components/RouteSkeleton";
import { ClientsSkeleton } from "../src/components/skeletons/ClientsSkeleton";
import { InboxSkeleton } from "../src/components/skeletons/InboxSkeleton";
import { PAGE_SKELETONS } from "../src/components/skeletons/routes";
import { TodaySkeleton } from "../src/components/skeletons/TodaySkeleton";

/**
 * The loading pictures before a page draws itself: one app shell mirror and
 * the page's own skeleton, chosen by the address. The theme is set before
 * the first paint. Synthetic only; nothing is sent anywhere.
 *
 * Run: bun test scripts/route-skeleton.test.tsx
 */

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
  ["/dashboard", "today"],
  ["/clients", "clients"],
  ["/inbox", "inbox"],
];

const render = (path: string, node: ReactNode) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>,
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("RouteSkeleton", () => {
  test("a public page draws only the page background", () => {
    const html = render("/", <RouteSkeleton label="Opening the cockpit" />);
    expect(html).toContain("min-h-dvh");
    expect(html).toContain("Opening the cockpit");
    expect(html).not.toContain("data-sidebar");
  });

  test("a known page draws its own skeleton inside the shell", () => {
    withTestSkeleton(() => {
      const html = render(
        "/dashboard",
        <RouteSkeleton label="Opening the cockpit" />,
      );
      expect(html).toContain('data-page-skeleton="test"');
      expect(html).toContain("data-sidebar");
    });
  });

  test("every registered page draws its own picture inside the shell", () => {
    for (const [path, name] of PAGE_NAMES) {
      expect(PAGE_SKELETONS.some(entry => entry.path === path)).toBe(true);
      const html = render(path, <RouteSkeleton label="Opening the cockpit" />);
      expect(html).toContain(`data-page-skeleton="${name}"`);
      expect(html).toContain("data-sidebar");
      expect(count(html, 'role="status"')).toBe(1);
    }
  });

  test("an unknown signed-in page draws the shell and the header", () => {
    const html = render(
      "/zz-unknown",
      <RouteSkeleton label="Opening the cockpit" />,
    );
    expect(html).toContain("data-sidebar");
    expect(html).not.toContain("data-page-skeleton");
    expect(html).toContain("h-8 w-48");
  });

  test("every render speaks once", () => {
    withTestSkeleton(() => {
      const renders = [
        render("/", <RouteSkeleton label="Opening the cockpit" />),
        render("/dashboard", <RouteSkeleton label="Opening the cockpit" />),
        render("/zz-unknown", <RouteSkeleton label="Opening the cockpit" />),
        render("/dashboard", <ContentSkeleton label="Opening the cockpit" />),
      ];
      for (const html of renders) {
        expect(count(html, 'role="status"')).toBe(1);
        expect(count(html, 'aria-busy="true"')).toBe(1);
      }
    });
  });
});

describe("ContentSkeleton", () => {
  test("a known page draws its own skeleton without the shell", () => {
    withTestSkeleton(() => {
      const html = render(
        "/dashboard",
        <ContentSkeleton label="Opening the cockpit" />,
      );
      expect(html).toContain('data-page-skeleton="test"');
      expect(html).not.toContain("data-sidebar");
    });
  });
});

describe("Remembered layout", () => {
  const WRAPPED: [string, () => ReactNode][] = [
    ["today", () => <TodaySkeleton />],
    ["clients", () => <ClientsSkeleton />],
    ["inbox", () => <InboxSkeleton />],
  ];

  test("each wrapped skeleton falls back to its full picture", () => {
    for (const [name, make] of WRAPPED) {
      const html = renderToStaticMarkup(make());
      expect(html).toContain(`data-page-skeleton="${name}"`);
      expect(html).not.toContain("data-remembered");
    }
  });

  test("the signed-in layout records the page shape", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "components", "AppLayout.tsx"),
      "utf8",
    );
    expect(source).toContain("<LayoutRecorder");
  });
});

describe("index.html", () => {
  test("sets the theme before the first paint", () => {
    const html = readFileSync(
      join(import.meta.dir, "..", "index.html"),
      "utf8",
    );
    const theme = html.indexOf('classList.toggle("dark"');
    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(html.indexOf('type="module"'));
  });
});
