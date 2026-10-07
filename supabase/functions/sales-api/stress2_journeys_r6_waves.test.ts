// Stress series 2, round 6: a manager's wave journey end to end, through
// sales-api's followup.wave on the fakes (followupAgent.ts) and the
// Follow-ups page's Backlog waves card (apps/sales-cockpit/src/components/
// WavesCard.tsx), which says one line after each press.
//
// bun test supabase/functions/sales-api/stress2_journeys_r6_waves.test.ts
//
// Each test's last expectations are what should hold; a failing one is a
// finding, and its comment says what the manager reads instead.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { batchState } from "../../../apps/sales-cockpit/src/lib/waves.ts";
import { AGENT_COPY, makeFollowupAgent, SENDING } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
// Sunday 2026-10-04, 08:00 UTC: 11:00 in Kuwait, inside the first hours.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

function setup() {
  const w = fakeWorld(SUN_11);
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async () => undefined,
    sendFollowup: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  return { ...w, agent };
}

/** The desk's followup.send_due has claimed one of the wave's approved openers and is sending it now. */
function deskSendingOne(w: ReturnType<typeof setup>, waveId: string) {
  const fid = fakeUuid();
  w.db.seed("cockpit_sales_followups", [
    {
      id: fid,
      contact_id: "stress-r6-wave-lead",
      status: "draft",
      segment: "reactivate",
      channel: "whatsapp_template",
      touch: 1,
      context: { wave_id: waveId, language: "ar" },
      created_at: new Date(SUN_11 - 3_600_000).toISOString(),
    },
  ]);
  w.db.seed("cockpit_sales_followup_meta", [
    {
      followup_id: fid,
      wave_id: waveId,
      send_after: new Date(SUN_11 - 60_000).toISOString(),
      approved_by: "boss@stress.invalid",
      held_by: SENDING,
      held_at: new Date(w.clock.now - 10_000).toISOString(),
    },
  ]);
  return fid;
}

/** WavesCard's press handler for `op` (pause or stop), as written: the source between its run() key and the line it returns. */
function cardHandler(op: "pause" | "stop"): string {
  const src = readFileSync(new URL("../../../apps/sales-cockpit/src/components/WavesCard.tsx", import.meta.url), "utf8");
  const at = src.indexOf(`run(\`${op}:\${w.id}\``);
  expect(at).toBeGreaterThan(0);
  const end = src.indexOf("})", src.indexOf("return ", at));
  return src.slice(at, end);
}

describe("journey: a manager starts a wave, approves its batch, and presses Pause (then Stop) while the desk is sending an opener", () => {
  for (const op of ["pause", "stop"] as const) {
    test(`${op}: the card tells the manager what sales-api told it, that one opener may still go`, async () => {
      const w = setup();
      const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
      const waveId = String((started.wave as Row).id);
      deskSendingOne(w, waveId);
      w.clock.now += 5_000;
      const out = (await w.agent.actions["followup.wave"]!(boss, { op, wave_id: waveId })) as Row;
      // sales-api says it (stress2 round 4: "said, never hidden").
      expect(out.going_now).toBe(1);
      expect(out.note).toBe(AGENT_COPY.wave_going_now);
      // What the card says after the press: WavesCard's run() handler for
      // this press awaits followup.wave and returns a fixed line ("Paused. No
      // new batch is written until you resume it." / "Stopped. The desk takes
      // back its openers within 5 minutes."), never reading the answer, so
      // the manager is told nothing more goes while an opener is on its way
      // to HighLevel and may still reach the lead.
      const handler = cardHandler(op);
      expect(handler).toMatch(/going_now|\.note\b/);
    });
  }
});

/** The card's opener row: which batch states get a Hold button (WavesCard.tsx), as written. */
function holdOffered(): string {
  const src = readFileSync(new URL("../../../apps/sales-cockpit/src/components/WavesCard.tsx", import.meta.url), "utf8");
  const at = src.indexOf('st === "held" || st === "set_aside" ? (');
  expect(at).toBeGreaterThan(0);
  const hold = src.indexOf(") : st === ", at);
  return src.slice(hold, src.indexOf("? (", hold));
}

describe("journey: a manager approves the paused wave's batch, then reads one opener as wrong (a company name as the first name) and wants to keep it back before pressing Resume", () => {
  test("the opener's row offers Hold, which sales-api allows on an approved opener of a paused wave", async () => {
    const w = setup();
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const waveId = String((started.wave as Row).id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = fakeUuid();
      const lead = `stress-r6-wave-paused-${i}`;
      ids.push(id);
      w.db.seed("cockpit_sales_leads", [{ contact_id: lead, country: "KW" }]);
      w.db.seed("cockpit_sales_followups", [
        {
          id,
          contact_id: lead,
          segment: "reactivate",
          channel: "whatsapp",
          status: "draft",
          touch: 1,
          body: i === 2 ? "Hi Al Mutairi Contracting, it's Sara from Mahara Media." : "Hi",
          created_at: new Date(w.clock.now - 60 * 60_000 + i).toISOString(),
          context: { wave_id: waveId, kind_key: "reactivate" },
        },
      ]);
      w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, kind_key: "reactivate", held_by: null }]);
    }
    await w.agent.actions["followup.wave"]!(boss, { op: "pause", wave_id: waveId });
    const out = (await w.agent.actions["followup.batch"]!(boss, { ids })) as Row;
    expect(out.waiting_resume).toBe(3);
    const wrong = ids[2] as string;
    const m = w.db.t("cockpit_sales_followup_meta").find(x => x.followup_id === wrong) as Row;
    // The card's row for it: "Waits for resume".
    const st = batchState({
      id: wrong,
      contact_id: "stress-r6-wave-paused-2",
      wave_id: waveId,
      send_after: (m.send_after as string) ?? null,
      held_by: (m.held_by as string) ?? null,
      held_at: null,
      hold_reason: null,
      wave_state: "paused",
    } as never);
    expect(st).toBe("waits_resume");
    // sales-api takes the hold (and the approval back) as it does for any approved opener.
    const held = (await w.agent.actions["followup.hold"]!(boss, { id: wrong, on: true })) as Row;
    expect((held.meta as Row).held_by).toBe("boss@stress.invalid");
    // The card: Hold shows only for "undecided" and "approved" (and Release
    // for held or set aside), so the row reads "Waits for resume" with no
    // button. The only way to keep that opener back is Stop (the whole
    // wave) or Resume and race the desk's next send with a Hold once the
    // row turns "Approved": after Resume the approved openers' turns are
    // already past, so the desk sends them one every 45 seconds at its next
    // run.
    expect(holdOffered()).toMatch(/waits_resume/);
  });
});
