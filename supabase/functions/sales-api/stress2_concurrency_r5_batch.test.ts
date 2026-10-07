// bun test supabase/functions/sales-api/stress2_concurrency_r5_batch.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. Approve
// all (followup.batch), its answer lost, pressed again.
//
// The Waves card sends Approve all through once() (apps/sales-cockpit
// lib/rooms.ts): an answer that may not have landed (no answer, a cut
// connection, a 5xx) keeps the press's request_id, and the next press within
// two minutes sends the same one, "so the server hands back the row it
// already made instead of making a second". followup.batch never reads that
// request_id. The second press runs the whole batch again:
//   - every opener is approved again from a new start, so the schedule the
//     first press set (its first_at, the 45 s gaps the line said) moves;
//   - a second followup.batch audit row says the same 40 openers were
//     approved again (the audit log counts 80 approvals for 40 openers);
//   - and once the desk has sent the batch's first opener (its turn is the
//     press's own moment), the retry is refused "Some of these openers were
//     already sent, skipped or taken back. Reload the page.", so the manager
//     who pressed Approve all is told it did not work although every opener
//     is approved and going.
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel; every lead is invented.
import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
// Sunday 4 October 2026, 11:00 in Kuwait: inside the first-message hours, not a day off.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

function setup() {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async (_who, action, _t, id, _b, after, meta) => {
      audits.push({ action, id, after, meta });
    },
    sendFollowup: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  async function waveWithOpeners(n: number): Promise<{ waveId: string; ids: string[] }> {
    const started = await agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const waveId = String((started.wave as Row).id);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = fakeUuid();
      const lead = `stress-s2c5-batch-lead-${i}`;
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
          body: "Hi",
          created_at: new Date(w.clock.now - 60 * 60_000 + i).toISOString(),
          context: { wave_id: waveId, kind_key: "reactivate" },
        },
      ]);
      w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, kind_key: "reactivate", held_by: null }]);
    }
    return { waveId, ids };
  }
  const meta = (id: string) => w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row;
  return { ...w, agent, audits, waveWithOpeners, meta };
}

describe("Approve all pressed again after its answer was lost", () => {
  test("batch-retry-reapproves-and-double-audits: the same request id twice, 20 s apart, nothing sent between: the second press hands back the batch the first made (its schedule kept, one audit row)", async () => {
    const w = setup();
    const { ids } = await w.waveWithOpeners(5);
    const request_id = crypto.randomUUID();
    await w.agent.actions["followup.batch"]!(boss, { request_id, ids });
    const first = ids.map(id => String(w.meta(id).send_after));
    // The answer never reached the browser; the manager presses again 20 s on (once() keeps the id).
    w.clock.now += 20_000;
    await w.agent.actions["followup.batch"]!(boss, { request_id, ids });
    const second = ids.map(id => String(w.meta(id).send_after));
    expect({
      schedule_kept: JSON.stringify(second) === JSON.stringify(first),
      batch_audit_rows: w.audits.filter(a => a.action === "followup.batch").length,
    }).toEqual({ schedule_kept: true, batch_audit_rows: 1 });
  });

  test("batch-retry-refused-after-first-send: the desk sent the batch's first opener before the retry: the retry must not answer 'already sent ... Reload the page.' for a batch that is approved and going", async () => {
    const w = setup();
    const { ids } = await w.waveWithOpeners(5);
    const request_id = crypto.randomUUID();
    await w.agent.actions["followup.batch"]!(boss, { request_id, ids });
    // The desk's run sends the first opener (its turn was the press's own moment).
    w.clock.now += 50_000;
    const f = w.db.t("cockpit_sales_followups").find(x => x.id === ids[0]) as Row;
    f.status = "sent";
    let told = "ok";
    try {
      await w.agent.actions["followup.batch"]!(boss, { request_id, ids });
    } catch (e) {
      told = String((e as Error).message);
    }
    expect({ retry_told: told }).toEqual({ retry_told: "ok" });
  });
});
