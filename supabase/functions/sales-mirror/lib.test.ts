// bun test supabase/functions/sales-mirror
import { describe, expect, test } from "bun:test";
import {
  dialsSql,
  dropLooksWrong,
  ghlContactRow,
  ghlEventRow,
  inboxRow,
  leadClass,
  leadRow,
  applyVoids,
  leadsSql,
  monthWindows,
  phone8,
  redact,
  scorecardRows,
  scorecardWindows,
  ts,
} from "./lib.ts";

describe("phone8", () => {
  test("keeps the last eight digits of any format", () => {
    expect(phone8("+965 9005 4963")).toBe("90054963");
    expect(phone8("00966-55-123-4567")).toBe("51234567");
  });
  test("a short or empty number joins nothing", () => {
    expect(phone8("12345")).toBeNull();
    expect(phone8(null)).toBeNull();
  });
});

describe("leadClass", () => {
  test("a contact with both lead tags is qualified (2026-09-21 rule)", () => {
    expect(leadClass(["roas-unqualified", "roas-qualified"])).toBe("qualified");
  });
  test("unqualified, then not ready, then nothing", () => {
    expect(leadClass(["roas-unqualified", "roas-unprepared"])).toBe("unqualified");
    expect(leadClass(["roas-unprepared"])).toBe("unprepared");
    expect(leadClass(["facebook ads"])).toBeNull();
    expect(leadClass(null)).toBeNull();
  });
});

describe("SQL values", () => {
  test("a timestamp that is not one is refused", () => {
    expect(() => ts("2026-09-24'; drop table leads; --")).toThrow();
    expect(ts("2026-09-24T07:55:51.320Z")).toBe("'2026-09-24T07:55:51.320Z'::timestamptz");
  });
  test("paging and the watermark both reach the query", () => {
    const sql = leadsSql({ since: "2026-09-24T00:00:00.000Z", after: "abc'd", limit: 5 });
    expect(sql).toContain("> '2026-09-24T00:00:00.000Z'::timestamptz");
    expect(sql).toContain("l.contact_id > 'abc''d'");
    expect(sql).toContain("limit 5");
  });
  test("limits are clamped", () => {
    expect(leadsSql({ limit: 99999 })).toContain("limit 2000");
    expect(dialsSql({ since: "2026-09-01T00:00:00Z", limit: 0 })).toContain("limit 1");
  });
});

describe("scorecard windows (Kuwait days, week from Saturday)", () => {
  test("on a Thursday the week began the Saturday before", () => {
    // 2026-09-24 is a Thursday; 12:00 Kuwait is 09:00 UTC.
    const w = scorecardWindows(Date.parse("2026-09-24T09:00:00Z"));
    const by = Object.fromEntries(w.map(x => [x.key, x]));
    expect(by.today).toEqual({ key: "today", from: "2026-09-24", to: "2026-09-24" });
    expect(by.week.from).toBe("2026-09-19");
    expect(by.month.from).toBe("2026-09-01");
    expect(by.last_month).toEqual({ key: "last_month", from: "2026-08-01", to: "2026-08-31" });
    expect(by.d30.from).toBe("2026-08-26");
  });
  test("on a Saturday the week is that day", () => {
    const w = scorecardWindows(Date.parse("2026-09-26T09:00:00Z"));
    expect(w.find(x => x.key === "week")?.from).toBe("2026-09-26");
  });
  test("just after midnight in Kuwait is already the next day", () => {
    const w = scorecardWindows(Date.parse("2026-09-30T21:30:00Z"));
    expect(w.find(x => x.key === "today")?.from).toBe("2026-10-01");
    expect(w.find(x => x.key === "last_month")?.from).toBe("2026-09-01");
  });
});

describe("rows", () => {
  test("a HighLevel event becomes an appointment with the calendar's type", () => {
    const r = ghlEventRow(
      {
        id: "ev1",
        calendarId: "cal1",
        contactId: "c1",
        title: "Call",
        startTime: "2026-09-24T10:00:00+03:00",
        dateAdded: "2026-09-23T10:00:00+03:00",
        appointmentStatus: "confirmed",
        assignedUserId: "u1",
      },
      { cal1: { type: "callback" } },
      "2026-09-24T00:00:00.000Z",
    );
    expect(r?.call_type).toBe("callback");
    expect(r?.start_at).toBe("2026-09-24T07:00:00.000Z");
    expect(r?.origin).toBe("ghl");
    expect(ghlEventRow({ id: "" }, {}, "x")).toBeNull();
    expect(ghlEventRow({ id: "e", calendarId: "c", deleted: true }, {}, "x")).toBeNull();
  });
  test("a lead row loses the helper column and gains its class", () => {
    const r = leadRow({ contact_id: "c", tags: ["roas-qualified"], changed_at: "x" }, "t");
    expect("changed_at" in r).toBe(false);
    expect(r.lead_class).toBe("qualified");
    expect(r.mirrored_at).toBe("t");
  });
});

