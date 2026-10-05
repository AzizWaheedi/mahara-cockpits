// bun test supabase/functions/sales-api/stress_concurrency_followups.test.ts
//
// Round 1 stress, dimension: concurrency and idempotency, for the follow-up
// agent's presses (followupAgent.ts on testfakes.ts). The Follow-ups page
// reads the batch's meta rows every 60 s and sends only the openers it saw
// as undecided (waves.ts toApprove), so a rep's Hold can land between the
// manager's screen and the manager's Approve all. A failing test is a
// finding, left for the fix agent; it stays as a regression test.
import { describe, expect, test } from "bun:test";
import { AGENT_COPY, makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@maharamedia.com" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com" };
const boss2: Who = { signed_in: true, seat: true, manager: true, email: "boss2@maharamedia.com" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

function setup() {
  const w = fakeWorld(SUN_11);
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: "c1", country: "KW", assigned_to: "G-setter" }]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async () => {},
    sendFollowup: async (who, f) => {
      sends.push({ who: who.email, id: f.id });
      return { followup: { status: "sent" }, message: { state: "sent" } };
    },
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  const draft = () => {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [{ id, contact_id: "c1", owner_email: rep.email, segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi", created_at: w.db.iso() }]);
    return id;
  };
  const meta = (id: string) => w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row | undefined;
  return { ...w, agent, sends, draft, meta };
}

describe("Hold and Approve all racing", () => {
  test("a rep holds an opener after the manager's screen loaded and before Approve all: the hold stands and the opener is not sent", async () => {
    const w = setup();
    const ids = [w.draft(), w.draft(), w.draft()];
    // The manager's screen shows all three undecided (read up to 60 s ago).
    const onScreen = [...ids];
    // The rep holds the second one ("I'm talking to this lead myself").
    await w.agent.actions["followup.hold"]!(rep, { id: ids[1], on: true, reason: "Talking to them on the phone." });
    expect(w.meta(ids[1]!)?.held_by).toBe(rep.email);
    // Approve all, with the screen's list.
    await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: onScreen });
    expect(w.meta(ids[1]!)?.held_by).toBe(rep.email);
    // The desk's paced send then sends whatever is approved and not held.
    w.clock.now += 10 * 60_000;
    for (const id of ids) await w.agent.desk["followup.send_due"]!({ signed_in: true, seat: true, manager: false, email: "sales-desk" }, { id }).catch(() => null);
    expect(w.sends.map(s => s.id)).not.toContain(ids[1]);
  });

  test("Hold and Approve all pressed at the same moment: a Hold the rep was told stands is never undone", async () => {
    const w = setup();
    const ids = Array.from({ length: 10 }, () => w.draft());
    const [held] = await Promise.all([
      w.agent.actions["followup.hold"]!(rep, { id: ids[4], on: true }),
      w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids }),
    ]);
    // The rep's answer said held...
    expect(((held as Row).meta as Row).held_by).toBe(rep.email);
    // ...so the opener must still be held.
    expect(w.meta(ids[4]!)?.held_by).toBe(rep.email);
  });
});

describe("waves started twice at once", () => {
  test("two managers start a wave on one pool at the same moment: one wave; the other hears a wave is running", async () => {
    const w = setup();
    const outs = await Promise.allSettled([
      w.agent.actions["followup.wave"]!(boss, { request_id: crypto.randomUUID(), op: "start", pool: "never_booked" }),
      w.agent.actions["followup.wave"]!(boss2, { request_id: crypto.randomUUID(), op: "start", pool: "never_booked" }),
    ]);
    expect(w.db.t("cockpit_sales_followup_waves").filter(x => x.pool === "never_booked")).toHaveLength(1);
    const no = outs.filter(o => o.status === "rejected").map(o => ((o as PromiseRejectedResult).reason as ApiRefusal).message);
    expect(no).toEqual([AGENT_COPY.wave_running]);
  });

  test("twenty presses of Start from one manager at once: one wave, every answer is that wave", async () => {
    const w = setup();
    const outs = await Promise.allSettled(
      Array.from({ length: 20 }, () => w.agent.actions["followup.wave"]!(boss, { request_id: crypto.randomUUID(), op: "start", pool: "good_intro" })),
    );
    expect(w.db.t("cockpit_sales_followup_waves")).toHaveLength(1);
    const id = w.db.t("cockpit_sales_followup_waves")[0]?.id;
    expect(outs.map(o => (o.status === "fulfilled" ? (o.value.wave as Row).id : String((o.reason as Error).message)))).toEqual(Array(20).fill(id));
  });

  test("pause and stop pressed at once by two managers: the wave ends done, and neither press crashes", async () => {
    const w = setup();
    const id = String(((await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "unclosed_demo" })).wave as Row).id);
    const outs = await Promise.allSettled([
      w.agent.actions["followup.wave"]!(boss, { op: "pause", wave_id: id }),
      w.agent.actions["followup.wave"]!(boss2, { op: "stop", wave_id: id }),
    ]);
    const crashes = outs.filter(o => o.status === "rejected" && !((o as PromiseRejectedResult).reason instanceof ApiRefusal));
    expect(crashes).toHaveLength(0);
    expect((w.db.t("cockpit_sales_followup_waves")[0] as Row).state).toBe("done");
  });
});
