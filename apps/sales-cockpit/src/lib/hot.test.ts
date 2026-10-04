// bun test src/lib/hot.test.ts
import { describe, expect, test } from "bun:test";
import {
  amountText,
  DEFAULT_SORT,
  dueOf,
  followUpPicks,
  followUpWords,
  type HotRow,
  heatOf,
  hotCounts,
  isOpen,
  keepOrder,
  lastFollowUp,
  mergeHot,
  newerRow,
  nextSort,
  parseAmount,
  type SortContext,
  sortHot,
  statusOf,
  touchesFrom,
} from "./hot";

// Sunday 27 September 2026, 12:00 in Kuwait.
const NOW = Date.parse("2026-09-27T09:00:00Z");
const H = 3_600_000;
const D = 24 * H;
const iso = (t: number) => new Date(t).toISOString();

const row = (id: string, over: Partial<HotRow> = {}): HotRow => ({
  contact_id: id,
  owner_email: "sara@x.com",
  next_at: null,
  next_how: null,
  last_objection: null,
  note: null,
  heat: "hot",
  status: "nurturing",
  amount: null,
  amount_currency: "USD",
  last_fu_at: null,
  added_by: "sara@x.com",
  added_at: iso(NOW - 5 * D),
  updated_at: iso(NOW - D),
  removed_at: null,
  ...over,
});

describe("a row from before the sheet's columns", () => {
  test("reads as hot and nurturing", () => {
    const old = row("a", { heat: undefined, status: undefined });
    expect(heatOf(old)).toBe("hot");
    expect(statusOf(old)).toBe("nurturing");
    expect(isOpen(old)).toBe(true);
    expect(heatOf(row("b", { heat: null }))).toBe("hot");
  });
  test("closed and lost are not open", () => {
    expect(isOpen(row("a", { status: "closed" }))).toBe(false);
    expect(isOpen(row("a", { status: "lost" }))).toBe(false);
  });
});

describe("the amount", () => {
  test("shown as money, and never as zero when none is said", () => {
    expect(amountText(row("a", { amount: 5000 }))).toBe("$5,000");
    expect(amountText(row("a", { amount: "12000.00" }))).toBe("$12,000");
    expect(amountText(row("a", { amount: 0 }))).toBe("$0");
    expect(amountText(row("a", { amount: null }))).toBeNull();
    expect(
      amountText(row("a", { amount: 1500, amount_currency: "KWD" })),
    ).toContain("1,500");
    expect(amountText(row("a", { amount: 700, amount_currency: null }))).toBe(
      "$700",
    );
  });
  test("typed the way people type it", () => {
    expect(parseAmount("5000")).toBe(5000);
    expect(parseAmount("5,000")).toBe(5000);
    expect(parseAmount(" $5,000 ")).toBe(5000);
    expect(parseAmount("KWD 1500")).toBe(1500);
    expect(parseAmount("5k")).toBe(5000);
    expect(parseAmount("1.2M")).toBe(1_200_000);
    expect(parseAmount("2500.5")).toBe(2500.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("five")).toBeNaN();
    expect(parseAmount("-100")).toBeNaN();
    expect(parseAmount("5k5")).toBeNaN();
  });
});

