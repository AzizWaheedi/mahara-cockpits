// The demo's closer picker (2026-11-07). The CEO, verbatim: "He should also
// be able to pick the specific closer he wants to book the demo on their
// calendar for." The words and order of "Who takes the demo", the request
// bodies (byte for byte as before without the picker), the picker drawn
// with and without `closerPick`, which screens pass it (the lead page's
// Calls card never does: booking and the Calls card are frozen for the
// 8 to 12 Nov WhatsApp campaign), and the practice cockpit's fake.
//
// The app has no DOM test library (and nothing is installed for this), so
// the picker is drawn with renderToStaticMarkup (its first frame, before
// any read) and the press-to-request path is pinned through the pure
// builders it calls and the source it is written in.
//
// bun test src/components/CloserPick.test.tsx   (from apps/sales-cockpit)

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

const R = await import("../lib/reschedule");
const { CloserChoice } = await import("./CloserChoice");
const { CallPicker } = await import("./CallPicker");
const F = await import("../dev/closerFake");
const SA = "../../../../supabase/functions/sales-api";
const S = await import(`${SA}/closers.ts`);

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

// Sun 8 Nov 2026, 9:00 am Kuwait time.
const NOW = Date.parse("2026-11-08T09:00:00+03:00");
const none = () => undefined;

describe("refusalLine: not_closer", () => {
  test("the server's sentence, read again, not blocked", () => {
    const line =
      "Lina has no active closer or manager seat in the cockpit, so the demo can't go on their calendar. Pick another closer, or Anyone free.";
    expect(R.refusalLine("not_closer", line)).toEqual({
      text: line,
      tone: "warn",
      reread: true,
      blocked: false,
    });
  });
});

describe("closerChips: the choices after Anyone free", () => {
  const list: import("../lib/reschedule").CloserOption[] = [
    {
      user_id: "M",
      name: "Aziz Boss",
      kind: "manager",
      soonest: "2026-11-08T11:00:00+03:00",
      state: "ok",
    },
    {
      user_id: "U",
      name: "Hadi Saleh",
      kind: "closer",
      soonest: null,
      state: "unread",
    },
    {
      user_id: "N",
      name: "Sami Nasser",
      kind: "closer",
      soonest: null,
      state: "ok",
    },
    {
      user_id: "L",
      name: "Sami Kareem",
      kind: "closer",
      soonest: "2026-11-09T10:00:00+03:00",
      state: "ok",
    },
    {
      user_id: "S",
      name: "Omar Haddad",
      kind: "closer",
      soonest: "2026-11-08T16:30:00+03:00",
      state: "ok",
    },
  ];

  test("closers first, the soonest first, then no time, then unread; managers last", () => {
    expect(R.closerChips(list, NOW).map(c => c.user_id)).toEqual([
      "S",
      "L",
      "N",
      "U",
      "M",
    ]);
  });

  test("the words: a time, no free time, not read; same first names get a last initial", () => {
    expect(R.closerChips(list, NOW).map(c => c.label)).toEqual([
      "Omar · Today 4:30 pm",
      "Sami K. · Tomorrow 10:00 am",
      "Sami N. · no free time in 14 days",
      "Hadi · not read just now",
      "Aziz · Today 11:00 am",
    ]);
  });

  test("missing is never zero: an unread calendar is never 'no free time'", () => {
    const [c] = R.closerChips(
      [
        {
          user_id: "U",
          name: "Hadi Saleh",
          kind: "closer",
          soonest: null,
          state: "unread",
        },
      ],
      NOW,
    );
    expect(c?.state).toBe("unread");
    expect(c?.when).toBe("not read just now");
    expect(R.closerChips(null, NOW)).toEqual([]);
    expect(R.closerChips(undefined, NOW)).toEqual([]);
  });

  test("a name not set says so", () => {
    expect(
      R.closerChips(
        [
          {
            user_id: "X",
            name: null,
            kind: "closer",
            soonest: null,
            state: "ok",
          },
        ],
        NOW,
      )[0]?.first,
    ).toBe("Name not set");
  });
});

