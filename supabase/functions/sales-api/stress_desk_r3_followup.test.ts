// bun test supabase/functions/sales-api/stress_desk_r3_followup.test.ts
//
// Stress round 3, the follow-up agent's sales-api doors (2026-10-03): an
// opener whose send died holding its sending mark, a refusal that has
// already closed the draft, the follow-up source's WhatsApp pause after an
// outage that ended, and Release on an approved opener a rep held. Each test
// asserts what must hold; a failing test names a defect for the fix lane.
// Every lead and line is invented.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeFollowupAgent, SENDING } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { healthCfg, sourceHealth } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
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
    { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: "stress-c1", country: "KW", assigned_to: "G-setter" }]);
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
      {
        id,
        contact_id: "stress-c1",
        segment: "reactivate",
        channel: "whatsapp_template",
        status: "draft",
        touch: 1,
        body: "Hi Huda",
        created_at: w.db.iso(),
        context: { wave_id: waveId, language: "en" },
        ...over,
      },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, ...meta }]);
    return id;
  };
  const meta = (id: string) => w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row | undefined;
  const row = (id: string) => w.db.t("cockpit_sales_followups").find(m => m.id === id) as Row;
  return { ...w, agent, audits, knobs, draft, meta, row, waveId };
}

async function outcome(p: Promise<unknown>): Promise<Row | ApiRefusal> {
  try {
    return (await p) as Row;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
}

const ago = (ms: number) => new Date(SUN_11 - ms).toISOString();

describe("an opener whose send died holding the sending mark (held_by sales-desk:sending, older than five minutes)", () => {
  test("Approve all approves it again, and never says a rep holds it", async () => {
    const w = setup();
    const id = w.draft({}, { held_by: SENDING, held_at: ago(30 * 60_000), send_after: ago(40 * 60_000) });
    const r = await outcome(w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] }));
    const words = r instanceof ApiRefusal ? r.message : "";
    expect(words).not.toContain("held by a rep");
    expect(r instanceof ApiRefusal ? null : (r as Row).count).toBe(1);
    expect(w.meta(id)?.held_by ?? null).toBeNull();
  });

  test("Approve all for its wave counts it among the openers it approved", async () => {
    const w = setup();
    const stuck = w.draft({}, { held_by: SENDING, held_at: ago(30 * 60_000), send_after: ago(40 * 60_000) });
    w.draft();
    const r = await outcome(w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), wave_id: w.waveId }));
    expect(r instanceof ApiRefusal ? r.message : null).toBeNull();
    expect((r as Row).count).toBe(2);
    expect((r as Row).held ?? 0).toBe(0);
    expect(w.meta(stuck)?.send_after).toBeTruthy();
  });
});

describe("followup.send_due: a refusal that has already closed the draft", () => {
  for (const [why, words] of [
    ["went stale", "This draft went stale. The agent writes a new one if it is still due."],
    [
      "is an active client",
      "This is an active client (tagged client in HighLevel), so it stays out of the sales lists and follow-ups. Client success looks after them.",
    ],
  ] as const) {
    test(`a draft sendFollowup closed because it ${why} is not set aside for a person`, async () => {
      const w = setup();
      const id = w.draft({}, { send_after: ago(1000), approved_by: boss.email });
      // index.ts sendFollowup: the draft is closed (expired), then the refusal.
      w.knobs.send = async f => {
        w.row(String(f.id)).status = "expired";
        throw new ApiRefusal(words, 409);
      };
      const r = await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
      expect(r instanceof ApiRefusal).toBe(true);
      expect(w.row(id).status).toBe("expired");
      // A closed draft is on no page: a set-aside for a person nobody can see,
      // and the desk counts it toward its three-in-a-row stop.
      expect(w.audits.filter(a => a.action === "followup.set_aside")).toHaveLength(0);
      expect(w.meta(id)?.held_by ?? null).not.toBe("sales-desk");
    });
  }
});