describe("the last follow-up", () => {
  const leads = [
    { contact_id: "a", phone8: "11112222" },
    { contact_id: "b", phone8: "33334444" },
    { contact_id: "c", phone8: null },
  ];
  test("the latest of a mark, a call and a WhatsApp, saying which", () => {
    const t = { call: { at: NOW - 2 * D, answered: false }, whatsapp: NOW - D };
    expect(lastFollowUp(iso(NOW - 3 * D), t)).toEqual({
      at: NOW - D,
      by: "whatsapp",
    });
    expect(lastFollowUp(iso(NOW - H), t)).toEqual({
      at: NOW - H,
      by: "marked",
    });
    expect(lastFollowUp(null, { call: t.call, whatsapp: null })).toEqual({
      at: NOW - 2 * D,
      by: "call",
    });
  });
  test("a tie goes to the one marked by hand", () => {
    expect(
      lastFollowUp(iso(NOW - D), {
        call: { at: NOW - D, answered: true },
        whatsapp: null,
      })?.by,
    ).toBe("marked");
  });
  test("none is none, never a made-up date", () => {
    expect(lastFollowUp(null, undefined)).toBeNull();
    expect(lastFollowUp(null, { call: null, whatsapp: null })).toBeNull();
    expect(lastFollowUp("not a date", null)).toBeNull();
  });
  test("calls: outbound only, the lead's own, or unlinked ones on their digits", () => {
    const t = touchesFrom(
      leads,
      [
        {
          contact_id: "a",
          lead_phone8: "11112222",
          occurred_at: iso(NOW - 5 * D),
          state: "completed",
          direction: "outbound",
        },
        {
          contact_id: "a",
          lead_phone8: "11112222",
          occurred_at: iso(NOW - 2 * D),
          state: "no_answer",
          direction: "outbound",
        },
        // Their own call to us is not our follow-up.
        {
          contact_id: "a",
          lead_phone8: "11112222",
          occurred_at: iso(NOW - H),
          state: "completed",
          direction: "inbound",
        },
        // Not linked to a lead yet: counts for the lead with those digits.
        {
          contact_id: null,
          lead_phone8: "33334444",
          occurred_at: iso(NOW - 3 * H),
          state: "completed",
          direction: "outbound",
        },
        // Linked to another lead that shares b's digits: never b's.
        {
          contact_id: "zz",
          lead_phone8: "33334444",
          occurred_at: iso(NOW - H),
          state: "completed",
          direction: "outbound",
        },
      ],
      [],
      [],
    );
    expect(t.get("a")?.call).toEqual({ at: NOW - 2 * D, answered: false });
    expect(t.get("b")?.call).toEqual({ at: NOW - 3 * H, answered: true });
    expect(t.get("c")).toBeUndefined();
    expect(t.has("zz")).toBe(false);
  });
  test("WhatsApp: the cockpit's sends and a conversation that ends with ours", () => {
    const t = touchesFrom(
      leads,
      [],
      [
        {
          contact_id: "a",
          last_message_at: iso(NOW - 4 * H),
          last_direction: "outbound",
          last_type: "TYPE_WHATSAPP",
        },
        // Their reply is not our follow-up; an email is not WhatsApp.
        {
          contact_id: "b",
          last_message_at: iso(NOW - H),
          last_direction: "inbound",
          last_type: "TYPE_WHATSAPP",
        },
        {
          contact_id: "c",
          last_message_at: iso(NOW - H),
          last_direction: "outbound",
          last_type: "TYPE_EMAIL",
        },
      ],
      [
        {
          contact_id: "a",
          created_at: iso(NOW - 6 * H),
          channel: "whatsapp",
          state: "read",
        },
        {
          contact_id: "b",
          created_at: iso(NOW - 2 * H),
          channel: "whatsapp",
          state: "delivered",
        },
        // A send that failed never reached them.
        {
          contact_id: "c",
          created_at: iso(NOW - H),
          channel: "whatsapp",
          state: "failed",
        },
        {
          contact_id: "c",
          created_at: iso(NOW - H),
          channel: "email",
          state: "sent",
        },
      ],
    );
    expect(t.get("a")?.whatsapp).toBe(NOW - 4 * H);
    expect(t.get("b")?.whatsapp).toBe(NOW - 2 * H);
    expect(t.get("c")).toBeUndefined();
  });
  test("the hover says each source, even the empty ones", () => {
    const words = followUpWords(
      null,
      { call: { at: NOW - D, answered: false }, whatsapp: null },
      false,
      NOW,
    );
    expect(words).toContain("None marked by hand");
    expect(words).toContain("Last call: Yesterday");
    expect(words).toContain("not answered");
    expect(words).toContain("No WhatsApp from us seen");
    expect(followUpWords(null, undefined, true, NOW)).toContain(
      "could not be read",
    );
  });
});

describe("the next follow-up", () => {
  test("overdue once its time has come, today while still ahead today", () => {
    expect(dueOf(iso(NOW - 60_000), NOW)).toBe("overdue");
    expect(dueOf(iso(NOW), NOW)).toBe("overdue");
    expect(dueOf(iso(NOW + 3 * H), NOW)).toBe("today");
    // 00:30 tomorrow in Kuwait is not today.
    expect(dueOf("2026-09-27T21:30:00Z", NOW)).toBe("later");
    expect(dueOf(null, NOW)).toBeNull();
  });
  test("one-tap dates at 10:00 Kuwait time, never on a Friday", () => {
    const picks = followUpPicks(NOW);
    expect(picks.map(p => p.label.replace("Sept", "Sep"))).toEqual([
      "Tomorrow 10:00",
      "Wed 30 Sep 10:00",
      "Sun 4 Oct 10:00",
    ]);
    expect(iso(picks[0].at)).toBe("2026-09-28T07:00:00.000Z");
    // From a Thursday: Friday becomes Saturday, and nothing is offered twice.
    const thursday = Date.parse("2026-10-01T09:00:00Z");
    const fromThu = followUpPicks(thursday);
    expect(fromThu[0].label).toBe("Sat 3 Oct 10:00");
    expect(new Set(fromThu.map(p => p.at)).size).toBe(fromThu.length);
  });
});

