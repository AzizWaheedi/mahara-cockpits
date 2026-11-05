import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { BlueprintSettings } from "../src/components/BlueprintSettings";
import {
  LoadingSkeleton,
  type LoadingSkeletonVariant,
} from "../src/components/LoadingSkeleton";
import { NotesOpening } from "../src/components/ProtectedRoute";
import {
  fakeSettingsIO,
  MEMBERS,
  settingsFixture,
  TASK,
} from "../src/dev/blueprintFixtures";
import { BlueprintCall, startCall } from "../src/pages/BlueprintCallPage";
import { BlueprintNotes } from "../src/pages/BlueprintNotesPage";

/**
 * The content skeletons of the creative director cockpit. Every variant is
 * drawn without fake controls, values or metrics, with one spoken status and
 * one hidden group of decorative shapes, and with the layout of the content
 * it replaces. Fictional data only; no network or authentication is used.
 *
 * Run: bun test scripts/skeleton-loading.test.tsx
 */

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

const EXPECTED_LABEL: Record<LoadingSkeletonVariant, string> = {
  page: "Loading page",
  cards: "Loading cards",
  table: "Loading table",
  list: "Loading list",
  detail: "Loading details",
  form: "Loading form",
  board: "Loading board",
  media: "Loading media",
};

const count = (html: string, needle: string) => html.split(needle).length - 1;

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

describe("LoadingSkeleton variants", () => {
  for (const variant of VARIANTS) {
    test(`${variant} draws one spoken status and one hidden shape group`, () => {
      const html = render(createElement(LoadingSkeleton, { variant }));

      expect(count(html, 'role="status"')).toBe(1);
      expect(count(html, 'aria-busy="true"')).toBe(1);
      expect(count(html, 'aria-hidden="true"')).toBe(1);
      expect(count(html, 'class="sr-only"')).toBe(1);

      expect(html).toContain("motion-safe:animate-pulse");
      expect(html).toContain("bg-muted");
      expect(html).toContain("min-w-0");
      expect(html).toContain("max-w-full");
    });

    test(`${variant} has no fake controls, links or metric values`, () => {
      const html = render(createElement(LoadingSkeleton, { variant }));

      expect(html).not.toMatch(/<(button|a|input|select|textarea|form)\b/i);
      expect(html).not.toMatch(/tabindex=/i);
      expect(html).not.toMatch(/>\s*\d[\d.,]*\s*</);
      expect(html.replace(/<[^>]*>/g, "")).toBe(EXPECTED_LABEL[variant]);
    });
  }

  test("a custom label replaces the default spoken line", () => {
    const html = render(
      createElement(LoadingSkeleton, {
        variant: "table",
        label: "Loading the scripting database",
      }),
    );
    expect(html).toContain("Loading the scripting database");
    expect(html).not.toContain("Loading table");
  });

  test("each variant matches the layout it will hold", () => {
    const page = render(createElement(LoadingSkeleton, { variant: "page" }));
    expect(page).toContain("h-8 w-52");
    expect(page).toContain("sm:grid-cols-3");
    expect(page).toContain("divide-y");

    const cards = render(createElement(LoadingSkeleton, { variant: "cards" }));
    expect(cards).toContain("sm:grid-cols-2");
    expect(cards).toContain("lg:grid-cols-3");

    const table = render(createElement(LoadingSkeleton, { variant: "table" }));
    expect(table).toContain(
      "grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]",
    );
    expect(table).toContain("overflow-x-auto");

    const list = render(createElement(LoadingSkeleton, { variant: "list" }));
    expect(list).toContain("rounded-full");
    expect(list).toContain("min-w-0 flex-1");

    const detail = render(
      createElement(LoadingSkeleton, { variant: "detail" }),
    );
    expect(detail).toContain("lg:grid-cols-[minmax(0,1fr)_18rem]");

    const form = render(createElement(LoadingSkeleton, { variant: "form" }));
    expect(form).toContain("h-10 w-full");

    const board = render(createElement(LoadingSkeleton, { variant: "board" }));
    expect(board).toContain("min-w-[13rem]");
    expect(board).toContain("overflow-x-auto");

    const media = render(createElement(LoadingSkeleton, { variant: "media" }));
    expect(media).toContain("aspect-video");
  });

  test("rows are bounded and counted deterministically", () => {
    const two = render(
      createElement(LoadingSkeleton, { variant: "list", rows: 2 }),
    );
    expect(count(two, "rounded-full")).toBe(2);

    const zero = render(
      createElement(LoadingSkeleton, { variant: "list", rows: 0 }),
    );
    expect(count(zero, "rounded-full")).toBe(1);

    const huge = render(
      createElement(LoadingSkeleton, { variant: "list", rows: 9_999 }),
    );
    expect(count(huge, "rounded-full")).toBe(12);
    expect(count(huge, 'role="status"')).toBe(1);

    const broken = render(
      createElement(LoadingSkeleton, {
        variant: "list",
        rows: Number.NaN,
      }),
    );
    expect(count(broken, "rounded-full")).toBe(4);
  });
});

