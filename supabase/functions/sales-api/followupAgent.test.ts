// bun test supabase/functions/sales-api/followupAgent.test.ts
import { describe, expect, test } from "bun:test";
import { AGENT_COPY, holdsEverything, makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { GATE_SHUT } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@maharamedia.com" };
const other: Who = { signed_in: true, seat: true, manager: false, email: "closer@maharamedia.com" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };
// Sunday 2026-10-04, 08:00 UTC: 11:00 in Kuwait.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

function setup(o: { guard?: Row; followups?: Row; now?: number } = {}) {
  const w = fakeWorld(o.now ?? SUN_11);
  const audits: Row[] = [];
  const sends: Row[] = [];
  const knobs = {
    send: (_f: Row): Row | Error => ({ followup: { status: "sent" }, message: { state: "sent" } }),
    health: { paused: false, why: "" },
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: o.guard ?? GATE },
    { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30, ...(o.followups ?? {}) } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: "c1", country: "KW", assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_people", [{ email: rep.email, ghl_user_id: "G-setter", active: true }]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async (who, action, _t, id, _b, after) => {
      audits.push({ who: who.email, action, id, after });
    },
    sendFollowup: async (who, f, b, auto, opts) => {
      sends.push({ who: who.email, id: f.id, b, auto, decidedBy: opts?.decidedBy ?? null });
      const r = knobs.send(f);
      if (r instanceof Error) throw r;
      return r;
    },
    whatsappHealth: async () => knobs.health,
  });
  const draft = (over: Row = {}) => {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [{ id, contact_id: "c1", owner_email: rep.email, segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi Huda", created_at: w.db.iso(), ...over }]);
    return id;
  };
  const meta = (id: string) => w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row | undefined;
  return { ...w, agent, audits, sends, knobs, draft, meta };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("followup.wave", () => {
  test("a manager starts a running wave on a known pool; a rep cannot", async () => {
    const w = setup();
    const out = await w.agent.actions["followup.wave"]!(boss, { request_id: crypto.randomUUID(), op: "start", pool: "never_booked" });
    expect((out.wave as Row)).toMatchObject({ pool: "never_booked", state: "running", per_day: 40, segment: "reactivate", made_by: boss.email });
    expect(w.audits.map(a => a.action)).toEqual(["followup.wave.start"]);
    expect((await refused(w.agent.actions["followup.wave"]!(rep, { op: "start", pool: "never_booked" }))).status).toBe(403);
    expect((await refused(w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "somewhere" }))).status).toBe(400);
  });

  test("refused while the WhatsApp gate is shut, with the gate sentence", async () => {
    const w = setup({ guard: { connector_off: false } });
    const r = await refused(w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "good_intro" }));
    expect([r.message, r.extra.hold_all]).toEqual([GATE_SHUT, true]);
  });

  test("a second running wave on one pool is refused; the same manager's double press is the same wave", async () => {
    const w = setup();
    const a = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "good_intro" });
    const b = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "good_intro" });
    expect([(b.wave as Row).id, b.repeated]).toEqual([(a.wave as Row).id, true]);
    w.clock.now += 5 * 60_000;
    expect((await refused(w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "good_intro" }))).message).toBe(AGENT_COPY.wave_running);
  });

  test("pause, resume, stop: stop ends it with the manager's reason; a done wave never moves again", async () => {
    const w = setup();
    const id = String(((await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "unclosed_demo" })).wave as Row).id);
    expect(((await w.agent.actions["followup.wave"]!(boss, { op: "pause", wave_id: id })).wave as Row).state).toBe("paused");
    expect(((await w.agent.actions["followup.wave"]!(boss, { op: "resume", wave_id: id })).wave as Row).state).toBe("running");
    const stopped = (await w.agent.actions["followup.wave"]!(boss, { op: "stop", wave_id: id })).wave as Row;
    expect([stopped.state, stopped.done_reason]).toEqual(["done", "Stopped by a manager."]);
    expect((await refused(w.agent.actions["followup.wave"]!(boss, { op: "resume", wave_id: id }))).message).toContain("done");
    expect((await w.agent.actions["followup.wave"]!(boss, { op: "stop", wave_id: id })).repeated).toBe(true);
  });
});

