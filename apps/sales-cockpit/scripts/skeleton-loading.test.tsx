/**
 * The sales cockpit's loading placeholders. Rendered on the server: nothing
 * here signs in, reads a database or reaches the network.
 *
 * bun test scripts/skeleton-loading.test.tsx
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  LoadingSkeleton,
  type LoadingSkeletonProps,
} from "../src/components/LoadingSkeleton";
import { NumbersBoard } from "../src/components/NumbersBoard";
import { NumbersDials } from "../src/components/NumbersDials";
import type { BoardRow } from "../src/lib/types";

const VARIANTS: LoadingSkeletonProps["variant"][] = [
  "page",
  "cards",
  "table",
  "list",
  "detail",
  "form",
  "board",
  "media",
  "inline",
  "tiles",
];

function renderSkeleton(props: LoadingSkeletonProps = {}): string {
  return renderToStaticMarkup(createElement(LoadingSkeleton, props));
}

describe("LoadingSkeleton", () => {
  for (const variant of VARIANTS) {
    test(`${variant} is one announced, decorative placeholder`, () => {
      const html = renderSkeleton({
        variant,
        label: `Loading ${variant}`,
        rows: 3,
      });

      expect(html.match(/role="status"/g)?.length).toBe(1);
      expect(html).toContain('aria-busy="true"');
      expect(html.match(/class="sr-only"/g)?.length).toBe(1);
      expect(html).toContain(`Loading ${variant}`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("motion-safe:animate-pulse");
      expect(html).toContain("bg-muted");
      expect(html).toContain("min-w-0");
      expect(html).toContain("max-w-full");
      expect(html).not.toContain("bg-primary");
      expect(html).not.toContain("animate-shimmer");
    });
  }

  test("draws no button, link, field or made-up value", () => {
    const html = renderSkeleton({ variant: "page", rows: 2 });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<textarea");
    expect(html).not.toMatch(/\b\d+%/);
  });

  test("keeps a caller's width and rows bounded", () => {
    const html = renderSkeleton({
      variant: "list",
      rows: 999,
      className: "w-full",
    });
    expect(html).toContain("w-full");
    expect(html.match(/rounded-full/g)?.length).toBeGreaterThanOrEqual(1);
  });

  test("clamps rows to twelve at the top and one at the bottom", () => {
    const many = renderSkeleton({ variant: "list", rows: 999 });
    const none = renderSkeleton({ variant: "list", rows: 0 });
    expect(many.match(/size-9/g)?.length).toBe(12);
    expect(none.match(/size-9/g)?.length).toBe(1);
  });

  test("a compact inline wait is one short line", () => {
    const html = renderSkeleton({ variant: "inline" });
    expect(html).toContain('role="status"');
    expect(html).toContain("h-5 w-36");
    expect(html).not.toContain("size-9");
  });

  test("tiles draw the four metrics the loaded cards show", () => {
    const html = renderSkeleton({ variant: "tiles", rows: 4 });
    expect(html.match(/h-20/g)?.length).toBe(4);
  });
});

describe("NumbersDials initial paths", () => {
  const base = {
    speed: null,
    gaps: null,
    stats: null,
    rows: 0,
    loading: false,
    error: null,
    reload: () => {},
    hasMaqsam: true,
    team: false,
    self: true,
  };

  function render(props: Partial<typeof base> = {}): string {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(NumbersDials, { ...base, ...props }),
      ),
    );
  }

  test("a pending read is a skeleton, not a zero", () => {
    const html = render({ loading: true });
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading the dials");
    expect(html).not.toContain("Outbound dials");
  });

  test("an error stays an error", () => {
    const html = render({ error: "offline" });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("could not be read");
  });

  test("a seat without Maqsam keeps its empty state", () => {
    const html = render({ hasMaqsam: false });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("No Maqsam email");
  });

  test("a finished read shows the numbers", () => {
    const html = render({
      stats: { outbound: 12, connected: 7, talkSeconds: 900, inbound: 3 },
    });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Outbound dials");
    expect(html).toContain("12");
  });

  test("a refresh keeps the last numbers on screen", () => {
    const html = render({
      stats: { outbound: 12, connected: 7, talkSeconds: 900, inbound: 3 },
      loading: true,
    });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Outbound dials");
    expect(html).toContain("12");
  });

  test("a settled empty read says so without waiting forever", () => {
    const html = render({ stats: null, loading: false });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("No calls read yet.");
  });

  test("a failure outranks a pending read", () => {
    const html = render({ error: "offline", loading: true });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("could not be read");
  });

  test("the team keeps its dials without a seat Maqsam email", () => {
    const html = render({
      team: true,
      hasMaqsam: false,
      stats: { outbound: 12, connected: 7, talkSeconds: 900, inbound: 3 },
    });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Outbound dials");
  });
});

describe("NumbersBoard initial paths", () => {
  const ROW: BoardRow = {
    window_key: "week",
    person_key: "rep-1",
    display_name: "Fictional Rep",
    role: "setter",
    from_day: "2026-11-01",
    to_day: "2026-11-07",
    show_rate: 0.5,
    noshow_rate: 0.1,
    disqualified_rate: 0.1,
    qualified_rate: 0.4,
    qualified_close_rate: 0.2,
    close_rate: 0.1,
    has_calls: true,
    computed_at: "2026-11-04T08:00:00.000Z",
  };

  function renderBoard(
    props: Partial<{
      rows: BoardRow[] | null;
      error: string | null;
      loading: boolean;
    }> = {},
  ): string {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(NumbersBoard, {
          rows: null,
          error: null,
          reload: () => {},
          loading: false,
          mine: null,
          ...props,
        }),
      ),
    );
  }

  test("a pending first read is a table skeleton, not an empty board", () => {
    const html = renderBoard({ rows: null, loading: true });
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading the board");
    expect(html).not.toContain("Nobody has calls");
  });

  test("a refresh with rows keeps the board on screen", () => {
    const html = renderBoard({ rows: [ROW], loading: true });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Fictional Rep");
  });

  test("a settled empty read keeps its empty state", () => {
    const html = renderBoard({ rows: [], loading: false });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Nobody has calls in this window yet");
  });

  test("a failure outranks a pending read", () => {
    const html = renderBoard({ error: "offline", loading: true });
    expect(html).not.toContain('role="status"');
    expect(html).toContain("could not be read");
  });
});