test("keys never reach a log line", () => {
  expect(redact("token sbp_abc123 and pit-1234-abcd")).toBe("token [key] and [key]");
});

test("a scorecard becomes one row per person, duplicates dropped", () => {
  const rows = scorecardRows(
    { key: "month", from: "2026-09-01", to: "2026-09-24" },
    [
      { person_key: "p1", display_name: "A", role: "rep", show_rate: 62.5 },
      { person_key: "p1", display_name: "A again" },
      { display_name: "Unresolved name" },
    ],
    "t",
  );
  expect(rows.map(r => r.person_key)).toEqual(["p1", "Unresolved name"]);
  expect((rows[0].row as Record<string, unknown>).show_rate).toBe(62.5);
  expect(scorecardRows({ key: "x", from: "a", to: "b" }, null, "t")).toEqual([]);
});

test("a conversation becomes an inbox row with times from milliseconds", () => {
  const r = inboxRow(
    { id: "c1", contactId: "k", fullName: "A B", lastMessageDate: 1758700884609, lastMessageDirection: "inbound", lastMessageType: "TYPE_WHATSAPP", lastMessageBody: "  hello\n there ", unreadCount: 2 },
    "t",
  );
  expect(r?.last_message_at).toBe(new Date(1758700884609).toISOString());
  expect(r?.last_body).toBe("hello there");
  expect(r?.unread).toBe(2);
  expect(inboxRow({}, "t")).toBeNull();
});

test("a fresh HighLevel contact becomes a lead row with its answers and class", () => {
  const r = ghlContactRow(
    {
      id: "c9",
      firstName: "Faisal",
      lastName: "Test",
      phone: "+966551234567",
      country: "SA",
      tags: ["roas-qualified"],
      dnd: false,
      dateAdded: "2026-09-24T09:00:00.000Z",
      customFields: [
        { id: "IvdTSSuctezX9DTHo42K", value: "$100K - $250k" },
        { id: "oNCqOSC5QOhkzEbP1BrZ", value: "120245" },
      ],
    },
    "t",
  );
  expect(r?.name).toBe("Faisal Test");
  expect(r?.phone8).toBe("51234567");
  expect(r?.lead_class).toBe("qualified");
  expect(r?.revenue).toBe("$100K - $250k");
  expect(r?.ad_id).toBe("120245");
  expect(r?.lead_created_at).toBe("2026-09-24T09:00:00.000Z");
});

describe("month windows (goals history)", () => {
  test("the running month to today, then whole months back", () => {
    const w = monthWindows(Date.parse("2026-09-24T09:00:00Z"), 3);
    expect(w.map(x => x.key)).toEqual(["m2026-09", "m2026-08", "m2026-07", "m2026-06"]);
    expect(w[0]).toEqual({ key: "m2026-09", from: "2026-09-01", to: "2026-09-24", current: true });
    expect(w[1]).toEqual({ key: "m2026-08", from: "2026-08-01", to: "2026-08-31", current: false });
    expect(w[3].to).toBe("2026-06-30");
  });
  test("a year back crosses into the year before, February included", () => {
    const w = monthWindows(Date.parse("2026-03-10T09:00:00Z"), 13);
    expect(w.find(x => x.key === "m2026-02")?.to).toBe("2026-02-28");
    expect(w.at(-1)?.key).toBe("m2025-02");
  });
  test("just after midnight in Kuwait on the first is the new month", () => {
    const w = monthWindows(Date.parse("2026-09-30T21:30:00Z"), 1);
    expect(w[0]).toEqual({ key: "m2026-10", from: "2026-10-01", to: "2026-10-01", current: true });
    expect(w[1].key).toBe("m2026-09");
  });
});

