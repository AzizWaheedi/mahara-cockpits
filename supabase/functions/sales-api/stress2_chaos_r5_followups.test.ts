// bun test supabase/functions/sales-api/stress2_chaos_r5_followups.test.ts
//
// Second series, round 5, chaos: the follow-up agent's doors with an answer
// lost after the write landed.
//
// followup.stop_task with answer "dnd" (a rep confirms "Stop for good" on a
// lead's stop message) claims the task first (a PATCH guarded on the state
// the page showed), then writes do-not-disturb on WhatsApp in HighLevel. The
// cockpit's own agent reads the stops table; everything else that messages
// the lead (HighLevel's own workflows, a rep's WhatsApp from the cockpit,
// a room's link, a template) reads HighLevel's do-not-disturb. When the
// claim lands and its answer is lost (the 8 s timeout fires after the
// commit), the press errors before HighLevel is written, and the rep's press
// again is refused "This stop was already answered (stop for good)": nothing
// ever writes do-not-disturb in HighLevel for a lead who asked to stop.
//
// sales-api's followupAgent.ts on testfakes.ts; every lead and line is
// invented. A failing test is a finding; tests marked HELD pass.
import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError, type LiveIO } from "./liveio.ts";
import { fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const SETTER: Who = { signed_in: true, seat: true, manager: false, email: "setter-c2r5@stress.invalid", ghl_user_id: "G-setter" };
const LEAD = "stress-c2r5-stop-0001";
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");
const SAID = new Date(SUN_11 - 20 * 60_000).toISOString();

function setup() {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  w.db.seed("cockpit_sales_settings", [{ key: "followups", value: { enabled: true, stop_pause_days: 30 } }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: "KW", assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER.email, ghl_user_id: "G-setter", active: true, role: "setter" }]);
  w.db.seed("cockpit_sales_followup_stops", [
    { contact_id: LEAD, said_at: SAID, kind: "unsubscribe", state: "asked", said: "please stop messaging me", created_by: "sales-desk" },
  ]);
  /** HighLevel's do-not-disturb on the contact, as the PUT writes it. */
  const hl = { whatsappDnd: false };
  w.routes.push((m, p, body) => {
    if (m === "PUT" && p === `/contacts/${LEAD}`) {
      const st = (((body as Row)?.dndSettings as Row)?.WhatsApp as Row)?.status;
      if (st === "active") hl.whatsappDnd = true;
      return { contact: { id: LEAD } };
    }
    return null as unknown as Row;
  });
  /** The next PATCH of the stops table lands and its answer is lost. */
  const lose = { stopsPatch: 0 };
  const io: LiveIO = {
    ...w.io,
    db: async (path, init = {}) => {
      const out = await w.io.db(path, init);
      if (lose.stopsPatch > 0 && (init.method ?? "GET") === "PATCH" && path.startsWith("cockpit_sales_followup_stops")) {
        lose.stopsPatch--;
        throw new DbError("database: no answer within 8 s", 0);
      }
      return out;
    },
  };
  const agent = makeFollowupAgent({
    io,
    audit: async (who, action, _t, id, _b, after) => {
      audits.push({ who: who.email, action, id, after });
    },
    sendFollowup: async () => ({}),
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  const press = async () => {
    try {
      return await agent.actions["followup.stop_task"]!(SETTER, { contact_id: LEAD, answer: "dnd", said_at: SAID, from: "asked" });
    } catch (e) {
      return e as Error;
    }
  };
  const task = () => w.db.t("cockpit_sales_followup_stops").find(r => r.contact_id === LEAD) as Row;
  return { w, agent, audits, hl, lose, press, task };
}

describe("chaos2 r5: Stop for good, the task's claim lands and its answer is lost", () => {
  test("HELD: the database answers: the task says stop for good and HighLevel has WhatsApp on do-not-disturb", async () => {
    const s = setup();
    const out = await s.press();
    expect(out instanceof Error).toBe(false);
    expect({ task: s.task().state, highlevel_dnd: s.hl.whatsappDnd }).toEqual({ task: "dnd", highlevel_dnd: true });
  });

  test("dnd-claim-lost-answer-highlevel-never-told: the press errors after its claim landed; the rep presses again: HighLevel must end with WhatsApp on do-not-disturb (or the task must not say stop for good)", async () => {
    const s = setup();
    s.lose.stopsPatch = 1;
    // Fix round 5: the first press reads its claim back and finishes (no
    // error); the second press finds the task stop for good and writes
    // HighLevel's do-not-disturb again, idempotently.
    await s.press();
    // The rep does what an error asks: presses Stop for good again (the page still shows the task asked).
    const second = await s.press();
    const said = second instanceof ApiRefusal ? second.message : second instanceof Error ? second.message : "ok";
    expect({
      task: s.task().state,
      highlevel_dnd: s.hl.whatsappDnd,
      audited: s.audits.filter(a => a.action === "followup.stop_task.dnd").length,
      second_press_said: said,
    }).toEqual({ task: "dnd", highlevel_dnd: true, audited: 1, second_press_said: "ok" });
  });
});
