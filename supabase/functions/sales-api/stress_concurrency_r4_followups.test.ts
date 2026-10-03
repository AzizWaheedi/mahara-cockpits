// bun test supabase/functions/sales-api/stress_concurrency_r4_followups.test.ts
//
// Round 4 stress, dimension: concurrency and idempotency, for the follow-up
// agent's presses (followupAgent.ts on testfakes.ts).
//
//   - A lead's stop message ("stop", "don't message me") is a task a person
//     answers: Stop for good (WhatsApp do-not-disturb in HighLevel), Pause,
//     or Resume. The setter and a manager both see the task; a tab left open
//     still shows it as asked after it was answered. The answer is written
//     with no check of what the task said when the press was made, so the
//     last press wins, whatever it overwrites.
//   - Two managers save the follow-up settings at the same moment (the
//     agent's switch on one screen, the waves' openers a day on another):
//     index.ts followupSettings reads the setting, merges the one key the
//     press sent (sendrules.ts followupSettingsValue keeps every other key
//     as it read them) and upserts the whole value. The second save writes
//     back the first one's key as it read it before the first landed.
//
// A failing test is a finding for the fix agent; once fixed it stays as a
// regression test. Nothing here reaches HighLevel (a fake router).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeFollowupAgent } from "./followupAgent.ts";
import { FOLLOWUP_SEGMENTS, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { followupSettingsValue } from "./sendrules.ts";
import { fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@stress.invalid" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const LEAD = "stress-r4-lead-000002";
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");
const SAID = "2026-10-04T07:30:00.000Z";

function setup() {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "followups", value: { enabled: true, stop_pause_days: 30 } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: "KW", assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_people", [{ email: rep.email, ghl_user_id: "G-setter", active: true }]);
  // The lead wrote "please stop messaging me": an unsubscribe, waiting for a person.
  w.db.seed("cockpit_sales_followup_stops", [
    { contact_id: LEAD, said_at: SAID, kind: "unsubscribe", said: "please stop messaging me", state: "asked", created_by: "sales-desk" },
  ]);
  const dnd: Row[] = [];
  w.routes.push(async (m, p, body) => {
    if (m === "PUT" && p === `/contacts/${LEAD}`) {
      // HighLevel's write takes a moment.
      for (let i = 0; i < 20; i++) await null;
      dnd.push(body as Row);
      return { contact: { id: LEAD } };
    }
    return null as unknown as Row;
  });
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async (who, action, _t, _id, before, after) => {
      audits.push({ who: who.email, action, before, after });
    },
    sendFollowup: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  const stops = () => w.db.t("cockpit_sales_followup_stops").filter(r => r.contact_id === LEAD) as Row[];
  const answer = (who: Who, a: "dnd" | "pause" | "resume", b: Row = {}) =>
    agent.actions["followup.stop_task"]!(who, { contact_id: LEAD, said_at: SAID, answer: a, ...b });
  return { ...w, agent, audits, dnd, stops, answer };
}

async function outcome(p: Promise<Row>) {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    if (e instanceof ApiRefusal) return { ok: false as const, status: e.status, message: e.message };
    throw e;
  }
}

describe("a lead's stop task answered from two places", () => {
  test("stop-task-stale-answer: the setter answers Stop for good; a manager's tab, still showing the task as asked, then presses Resume: the lead who asked to stop is not resumed", async () => {
    const w = setup();
    await w.answer(rep, "dnd");
    expect(w.stops()[0]!.state).toBe("dnd");
    expect(w.dnd).toHaveLength(1);
    // The manager's page loaded before the setter answered; their press
    // carries nothing that says what they saw, and lands unguarded.
    const late = await outcome(w.answer(boss, "resume"));
    // HighLevel still has WhatsApp do-not-disturb on (nothing takes it off),
    // and the desk's hold_of reads only the row: a resumed row lets the agent
    // draft to this lead again (email and SMS are not covered by the DND).
    const row = w.stops()[0]!;
    expect({ state: row.state, refused: !late.ok }).toEqual({ state: "dnd", refused: true });
  });

  test("stop-task-stale-answer (pause over dnd): a stale Pause turns Stop for good into a 30-day pause, after which the agent writes again", async () => {
    const w = setup();
    await w.answer(rep, "dnd");
    const late = await outcome(w.answer(boss, "pause"));
    const row = w.stops()[0]!;
    expect({ state: row.state, refused: !late.ok }).toEqual({ state: "dnd", refused: true });
  });

  test("Stop for good and Resume pressed at the same moment (HighLevel's write is slow): the task ends in one answer that matches HighLevel, and the other press is told it was answered", async () => {
    const w = setup();
    const [d, r] = await Promise.all([outcome(w.answer(rep, "dnd")), outcome(w.answer(boss, "resume"))]);
    const row = w.stops()[0]!;
    const won = [d, r].filter(o => o.ok).length;
    // Today both land: Resume first (no HighLevel call), then dnd over it.
    // Both rows are audited as the answer, and both presses were told "done".
    expect(won).toBe(1);
    // Whatever won, the row and HighLevel agree: dnd in the row only with DND in HighLevel.
    expect(row.state === "dnd").toBe(w.dnd.length > 0);
  });

  test("Stop for good pressed twice (a double tap): HighLevel is written once and one answer is audited", async () => {
    const w = setup();
    await Promise.all([outcome(w.answer(rep, "dnd")), outcome(w.answer(rep, "dnd"))]);
    expect(w.stops()[0]!.state).toBe("dnd");
    expect(w.audits.filter(a => a.action === "followup.stop_task.dnd")).toHaveLength(1);
  });
});

describe("two managers save the follow-up settings at the same moment", () => {
  test("followup-settings-lost-update: the CEO switches the agent off while another manager changes openers a day; the switch stays off", () => {
    // Both saves read the setting before either landed (index.ts
    // followupSettings: setting("followups"), then followupSettingsValue,
    // then an upsert of the whole value with merge-duplicates).
    const before = { enabled: true, waves: { per_day: 40, holdout_share: 0.1, batch_gap_s: 45 }, first_hours: [9, 18] };
    const off = followupSettingsValue(before, { enabled: false }, FOLLOWUP_SEGMENTS);
    const perDay = followupSettingsValue(before, { waves: { per_day: 60 } }, FOLLOWUP_SEGMENTS);
    expect(off.ok && perDay.ok).toBe(true);
    if (!off.ok || !perDay.ok) return;
    expect((off.value as Record<string, unknown>).enabled).toBe(false);
    // The save that lands second writes enabled: true back, as it read it:
    // the kill switch the CEO was told is off is on again, and nothing says so.
    expect((perDay.value as Record<string, unknown>).enabled).toBe(true);
    // So the write itself has to be conditional on what was read (a
    // compare-and-set on updated_at, read again and merged again on a miss),
    // or one database statement that merges only the keys the press sent.
    const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const bodyOf = (name: string) => {
      const start = src.indexOf(`async function ${name}(`);
      return start < 0 ? "" : src.slice(start, src.indexOf("\n}\n", start));
    };
    const body = bodyOf("followupSettings");
    // The fix (round 4): saveSettingIf, a compare-and-set on updated_at that
    // reads and merges again on a miss. The helper's own write must carry the
    // guard, and the save must go through it.
    const helper = bodyOf("saveSettingIf");
    const conditional =
      /updated_at=eq\.|value=eq\.|io\.rpc\(|rpc\("cockpit_sales_settings|svc\(`rpc\//.test(body) ||
      (/saveSettingIf\(/.test(body) && /updated_at=eq\./.test(helper) && /method: "PATCH"/.test(helper));
    expect(conditional).toBe(true);
    // The same for the WhatsApp guard and the other setting saves (one root cause).
    for (const name of ["whatsappGuardSave", "settingSave"]) expect(bodyOf(name)).toContain("saveSettingIf(");
  });
});
