// bun test supabase/functions/sales-api/stress2_concurrency_r4_send_due.test.ts
//
// Second series, round 4, dimension: concurrency and idempotency, for the
// follow-up agent's paced send (followupAgent.ts sendDue on testfakes.ts).
//
// sendDue reads the opener's wave (running?), the kind's switch, the gate,
// the lead's hours, the stops (a rep's pause, the lead's STOP) and the
// lead's calls, and only then claims the opener (meta held_by: sending,
// guarded on held_by is null) and sends. The claim is guarded on a person's
// hold alone: a manager's Pause or Stop of the wave, or a rep's Pause for
// this lead, that lands after those reads and before the claim never reaches
// the send (contract 0b.12: "Pause, stop and hold always work"). The desk
// sends a batch one opener every 45 s, each send_due taking from a few
// hundred milliseconds to seconds (HighLevel's reads, the slot, the
// enrolment), so a Pause pressed at a random moment lands inside one in
// roughly one press in ten.
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel; every lead is invented.
import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import type { LiveIO } from "./liveio.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@stress.invalid" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
// Sunday 4 October 2026, 11:00 in Kuwait: inside the first-message hours, not a day off.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");
const LEAD = "stress-s2c4-lead-1";

function setup() {
  const w = fakeWorld(SUN_11);
  const sends: Row[] = [];
  /** Runs once, the first time sendDue reads a table whose path starts with `atPrefix` (after it read the wave). */
  let atStops: (() => Promise<void>) | null = null;
  let atPrefix = "cockpit_sales_followup_stops";
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: "KW", assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_people", [{ email: rep.email, ghl_user_id: "G-setter", active: true, role: "setter" }]);
  const io: LiveIO = {
    ...w.io,
    db: async (path, init) => {
      if ((init?.method ?? "GET") === "GET" && path.startsWith(atPrefix) && atStops) {
        const hook = atStops;
        atStops = null;
        await hook();
      }
      return await w.io.db(path, init);
    },
  };
  const agent = makeFollowupAgent({
    io,
    audit: async () => {},
    sendFollowup: async (who, f) => {
      sends.push({ who: who.email, id: f.id, at: w.clock.now });
      return { followup: { status: "sent" }, message: { state: "sent" } };
    },
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  /** A running wave with one approved opener whose turn has come. */
  async function waveWithDueOpener(): Promise<{ waveId: string; id: string }> {
    const started = await agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const waveId = String((started.wave as Row).id);
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      {
        id,
        contact_id: LEAD,
        owner_email: rep.email,
        segment: "reactivate",
        channel: "whatsapp_template",
        status: "draft",
        touch: 1,
        body: "Hi",
        created_at: new Date(w.clock.now - 60 * 60_000).toISOString(),
        context: { wave_id: waveId, kind_key: "reactivate" },
      },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [
      {
        followup_id: id,
        wave_id: waveId,
        kind_key: "reactivate",
        held_by: null,
        send_after: new Date(w.clock.now - 60_000).toISOString(),
        approved_by: boss.email,
        approved_at: new Date(w.clock.now - 5 * 60_000).toISOString(),
      },
    ]);
    return { waveId, id };
  }
  return {
    ...w,
    agent,
    sends,
    waveWithDueOpener,
    onStopsRead: (f: () => Promise<void>, prefix = "cockpit_sales_followup_stops") => {
      atStops = f;
      atPrefix = prefix;
    },
  };
}

describe("a Pause that lands while send_due is checking an opener", () => {
  test("wave-pause-during-send-due-still-sends: the manager pauses the wave after send_due read it as running and before it claimed the opener; the Pause was answered 'paused', so the opener must not go", async () => {
    const w = setup();
    const { waveId, id } = await w.waveWithDueOpener();
    let paused: Row | null = null;
    w.onStopsRead(async () => {
      paused = await w.agent.actions["followup.wave"]!(boss, { op: "pause", wave_id: waveId });
    });
    await w.agent.desk["followup.send_due"]!(desk, { id }).catch(() => null);
    expect(((paused as Row | null)?.wave as Row | undefined)?.state).toBe("paused");
    expect({ openers_sent_after_the_pause: w.sends.length }).toEqual({ openers_sent_after_the_pause: 0 });
  });

  test("wave-stop-during-send-due-still-sends: the same with Stop (the wave is done and its openers are being taken back): nothing may go", async () => {
    const w = setup();
    const { waveId, id } = await w.waveWithDueOpener();
    w.onStopsRead(async () => {
      await w.agent.actions["followup.wave"]!(boss, { op: "stop", wave_id: waveId });
    });
    await w.agent.desk["followup.send_due"]!(desk, { id }).catch(() => null);
    expect((w.db.t("cockpit_sales_followup_waves")[0] as Row).state).toBe("done");
    expect({ openers_sent_after_the_stop: w.sends.length }).toEqual({ openers_sent_after_the_stop: 0 });
  });

  test("lead-pause-during-send-due-still-sends: the setter answers the lead's stop task with Pause (followup.stop_task) while send_due checks the opener: nothing may go to that lead", async () => {
    const w = setup();
    const { id } = await w.waveWithDueOpener();
    let answered: unknown = null;
    w.onStopsRead(async () => {
      answered = await w.agent.actions["followup.stop_task"]!(rep, { contact_id: LEAD, answer: "pause" }).catch(e => e);
    }, "cockpit_sales_calendar");
    await w.agent.desk["followup.send_due"]!(desk, { id }).catch(() => null);
    const pausedNow = w.db.t("cockpit_sales_followup_stops").some(s => s.contact_id === LEAD && /pause/.test(String(s.state ?? s.kind)));
    // Only meaningful once the setter's Pause was taken.
    expect({ pause_recorded: pausedNow, answered: answered instanceof Error ? answered.message : "ok" }).toEqual({ pause_recorded: true, answered: "ok" });
    expect({ openers_sent_after_the_lead_pause: w.sends.length }).toEqual({ openers_sent_after_the_lead_pause: 0 });
  });
});