describe("the request bodies", () => {
  test("without a closer, book.slots is asked exactly as before, key for key", () => {
    expect(
      JSON.stringify(
        R.bookingAsk({ contactId: "c-1", kind: "demo", withWho: "anyone" }),
      ),
    ).toBe('{"contact_id":"c-1","kind":"demo","with":"anyone"}');
    expect(
      JSON.stringify(
        R.bookingAsk({
          contactId: "c-1",
          kind: "intro",
          withWho: "me",
          closerId: null,
        }),
      ),
    ).toBe('{"contact_id":"c-1","kind":"intro","with":"me"}');
    expect(R.closerField(null)).toEqual({});
    expect(R.closerField(undefined)).toEqual({});
  });

  test("with a closer picked, the read and the press carry closer_id", () => {
    expect(
      R.bookingAsk({
        contactId: "c-1",
        kind: "demo",
        withWho: "anyone",
        closerId: "u-omar",
      }),
    ).toEqual({
      contact_id: "c-1",
      kind: "demo",
      with: "anyone",
      closer_id: "u-omar",
    });
    expect(R.closerField("u-omar")).toEqual({ closer_id: "u-omar" });
  });

  test("no free time with a closer picked: pick another closer, or Anyone free", () => {
    expect(
      R.noTimesLine({
        mode: "book",
        host: "Omar Haddad",
        until: "up to Sat 21 Nov",
        withWho: "anyone",
        closer: true,
      }),
    ).toBe(
      "Omar has no free time up to Sat 21 Nov. Pick another closer, or Anyone free.",
    );
    // Without the picker the line is as before.
    expect(
      R.noTimesLine({
        mode: "book",
        host: null,
        until: "up to Sat 21 Nov",
        withWho: "anyone",
      }),
    ).toBe(
      "Nobody has no free time up to Sat 21 Nov. Book in HighLevel, or set a call-back in the dialer.",
    );
  });
});

describe("closerStart: who the picker starts on", () => {
  const seat = (role: string, id: string | null = "u-1") => ({
    role,
    ghl_user_id: id,
    name: "Rana Both",
  });

  test("a closer, both or manager seat: their own name; a setter: Anyone free", () => {
    for (const role of ["closer", "both", "manager"])
      expect(R.closerStart({ on: true, me: seat(role) })).toEqual({
        user_id: "u-1",
        name: "Rana Both",
      });
    expect(R.closerStart({ on: true, me: seat("setter") })).toBeNull();
  });

  test("the script's block (withDefault anyone), the picker off, or no HighLevel user: Anyone free", () => {
    expect(
      R.closerStart({ on: true, withDefault: "anyone", me: seat("closer") }),
    ).toBeNull();
    expect(R.closerStart({ on: false, me: seat("closer") })).toBeNull();
    expect(R.closerStart({ on: true, me: seat("closer", null) })).toBeNull();
    // withDefault me: their own name, whatever the role.
    expect(
      R.closerStart({ on: true, withDefault: "me", me: seat("setter") }),
    ).toEqual({ user_id: "u-1", name: "Rana Both" });
  });
});

describe("Who takes the demo, drawn", () => {
  const list: import("../lib/reschedule").CloserOption[] = [
    {
      user_id: "u-omar",
      name: "Omar Haddad",
      kind: "closer",
      soonest: "2026-11-08T16:30:00+03:00",
      state: "ok",
    },
    {
      user_id: "u-hadi",
      name: "Hadi Saleh",
      kind: "closer",
      soonest: null,
      state: "unread",
    },
  ];
  const draw = (
    l: import("../lib/reschedule").CloserOption[] | null | undefined,
    picked: string | null = null,
  ) =>
    renderToStaticMarkup(
      <CloserChoice list={l} picked={picked} now={NOW} onPick={none} />,
    );

  test("Anyone free first and pressed by default, then each closer with their soonest time", () => {
    const html = draw(list);
    expect(html).toContain('aria-label="Who takes the demo"');
    const anyone = html.indexOf("Anyone free");
    expect(anyone).toBeGreaterThan(0);
    expect(html.indexOf("Omar")).toBeGreaterThan(anyone);
    expect(html).toMatch(/aria-pressed="true"[^>]*><span[^>]*>Anyone free/);
    expect(html).toContain("· Today 4:30 pm");
    expect(html).toContain("· not read just now");
  });

  test("a picked closer is the pressed one", () => {
    const html = draw(list, "u-omar");
    expect(html).toMatch(
      /aria-pressed="true" aria-label="Omar · Today 4:30 pm"/,
    );
    expect(html).toMatch(/aria-pressed="false"[^>]*><span[^>]*>Anyone free/);
  });

  test("not read yet, not readable, and nobody listed each say so", () => {
    expect(draw(undefined)).toContain("Reading the closers&#x27; calendars…");
    expect(draw(null)).toContain(
      "The closers could not be read just now. Anyone free still works.",
    );
    expect(draw([])).toContain(
      "No closer is on the Demo calendar in HighLevel, so the calendar picks who takes it.",
    );
  });
});

