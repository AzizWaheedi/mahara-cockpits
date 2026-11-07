// Did the intro now, fix pass (2026-11-07): the script's Book the demo on a
// confirmation call advises Did the intro now first (fix pass 2: above the
// picker, which still books; it used to replace it), the held button and
// its words show only to someone who may mark the intro, a demo's
// confirmation held on video is not called "Did the intro now", and the
// lead's calls are read again after the mark. The call page's block and the
// lead page's Calls card are unchanged.
//
// The app has no DOM test library, so the block is drawn with
// renderToStaticMarkup (its first frame) and the page's wiring is read from
// the source, as CloserPick.test.tsx does.
//
// bun test src/components/HeldFirst.test.tsx   (from apps/sales-cockpit)

import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

// The Supabase client needs the build's settings; nothing here reaches it.
mock.module("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const U = await import("../lib/dialerUi");
const { BookDemoBlock } = await import("./BookDemoBlock");

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

const MIN = 60_000;
// Sun 8 Nov 2026, 9:00 am Kuwait time.
const NOW = Date.parse("2026-11-08T09:00:00+03:00");
const at = (ms: number) => new Date(NOW + ms).toISOString();

const confirmItem = (type: "intro" | "demo", startIn: number) => ({
  kind: "confirm" as const,
  appointment: {
    id: "a1",
    type,
    start_at: at(startIn),
    booked_at: at(-24 * 60 * MIN),
    assigned_user_id: "u-tara",
    confirmed: false,
  },
});

describe("introHeldFirst: when the script's Book the demo advises Did the intro now", () => {
  const row = (o: Record<string, unknown> = {}) => ({
    appointment_id: "a1",
    start_at: at(150 * MIN),
    status: "confirmed",
    marked_status: null,
    ...o,
  });

  test("an intro's confirmation call, the intro unmarked and 2.5 hours ahead: it advises", () => {
    expect(
      U.introHeldFirst(confirmItem("intro", 150 * MIN), [row()], NOW, true),
    ).toEqual({ appointment_id: "a1", start_at: at(150 * MIN) });
    // The lead's calls not read yet: the item's own time.
    expect(
      U.introHeldFirst(confirmItem("intro", 150 * MIN), [], NOW, true)
        ?.start_at,
    ).toBe(at(150 * MIN));
  });

  test("a seat that may not mark the intro (not its host, not a manager): no advice", () => {
    expect(
      U.introHeldFirst(confirmItem("intro", 150 * MIN), [row()], NOW, false),
    ).toBeNull();
    // The page passes mayMarkCall with the intro's host.
    const dialer = read("../pages/DialerPage.tsx");
    expect(dialer).toMatch(
      /heldFirst=\{introHeldFirst\(\s+item,\s+appointments,\s+Date\.now\(\),\s+mayMarkCall\(me, item\?\.appointment\?\.assigned_user_id\),\s+\)\}/,
    );
  });

  test("marked already, ten minutes away or less, a demo's confirmation, or not a confirmation: it books as before", () => {
    const item = confirmItem("intro", 150 * MIN);
    expect(
      U.introHeldFirst(item, [row({ marked_status: "showed" })], NOW, true),
    ).toBeNull();
    expect(
      U.introHeldFirst(item, [row({ status: "showed" })], NOW, true),
    ).toBeNull();
    expect(
      U.introHeldFirst(item, [row({ status: "cancelled" })], NOW, true),
    ).toBeNull();
    expect(
      U.introHeldFirst(
        confirmItem("intro", 10 * MIN),
        [row({ start_at: at(10 * MIN) })],
        NOW,
        true,
      ),
    ).toBeNull();
    expect(
      U.introHeldFirst(confirmItem("demo", 150 * MIN), [row()], NOW, true),
    ).toBeNull();
    expect(
      U.introHeldFirst(
        { ...confirmItem("intro", 150 * MIN), kind: "intro" },
        [row()],
        NOW,
        true,
      ),
    ).toBeNull();
    expect(U.introHeldFirst(null, [row()], NOW, true)).toBeNull();
  });
});

describe("the script's Book the demo block with heldFirst", () => {
  const me = {
    signed_in: true,
    name: "Tara Setter",
    role: "setter" as const,
    ghl_user_id: "u-tara",
  };
  const lead = {
    contact_id: "lead-1",
    name: "Hana Al Ali",
    country: "KW",
  } as unknown as import("../lib/types").Lead;
  const draw = (heldFirst?: { start_at: string | null } | null) =>
    renderToStaticMarkup(
      <BookDemoBlock
        me={me}
        as="setter"
        lead={lead}
        appointments={[]}
        values={{}}
        attemptId="att-1"
        since={NOW}
        heldFirst={heldFirst}
        onSlots={() => undefined}
        onBooked={() => undefined}
      />,
    );

  test("advises Did the intro now above the picker; the picker, with its closer choice, still books", () => {
    const html = draw({ start_at: "2026-11-08T11:30:00+03:00" });
    expect(html).toContain("Did the intro on this call?");
    expect(html).toContain("Press Did the intro now under");
    expect(html).toContain("Are they coming?");
    expect(html).toContain("so the intro counts as held");
    expect(html).toContain(
      "Or book the demo now and mark the intro at its time",
    );
    expect(html).toContain("11:30");
    // Booking is never blocked (fix pass 2): the picker is drawn under it.
    expect(html).toContain("Book the demo");
    expect(html).toContain("Who takes the demo");
    expect(html).toContain("Anyone free");
    expect(html).toContain("<button");
    expect(html.indexOf("Did the intro on this call?")).toBeLessThan(
      html.indexOf("Who takes the demo"),
    );
    expect(html).not.toContain("Do the intro first");
    // No time known: the line still reads whole.
    expect(draw({ start_at: null })).toContain("mark the intro at its time.");
  });

  test("unset (the call page), the block books as before, with no line", () => {
    for (const html of [draw(), draw(null)]) {
      expect(html).not.toContain("Did the intro on this call?");
      expect(html).toContain("Who takes the demo");
    }
  });

  test("the block never returns early on heldFirst: one return draws the picker", () => {
    const src = read("./BookDemoBlock.tsx");
    expect(src).not.toMatch(/if \(heldFirst && !bookedHere\)\s+return/);
    expect(src).toContain("{heldFirst && !bookedHere ? (");
  });

  test("only the dialer sets it: the call page and the Calls card never do", () => {
    expect(read("../pages/CallPage.tsx")).not.toContain("heldFirst");
    expect(read("./CallsCard.tsx")).not.toContain("heldFirst");
    const dialer = read("../pages/DialerPage.tsx");
    expect(dialer).toMatch(/heldFirst=\{introHeldFirst\(\s+item,/);
    const runner = read("./ScriptRunner.tsx");
    expect(runner).toContain("heldFirst = null,");
    expect(runner).toContain("heldFirst={heldFirst}");
  });
});

describe("the held button shows only to someone who may mark the intro", () => {
  test("its host or a manager; anyone else, or an intro with no host, not", () => {
    expect(U.mayMarkCall({ ghl_user_id: "u-tara" }, "u-tara")).toBe(true);
    expect(U.mayMarkCall({ manager: true, ghl_user_id: "u-boss" }, "u-x")).toBe(
      true,
    );
    expect(U.mayMarkCall({ manager: true }, null)).toBe(true);
    expect(U.mayMarkCall({ ghl_user_id: "u-tara" }, "u-other")).toBe(false);
    expect(U.mayMarkCall({ ghl_user_id: "u-tara" }, null)).toBe(false);
    expect(U.mayMarkCall({ ghl_user_id: null }, null)).toBe(false);
  });

  test("the grid drops Did the intro now when it may not; every other button stays", () => {
    expect(U.outcomeOffered("confirm", "showed", "intro", false)).toBe(false);
    expect(U.outcomeOffered("confirm", "showed", "intro", true)).toBe(true);
    expect(U.outcomeOffered("confirm", "showed", "intro")).toBe(true);
    expect(U.outcomeOffered("confirm", "confirmed", "intro", false)).toBe(true);
    expect(U.outcomeOffered("intro", "showed", "intro", false)).toBe(true);
    const page = read("../pages/DialerPage.tsx");
    expect(page).toMatch(
      /outcomeOffered\(\s+kind,\s+o\.key,\s+appt\?\.type,\s+mayMarkCall\(me, appt\?\.assigned_user_id\),\s+\)/,
    );
  });
});

describe("after the save", () => {
  const page = read("../pages/DialerPage.tsx");

  test("a demo's confirmation held on video says so, not Did the intro now", () => {
    expect(page).toMatch(
      /kind === "confirm" && outcome === "showed" && appt\?\.type === "demo"\s+\? "Held on video"/,
    );
  });

  test("Did the intro now reads the lead's calls again, so the lead pane shows it held", () => {
    const held = page.slice(page.indexOf('if (next === "held") {'));
    expect(held.slice(0, 400)).toContain(
      'if (kind === "confirm") onCallsChanged?.();',
    );
  });
});
