import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FunnelSplit } from "../src/components/FunnelSplit";
import {
  LoadingSkeleton,
  type LoadingSkeletonVariant,
} from "../src/components/LoadingSkeleton";
import { PagePreview } from "../src/components/pageform/PageFormParts";
import type { PageFormSpec } from "../src/lib/pageForm";

const VARIANTS: LoadingSkeletonVariant[] = [
  "page",
  "cards",
  "table",
  "list",
  "detail",
  "form",
  "board",
  "media",
];

const render = (variant: LoadingSkeletonVariant) =>
  renderToStaticMarkup(
    <LoadingSkeleton variant={variant} label="Loading the numbers" rows={4} />,
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("LoadingSkeleton", () => {
  test("every variant renders one status wrapper and one label", () => {
    for (const variant of VARIANTS) {
      const html = render(variant);
      expect(count(html, "<div")).toBeGreaterThan(0);
      expect(count(html, 'role="status"')).toBe(1);
      expect(count(html, 'aria-busy="true"')).toBe(1);
      expect(count(html, 'class="sr-only"')).toBe(1);
      expect(html).toContain("Loading the numbers");
    }
  });

  test("the default label is used and rows default to four", () => {
    const html = renderToStaticMarkup(<LoadingSkeleton />);
    expect(html).toContain("Loading content");
    expect(count(html, "motion-safe:animate-pulse")).toBeGreaterThan(4);
  });

  test("all shapes sit behind one aria-hidden decorative layer", () => {
    for (const variant of VARIANTS) {
      const html = render(variant);
      expect(count(html, 'aria-hidden="true"')).toBe(1);
      const hidden = html.slice(html.indexOf('aria-hidden="true"'));
      expect(count(hidden, "motion-safe:animate-pulse")).toBeGreaterThan(0);
      // The label is outside that decorative layer.
      expect(hidden).not.toContain("Loading the numbers");
    }
  });

  test("no fake interactive controls or metric values are rendered", () => {
    for (const variant of VARIANTS) {
      const html = render(variant);
      expect(html).not.toMatch(/<(button|a|input|select|textarea|form)\b/i);
      expect(html).not.toContain("href=");
      expect(html).not.toContain("tabindex");
      expect(html).not.toContain("aria-pressed");
      expect(html).not.toMatch(/\$\d/);
      expect(html).not.toMatch(/[0-9]+%/);
    }
  });

  test("every variant uses neutral muted blocks and safe motion", () => {
    for (const variant of VARIANTS) {
      const html = render(variant);
      expect(html).toContain("bg-muted");
      expect(html).toContain("motion-safe:animate-pulse");
      expect(html).not.toContain("bg-primary");
      expect(html).not.toMatch(/(^|[\s"])animate-pulse/);
      expect(html).not.toContain("shimmer");
      expect(html).not.toContain("linear-gradient");
    }
  });

  test("widths stay bounded and mobile-safe", () => {
    for (const variant of VARIANTS) {
      const html = render(variant);
      expect(html).toContain("min-w-0");
      expect(html).toContain("max-w-full");
      expect(html).not.toContain("w-screen");
      expect(html).not.toContain("min-w-[100vw]");
    }
  });

  test("rows controls how many repeated shapes are drawn", () => {
    for (const variant of [
      "cards",
      "table",
      "list",
      "form",
      "detail",
    ] as const) {
      const two = renderToStaticMarkup(
        <LoadingSkeleton variant={variant} rows={2} />,
      );
      const six = renderToStaticMarkup(
        <LoadingSkeleton variant={variant} rows={6} />,
      );
      expect(count(six, "motion-safe:animate-pulse")).toBeGreaterThan(
        count(two, "motion-safe:animate-pulse"),
      );
    }
  });

  test("media keeps its 16:9 frame and caption", () => {
    const html = renderToStaticMarkup(<LoadingSkeleton variant="media" />);
    expect(html).toContain("aspect-video");
    expect(count(html, "motion-safe:animate-pulse")).toBeGreaterThanOrEqual(3);
  });

  test("the caller's className extends the status wrapper", () => {
    const html = renderToStaticMarkup(
      <LoadingSkeleton variant="list" className="mt-4" />,
    );
    expect(html).toContain("mt-4");
  });
});

/** A content region's one polite status, with its decorative shapes. */
function expectContentSkeleton(html: string, label: string) {
  expect(count(html, 'role="status"')).toBe(1);
  expect(count(html, 'aria-busy="true"')).toBe(1);
  expect(count(html, 'aria-hidden="true"')).toBe(1);
  expect(html).toContain(label);
  expect(html).toContain("motion-safe:animate-pulse");
}

describe("initial content branches", () => {
  test("FunnelSplit reads each campaign's funnel with a skeleton", () => {
    const html = renderToStaticMarkup(
      <FunnelSplit lines={[]} loading error={null} />,
    );
    expectContentSkeleton(html, "Reading each campaign");
    expect(html).not.toContain("Reading each campaign's funnel…");
    expect(html).not.toContain("No campaign spent");
  });

  test("PagePreview fills the phone while the page loads", () => {
    const html = renderToStaticMarkup(
      <PagePreview
        siteUrl="https://example.com"
        spec={{ version: "preview" } as PageFormSpec}
        screen={0}
      />,
    );
    expectContentSkeleton(html, "Loading the page");
    expect(html).not.toContain("Loading the page…");
  });
});