describe("followup.batch and followup.hold", () => {
  test("approves a wave's open openers one every 45 seconds, and clears a desk hold", async () => {
    const w = setup();
    const waveId = fakeUuid();
    w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "never_booked", state: "running", made_by: boss.email }]);
    const ids = [w.draft(), w.draft(), w.draft()];
    for (const id of ids) w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, held_by: "sales-desk", hold_reason: "x" }]);
    const out = await w.agent.actions["followup.batch"]!(rep, { request_id: crypto.randomUUID(), wave_id: waveId });
    expect(out).toMatchObject({ count: 3, gap_s: 45 });
    const at = ids.map(id => Date.parse(String(w.meta(id)?.send_after)));
    expect([at[1]! - at[0]!, at[2]! - at[1]!]).toEqual([45_000, 45_000]);
    expect(ids.every(id => w.meta(id)?.held_by === null && w.meta(id)?.approved_by === rep.email)).toBe(true);
  });

  test("refused: another rep's opener, a draft that is not open, a draft that is not an opener, more than 40, the gate shut", async () => {
    const w = setup();
    const mine = w.draft();
    expect((await refused(w.agent.actions["followup.batch"]!(other, { ids: [mine] }))).status).toBe(403);
    const sent = w.draft({ status: "sent" });
    expect((await refused(w.agent.actions["followup.batch"]!(rep, { ids: [mine, sent] }))).message).toBe(AGENT_COPY.batch_not_open);
    const plain = w.draft({ segment: "no_show" });
    expect((await refused(w.agent.actions["followup.batch"]!(rep, { ids: [plain] }))).message).toBe(AGENT_COPY.batch_not_opener);
    const many = Array.from({ length: 41 }, () => w.draft());
    expect((await refused(w.agent.actions["followup.batch"]!(boss, { ids: many }))).message).toBe(AGENT_COPY.batch_too_many);
    const shut = setup({ guard: {} });
    expect((await refused(shut.agent.actions["followup.batch"]!(rep, { ids: [shut.draft()] }))).message).toBe(GATE_SHUT);
  });

  test("hold on and off, by the owner or a manager", async () => {
    const w = setup();
    const id = w.draft();
    await w.agent.actions["followup.hold"]!(rep, { id, on: true });
    expect(w.meta(id)?.held_by).toBe(rep.email);
    await w.agent.actions["followup.hold"]!(boss, { id, on: false });
    expect([w.meta(id)?.held_by, w.meta(id)?.hold_reason]).toEqual([null, null]);
    expect((await refused(w.agent.actions["followup.hold"]!(other, { id, on: true }))).status).toBe(403);
  });
});

