// bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import {
  type Appointment,
  applyFills,
  fillPaths,
  checkGoals,
  checkLink,
  checkOffer,
  checkPay,
  cors,
  crmDecision,
  refuseMark,
  trimMessages,
} from "./lib.ts";

const NOW = Date.parse("2026-09-24T09:00:00Z");
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  appointment_id: "a1",
  contact_id: "c1",
  call_type: "demo",
  start_at: "2026-09-24T07:00:00Z",
  status: "confirmed",
  assigned_user_id: "ghl-closer",
  calendar_id: "cal",
  ...over,
});
const rep = { signed_in: true, email: "rep@x.com", seat: true, manager: false, role: "closer", ghl_user_id: "ghl-closer" };
const manager = { signed_in: true, email: "boss@x.com", seat: true, manager: true, role: "manager", ghl_user_id: null };

describe("who may mark a call", () => {
  test("the rep the call is booked with", () => {
    expect(refuseMark(rep, appt(), "showed", NOW)).toBeNull();
  });
  test("not another rep's call", () => {
    expect(refuseMark(rep, appt({ assigned_user_id: "other" }), "showed", NOW)).toContain("another rep");
  });
  test("a manager may mark any call", () => {
    expect(refuseMark(manager, appt({ assigned_user_id: "other" }), "noshow", NOW)).toBeNull();
  });
  test("a seat with no HighLevel user is told how to fix it", () => {
    expect(refuseMark({ ...rep, ghl_user_id: null }, appt(), "showed", NOW)).toContain("Team page");
  });
  test("a future call can be cancelled but not attended", () => {
    const later = appt({ start_at: "2026-09-25T09:00:00Z" });
    expect(refuseMark(rep, later, "showed", NOW)).toContain("not happened yet");
    expect(refuseMark(rep, later, "cancelled", NOW)).toBeNull();
  });
  test("only the four statuses", () => {
    expect(refuseMark(rep, appt(), "rescheduled", NOW)).toContain("Choose");
  });
});

describe("whether a mark goes to HighLevel (Aziz: yes for today's calls)", () => {
  test("switched off means off", () => {
    expect(crmDecision({ dispositions: false }, appt(), NOW)).toBe("off");
    expect(crmDecision(null, appt(), NOW)).toBe("off");
  });
  test("a recent call is written", () => {
    expect(crmDecision({ dispositions: true, backlog_days: 7 }, appt(), NOW)).toBe("write");
  });
  test("an old call stays in the cockpit, so no old lead gets a no-show message", () => {
    const old = appt({ start_at: "2026-09-10T07:00:00Z" });
    expect(crmDecision({ dispositions: true, backlog_days: 7 }, old, NOW)).toBe("skipped");
  });
});

describe("pay rules", () => {
  test("Aziz's closer rule: 10% of cash as it is collected, plus $250 paid in full", () => {
    const r = checkPay({ cash_rate: "0.10", pif_bonus: 250 });
    expect(r).toEqual({ ok: true, pay: { cash_rate: 0.1, pif_bonus: 250, currency: "USD" } });
  });
  test("a rate over 100% is refused with the fix", () => {
    const r = checkPay({ cash_rate: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("0.10");
  });
  test("no rule is an empty rule, never zero", () => {
    expect(checkPay(null)).toEqual({ ok: true, pay: {} });
  });
});

describe("goals", () => {
  test("weekly and monthly units and cash", () => {
    expect(checkGoals({ weekly: { booked: 20, cash: "3000" }, monthly: { closes: 4 } })).toEqual({
      ok: true,
      goals: { weekly: { booked: 20, cash: 3000 }, monthly: { closes: 4 } },
    });
  });
  test("a negative goal is refused", () => {
    expect(checkGoals({ weekly: { booked: -1 } }).ok).toBe(false);
  });
});

describe("links", () => {
  test("https only, with a name", () => {
    expect(checkLink({ label: "Deck", url: "http://x.com" }).ok).toBe(false);
    expect(checkLink({ label: "", url: "https://x.com" }).ok).toBe(false);
    const ok = checkLink({ label: "Deck", url: "https://pitch.com/v/x", kind: "deck" });
    expect(ok.ok && ok.row.kind).toBe("deck");
    const blank = checkLink({ label: "Deck", url: "https://x.com", sort: "" });
    expect(blank.ok && blank.row.sort).toBe(100);
  });
});

describe("the closer's offer choices", () => {
  test("guarantee and a payment plan", () => {
    expect(checkOffer({ guarantee: true, payment: "plan_3" })).toEqual({
      ok: true,
      offer: { guarantee: true, payment: "plan_3" },
    });
  });
  test("defaults to paid in full with no guarantee", () => {
    expect(checkOffer(undefined)).toEqual({ ok: true, offer: { guarantee: false, payment: "pif" } });
  });
  test("an odd length is refused", () => {
    expect(checkOffer({ months: 2.5 }).ok).toBe(false);
  });
});

test("messages are trimmed to what the page shows", () => {
  const out = trimMessages([{ id: "m", direction: "inbound", messageType: "TYPE_WHATSAPP", body: "x".repeat(5000), attachments: ["a"] }]);
  expect(out[0].type).toBe("TYPE_WHATSAPP");
  expect(String(out[0].body).length).toBe(2000);
  expect(out[0].has_attachments).toBe(true);
});

test("only the cockpit's own addresses may call it from a browser", () => {
  expect(cors("https://cockpit.maharamedia.com")["Access-Control-Allow-Origin"]).toBe("https://cockpit.maharamedia.com");
  expect(cors("https://evil.example")["Access-Control-Allow-Origin"]).toBe("null");
});

describe("filling the blanks a draft left", () => {
  const deal = {
    headline: "Your next FILL projects",
    investment: { rows: [{ label: "Program", amount: "FILL" }], total: 6000 },
    quotes: [{ en: "We need more leads" }],
  };
  test("every FILL is found by its path", () => {
    expect(fillPaths(deal)).toEqual(["headline", "investment.rows.0.amount"]);
  });
  test("a figure replaces a bare FILL as a number, words replace text", () => {
    const out = applyFills(deal, { "investment.rows.0.amount": "6,000", headline: "Your next 12 projects" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const d = out.deal as typeof deal;
      expect(d.investment.rows[0].amount as unknown).toBe(6000);
      expect(d.headline).toBe("Your next 12 projects");
      expect(deal.headline).toContain("FILL");
    }
  });
  test("settled text cannot be rewritten through a fill", () => {
    expect(applyFills(deal, { "quotes.0.en": "made up" }).ok).toBe(false);
    expect(applyFills(deal, { "investment.total": "1" }).ok).toBe(false);
  });
  test("a fill that still says FILL is refused", () => {
    expect(applyFills(deal, { headline: "Your next FILL" }).ok).toBe(false);
  });
});
