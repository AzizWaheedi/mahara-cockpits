import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type ChecksApi,
  ChecksWaitingView,
} from "../src/components/billing/ChecksWaiting";
import { FormsOut } from "../src/components/ClientForms";
import { ClientMessages } from "../src/components/ClientMessages";
import { ClientVoiceCard } from "../src/components/ClientVoice";
import {
  LoadingSkeleton,
  type LoadingSkeletonVariant,
} from "../src/components/LoadingSkeleton";
import { MarketResearchCard } from "../src/components/MarketResearch";
import { RowsSkeleton } from "../src/components/results/ResultsKit";
import type { MessagesIO } from "../src/lib/clientMessages";
import { VOICE_EMPTY, type VoiceRead } from "../src/lib/clientVoice";
import { OfferVideos } from "../src/pages/money/offers/OfferVideos";
import { ProposalsCard } from "../src/pages/money/offers/proposal/ProposalsCard";
import type { OfferClient } from "../src/present/offer/sources";

/**
 * The content skeletons of the client success cockpit. Every variant is drawn
 * without fake controls, values or metrics, with one spoken status and one
 * hidden group of decorative shapes. The client voice card is also rendered
 * through its real loading, failed, empty and filled paths with fictional
 * data. No network or authentication is used.
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

const emptyVoice: VoiceRead = {
  nps: { latest: null, history: [] },
  csat: { score: null, liked: null, disliked: null, at: null },
  feedback: [],
  open: [],
  source: "",
  lowScoreMax: 6,
};

const filledVoice: VoiceRead = {
  ...emptyVoice,
  nps: {
    latest: {
      score: 8,
      results: 8,
      communication: 9,
      startStop: "Keep the weekly calls.",
      at: "2026-10-20T00:00:00Z",
      round: 1,
    },
    history: [{ score: 8, at: "2026-10-20T00:00:00Z" }],
  },
  source: "NPS survey",
};

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
        variant: "list",
        label: "Reading their asks",
      }),
    );
    expect(html).toContain("Reading their asks");
    expect(html).not.toContain("Loading list");
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

describe("Client voice card content paths", () => {
  test("loading shows the list skeleton and its label", () => {
    const html = render(
      createElement(ClientVoiceCard, { state: { status: "loading" } }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Reading their answers");
    expect(html).not.toContain(VOICE_EMPTY);
  });

  test("failed shows its note and no content skeleton", () => {
    const html = render(
      createElement(ClientVoiceCard, {
        state: { status: "failed", error: "Not now" },
      }),
    );
    expect(html).toContain('role="note"');
    expect(html).toContain("answers could not be read");
    expect(html).not.toContain('role="status"');
  });

  test("empty shows the empty sentence and no content skeleton", () => {
    const html = render(
      createElement(ClientVoiceCard, {
        state: { status: "ready", voice: emptyVoice },
      }),
    );
    expect(html).toContain("data-empty");
    expect(html).toContain(VOICE_EMPTY);
    expect(html).not.toContain('role="status"');
  });

  test("filled shows the client's own score and no content skeleton", () => {
    const html = render(
      createElement(ClientVoiceCard, {
        state: { status: "ready", voice: filledVoice },
      }),
    );
    expect(html).toContain("8");
    expect(html).not.toContain(VOICE_EMPTY);
    expect(html).not.toContain('role="status"');
  });
});

describe("Forms out content paths", () => {
  const read = {
    view: null,
    error: null,
    loading: true,
    reload: () => {},
    put: () => {},
  };

  test("an unread forms list shows its compact list skeleton", () => {
    const html = render(
      createElement(FormsOut, { io: null, read, onSend: () => {} }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Reading the forms");
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toContain("Reading the forms…");
  });

  test("a failed forms read keeps the warning and shows no skeleton", () => {
    const html = render(
      createElement(FormsOut, {
        io: null,
        read: { ...read, error: "Not now" },
        onSend: () => {},
      }),
    );
    expect(html).toContain('role="note"');
    expect(html).toContain("could not be read");
    expect(html).not.toContain('role="status"');
  });
});

describe("Market research card content paths", () => {
  test("an unread card shows a card skeleton, not a text line", () => {
    const html = render(
      createElement(MarketResearchCard, {
        client: null,
        taskId: "fixture-client",
      }),
    );
    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Reading the market research");
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toContain("Loading market research…");
  });
});

describe("Offer video form content paths", () => {
  test("an unread form shows one form skeleton", () => {
    const html = render(
      createElement(OfferVideos, {
        client: {} as OfferClient,
        isCeo: false,
      }),
    );
    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Reading recordings");
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toContain("Reading recordings…");
  });
});

describe("Checks waiting content paths", () => {
  const api = {
    door: async () => true,
    list: async () => [],
    check: async () => ({
      id: "fixture",
      state: "checked",
      sentence: "Checked.",
    }),
    ticketType: async () => false,
    receiptUrl: async () => "https://example.test/receipt",
  } as unknown as ChecksApi;

  test("an unread list shows one list skeleton", () => {
    const html = render(
      createElement(ChecksWaitingView, { api, canCheck: true }),
    );
    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Loading the payments waiting on a check");
    expect(html).toContain("motion-safe:animate-pulse");
  });
});

describe("Proposals card content paths", () => {
  test("an unread list shows one list skeleton", () => {
    const html = render(
      createElement(ProposalsCard, { taskId: "fixture-client" }),
    );
    expect(count(html, 'role="status"')).toBe(1);
    expect(html).toContain("Loading proposals");
  });
});

describe("Messages card content paths", () => {
  test("the first read speaks once and leaves no empty action region", () => {
    const html = render(
      createElement(ClientMessages, {
        taskId: "fixture-client",
        native: true,
        io: {} as MessagesIO,
      }),
    );
    expect(count(html, 'role="status"')).toBe(1);
    expect(count(html, 'aria-live="polite"')).toBe(0);
    expect(html).toContain("Reading the messages");
  });
});

describe("Results rows skeleton", () => {
  test("has one spoken status and hides its decorative rows", () => {
    const html = render(
      createElement(RowsSkeleton, {
        rows: 2,
        label: "Reading the results",
      }),
    );
    expect(count(html, 'role="status"')).toBe(1);
    expect(count(html, 'aria-busy="true"')).toBe(1);
    expect(count(html, 'aria-hidden="true"')).toBe(1);
    expect(html).toContain("Reading the results");
    expect(count(html, "motion-safe:animate-pulse")).toBe(2);
  });
});
