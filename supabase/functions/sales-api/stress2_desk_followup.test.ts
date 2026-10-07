// bun test supabase/functions/sales-api/stress2_desk_followup.test.ts
//
// Stress series 2, round 1, the follow-up agent's sales-api doors as the
// desk and the waves meet them (2026-10-04). Each test asserts what must
// hold; a failing test names a defect for the fix lane. Every lead and line
// is invented.

import { describe, expect, test } from "bun:test";
import { AGENT_COPY, makeFollowupAgent, openerTakenBack } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { budgetCap } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00.000Z" };
const SUN_11 = Date.parse("2026-10-04T08:00:00Z"); // 11:00 in Kuwait, a Sunday
const ago = (ms: number) => new Date(SUN_11 - ms).toISOString();
const HOUR = 3_600_000;
// PostgREST's max-rows on Creative Triage (management API, read 2026-10-03):
// a GET answers at most this many rows, whatever its limit asks.
const MAX_ROWS = 1000;

async function outcome(p: Promise<unknown>): Promise<Row | ApiRefusal> {
  try {
    return (await p) as Row;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 1. Approve all once the month's template budget is spent, at the budget
//    as it ships ($100 at Meta's $0.0792: 1,262 templates). followup.batch
//    (round 4's fix) reads this month's templates in one request with
//    limit=cap (1,262), and PostgREST answers at most 1,000 rows: the count
//    stops at 1,000, under the cap, so the budget never refuses an Approve
//    all at the shipped settings. The openers are approved ("one every 45
//    seconds"), each then refused at the send, and each holds its lead's one
//    open draft until it goes stale 72 hours later.
// ---------------------------------------------------------------------------

describe("followup.batch at the shipped budget, past 1,000 templates this month", () => {
  test("the spent budget refuses the press, as it does below 1,000", async () => {
    const w = fakeWorld(SUN_11);
    const db = w.io.db;
    w.io.db = async (path, init) => {
      const rows = await db(path, init);
      return (init?.method ?? "GET") === "GET" ? rows.slice(0, MAX_ROWS) : rows;
    };
    w.db.seed("cockpit_sales_settings", [
      { key: "whatsapp_guard", value: { ...GATE, template_budget_usd_month: 100 } },
      { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] } },
    ]);
    const cap = budgetCap({ template_budget_usd_month: 100 });
    expect(cap).toBeGreaterThan(MAX_ROWS);
    // The month's templates so far: the cap's worth, every one sent ($99.95).
    w.db.seed(
      "cockpit_sales_messages",
      Array.from({ length: cap }, (_, i) => ({
        id: fakeUuid(),
        request_id: fakeUuid(),
        contact_id: `stress-other-${i}`,
        via: "workflow",
        state: "sent",
        sent_by: "rep@stress.invalid",
        created_at: ago(30 * HOUR),
      })),
    );
    const waveId = fakeUuid();
    w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "no_show_cancelled", state: "running", made_by: boss.email }]);
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      {
        id,
        contact_id: "stress-c1",
        segment: "reactivate",
        channel: "whatsapp_template",
        template_key: "opener_ar",
        status: "draft",
        touch: 1,
        body: "Hi Huda",
        created_at: ago(2 * HOUR),
        expires_at: ago(-46 * HOUR),
        context: { wave_id: waveId, language: "ar", arm: "wave" },
      },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId }]);
    const agent = makeFollowupAgent({
      io: w.io,
      audit: async () => {},
      sendFollowup: async f => ({ followup: { id: f.id, status: "sent" }, message: { state: "sent" } }),
      whatsappHealth: async () => ({ paused: false, why: "" }),
    });
    const r = await outcome(agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] }));
    const said = r instanceof ApiRefusal ? r.message : `approved ${(r as Row).count} opener(s) to go from ${(r as Row).first_at}`;
    // $99.95 of $100 is spent: the press must be refused with the budget's sentence.
    expect({ refused: r instanceof ApiRefusal, said }).toEqual({ refused: true, said: expect.stringMatching(/budget/i) });
  });
});

// ---------------------------------------------------------------------------
// 2. crm-disqualified-stage-leads-in-backlog-pools (fix round 1): a lead the
//    team disqualified in HighLevel moved to the DISQUALIFIED (or a lost)
//    stage with the call left as it was. The desk's pool_of keeps them out
//    of every pool; an opener approved before the move is taken back at the
//    send by the same rule.
// ---------------------------------------------------------------------------

describe("a lead whose deal is in a disqualified or lost stage in the CRM", () => {
  test("the approved opener is taken back at the send, whatever the call says", () => {
    const noshow = [{ call_type: "intro", status: "noshow", start_at: ago(12 * 24 * HOUR), booked_at: ago(14 * 24 * HOUR) }];
    for (const stage of ["\u{1F6D1}DISQUALIFIED", "Disqualified", "Closed Lost", "LOST", "\u{1F6D1}lost lead"])
      expect({ stage, why: openerTakenBack(noshow, SUN_11, null, stage) }).toEqual({ stage, why: AGENT_COPY.opener_stage_out });
    for (const stage of [null, "", "No show", "Follow up", "Lostboys", "Almost"])
      expect({ stage, why: openerTakenBack(noshow, SUN_11, null, stage) }).toEqual({ stage, why: null });
  });
});