describe("the sheet's order", () => {
  const names: Record<string, string> = {
    a: "Faisal",
    b: "Mona",
    c: "Khalid",
    d: "Huda",
    e: "عبدالله",
  };
  const ctx: SortContext = {
    name: id => names[id] ?? null,
    last: id =>
      (({ a: NOW - 3 * D, b: NOW - D }) as Record<string, number>)[id] ?? null,
    owner: e => e.split("@")[0],
  };
  const rows = [
    row("a", { next_at: iso(NOW + 2 * D), heat: "warm", amount: 3000 }),
    row("b", { next_at: iso(NOW - D), heat: "red_hot", amount: 9000 }),
    row("c", { next_at: null, heat: null, amount: null }),
    row("d", { next_at: iso(NOW - 3 * D), status: "closed", amount: 6000 }),
    row("e", { next_at: iso(NOW + H), heat: "hot" }),
  ];
  const ids = (rs: HotRow[]) => rs.map(r => r.contact_id);

  test("opens on the next follow-up: overdue first, blanks and closed deals last", () => {
    expect(ids(sortHot(rows, DEFAULT_SORT, ctx))).toEqual([
      "b",
      "e",
      "a",
      "c",
      "d",
    ]);
  });
  test("blanks stay last the other way round too", () => {
    expect(ids(sortHot(rows, { key: "next", dir: "desc" }, ctx))).toEqual([
      "a",
      "e",
      "b",
      "c",
      "d",
    ]);
  });
  test("by type, hottest first; a blank type is hot", () => {
    expect(ids(sortHot(rows, { key: "heat", dir: "asc" }, ctx))).toEqual([
      "b",
      "e",
      "c",
      "d",
      "a",
    ]);
  });
  test("by amount, biggest first, unknown amounts last", () => {
    const by = nextSort(DEFAULT_SORT, "amount");
    expect(by).toEqual({ key: "amount", dir: "desc" });
    expect(ids(sortHot(rows, by, ctx))).toEqual(["b", "d", "a", "e", "c"]);
  });
  test("by last follow-up, longest ago first, never followed up last", () => {
    expect(ids(sortHot(rows, nextSort(DEFAULT_SORT, "last"), ctx))).toEqual([
      "a",
      "b",
      "e",
      "c",
      "d",
    ]);
  });
  test("a second click turns a column round", () => {
    const once = nextSort(DEFAULT_SORT, "name");
    expect(once).toEqual({ key: "name", dir: "asc" });
    expect(nextSort(once, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(DEFAULT_SORT, "next")).toEqual({
      key: "next",
      dir: "desc",
    });
  });
  test("names sort A to Z", () => {
    expect(
      ids(sortHot(rows, { key: "name", dir: "asc" }, ctx)).slice(0, 4),
    ).toEqual(["a", "d", "c", "b"]);
  });
});

describe("while someone edits", () => {
  test("rows keep their places; gone rows drop out, new ones go last", () => {
    expect(keepOrder(["a", "b", "c"], ["c", "a", "d", "b"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(keepOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
    expect(keepOrder([], ["x", "y"])).toEqual(["x", "y"]);
  });
  test("a save's answer stands until a read made after it", () => {
    const read = row("a", { note: "old", updated_at: iso(NOW - D) });
    const saved = row("a", { note: "new", updated_at: iso(NOW) });
    expect(newerRow(read, saved)?.note).toBe("new");
    expect(
      newerRow({ ...read, updated_at: iso(NOW + 1000) }, saved)?.note,
    ).toBe("old");
    expect(newerRow(null, saved)?.note).toBe("new");
    expect(newerRow(read, null)?.note).toBe("old");
  });
});

describe("rows read and rows saved here", () => {
  const read = [
    row("a", { note: "read", updated_at: iso(NOW - D) }),
    row("b", { updated_at: iso(NOW - D) }),
  ];
  test("a save newer than the read shows; an older one does not", () => {
    const out = mergeHot(
      read,
      {
        a: row("a", { note: "saved", updated_at: iso(NOW) }),
        b: row("b", { note: "stale", updated_at: iso(NOW - 2 * D) }),
      },
      null,
    );
    expect(out.find(r => r.contact_id === "a")?.note).toBe("saved");
    expect(out.find(r => r.contact_id === "b")?.note).toBeNull();
  });
  test("a lead added here shows before the next read", () => {
    const out = mergeHot(read, { c: row("c", { updated_at: iso(NOW) }) }, null);
    expect(out.map(r => r.contact_id).sort()).toEqual(["a", "b", "c"]);
  });
  test("a row given to someone else leaves a seat's own list", () => {
    const given = row("a", { owner_email: "omar@x.com", updated_at: iso(NOW) });
    expect(
      mergeHot(read, { a: given }, "sara@x.com").map(r => r.contact_id),
    ).toEqual(["b"]);
    expect(mergeHot(read, { a: given }, null)).toHaveLength(2);
  });
  test("one seat's list never shows another's row, even from a team read", () => {
    const team = [...read, row("c", { owner_email: "omar@x.com" })];
    expect(mergeHot(team, {}, "sara@x.com").map(r => r.contact_id)).toEqual([
      "a",
      "b",
    ]);
  });
  test("nothing read yet is an empty list, not an error", () => {
    expect(mergeHot(null, {}, null)).toEqual([]);
  });
});

describe("how the list stands", () => {
  test("open, overdue and due today count open rows only", () => {
    expect(
      hotCounts(
        [
          row("a", { next_at: iso(NOW - H) }),
          row("b", { next_at: iso(NOW + H) }),
          row("c", { next_at: iso(NOW + 2 * D) }),
          row("d", { next_at: iso(NOW - D), status: "lost" }),
          row("e", { status: "closed" }),
        ],
        NOW,
      ),
    ).toEqual({ open: 3, overdue: 1, today: 1, done: 2 });
  });
});