describe("CallPicker: the row shows only with closerPick, on a demo booking", () => {
  const me = {
    signed_in: true,
    name: "Tara Setter",
    role: "setter" as const,
    ghl_user_id: "u-tara",
  };
  const lead = { contact_id: "lead-1", name: "Hana Al Ali", country: "KW" };
  const draw = (o: { closerPick?: boolean; kind?: "demo" | "intro" }) =>
    renderToStaticMarkup(
      <CallPicker
        me={me}
        lead={lead}
        mode="book"
        kind={o.kind ?? "demo"}
        source="dialer"
        closerPick={o.closerPick}
      />,
    );

  test("with closerPick on a demo: Who takes the demo, Anyone free pressed", () => {
    const html = draw({ closerPick: true });
    expect(html).toContain('aria-label="Who takes the demo"');
    expect(html).toMatch(/aria-pressed="true"[^>]*><span[^>]*>Anyone free/);
  });

  test("a closer, both or manager seat starts on their own name, as With me did; through the script's block, on Anyone free", () => {
    const seat = (role: "closer" | "both" | "manager") =>
      renderToStaticMarkup(
        <CallPicker
          me={{ ...me, name: "Rana Both", role, ghl_user_id: "u-rana" }}
          lead={lead}
          mode="book"
          kind="demo"
          source="dialer"
          closerPick
        />,
      );
    for (const role of ["closer", "both", "manager"] as const) {
      const html = seat(role);
      expect(html).toContain('aria-label="Who takes the demo"');
      expect(html).toMatch(/aria-pressed="false"[^>]*><span[^>]*>Anyone free/);
    }
    const script = renderToStaticMarkup(
      <CallPicker
        me={{ ...me, name: "Rana Both", role: "closer", ghl_user_id: "u-rana" }}
        lead={lead}
        mode="book"
        kind="demo"
        source="script"
        withDefault="anyone"
        closerPick
      />,
    );
    expect(script).toMatch(/aria-pressed="true"[^>]*><span[^>]*>Anyone free/);
  });

  test("without closerPick (the Calls card), or on an intro: no row", () => {
    expect(draw({})).not.toContain("Who takes the demo");
    expect(draw({ closerPick: false })).not.toContain("Who takes the demo");
    expect(draw({ closerPick: true, kind: "intro" })).not.toContain(
      "Who takes the demo",
    );
  });
});