describe("followup.send_due (the desk's paced send)", () => {
  function due(w: ReturnType<typeof setup>, over: Row = {}, metaOver: Row = {}) {
    const id = w.draft(over);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, send_after: new Date(w.clock.now - 1000).toISOString(), approved_by: rep.email, ...metaOver }]);
    return id;
  }

  test("sends as the desk, recording who approved it", async () => {
    const w = setup();
    const id = due(w);
    const out = await w.agent.desk["followup.send_due"]!(desk, { id });
    expect(w.sends).toEqual([{ who: "sales-desk", id, b: {}, auto: false, decidedBy: rep.email }]);
    expect(out.followup).toEqual({ status: "sent" });
  });

  test("hold_all: the agent switched off, the gate shut, WhatsApp off, a source health pause", async () => {
    const off = setup({ followups: { enabled: false } });
    const a = await refused(off.agent.desk["followup.send_due"]!(desk, { id: due(off) }));
    expect([a.message, a.extra.hold_all]).toEqual([AGENT_COPY.agent_off, true]);
    const shut = setup({ guard: { connector_off: true } });
    expect((await refused(shut.agent.desk["followup.send_due"]!(desk, { id: due(shut) }))).extra.hold_all).toBe(true);
    const sick = setup();
    sick.knobs.health = { paused: true, why: "Automatic WhatsApp sends for follow-ups are paused: 6 of 20 failed." };
    expect((await refused(sick.agent.desk["followup.send_due"]!(desk, { id: due(sick) }))).extra.hold_all).toBe(true);
    expect(off.sends.length + shut.sends.length + sick.sends.length).toBe(0);
    // An email draft is not held by the WhatsApp gate.
    const mail = setup({ guard: {} });
    await mail.agent.desk["followup.send_due"]!(desk, { id: due(mail, { channel: "email", segment: "no_show" }) });
    expect(mail.sends).toHaveLength(1);
  });

  test("never sends a held draft, one not yet due, one no longer a draft, or one for a wave that is not running", async () => {
    const w = setup();
    expect((await refused(w.agent.desk["followup.send_due"]!(desk, { id: due(w, {}, { held_by: rep.email }) }))).message).toBe(AGENT_COPY.held);
    expect((await refused(w.agent.desk["followup.send_due"]!(desk, { id: due(w, {}, { send_after: new Date(w.clock.now + 60_000).toISOString() }) }))).message).toBe(AGENT_COPY.not_due);
    expect((await refused(w.agent.desk["followup.send_due"]!(desk, { id: due(w, { status: "sent" }) }))).message).toBe("This draft was already sent.");
    const waveId = fakeUuid();
    w.db.seed("cockpit_sales_followup_waves", [{ id: waveId, pool: "good_intro", state: "paused", made_by: boss.email }]);
    expect((await refused(w.agent.desk["followup.send_due"]!(desk, { id: due(w, {}, { wave_id: waveId }) }))).message).toBe(AGENT_COPY.wave_not_running);
    expect(w.sends).toHaveLength(0);
  });

  test("outside the lead's hours, or on their Friday: refused in words the desk reads as hours, and not set aside", async () => {
    const early = setup({ now: Date.parse("2026-10-04T04:00:00Z") });
    const id = due(early);
    const r = await refused(early.agent.desk["followup.send_due"]!(desk, { id }));
    expect(r.message).toBe("A first message goes between 9 and 6, their time.");
    expect(early.meta(id)?.held_by ?? null).toBeNull();
    const fri = setup({ now: Date.parse("2026-10-02T08:00:00Z") });
    expect((await refused(fri.agent.desk["followup.send_due"]!(desk, { id: due(fri) }))).message).toContain("Friday");
  });

  test("a refusal for this lead sets the draft aside for a person; one for every send does not, and carries hold_all", async () => {
    const w = setup();
    const id = due(w);
    w.knobs.send = () => new ApiRefusal("This lead asked not to be contacted on WhatsApp.", 409);
    await refused(w.agent.desk["followup.send_due"]!(desk, { id }));
    expect([w.meta(id)?.held_by, w.meta(id)?.send_after, w.meta(id)?.hold_reason]).toEqual(["sales-desk", null, "This lead asked not to be contacted on WhatsApp."]);
    const id2 = due(w);
    w.knobs.send = () => new ApiRefusal("Today's 250 WhatsApp templates have gone out.", 409);
    const r = await refused(w.agent.desk["followup.send_due"]!(desk, { id: id2 }));
    expect(r.extra.hold_all).toBe(true);
    expect(w.meta(id2)?.held_by ?? null).toBeNull();
  });

  test("a 200 whose message failed for the wallet holds every send", async () => {
    const w = setup();
    w.knobs.send = () => ({ followup: { status: "failed" }, message: { state: "failed", error: "Insufficient funds in the wallet" } });
    const out = await w.agent.desk["followup.send_due"]!(desk, { id: due(w) });
    expect(out.hold_all).toBe(true);
  });
});

