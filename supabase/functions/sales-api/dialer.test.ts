// bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import { afterOutcome, type Candidate, kuwaitAt, nextTry, rankForCloser, rankForSetter, routePhone, speedToLead } from "./dialer.ts";

describe("phone routing", () => {
  test("each GCC line gets its own caller ID", () => {
    const sa = routePhone("+966 55 123 4567");
    expect(sa.ok && sa.route.caller).toBe("966115203895");
    const kw = routePhone("0096550012345");
    expect(kw.ok && kw.route.caller).toBe("96522209572");
    const bh = routePhone("+97336001122");
    expect(bh.ok && bh.route.flag).toBe("BH");
  });
  test("Arabic digits and a local Saudi mobile are understood", () => {
    const r = routePhone("٠٥٥١٢٣٤٥٦٧");
    expect(r.ok && r.route.digits).toBe("966551234567");
  });
  test("a number the dialer cannot call says what to do", () => {
    const r = routePhone("+44 7700 900123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Maqsam");
    expect(routePhone("").ok).toBe(false);
  });
});

describe("the retry ladder", () => {
  // 2026-09-24 10:00 Kuwait
  const morning = Date.parse("2026-09-24T07:00:00Z");
  test("first miss in the morning: try again at 17:00 the same day", () => {
    const n = nextTry(0, morning);
    expect(n.step).toBe(1);
    expect(n.due).toBe(kuwaitAt(morning, 17));
  });
  test("first miss after 16:00: tomorrow at 09:00", () => {
    const late = Date.parse("2026-09-24T13:30:00Z"); // 16:30 Kuwait
    expect(nextTry(0, late).due).toBe(kuwaitAt(late, 9, 0, 1));
  });
  test("second and third misses: next day at 09:00; the fourth leaves the lead unreachable", () => {
    expect(nextTry(1, morning).due).toBe(kuwaitAt(morning, 9, 0, 1));
    expect(nextTry(3, morning)).toEqual({ step: 3, due: null, unreachable: true });
    expect(afterOutcome("no_answer", 3, morning, null).closed).toBe("unreachable");
  });
  test("booked closes the lead in the queue; a callback is due when agreed", () => {
    expect(afterOutcome("booked", 2, morning, null).closed).toBe("booked");
    const cb = morning + 3_600_000;
    expect(afterOutcome("callback", 0, morning, cb)).toEqual({ step: 0, due: cb, closed: null, callback: cb });
  });
});

const NOW = Date.parse("2026-09-24T09:00:00Z");
const lead = (over: Partial<Candidate>): Candidate => ({
  contact_id: "x",
  name: null,
  phone: "+966551234567",
  created_at: NOW - 3 * 86_400_000,
  stage: null,
  lead_class: "qualified",
  dnd: false,
  last_dial_at: null,
  reached: false,
  inbound_at: null,
  booked_at: null,
  last_call_status: null,
  last_call_type: null,
  last_call_at: null,
  due_at: null,
  callback_at: null,
  closed: null,
  claimed_by: null,
  ...over,
});

describe("the queue order", () => {
  test("a lead who arrived five minutes ago comes before everything", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "old-new", created_at: NOW - 20 * 3_600_000 }),
        lead({ contact_id: "fresh", created_at: NOW - 5 * 60_000 }),
        lead({ contact_id: "retry", due_at: NOW - 60_000, last_dial_at: NOW - 86_400_000 }),
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["fresh", "old-new", "retry"]);
    expect(q[0].tier).toBe(0);
  });
  test("a reply in the last ten minutes is tier 0 even for an old lead", () => {
    const q = rankForSetter([lead({ contact_id: "r", inbound_at: NOW - 60_000, last_dial_at: NOW - 86_400_000, reached: true })], "me", NOW);
    expect(q[0].tier).toBe(0);
  });
  test("leads that must not be called are left out", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "dnd", dnd: true }),
        lead({ contact_id: "taken", claimed_by: "someone-else" }),
        lead({ contact_id: "booked", booked_at: NOW + 86_400_000 }),
        lead({ contact_id: "later", due_at: NOW + 3_600_000, last_dial_at: NOW - 3_600_000 }),
        lead({ contact_id: "closed", closed: "not_interested" }),
      ],
      "me",
      NOW,
    );
    expect(q).toEqual([]);
  });
  test("a number the dialer cannot call, and an untagged lead nobody called, stay out", () => {
    const q = rankForSetter(
      [
        lead({ contact_id: "abroad", phone: "+919303802303", created_at: NOW - 60_000 }),
        lead({ contact_id: "untagged", lead_class: null, created_at: NOW - 10 * 86_400_000 }),
        lead({ contact_id: "tagged", lead_class: "unqualified", created_at: NOW - 10 * 86_400_000 }),
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["tagged"]);
  });
  test("a missed intro comes back to be rebooked", () => {
    const q = rankForSetter([lead({ contact_id: "ns", reached: true, last_dial_at: NOW - 2 * 86_400_000, last_call_type: "intro", last_call_status: "noshow", last_call_at: NOW - 86_400_000 })], "me", NOW);
    expect(q[0].tier).toBe(2);
  });
});

test("speed to lead is minutes to the first outbound call", () => {
  expect(speedToLead(NOW, NOW + 150_000)).toBe(3);
  expect(speedToLead(NOW, null)).toBeNull();
  expect(speedToLead(NOW, NOW - 1)).toBeNull();
});

describe("the closer's queue", () => {
  const facts = { demo_at: null as number | null, demo_status: null as string | null, signed: false };
  test("an unconfirmed demo in the next two hours comes first", () => {
    const q = rankForCloser(
      [
        { ...lead({ contact_id: "fu" }), ...facts, demo_at: NOW - 86_400_000, demo_status: "showed" },
        { ...lead({ contact_id: "soon" }), ...facts, demo_at: NOW + 3_600_000, demo_status: "new" },
      ],
      "me",
      NOW,
    );
    expect(q.map(r => r.contact_id)).toEqual(["soon", "fu"]);
  });
  test("a lead who signed is never in the queue", () => {
    const q = rankForCloser([{ ...lead({ contact_id: "s" }), ...facts, demo_at: NOW - 86_400_000, demo_status: "showed", signed: true }], "me", NOW);
    expect(q).toEqual([]);
  });
  test("a missed demo from last week comes back to be rebooked", () => {
    const q = rankForCloser([{ ...lead({ contact_id: "m" }), ...facts, demo_at: NOW - 3 * 86_400_000, demo_status: "noshow" }], "me", NOW);
    expect(q[0]?.tier).toBe(2);
  });
});
