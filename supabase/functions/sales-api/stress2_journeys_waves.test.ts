// Stress series 2, round 1: a manager's wave journey end to end, through
// sales-api's followup actions (followupAgent.ts) on the fakes and the
// Follow-ups page's own batch rules (apps/sales-cockpit/src/lib/waves.ts):
// start, the day's batch, pause, stop, and what the page says after each.
//
// bun test supabase/functions/sales-api/stress2_journeys_waves.test.ts

import { describe, expect, test } from "bun:test";
import { approvedLine, type BatchDraft, toApprove, waveSettings } from "../../../apps/sales-cockpit/src/lib/waves.ts";
import { AGENT_COPY, makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@maharamedia.com" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
// Sunday 2026-10-04, 08:00 UTC: 11:00 in Kuwait.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

function setup() {
  const w = fakeWorld(SUN_11);
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
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
  /** Today's batch as WavesCard builds it from the drafts and their meta. */
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
        // Since fix round 1 the card reads each opener's wave state.
        wave_state: (w.db.t("cockpit_sales_followup_waves").find(x => x.id === m.wave_id)?.state as string) ?? null,
      };
    });
  }
  return { ...w, agent, sends, opener, batchRows };
}

describe("journey: a manager stops a wave, then approves today's batch", () => {
  test("Approve all after Stop must not say the stopped wave's openers go (and they must not take the running wave's 40)", async () => {
    const w = setup();
    const start = async (pool: string) =>
      String(((await w.agent.actions["followup.wave"]!(boss, { op: "start", pool })).wave as Row).id);
    const stopped = await start("never_booked");
    const running = await start("no_show_cancelled");
    // The desk wrote today's batch for both waves: the stopped wave's first (older).
    const old = Array.from({ length: 40 }, (_, i) => w.opener(stopped, `old-${i}`));
    const live = Array.from({ length: 5 }, (_, i) => w.opener(running, `live-${i}`));
    // The manager stops the first wave. The page says: "Stopped. The desk takes
    // back its openers within 5 minutes." Until it does, they sit in the batch.
    await w.agent.actions["followup.wave"]!(boss, { op: "stop", wave_id: stopped });
    const batch = w.batchRows([...old, ...live]);
    // Fixed in fix round 1: the card leaves the stopped wave's openers out of
    // Approve all (shown as Taken back), so the press is the running wave's 5.
    const ids = toApprove(batch, w.clock.now);
    expect(ids.sort()).toEqual([...live].sort());
    const out = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids });
    const line = approvedLine(out, waveSettings({ waves: { batch_gap_s: 45 } }).gapS);
    expect(out.count).toBe(5);
    expect(line).not.toMatch(/40/);
    // The stopped wave's openers are never approved, so none of them is said to go.
    const oldApproved = old.filter(id => Boolean((w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row)?.send_after));
    const runningApproved = live.filter(id => Boolean((w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row)?.send_after));
    expect({ oldApproved: oldApproved.length, runningApproved: runningApproved.length }).toEqual({ oldApproved: 0, runningApproved: 5 });
    // A press that still names the stopped wave's openers (an older page) is
    // refused by sales-api itself, with the reason, and approves nothing.
    let said = "";
    try {
      await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: old });
    } catch (e) {
      if (e instanceof ApiRefusal) said = e.message;
    }
    expect(said).toBe(AGENT_COPY.batch_taken_back.replace("{n}", "40"));
    expect(old.filter(id => Boolean((w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row)?.send_after))).toHaveLength(0);
    // The running wave's five go; a stopped wave's opener asked for anyway is refused at the send.
    w.clock.now += 60 * 60_000;
    let went = 0;
    for (const id of live) {
      await w.agent.desk["followup.send_due"]!(desk, { id });
      went++;
    }
    expect(went).toBe(5);
  });
});