describe("Notes popup opening", () => {
  test("shows a full-height detail skeleton, not a text line", () => {
    const html = render(createElement(NotesOpening));

    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Opening the notes…");
    expect(html).toContain("min-h-dvh");
    expect(html).toContain("lg:grid-cols-[minmax(0,1fr)_18rem]");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("motion-safe:animate-pulse");
  });
});

const inRouter = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [`/blueprint/${TASK}`] },
      element,
    ),
  );

describe("Blueprint call content paths", () => {
  test("opening the prep speaks one status through the skeleton", () => {
    const html = inRouter(
      createElement(BlueprintCall, {
        taskId: TASK,
        rehearse: false,
        io: null,
        initial: startCall,
        initialRead: {
          row: null,
          now: new Date().toISOString(),
          at: Date.now(),
        },
        frameless: true,
      }),
    );

    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Opening the Blueprint");
    expect(html).toContain("motion-safe:animate-pulse");
  });

  test("a failed prep keeps its own error status and no loading skeleton", () => {
    const html = inRouter(
      createElement(BlueprintCall, {
        taskId: TASK,
        rehearse: false,
        io: null,
        frameless: true,
        initial: {
          ...startCall,
          stage: { kind: "failed", message: "The deck refused." },
        },
        initialRead: {
          row: null,
          now: new Date().toISOString(),
          at: Date.now(),
        },
      }),
    );

    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("The Blueprint did not open.");
    expect(html).toContain("The deck refused.");
    expect(html).not.toContain("Opening the Blueprint");
  });

  test("the notes popup opening speaks once, not twice", () => {
    const html = render(
      createElement(BlueprintNotes, {
        taskId: TASK,
        src: "https://example.test/notes",
        allowed: () => true,
      }),
    );

    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Opening the notes");
    expect(html).not.toContain("Opening the notes…");
  });
});

describe("Blueprint settings member field", () => {
  test("an unread member list shows a compact form skeleton", () => {
    const settings = settingsFixture(true);
    settings.changes = {
      ...settings.changes,
      launch_assignee: { at: "2026-11-03T12:00:00Z", by: "Omar" },
    };
    const html = render(
      createElement(BlueprintSettings, {
        io: fakeSettingsIO(settings),
        initial: { settings },
      }),
    );

    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Reading the Marketing/ADs members");
    expect(html).toContain("Set 3 Nov by Omar");
    expect(html).toContain("motion-safe:animate-pulse");
  });

  test("a read member list shows the choices and no skeleton", () => {
    const settings = settingsFixture(true);
    const html = render(
      createElement(BlueprintSettings, {
        io: fakeSettingsIO(settings),
        initial: { settings, members: MEMBERS },
      }),
    );

    expect(html).toContain("Example media buyer");
    expect(html).not.toContain("Reading the Marketing/ADs members");
    expect(count(html, 'role="status"')).toBe(0);
  });
});
