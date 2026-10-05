// bun test supabase/functions/sales-api/stress_desk_followup.test.ts
//
// Stress round 1, the follow-up agent's sales-api doors (2026-10-03): a
// manager's wave approval against a rep's hold and a large wave, two desk
// sends of one draft at once, the WA Connector gate turned off and on again,
// and the rep's own Approve on a backlog opener. Each test asserts what must
// hold; a failing test names a defect for the fix lane. Every lead and line is
// invented.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { gateOpen, whatsappGuardValue } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@maharamedia.com" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00.000Z" };
const SUN_11 = Date.parse("2026-10-04T08:00:00Z"); // 11:00 in Kuwait, a Sunday

function setup() {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  const knobs: { send: (f: Row) => Promise<Row> } = {
    send: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: "c1", country: "KW", assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_people", [{ email: rep.email, ghl_user_id: "G-setter", active: true }]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async (who, action, _t, id, _b, after) => {
      audits.push({ who: who.email, action, id, after });
    },
    sendFollowup: (_who, f) => knobs.send(f),
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  const waveId = fakeUuid();
  w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "never_booked", state: "running", made_by: boss.email }]);
  const draft = (over: Row = {}, meta: Row = {}) => {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      { id, contact_id: "c1", owner_email: rep.email, segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi Huda", created_at: w.db.iso(), ...over },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, ...meta }]);
    return id;
  };
  const meta = (id: string) => w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row | undefined;
  return { ...w, agent, audits, knobs, draft, meta, waveId };
}

async function outcome(p: Promise<unknown>): Promise<Row | ApiRefusal> {
  try {
    return (await p) as Row;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
}

describe("followup.batch {wave_id}: the manager's approval of a whole wave", () => {
  test("a rep's own hold is kept (only the desk's set-aside is cleared)", async () => {
    const w = setup();
    const held = w.draft({}, { held_by: rep.email, hold_reason: "Calling her first." });
    const open = w.draft();
    const out = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), wave_id: w.waveId });
    expect(out.count).toBe(1);
    expect(w.meta(held)?.held_by).toBe(rep.email);
    expect(w.meta(held)?.send_after ?? null).toBeNull();
    expect(w.meta(open)?.send_after).toBeTruthy();
  });

  test("a wave with more than 40 open openers approves 40, never refuses the whole press", async () => {
    const w = setup();
    for (let i = 0; i < 45; i++) w.draft();
    const r = await outcome(w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), wave_id: w.waveId }));
    expect(r instanceof ApiRefusal ? r.message : null).toBeNull();
    expect((r as Row).count).toBe(40);
  });

  test("today's openers are found behind 500 finished ones", async () => {
    const w = setup();
    for (let i = 0; i < 500; i++) w.draft({ status: "sent", created_at: new Date(SUN_11 - 86_400_000 * 13).toISOString() });
    const today = [w.draft(), w.draft(), w.draft()];
    const r = await outcome(w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), wave_id: w.waveId }));
    expect(r instanceof ApiRefusal ? r.message : null).toBeNull();
    expect((r as Row).count).toBe(3);
    expect(today.every(id => w.meta(id)?.send_after)).toBe(true);
  });
});

describe("followup.send_due: two desk sends of one draft at once", () => {
  test("the loser's refusal never sets aside the draft the winner is sending", async () => {
    const w = setup();
    const id = w.draft({}, { send_after: new Date(SUN_11 - 1000).toISOString(), approved_by: rep.email });
    let release!: () => void;
    const gate = new Promise<void>(r => {
      release = r;
    });
    let first = true;
    // index.ts sendFollowup's claim: draft -> sending; a second claim finds none.
    w.knobs.send = async f => {
      const row = w.db.t("cockpit_sales_followups").find(x => x.id === f.id)!;
      if (row.status !== "draft") throw new ApiRefusal("Someone else has just dealt with this draft.", 409);
      row.status = "sending";
      if (first) {
        first = false;
        await gate; // HighLevel is slow for the winner
        // ...and refuses before anything went out: the draft waits again (fixable).
        row.status = "draft";
        throw new ApiRefusal("A template went to this lead a moment ago. Wait two minutes before sending another.", 409);
      }
      return { followup: { status: "sent" }, message: { state: "sent" } };
    };
    const a = outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
    const b = outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
    const rb = await b;
    release();
    await a;
    expect(rb instanceof ApiRefusal ? rb.message : "").toBe("Someone else has just dealt with this draft.");
    // The second desk run only lost a race; the draft is not put in front of a person for it.
    const asides = w.audits.filter(x => x.action === "followup.set_aside" && String((x.after as Row)?.hold_reason ?? "").includes("Someone else"));
    expect(asides).toHaveLength(0);
  });
});

describe("whatsapp.guard: the WA Connector turned on again", () => {
  test("turning the connector off again needs a new single-copy test", () => {
    const now = Date.parse("2026-10-05T08:00:00Z");
    const open = whatsappGuardValue({}, { connector_off: true, single_copy_ok_at: true }, now - 86_400_000);
    expect(open.ok && gateOpen(open.value)).toBe(true);
    // A manager (or an older page) says the connector is on again, sending only that key.
    const on = whatsappGuardValue(open.ok ? open.value : {}, { connector_off: false }, now - 3_600_000);
    expect(on.ok && gateOpen(on.value)).toBe(false);
    // The connector is said to be off again: the old test from before it came back must not open the gate.
    const off = whatsappGuardValue(on.ok ? on.value : {}, { connector_off: true }, now);
    expect(off.ok && gateOpen(off.value)).toBe(false);
  });

  test("a single-copy test from before the connector went off does not count", () => {
    const now = Date.parse("2026-10-05T08:00:00Z");
    const off = whatsappGuardValue({}, { connector_off: true }, now);
    const old = whatsappGuardValue(off.ok ? off.value : {}, { single_copy_ok_at: "2026-09-01T08:00:00Z" }, now + 1000);
    expect(old.ok && gateOpen(old.value)).toBe(false);
  });
});

describe("followup.approve on a backlog opener (index.ts, read as source: the module serves, it does not export)", () => {
  // A rep's single Approve goes through sendFollowup with no wave, switch or
  // gate check: a paused or stopped wave's opener, or one while the agent is
  // switched off, goes the moment a seat posts followup.approve with its id.
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const start = src.indexOf("async function followupApprove(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  test("refuses a reactivate draft, or checks its wave, the switch and the gate", () => {
    expect(start).toBeGreaterThan(0);
    expect(/reactivate|wave|gateOpen|enabled/.test(body)).toBe(true);
  });
});

describe("followup.send_due: a lead who booked after the batch was approved (stress round 1)", () => {
  test("the opener is taken back, never sent, and the draft is not put in front of a person", async () => {
    const w = setup();
    const id = w.draft({}, { send_after: new Date(SUN_11 - 1000).toISOString(), approved_by: rep.email });
    let sent = 0;
    w.knobs.send = async () => {
      sent++;
      return { followup: { status: "sent" }, message: { state: "sent" } };
    };
    w.db.seed("cockpit_sales_calendar", [
      { appointment_id: "a1", contact_id: "c1", call_type: "intro", status: "confirmed", start_at: new Date(SUN_11 + 86_400_000).toISOString() },
    ]);
    const r = await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
    expect(r instanceof ApiRefusal ? r.message : "").toContain("taken back");
    expect(sent).toBe(0);
    expect(w.db.t("cockpit_sales_followups").find(f => f.id === id)?.status).toBe("expired");
    expect(w.audits.filter(a => a.action === "followup.set_aside")).toHaveLength(0);
  });
});
