import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  ContentSkeleton,
  RouteSkeleton,
} from "../src/components/RouteSkeleton";
import { AdsSkeleton } from "../src/components/skeletons/AdsSkeleton";
import { CeoSkeleton } from "../src/components/skeletons/CeoSkeleton";
import { ClientsSkeleton } from "../src/components/skeletons/ClientsSkeleton";
import { PAGE_SKELETONS } from "../src/components/skeletons/routes";
import { TodaySkeleton } from "../src/components/skeletons/TodaySkeleton";

const LABEL = "Loading the cockpit";

const count = (html: string, needle: string) => html.split(needle).length - 1;

function render(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <RouteSkeleton label={LABEL} />
    </MemoryRouter>,
  );
}

function renderContent(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <ContentSkeleton label={LABEL} />
    </MemoryRouter>,
  );
}

/** Register a page picture for the length of one check, then take it away. */
function withTestSkeleton(run: () => void) {
  PAGE_SKELETONS.unshift({
    path: "/dashboard",
    Skeleton: () => <div data-page-skeleton="test" />,
  });
  try {
    run();
  } finally {
    PAGE_SKELETONS.shift();
  }
}

/** The real page pictures, in registry order, with the name each one draws. */
const PAGE_NAMES: [string, string][] = [
  ["/dashboard", "today"],
  ["/ads", "ads"],
  ["/clients", "clients"],
  ["/ceo", "ceo"],
];

afterAll(() => {
  PAGE_SKELETONS.length = 0;
});

describe("RouteSkeleton", () => {
  test("a public page shows the empty page, not the shell", () => {
    const html = render("/");
    expect(html).toContain("min-h-dvh");
    expect(html).toContain(LABEL);
    expect(html).not.toContain("data-sidebar");
  });

  test("a registered page draws its own picture inside the shell", () => {
    withTestSkeleton(() => {
      const html = render("/dashboard");
      expect(html).toContain('data-page-skeleton="test"');
      expect(html).toContain("data-sidebar");
    });
  });

  test("every registered page draws its own picture inside the shell", () => {
    for (const [path, name] of PAGE_NAMES) {
      expect(PAGE_SKELETONS.some(entry => entry.path === path)).toBe(true);
      const html = render(path);
      expect(html).toContain(`data-page-skeleton="${name}"`);
      expect(html).toContain("data-sidebar");
      expect(count(html, 'role="status"')).toBe(1);
    }
  });

  test("the shell holds the alerts row above the page", () => {
    const html = render("/dashboard");
    expect(html).toContain("tk-bell-bar");
    expect(html.indexOf("tk-bell-bar")).toBeLessThan(
      html.indexOf('data-page-skeleton="today"'),
    );
  });

  test("an unknown signed-in path draws the shell and the header only", () => {
    const html = render("/zz-unknown");
    expect(html).toContain("data-sidebar");
    expect(html).not.toContain("data-page-skeleton");
  });

  test("every picture has one polite status", () => {
    const htmls = [render("/"), render("/zz-unknown")];
    withTestSkeleton(() => {
      htmls.push(render("/dashboard"));
      htmls.push(renderContent("/dashboard"));
    });
    for (const html of htmls) {
      expect(count(html, 'role="status"')).toBe(1);
      expect(count(html, 'aria-busy="true"')).toBe(1);
    }
  });

  test("a content loading state draws the page without the shell", () => {
    withTestSkeleton(() => {
      const html = renderContent("/dashboard");
      expect(html).toContain('data-page-skeleton="test"');
      expect(html).not.toContain("data-sidebar");
    });
  });

  test("index.html sets the theme before the module script", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain('classList.toggle("dark"');
    expect(html.indexOf('classList.toggle("dark"')).toBeLessThan(
      html.indexOf('type="module"'),
    );
  });
});

describe("remembered page skeletons", () => {
  const PICTURES: { name: string; html: () => string }[] = [
    { name: "today", html: () => renderToStaticMarkup(<TodaySkeleton />) },
    { name: "ads", html: () => renderToStaticMarkup(<AdsSkeleton />) },
    { name: "clients", html: () => renderToStaticMarkup(<ClientsSkeleton />) },
    { name: "ceo", html: () => renderToStaticMarkup(<CeoSkeleton />) },
  ];

  test("a first visit draws the static page, not a replay", () => {
    for (const picture of PICTURES) {
      const html = picture.html();
      expect(html).toContain(`data-page-skeleton="${picture.name}"`);
      expect(html).not.toContain("data-remembered");
    }
  });

  test("the signed-in layout records each page's shape", () => {
    const source = readFileSync(
      new URL("../src/components/AppLayout.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<LayoutRecorder");
  });
});
