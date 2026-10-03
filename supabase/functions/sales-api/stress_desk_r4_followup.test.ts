// bun test supabase/functions/sales-api/stress_desk_r4_followup.test.ts
//
// Stress round 4, the follow-up agent's sales-api doors (2026-10-03): an
// approved opener that waited (the lead's hours, a paused wave, a gate that
// shut again) while the lead had their call or was disqualified, and an
// Approve all pressed after the month's template budget is spent. Each test
// asserts what must hold; a failing test names a defect for the fix lane.
// Every lead and line is invented.

import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00.000Z" };
const SUN_11 = Date.parse("2026-10-04T08:00:00Z"); // 11:00 in Kuwait, a Sunday
const ago = (ms: number) => new Date(SUN_11 - ms).toISOString();
const HOUR = 3_600_000;

function setup(guard: Row = GATE) {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  let sent = 0;
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: guard },
    { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: "stress-c1", country: "KW", assigned_to: "G-setter" }]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async (who, action, _t, id, _b, after) => {
      audits.push({ who: who.email, action, id, after });
    },
    sendFollowup: async f => {
      sent++;
      return { followup: { id: f.id, status: "sent" }, message: { state: "sent" } };
    },
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  const waveId = fakeUuid();
  w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "no_show_cancelled", state: "running", made_by: boss.email }]);
  const draft = (meta: Row = {}) => {
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
        created_at: ago(21 * HOUR),
        expires_at: ago(-48 * HOUR),
        context: { wave_id: waveId, language: "ar", arm: "wave" },
      },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, ...meta }]);
    return id;
  };
  const row = (id: string) => w.db.t("cockpit_sales_followups").find(f => f.id === id) as Row;
  return { ...w, agent, audits, draft, row, sent: () => sent };
}

