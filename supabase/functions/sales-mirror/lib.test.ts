// bun test supabase/functions/sales-mirror
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "../../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb.ts";
import {
  applyHolds,
  callsSql,
  DEAL_ANSWER_COLUMNS,
  DEAL_ANSWERS,
  DEAL_MONEY_EDIT_FIELDS,
  dealsSql,
  type Hold,
  holdLapse,
  holdStart,
  holdsByCall,
  meetUrl,
  dialsSql,
  dropLooksWrong,
  ghlContactRow,
  ghlEventRow,
  inboxRow,
  leadClass,
  leadRow,
  applyVoids,
  leadsSql,
  missingDealAnswerColumn,
  monthWindows,
  phone8,
  redact,
  scorecardRows,
  scorecardWindows,
  ts,
  withoutDealAnswers,
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

describe("redact", () => {
  test("a key in a query string or a bearer header never reaches a row", () => {
    expect(redact("GET /x?api_key=abc123&page=2 -> 500")).toBe("GET /x?api_key=[key]&page=2 -> 500");
    expect(redact("token=zz9 failed")).toBe("token=[key] failed");
    expect(redact("Authorization: Bearer sk-live.abc_DEF")).toBe("Authorization: Bearer [key]");
  });
});

// The same cases as sales-api/reschedule.test.ts: holdStart and meetUrl are
// one rule kept in two files (an Edge Function cannot import from another).
describe("a call rescheduled in the cockpit (2026-10-11)", () => {
  const from = "2026-10-12T13:30:00.000Z";
  const to = "2026-10-13T14:00:00.000Z";
  const made = "2026-10-11T11:00:00.000Z";
  const h: Hold = { id: "r1", appointment_id: "a1", from_start: from, to_start: to, from_user_id: "G-a", to_user_id: "G-a", created_at: made };
  const now = Date.parse("2026-10-11T11:10:00Z");

  test("B2B still showing the old time keeps the cockpit's new time", () => {
    expect(holdStart({ start_at: "2026-10-12 13:30:00+00", assigned_user_id: "G-a" }, [h], now)).toEqual({
      kind: "hold",
      start_at: to,
      assigned_user_id: null,
      ids: ["r1"],
      since: Date.parse(made),
    });
    const moved = { ...h, to_user_id: "G-b" };
    const v = holdStart({ start_at: from, assigned_user_id: "G-a" }, [moved], now);
    expect(v.kind === "hold" && v.assigned_user_id).toBe("G-b");
  });

  test("the new time is caught; a third time releases; the hold lapses", () => {
    expect(holdStart({ start_at: "2026-10-13 14:00:00+00" }, [h], now)).toEqual({ kind: "caught", ids: ["r1"] });
    expect(holdStart({ start_at: "2026-10-14T10:00:00Z" }, [h], now)).toEqual({ kind: "released", ids: ["r1"], why: "moved again in HighLevel" });
    expect(holdLapse(h)).toBe(Date.parse(to) + 3_600_000);
    expect(holdStart({ start_at: from }, [h], Date.parse(to) + 3_600_001)).toEqual({
      kind: "released",
      ids: ["r1"],
      why: "lapsed: B2B never showed the new time",
    });
  });

  test("moved twice in the cockpit: either old time holds to the newest", () => {
    const second: Hold = { ...h, id: "r2", from_start: to, to_start: "2026-10-14T09:00:00.000Z", created_at: "2026-10-11T11:05:00.000Z" };
    const v = holdStart({ start_at: from }, [second, h], now);
    expect(v.kind === "hold" && v.start_at).toBe("2026-10-14T09:00:00.000Z");
    expect(holdStart({ start_at: "2026-10-14T09:00:00Z" }, [second, h], now)).toEqual({ kind: "caught", ids: ["r1", "r2"] });
  });

  test("a read through the holds: held rows carry the cockpit's time, the rest pass, an hour's hold warns", () => {
    const holds = holdsByCall([
      { id: "r1", appointment_id: "a1", from_start: from, to_start: to, created_at: made },
      { id: "r9", appointment_id: "a9", from_start: from, to_start: to, created_at: made },
    ]);
    const rows = [
      { appointment_id: "a1", start_at: "2026-10-12 13:30:00+00", status: "confirmed" },
      { appointment_id: "a9", start_at: "2026-10-13 14:00:00+00" },
      { appointment_id: "a5", start_at: "2026-10-15 10:00:00+00" },
    ];
    const out = applyHolds(rows, holds, now);
    expect(out.rows[0]).toEqual({ appointment_id: "a1", start_at: to, status: "confirmed" });
    expect(out.rows[1]).toBe(rows[1]);
    expect(out.rows[2]).toBe(rows[2]);
    expect([out.held, out.caught, out.released, out.warnings]).toEqual([1, ["r9"], [], []]);
    const later = applyHolds(rows, holds, Date.parse(made) + 61 * 60_000);
    expect(later.warnings).toEqual(["B2B has not carried the reschedule of a1 yet"]);
  });

  test("the Zoom address and HighLevel's reschedule stamp come out of B2B's payload, guarded", () => {
    const sql = callsSql("2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z");
    expect(sql).toContain("as meet_url");
    expect(sql).toContain("as crm_rescheduled_at");
    expect(sql).toContain("zoom\\.us/");
    expect(meetUrl("https://us06web.zoom.us/j/81001879864?pwd=abc.1")).toBe("https://us06web.zoom.us/j/81001879864?pwd=abc.1");
    expect(meetUrl(" 055 445 5823")).toBeNull();
    expect(meetUrl("https://evil.example/zoom.us/j/1")).toBeNull();
    const r = ghlEventRow(
      { id: "e1", calendarId: "cal1", startTime: "2026-10-12T10:00:00+03:00", address: "https://zoom.us/j/1" },
      { cal1: { type: "follow_up" } },
      "x",
    );
    expect(r?.meet_url).toBe("https://zoom.us/j/1");
  });
});

// 2026-10-23, Billing's pending payments: the two New Client Form answers B2B
// keeps only in raw_payload. The B2B side is a fixture shaped like the live
// closed_deals (only the columns dealsSql reads, no real contact details);
// the cockpit side is cockpit_sales_deals as the migrations build it.
describe("the onboarding payment and the later payment from the closer form", () => {
  const ON_CALL = "77a14b37-7f16-4c72-8c54-38f597bdddc2";
  const ONB = DEAL_ANSWERS.cash_at_onboarding;
  const LATER = DEAL_ANSWERS.second_payment;
  const num = (ref: string, n: unknown) => ({ type: "number", number: n, field: { id: "f", ref, type: "number" } });
  const payloads: Record<string, unknown> = {
    // City Wood's shape: $500 on the call, $5,500 at onboarding, a typed 0 later.
    "r-full": { answers: [num(ON_CALL, 500), num(ONB, 5500), num(LATER, 0)], hidden: {} },
    // mergestudio's shape: the later question left empty.
    "r-no-later": { answers: [num(ON_CALL, 500), num(ONB, 5500)] },
    // A form from before 29 Aug never asked either question.
    "r-april": { answers: [num(ON_CALL, 200)] },
    "r-text": { answers: [{ type: "text", text: "5,500", field: { ref: ONB } }, num(LATER, 1532.5)] },
    "r-negative": { answers: [num(ONB, -100), num(LATER, 2000)] },
    "r-string-number": { answers: [num(ONB, "abc"), num(LATER, "2000")] },
    "r-no-answers": {},
    "r-odd-answers": { answers: { [ONB]: 5500 } },
    "r-null-payload": null,
    "r-twice": { answers: [num(ONB, 1500), num(ONB, 9999)] },
    "r-voided": { answers: [num(ONB, 2500), num(LATER, 3000)] },
    // Typed Paid in full, deposit $500, $5,500 at onboarding, then corrected in
    // B2B: the contract cut to $5,000, or the plan changed to Split.
    "r-contract-edited": { answers: [num(ON_CALL, 500), num(ONB, 5500), num(LATER, 0)] },
    "r-plan-edited": { answers: [num(ON_CALL, 500), num(ONB, 5500), num(LATER, 0)] },
    "r-deposit-edited": { answers: [num(ON_CALL, 500), num(ONB, 5500), num(LATER, 0)] },
    "r-mrr-edited": { answers: [num(ON_CALL, 500), num(ONB, 1500), num(LATER, 2000)] },
    // Alkhalil's shape: only the closer's name was corrected.
    "r-closer-edited": { answers: [num(ON_CALL, 500), num(ONB, 2500), num(LATER, 3000)] },
  };
  let db: PGlite;

  beforeAll(async () => {
    db = await cockpitTestDb();
    await db.exec(`
      CREATE TABLE public.closed_deals (
        response_id text PRIMARY KEY, submitted_at timestamptz, closer text, contact_id text,
        client_first_name text, client_last_name text, business_name text, email text,
        phone text, phone_normalized text, country text, payment_structure text, agreement_type text,
        daily_ad_spend numeric, cash_collected numeric, contracted_revenue numeric, new_mrr numeric,
        fathom_link text, csm text, lead_source text, ad_id text, raw_payload jsonb);
      CREATE TABLE public.record_voids (entity text, record_id text);
      INSERT INTO public.record_voids VALUES ('closed_deal', 'r-voided');
      CREATE TABLE public.record_edits (entity text, record_id text, field text, new_value text, created_at timestamptz);
      INSERT INTO public.record_edits VALUES
        ('closed_deal', 'r-contract-edited', 'contracted_revenue', '5000', '2026-09-05T09:00:00Z'),
        ('closed_deal', 'r-plan-edited', 'payment_structure', 'Split ($3,000 x 2)', '2026-09-05T09:00:00Z'),
        ('closed_deal', 'r-deposit-edited', 'cash_collected', '1000', '2026-09-05T09:00:00Z'),
        ('closed_deal', 'r-mrr-edited', 'new_mrr', '1800', '2026-09-05T09:00:00Z'),
        ('closed_deal', 'r-closer-edited', 'closer', 'Someone else', '2026-08-29T09:00:00Z'),
        -- A call that happens to share an id never touches a deal.
        ('call', 'r-full', 'status', 'showed', '2026-09-05T09:00:00Z');`);
    for (const [id, payload] of Object.entries(payloads)) {
      await db.query(
        `INSERT INTO public.closed_deals (response_id, submitted_at, business_name, payment_structure,
           cash_collected, contracted_revenue, raw_payload)
         VALUES ($1, '2026-09-01T09:00:00Z', 'Fixture ' || $1, 'Paid in full ($6,000)', 500, 6000, $2::jsonb)`,
        [id, payload === null ? null : JSON.stringify(payload)],
      );
    }
  });
  afterAll(async () => {
    await db?.close();
  });

  const read = async () =>
    Object.fromEntries(
      (
        await db.query<{ response_id: string; onb: string | null; later: string | null; voided: boolean }>(
          `SELECT q.response_id, q.cash_at_onboarding::text AS onb, q.second_payment::text AS later, q.voided
             FROM (${dealsSql()}) AS q`,
        )
      ).rows.map(r => [r.response_id, [r.onb, r.later, r.voided]]),
    );

  test("both answers are read by their exact Typeform refs, once each", () => {
    const sql = dealsSql();
    expect(ONB).toBe("b37f4cfe-82ab-4da7-b1f8-aaabe2afbf9b");
    expect(LATER).toBe("ea6fccbd-d27e-4b57-8cfb-d3fa527f362f");
    expect(sql.split(`'${ONB}'`).length).toBe(2);
    expect(sql.split(`'${LATER}'`).length).toBe(2);
    expect(sql).toContain(" end as cash_at_onboarding,");
    expect(sql).toContain(" end as second_payment,");
    expect(sql).toContain("from public.closed_deals as d");
  });

  test("the numbers on the form come through, a typed 0 stays 0, an unasked question is null", async () => {
    const got = await read();
    expect(got["r-full"]).toEqual(["5500", "0", false]);
    expect(got["r-no-later"]).toEqual(["5500", null, false]);
    expect(got["r-april"]).toEqual([null, null, false]);
    expect(got["r-voided"]).toEqual(["2500", "3000", true]);
    expect(got["r-twice"]).toEqual(["1500", null, false]);
  });

  test("a deal whose money was corrected in B2B reads null on both, so the rule falls back to the plan", async () => {
    const got = await read();
    expect(got["r-contract-edited"]).toEqual([null, null, false]);
    expect(got["r-plan-edited"]).toEqual([null, null, false]);
    expect(got["r-deposit-edited"]).toEqual([null, null, false]);
    expect(got["r-mrr-edited"]).toEqual([null, null, false]);
    // A correction that leaves the money alone keeps what the closer typed.
    expect(got["r-closer-edited"]).toEqual(["2500", "3000", false]);
    expect(got["r-full"]).toEqual(["5500", "0", false]);
  });

  test("the guard names exactly the money fields B2B lets a person correct", () => {
    expect([...DEAL_MONEY_EDIT_FIELDS].sort()).toEqual(
      ["cash_collected", "contracted_revenue", "new_mrr", "payment_structure"],
    );
    const sql = dealsSql();
    // One guard per answer, each reading only deal edits.
    expect(sql.split("from public.record_edits as e").length).toBe(3);
    expect(sql.split("e.entity = 'closed_deal' and e.record_id = d.response_id").length).toBe(3);
  });

  test("an odd answer reads null (missing, never zero) and never fails the read", async () => {
    const got = await read();
    expect(Object.keys(got).length).toBe(Object.keys(payloads).length);
    expect(got["r-text"]).toEqual([null, "1532.5", false]);
    expect(got["r-negative"]).toEqual([null, "2000", false]);
    expect(got["r-string-number"]).toEqual([null, null, false]);
    expect(got["r-no-answers"]).toEqual([null, null, false]);
    expect(got["r-odd-answers"]).toEqual([null, null, false]);
    expect(got["r-null-payload"]).toEqual([null, null, false]);
  });

  test("a mirror deployed before 20261023x knows the refusal and copies deals without the two answers", () => {
    expect(DEAL_ANSWER_COLUMNS).toEqual(["cash_at_onboarding", "second_payment"]);
    // What index.ts's rest() throws: the probe's select, then a write.
    const select =
      'Triage 400 on cockpit_sales_deals: {"code":"42703","details":null,"hint":null,"message":"column cockpit_sales_deals.cash_at_onboarding does not exist"}';
    const write =
      `Triage 400 on cockpit_sales_deals: {"code":"PGRST204","details":null,"hint":null,"message":"Could not find the 'second_payment' column of 'cockpit_sales_deals' in the schema cache"}`;
    expect(missingDealAnswerColumn(select)).toBe(true);
    expect(missingDealAnswerColumn(write)).toBe(true);
    // Any other refusal still fails the step, as it should.
    expect(
      missingDealAnswerColumn(
        'Triage 400 on cockpit_sales_deals: {"code":"42703","message":"column cockpit_sales_deals.closer does not exist"}',
      ),
    ).toBe(false);
    expect(missingDealAnswerColumn("Triage 503 on cockpit_sales_deals: upstream timeout")).toBe(false);
    const row = { response_id: "r1", cash_at_onboarding: 5500, second_payment: 0, contracted_revenue: 6000 };
    expect(withoutDealAnswers(row)).toEqual({ response_id: "r1", contracted_revenue: 6000 });
    expect(row.cash_at_onboarding).toBe(5500);
  });

  test("every column the mirror sends exists only once 20261023x is applied (deploy after it)", async () => {
    const core = migration("20260924a_sales_cockpit.sql").match(
      /create table if not exists public\.cockpit_sales_deals \([\s\S]*?\n\);/,
    );
    const added = migration("20261023x_billing_balances.sql").match(
      /ALTER TABLE public\.cockpit_sales_deals\s+ADD COLUMN[\s\S]*?;/,
    );
    expect(core).not.toBeNull();
    expect(added).not.toBeNull();
    await db.exec(core![0]);
    await db.exec(migration("20260924g_sales_deal_setter.sql"));
    const cols = (await db.query(`SELECT * FROM (${dealsSql()}) AS q LIMIT 0`)).fields.map(f => f.name);
    expect(cols).toContain("cash_at_onboarding");
    expect(cols).toContain("second_payment");
    // index.ts sends every column of dealsSql plus mirrored_at.
    const upsert = `INSERT INTO public.cockpit_sales_deals (${cols.join(", ")}, mirrored_at)
      SELECT ${cols.map(c => `q.${c}`).join(", ")}, now() FROM (${dealsSql()}) AS q
      ON CONFLICT (response_id) DO UPDATE SET cash_at_onboarding = excluded.cash_at_onboarding,
        second_payment = excluded.second_payment`;
    // Before the migration the upsert is refused, as PostgREST would refuse it.
    await expect(db.exec(upsert)).rejects.toThrow(/cash_at_onboarding/);
    // ... and so is index.ts's probe, with a refusal it recognises; the rows
    // without the two answers still go in, so the deal copy never stops.
    let probe = "";
    try {
      await db.query(`SELECT ${DEAL_ANSWER_COLUMNS.join(", ")} FROM public.cockpit_sales_deals LIMIT 1`);
    } catch (e) {
      probe = String((e as Error).message);
    }
    expect(missingDealAnswerColumn(probe)).toBe(true);
    const bare = cols.filter(c => !(DEAL_ANSWER_COLUMNS as string[]).includes(c));
    await db.exec(`INSERT INTO public.cockpit_sales_deals (${bare.join(", ")}, mirrored_at)
      SELECT ${bare.map(c => `q.${c}`).join(", ")}, now() FROM (${dealsSql()}) AS q
      ON CONFLICT (response_id) DO NOTHING`);
    await db.exec(added![0]);
    await db.exec(upsert);
    const stored = (
      await db.query<{ response_id: string; onb: string | null; later: string | null }>(
        `SELECT response_id, cash_at_onboarding::text AS onb, second_payment::text AS later
           FROM public.cockpit_sales_deals WHERE response_id IN ('r-full', 'r-no-later', 'r-april') ORDER BY 1`,
      )
    ).rows;
    expect(stored).toEqual([
      { response_id: "r-april", onb: null, later: null },
      { response_id: "r-full", onb: "5500", later: "0" },
      { response_id: "r-no-later", onb: "5500", later: null },
    ]);
  });
});