describe("the source: who passes closerPick, and what it changes", () => {
  const picker = read("./CallPicker.tsx");
  const calls = read("./CallsCard.tsx");
  const block = read("./BookDemoBlock.tsx");
  const dialer = read("../pages/DialerPage.tsx");

  test("the lead page's Calls card never passes closerPick", () => {
    expect(calls).not.toContain("closerPick");
    expect(calls).not.toContain("closer_id");
  });

  test("the script's Book the demo block passes it on its booking picker only", () => {
    const start = block.indexOf('title="Book the demo"');
    const end = block.indexOf("/>", start);
    expect(start).toBeGreaterThan(0);
    expect(block.slice(start, end)).toMatch(/\n\s+closerPick\n/);
    const move = block.indexOf('mode="reschedule"');
    expect(block.slice(move, block.indexOf("/>", move))).not.toContain(
      "closerPick",
    );
    // The follow-up block books on the closer's own calendar, no picker.
    const follow = block.indexOf("export function FollowUpBlock");
    expect(block.slice(follow)).not.toContain("closerPick");
  });

  test("the dialer's booking panel passes it for a demo, never on a reschedule", () => {
    const panel = dialer.slice(dialer.indexOf("function DialerBooking("));
    // The booking picker's key, as written in the page: key={`book:${kind}`}.
    const bookKey = ["key={`book:", "$", "{kind}`}"].join("");
    const book = panel.slice(
      panel.indexOf(bookKey),
      panel.indexOf("/>", panel.indexOf(bookKey)),
    );
    expect(panel.indexOf(bookKey)).toBeGreaterThan(0);
    expect(book).toContain('closerPick={kind === "demo"}');
    const move = panel.slice(
      panel.indexOf("key={`move:"),
      panel.indexOf("/>", panel.indexOf("key={`move:")),
    );
    expect(move).not.toContain("closerPick");
    expect(dialer.match(/closerPick/g)).toHaveLength(1);
  });

  test("CallPicker: off by default; only a demo booking with it on sends closers or closer_id", () => {
    expect(picker).toContain("closerPick = false,");
    expect(picker).toContain(
      'const closerOn = closerPick && mode === "book" && kind === "demo";',
    );
    expect(picker).toContain(
      "const closerId = closerOn ? (closer?.user_id ?? null) : null;",
    );
    // The read: closers only with the picker on; who() names the closer picked.
    expect(picker).toContain(
      'api<Slots>("book.slots", closerOn ? { ...who(), closers: true } : who())',
    );
    expect(picker).toMatch(
      /bookingAsk\(\{\s+contactId: lead\.contact_id,\s+kind,\s+withWho,\s+closerId,\s+\}\)/,
    );
    // Picking a closer reads again: the closer is part of the read's identity.
    const deps = picker.slice(picker.indexOf("withWho,\n    closerId,\n"));
    expect(deps.startsWith("withWho,\n    closerId,\n    tick,\n  ]);")).toBe(
      true,
    );
    expect(picker).toContain("setCloser(p);");
    // The press: book.create carries the closer picked.
    const body = picker.slice(
      picker.indexOf("function bookBody("),
      picker.indexOf("async function sendMove("),
    );
    expect(body).toContain("...closerField(closerId),");
    // The "With whom" switch hides while the row shows; a server without
    // the picker (no list in its answer) shows the switch and no row.
    expect(picker).toMatch(/!holding &&\s+!closerShown \? \(\s+<Segmented/);
    expect(picker).toContain("const closerShown = closerOn && !closerAbsent;");
    expect(picker).toMatch(
      /if \("closers" in s\) setCloserList\(s\.closers \?\? null\);\s+else \{\s+setCloserAbsent\(true\);/,
    );
    // A read that fails says the closers could not be read, never "Reading…" for good.
    expect(picker).toContain(
      "if (closerOn) setCloserList(l => (l === undefined ? null : l));",
    );
    // Another closer clears the old tiles until theirs arrive.
    const pick = picker.slice(picker.indexOf("const pickCloser = "));
    expect(pick.slice(0, 200)).toContain("setSlots(null);");
  });
});

describe("the practice cockpit's closers (closerFake.ts)", () => {
  test("two closers on the Demo calendar with different soonest times, the manager after", () => {
    const days = [
      {
        day: "2026-11-08",
        slots: ["2026-11-08T10:00:00+03:00", "2026-11-08T14:00:00+03:00"],
      },
      {
        day: "2026-11-09",
        slots: ["2026-11-09T10:20:00+03:00", "2026-11-09T13:20:00+03:00"],
      },
    ];
    const list = F.closerListFake(id => F.closerDaysOf(id, days, NOW), NOW);
    expect(list.map(c => [c.user_id, c.kind, c.soonest])).toEqual([
      ["u-omar", "closer", "2026-11-08T10:00:00+03:00"],
      ["u-hadi", "closer", "2026-11-09T13:20:00+03:00"],
      ["u-aziz", "manager", "2026-11-08T10:00:00+03:00"],
    ]);
    const unread = F.closerListFake(
      id => (id === F.LATER_CLOSER ? null : days),
      NOW,
    );
    expect(unread.find(c => c.user_id === F.LATER_CLOSER)).toMatchObject({
      soonest: null,
      state: "unread",
    });
  });

  test("its refusals are sales-api's, word for word", () => {
    const people = [
      ...F.DEMO_TEAM,
      {
        user_id: "u-left",
        name: "Lina Left",
        role: "closer" as const,
        active: false,
      },
      {
        user_id: "u-out",
        name: "Omar Outside",
        role: "closer" as const,
        active: true,
      },
    ];
    const team = ["u-omar", "u-aziz", "u-hadi", "u-left"];
    const seats = people.map(p => ({
      ghl_user_id: p.user_id,
      name: p.name,
      role: p.role,
      active: p.active,
    }));
    for (const [id, kind, userId] of [
      ["u-omar", "demo", null],
      ["u-omar", "intro", null],
      ["u-out", "demo", null],
      ["u-left", "demo", null],
      ["u-hadi", "demo", "u-omar"],
      ["u-hadi", "demo", "u-hadi"],
    ] as [string, string, string | null][]) {
      expect(F.closerRefusalFake({ id, kind, userId, people, team })).toEqual(
        S.closerRefusal({ id, kind, team, seats, userId }),
      );
    }
  });
});