async function outcome(p: Promise<unknown>): Promise<Row | ApiRefusal> {
  try {
    return (await p) as Row;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 1. followup.send_due takes a backlog opener back only for a call still to
//    come. An approved opener that waited (overnight for the lead's hours, a
//    wave paused for two days, a gate that shut again) while the lead booked
//    and had their intro this morning goes out an hour after the call:
//    "How are you?" from the rep they just spoke to. The same for an intro
//    marked invalid (disqualified) since the approval. The desk's pools
//    (waves.py pool_of) hold neither lead: a held call counts only a day on,
//    and a disqualified lead is in no pool.
// ---------------------------------------------------------------------------

describe("followup.send_due: an approved opener whose lead has left the backlog since", () => {
  const cases: [string, Row][] = [
    ["an intro held an hour ago", { status: "showed", start_at: ago(HOUR) }],
    ["an intro that started 20 minutes ago and is still confirmed (held, by the B2B rule)", { status: "confirmed", start_at: ago(20 * 60_000) }],
    ["an intro marked invalid (disqualified) since the approval", { status: "invalid", start_at: ago(3 * HOUR) }],
  ];
  for (const [what, call] of cases) {
    test(`${what}: the opener does not go`, async () => {
      const w = setup();
      w.db.seed("cockpit_sales_calendar", [
        { appointment_id: "stress-old", contact_id: "stress-c1", call_type: "intro", status: "noshow", start_at: ago(240 * HOUR) },
        { appointment_id: "stress-new", contact_id: "stress-c1", call_type: "intro", booked_at: ago(14 * HOUR), ...call },
      ]);
      const id = w.draft({ send_after: ago(20 * HOUR), approved_by: boss.email });
      const r = await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
      expect(w.sent()).toBe(0);
      expect(r instanceof ApiRefusal).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Approve all with the month's template budget spent: followup.batch
//    checks the switch and the gate, not the budget, and answers "Approved.
//    One goes every 45 seconds, finishing at ..." for openers that cannot
//    go this month. Each one then holds its lead's one open draft.
// ---------------------------------------------------------------------------

describe("followup.batch after the month's template budget is spent", () => {
  test("the press is refused with the budget's sentence, never answered as approved", async () => {
    const w = setup({ ...GATE, template_budget_usd_month: 1, template_rate_usd: 0.1 });
    for (let i = 0; i < 10; i++)
      w.db.seed("cockpit_sales_messages", [
        {
          id: fakeUuid(),
          request_id: fakeUuid(),
          contact_id: `stress-other-${i}`,
          via: "workflow",
          state: "sent",
          sent_by: "rep@stress.invalid",
          created_at: ago(48 * HOUR),
        },
      ]);
    const id = w.draft();
    const r = await outcome(w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] }));
    expect(r instanceof ApiRefusal ? r.message : `approved ${(r as Row).count}`).toMatch(/budget/i);
  });
});

// ---------------------------------------------------------------------------
// 3. One lead's error that is not a refusal: sendTemplate's contact read gets
//    HighLevel's 400 "Contact not found" (the contact was merged or deleted
//    in HighLevel after its opener was written). ghl() throws a plain Error,
//    sendFollowup puts the draft back, and followup.send_due lets it through
//    as a 500 "That did not work", which the desk reads as sales-api failing
//    for every send: it stops the run, and the same opener, still first in
//    the queue, stops every run after it (desk test_stress_desk_r4,
//    OneLeadsErrorNeverHoldsEveryRun).
// ---------------------------------------------------------------------------

describe("followup.send_due: HighLevel no longer has this lead's contact", () => {
  test("the answer is this lead's refusal (a 4xx), not a 500 that stops every desk run", async () => {
    const w = fakeWorld(SUN_11);
    w.db.seed("cockpit_sales_settings", [
      { key: "whatsapp_guard", value: GATE },
      { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] } },
      { key: "messaging", value: { whatsapp: true } },
    ]);
    w.db.seed("cockpit_sales_leads", [{ contact_id: "stress-c1", country: "KW" }]);
    const waveId = fakeUuid();
    w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "no_show_cancelled", state: "running", made_by: boss.email }]);
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      {
        id,
        contact_id: "stress-c1",
        segment: "reactivate",
        channel: "whatsapp_template",
        status: "draft",
        touch: 1,
        body: "Hi Huda",
        created_at: ago(2 * HOUR),
        context: { wave_id: waveId, language: "ar" },
      },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, send_after: ago(60_000), approved_by: boss.email }]);
    const agent = makeFollowupAgent({
      io: w.io,
      audit: async () => {},
      // index.ts sendFollowup after ghl("GET", /contacts/...) threw: the draft is a draft again, the error rethrown.
      sendFollowup: async () => {
        throw Object.assign(new Error("HighLevel said 400: Contact not found"), { status: 400 });
      },
      whatsappHealth: async () => ({ paused: false, why: "" }),
    });
    let answer: unknown;
    try {
      answer = await agent.desk["followup.send_due"]!(desk, { id });
    } catch (e) {
      answer = e;
    }
    expect(answer instanceof ApiRefusal ? `${(answer as ApiRefusal).status}` : `plain error, so the door answers 500: ${String(answer)}`).toMatch(/^4\d\d$/);
  });
});

// ---------------------------------------------------------------------------
// 4. A rep pauses the agent for this lead (followup.stop_task, answer pause:
//    a manual stops row for 30 days) after the opener was approved, while it
//    waits for the lead's hours. followup.send_due never reads the stops
//    table, so the opener goes to the lead the rep paused (the desk's own
//    last look does not read it either: test_stress_desk_r4).
// ---------------------------------------------------------------------------

describe("followup.send_due after a rep paused the agent for the lead", () => {
  test("the approved opener does not go", async () => {
    const w = setup();
    const id = w.draft({ send_after: ago(15 * HOUR), approved_by: boss.email });
    const paused = await w.agent.actions["followup.stop_task"]!(boss, { contact_id: "stress-c1", answer: "pause" });
    expect((paused.stop as Row).state).toBe("paused");
    const r = await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
    expect(w.sent()).toBe(0);
    expect(r instanceof ApiRefusal).toBe(true);
  });
});
