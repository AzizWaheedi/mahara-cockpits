// Stress series 2, round 2: a manager's wave journey end to end, through
// sales-api's followup actions (followupAgent.ts) on the fakes and the
// Follow-ups page's own lines (apps/sales-cockpit/src/lib/waves.ts): start,
// pause, the day's batch approved while paused, resume, stop, and what the
// card says at each step. The desk's half of the same journey is in
// hermes/sales-desk/tests/test_stress2_journeys_r2.py.
//
// bun test supabase/functions/sales-api/stress2_journeys_r2_waves.test.ts
//
// Each test's last expectations are what should hold; a failing one is a
// finding, and its comment says what the manager reads instead.

import { describe, expect, test } from "bun:test";
import { approvedLine, countMembers, countsFor, readWave, toApprove, type BatchDraft, waveLine, waveSettings } from "../../../apps/sales-cockpit/src/lib/waves.ts";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@stress.invalid" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
// Sunday 2026-10-04, 08:00 UTC: 11:00 in Kuwait, inside the first hours.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

function setup() {
  const w = fakeWorld(SUN_11);
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: rep.email, ghl_user_id: "G-setter", active: true }]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async () => undefined,
    sendFollowup: async (who, f) => {
      sends.push({ who: who.email, id: f.id });
      return { followup: { status: "sent" }, message: { state: "sent" } };
    },
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  /** The desk's draft of a wave's opener and its meta row, as waves.py writes them. */
  function opener(waveId: string, contact: string): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_leads", [{ contact_id: contact, country: "KW", assigned_to: "G-setter" }]);
    w.db.seed("cockpit_sales_followups", [
      {
        id,
        contact_id: contact,
        owner_email: rep.email,
        segment: "reactivate",
        channel: "whatsapp_text",
        status: "draft",
        touch: 1,
        body: "Hi",
        created_at: w.db.iso(),
        context: { wave_id: waveId, language: "ar" },
      },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, kind_key: "reactivate.ar.whatsapp_text" }]);
    w.clock.now += 1000;
    return id;
  }
  /** Today's batch as WavesCard builds it from the drafts, their meta and their wave's state. */
  function batchRows(ids: string[]): BatchDraft[] {
    return ids.map(id => {
      const f = w.db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
      const m = (w.db.t("cockpit_sales_followup_meta").find(x => x.followup_id === id) ?? {}) as Row;
      return {
        id,
        contact_id: String(f.contact_id),
        wave_id: (m.wave_id as string) ?? null,
        send_after: (m.send_after as string) ?? null,
        held_by: (m.held_by as string) ?? null,
        held_at: (m.held_at as string) ?? null,
        hold_reason: (m.hold_reason as string) ?? null,
        wave_state: (w.db.t("cockpit_sales_followup_waves").find(x => x.id === m.wave_id)?.state as string) ?? null,
      };
    });
  }
  return { ...w, agent, sends, opener, batchRows };
}

async function refusalOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof ApiRefusal) return e.message;
    throw e;
  }
}

describe("journey: a manager pauses a wave, then approves the day's batch on the Follow-ups page", () => {
  test("the line after Approve all must not say the paused wave's openers are going out one every 45 seconds", async () => {
    const w = setup();
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const waveId = String((started.wave as Row).id);
    // The desk wrote today's batch of five.
    const ids = Array.from({ length: 5 }, (_, i) => w.opener(waveId, `stress-r2j-pause-${i}`));
    // The manager presses Pause: "Paused. No new batch is written until you resume it."
    await w.agent.actions["followup.wave"]!(boss, { op: "pause", wave_id: waveId });
    // The card's batch: the paused wave's openers read "Waiting" and Approve all takes all five.
    const batch = w.batchRows(ids);
    const approve = toApprove(batch, w.clock.now);
    expect(approve.sort()).toEqual([...ids].sort());
    const out = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: approve });
    const line = approvedLine(out, waveSettings({ waves: { batch_gap_s: 45 } }).gapS, { from: 9, to: 18, daysOff: ["friday"] }, w.clock.now);
    // The desk's send_due at each turn: every one is refused, the wave is not running.
    w.clock.now += 10 * 60_000;
    const said: (string | null)[] = [];
    for (const id of ids) said.push(await refusalOf(w.agent.desk["followup.send_due"]!(desk, { id })));
    expect(w.sends).toHaveLength(0);
    expect(said.every(s => /paused or stopped/.test(String(s)))).toBe(true);
    // The card read: "Approved. One goes every 45 seconds, finishing at 11:03.
    // 5 openers wait for their wave to resume." Nothing goes until a Resume,
    // and the first half of the line says they are going now.
    expect(out.waiting_resume).toBe(5);
    expect(line).not.toMatch(/One goes every 45 seconds/);
    expect(line).not.toMatch(/finishing at/);
  });
});

describe("journey: a manager starts a wave and pauses it before the desk's next run", () => {
  test("the paused wave's line must not promise the desk adds its leads within 5 minutes (the desk enrols running waves only)", async () => {
    const w = setup();
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const waveId = String((started.wave as Row).id);
    const paused = await w.agent.actions["followup.wave"]!(boss, { op: "pause", wave_id: waveId });
    const wave = readWave(paused.wave);
    expect(wave?.state).toBe("paused");
    // No member rows yet: desk/waves.py run() enrols only `state == "running"`
    // waves without enrolled_at (test_stress2_journeys_r2.py shows a run
    // leaves a paused wave with no members), so none come while it is paused.
    const line = waveLine(wave!, countsFor(countMembers([]), waveId), null);
    // "Leads never booked, 40 a day, newest first. The desk adds the pool's
    // leads within 5 minutes; nothing is counted before then." for as long as
    // it stays paused.
    expect(line).not.toMatch(/within 5 minutes/);
  });
});