describe("voided deals come out of B2B's scorecard", () => {
  const reps = [
    { id: "ahmed", closer_aliases: ["Ahmed Abushaiba", "Ahmed"] },
    { id: "samer", closer_aliases: ["Samer"] },
  ];
  const w = { from: "2026-08-01", to: "2026-08-31" };
  const card = {
    person_key: "ahmed",
    closes: 6,
    revenue: 12000,
    cash_collected: 4000,
    new_mrr: 0,
    demos_qualified: 10,
    close_rate: 60,
    avg_deal: 2000,
  };
  const voidDeal = (over: Record<string, unknown>) => ({
    response_id: "r",
    closer: " ahmed ",
    submitted_at: "2026-08-10T10:00:00Z",
    contracted_revenue: 3000,
    cash_collected: 1500,
    new_mrr: 0,
    ...over,
  });

  test("a void in the window comes off its closer, B2B's figures kept beside it", () => {
    const [r] = applyVoids([card], [voidDeal({})], reps, w);
    expect(r.closes).toBe(5);
    expect(r.cash_collected).toBe(2500);
    expect(r.revenue).toBe(9000);
    expect(r.close_rate).toBe(50);
    expect(r.avg_deal).toBe(1800);
    expect((r.b2b as Record<string, unknown>).closes).toBe(6);
    expect((r.voided as Record<string, unknown>).cash_collected).toBe(1500);
  });
  test("the window is the Riyadh day the form came in", () => {
    // 21:30 UTC on 31 August is 1 September in Riyadh: outside August.
    const [r] = applyVoids([card], [voidDeal({ submitted_at: "2026-08-31T21:30:00Z" })], reps, w);
    expect(r.closes).toBe(6);
    expect("voided" in r).toBe(false);
  });
  test("a closer no alias knows is B2B's 'unattributed', not anyone's", () => {
    const rows = [card, { person_key: "unattributed", closes: 1, cash_collected: 500 }];
    const out = applyVoids(rows, [voidDeal({ closer: "Someone New", cash_collected: 500 })], reps, w);
    expect(out[0].closes).toBe(6);
    expect(out[1].closes).toBe(0);
    expect(out[1].cash_collected).toBe(0);
  });
  test("nothing voided leaves the rows as they were", () => {
    expect(applyVoids([card], [], reps, w)).toEqual([card]);
  });
});

describe("calls page by (synced_at, call id)", () => {
  test("the first page reads after the watermark", () => {
    const sql = dialsSql({ since: "2026-09-20T16:00:00.000Z", limit: 5000 });
    expect(sql).toContain("m.synced_at > '2026-09-20T16:00:00.000Z'::timestamptz");
    expect(sql).toContain("order by m.synced_at, m.maqsam_call_id");
  });
  test("the next page carries on from the last row, B2B's microseconds kept", () => {
    const sql = dialsSql({
      since: "2026-09-20T16:00:00.000Z",
      after: { at: "2026-09-20 16:02:16.108334+00", id: "338314280" },
      limit: 5000,
    });
    expect(sql).toContain(
      "(m.synced_at, m.maqsam_call_id) > ('2026-09-20 16:02:16.108334+00'::timestamptz, '338314280')",
    );
  });
  test("the whole number is read beside the last eight digits", () => {
    expect(dialsSql({ since: "2026-09-20T16:00:00Z", limit: 1 })).toContain(
      "nullif(regexp_replace(coalesce(m.lead_phone, ''), '\\D', '', 'g'), '') as lead_digits",
    );
  });
  test("a call id cannot break out of the query", () => {
    expect(
      dialsSql({ since: "2026-09-20T16:00:00Z", after: { at: "2026-09-20T16:00:00Z", id: "1'; drop table x; --" }, limit: 1 }),
    ).toContain("'1''; drop table x; --'");
  });
});

describe("drops wait for a person when they look wrong", () => {
  test("nothing read never drops anything", () => {
    expect(dropLooksWrong(0, 0)).toBe(true);
  });
  test("a few rows B2B deleted are dropped", () => {
    expect(dropLooksWrong(50, 2)).toBe(false);
    expect(dropLooksWrong(4940, 300)).toBe(false);
    expect(dropLooksWrong(9, 5)).toBe(false);
  });
  test("more than a fifth gone is B2B answering oddly", () => {
    expect(dropLooksWrong(50, 11)).toBe(true);
    expect(dropLooksWrong(4940, 1000)).toBe(true);
  });
});