describe("followup.stop_task", () => {
  function stop(w: ReturnType<typeof setup>) {
    const said = new Date(w.clock.now - 3_600_000).toISOString();
    w.db.seed("cockpit_sales_followup_stops", [{ contact_id: "c1", said_at: said, kind: "unsubscribe", said: "stop", state: "asked" }]);
    return said;
  }

  test("dnd writes WhatsApp do-not-disturb in HighLevel, then records it", async () => {
    const w = setup();
    const said = stop(w);
    w.routes.push((m, p) => (m === "PUT" && p === "/contacts/c1" ? { ok: true } : (null as unknown as Row)));
    const out = await w.agent.actions["followup.stop_task"]!(rep, { contact_id: "c1", said_at: said, answer: "dnd" });
    expect((out.stop as Row).state).toBe("dnd");
    expect(w.ghlCalls[0]?.body).toEqual({ dndSettings: { WhatsApp: { status: "active", message: "Asked to stop (cockpit)" } } });
  });

  test("HighLevel refusing the stop leaves it asked, with what to do next", async () => {
    const w = setup();
    const said = stop(w);
    const r = await refused(w.agent.actions["followup.stop_task"]!(rep, { contact_id: "c1", said_at: said, answer: "dnd" }));
    expect([r.status, w.db.t("cockpit_sales_followup_stops")[0]?.state]).toEqual([502, "asked"]);
  });

  test("pause holds for stop_pause_days; the lead page's pause and resume work without a stop", async () => {
    const w = setup();
    const said = stop(w);
    const out = await w.agent.actions["followup.stop_task"]!(rep, { contact_id: "c1", said_at: said, answer: "pause" });
    expect(Date.parse(String((out.stop as Row).paused_until)) - w.clock.now).toBe(30 * 86_400_000);
    await w.agent.actions["followup.stop_task"]!(rep, { contact_id: "c1", answer: "pause" });
    expect(w.db.t("cockpit_sales_followup_stops").filter(s => s.kind === "manual")).toHaveLength(1);
    const resumed = await w.agent.actions["followup.stop_task"]!(rep, { contact_id: "c1", answer: "resume" });
    expect(resumed.resumed).toBe(2);
  });

  test("another rep's lead is refused; a manager may", async () => {
    const w = setup();
    const said = stop(w);
    expect((await refused(w.agent.actions["followup.stop_task"]!(other, { contact_id: "c1", said_at: said, answer: "pause" }))).status).toBe(403);
    await w.agent.actions["followup.stop_task"]!(boss, { contact_id: "c1", said_at: said, answer: "resume" });
  });
});

describe("followup.level", () => {
  test("a manager sets a kind's level; openers stay at Approve or Off; a rep cannot", async () => {
    const w = setup();
    const out = await w.agent.actions["followup.level"]!(boss, { kind_key: "no_show.ar.email", level: "send_unless_stopped" });
    expect((out.level as Row).level).toBe("send_unless_stopped");
    expect((await refused(w.agent.actions["followup.level"]!(boss, { kind_key: "reactivate.ar.whatsapp_template", level: "sends_by_itself" }))).status).toBe(409);
    expect((await refused(w.agent.actions["followup.level"]!(boss, { kind_key: "nope", level: "approve" }))).status).toBe(400);
    expect((await refused(w.agent.actions["followup.level"]!(rep, { kind_key: "no_show.ar.email", level: "approve" }))).status).toBe(403);
  });
});

test("holdsEverything reads the desk's hold words and a 429", () => {
  expect(holdsEverything("That is 30 messages in ten minutes from you.", 429)).toBe(true);
  expect(holdsEverything("This month's WhatsApp template budget of $100 is spent", 409)).toBe(true);
  expect(holdsEverything("The conversation has moved on.", 409)).toBe(false);
});