// ---------------------------------------------------------------------------
// The follow-up source's WhatsApp health (index.ts whatsappHealth({source}))
// counts the last 20 follow-up WhatsApp sends with no time bound, and nobody
// can clear it. A wallet outage that fails six openers pauses every wave; the
// only sends that could dilute those six are other follow-up WhatsApp
// messages a rep approves (followup.approve refuses every backlog opener),
// and the page's own health line reads the last day only, so a day later it
// shows nothing paused while followup.send_due still answers hold_all.
// index.ts serves and does not export: the function is lifted from the
// source and run against a stand-in for svc that keeps PostgREST's filters.
// ---------------------------------------------------------------------------


function liftWhatsappHealth(rows: Row[], now: number): (o: { source?: string }) => Promise<Row> {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const a = src.indexOf("async function whatsappHealth(");
  const b = src.indexOf("\n}\n", a);
  if (a < 0 || b < a) throw new Error("index.ts no longer has whatsappHealth: update this test with the fix");
  const name = `__health${Math.random().toString(36).slice(2)}`;
  const code = `globalThis.${name} = function (setting, svc, enc, healthCfg, sourceHealth, whatsappGuard, redact, Date) {\n${src.slice(a, b + 2)}\nreturn whatsappHealth;\n};`;
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(code);
  (0, eval)(js);
  const make = (globalThis as unknown as Record<string, (...a: unknown[]) => (o: { source?: string }) => Promise<Row>>)[name]!;
  const svc = async (path: string): Promise<Row[]> => {
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    let out = rows.filter(r => r.channel === "whatsapp");
    const source = q.get("source");
    if (source) out = out.filter(r => `eq.${r.source}` === source);
    const state = q.get("state");
    if (state) out = out.filter(r => state.slice(4, -1).split(",").includes(String(r.state)));
    const since = q.get("created_at");
    if (since?.startsWith("gte.")) out = out.filter(r => Date.parse(String(r.created_at)) >= Date.parse(since.slice(4)));
    out.sort((x, y) => Date.parse(String(y.created_at)) - Date.parse(String(x.created_at)));
    const limit = Number(q.get("limit") ?? 1000);
    return out.slice(0, limit);
  };
  class FixedDate extends Date {
    constructor(...a: unknown[]) {
      super(...((a.length ? a : [now]) as [number]));
    }
    static now() {
      return now;
    }
  }
  return make(
    async () => ({ health: { followup: { window: 20, fail_share: 0.3 } }, pause_min_sends: 5 }),
    svc,
    encodeURIComponent,
    healthCfg,
    sourceHealth,
    async () => ({ templates_per_day: 250, pause_fail_share: 0.3, pause_min_sends: 5 }),
    (s: string) => s,
    FixedDate,
  );
}

describe("whatsappHealth({source: 'followup'}) after a wallet outage that ended days ago", () => {
  test("six openers failed three days ago and nothing has gone since: the waves are not held for good", async () => {
    const outage = SUN_11 - 3 * 86_400_000;
    const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({
      channel: "whatsapp",
      source: "followup",
      state: "failed",
      error: "Insufficient funds in the WhatsApp wallet",
      created_at: new Date(outage + i * 45_000).toISOString(),
    }));
    const health = liftWhatsappHealth(rows, SUN_11);
    const day = await health({});
    const followup = await health({ source: "followup" });
    // The page's line and the global rule read the last day: nothing is paused.
    expect(day.paused).toBe(false);
    // followup.send_due answers hold_all on this, every run, until other
    // follow-up WhatsApp sends succeed: no time bound, no clear.
    expect(followup.paused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A rep holds an approved opener (to call the lead first), then presses
// Release. The page says "Released. It goes with the next approval." (WavesCard),
// but followup.hold off keeps the approval's send_after, so the very next
// followup.send_due sends it with nobody approving it again.
// ---------------------------------------------------------------------------

describe("Release on an opener a rep held after it was approved", () => {
  test("it waits for the next approval, as the button says, and does not go on the next send", async () => {
    const w = setup();
    const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@stress.invalid" };
    const id = w.draft({ owner_email: rep.email }, { send_after: ago(60_000), approved_by: boss.email });
    await w.agent.actions["followup.hold"]!(rep, { id, on: true, reason: "Calling her first." });
    await w.agent.actions["followup.hold"]!(rep, { id, on: false });
    let sent = 0;
    w.knobs.send = async () => {
      sent++;
      return { followup: { status: "sent" }, message: { state: "sent" } };
    };
    await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
    expect(sent).toBe(0);
  });
});
