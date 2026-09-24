// bun test supabase/functions/sales-mirror
import { describe, expect, test } from "bun:test";
import {
  dialsSql,
  ghlEventRow,
  inboxRow,
  leadClass,
  leadRow,
  leadsSql,
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
    expect(dialsSql("2026-09-01T00:00:00Z", 0)).toContain("limit 1");
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
