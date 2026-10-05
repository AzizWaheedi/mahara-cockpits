// bun test supabase/functions/sales-api/stress_desk_r2_followup.test.ts
//
// Stress round 2, the follow-up agent's sales-api doors (2026-10-03): a send
// that fails before anything was written, an opener whose meta row lost its
// wave, a refusal about the template rather than the lead, a WhatsApp reply
// hidden behind a later email, and the per-kind Off switch. Each test asserts
// what must hold; a failing test names a defect for the fix lane. Every lead
// and line is invented.
//
// index.ts serves and does not export, so two tests lift the exact lines of
// sendFollowup they exercise out of the source and run them (transpiled by
// Bun) against stand-ins for svc: they break loudly if those lines move, and
// they test what the code does, not how it is spelled.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@stress.invalid" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00.000Z" };
const SUN_11 = Date.parse("2026-10-04T08:00:00Z"); // 11:00 in Kuwait, a Sunday

const SRC = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/** Lines `from` .. `to` (exclusive) of index.ts's sendFollowup, as one async function of the names given. */
function lift(from: string, to: string, params: string[], tail: string): (...a: unknown[]) => Promise<Row> {
  const fn = SRC.indexOf("async function sendFollowup(");
  const a = SRC.indexOf(from, fn);
  const b = SRC.indexOf(to, a);
  if (fn < 0 || a < fn || b < a) throw new Error(`sendFollowup no longer has "${from}" .. "${to}": update this test with the fix`);
  const name = `__lift${Math.random().toString(36).slice(2)}`;
  const code = `async function ${name}(${params.join(", ")}) {\n${SRC.slice(a, b)}\n${tail}\n}\nglobalThis.${name} = ${name};`;
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(code);
  (0, eval)(js);
  return (globalThis as unknown as Record<string, (...a: unknown[]) => Promise<Row>>)[name] as (...a: unknown[]) => Promise<Row>;
}

function setup() {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  let sent = 0;
  const knobs: { send: (f: Row) => Promise<Row> } = {
    send: async () => {
      sent++;
      return { followup: { status: "sent" }, message: { state: "sent" } };
    },
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: "stress-c1", country: "KW", assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_people", [{ email: rep.email, ghl_user_id: "G-setter", active: true }]);
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
  /** A backlog opener as the desk writes it: the wave named in its context. `meta` false leaves no meta row. */
  const draft = (meta: Row | false = {}) => {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      {
        id,
        contact_id: "stress-c1",
        owner_email: rep.email,
        segment: "reactivate",
        channel: "whatsapp_template",
        template_key: "opener_ar",
        status: "draft",
        touch: 1,
        body: "Hi Huda",
        context: { wave_id: waveId, arm: "wave" },
        created_at: w.db.iso(),
      },
    ]);
    if (meta !== false) w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, ...meta }]);
    return id;
  };
  const meta = (id: string) => w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row | undefined;
  return { ...w, agent, audits, knobs, draft, meta, waveId, sent: () => sent };
}

async function outcome(p: Promise<unknown>): Promise<Row | ApiRefusal> {
  try {
    return (await p) as Row;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 1. sendFollowup's catch: an error thrown before the message row was written
//    (HighLevel's contact read, a database read, the slot's lock timeout) is
//    recorded as "sent, may have gone": the opener or the reply never went,
//    and nothing writes it again.
// ---------------------------------------------------------------------------

describe("sendFollowup: an error before anything was written is no send", () => {
  const decide = lift(
    "const err =",
    "await audit(",
    ["e", "f", "svc", "enc", "redact", "Refusal", "MAY_HAVE_GONE", "body", "subject", "edited", "auto", "switched", "channel"],
    "return {};",
  );
  // The PATCH the catch writes, read from the stand-in svc.
  async function patchFor(e: unknown, messages: Row[] | Error): Promise<Row> {
    let patch: Row = {};
    const svc = async (path: string, init: { method?: string; body?: Row } = {}) => {
      if (path.startsWith("cockpit_sales_messages")) {
        if (messages instanceof Error) throw messages;
        return messages;
      }
      if (init.method === "PATCH") patch = init.body ?? {};
      return [];
    };
    await decide(e, { id: "00000000-0000-4000-8000-0000000000aa" }, svc, encodeURIComponent, (s: string) => s, ApiRefusal,
      "The send may have gone; read the conversation in HighLevel before writing to the lead again",
      "Hi Huda", null, false, false, false, "whatsapp_template").catch(() => undefined);
    return { patch };
  }
  // The lifted lines end on the PATCH; the stand-in records it.
  const statusOf = async (e: unknown, messages: Row[] | Error) => String(((await patchFor(e, messages)).patch as Row).status ?? "");

  test("HighLevel refused the contact read (429) before the slot: the draft is not recorded as sent", async () => {
    const e = Object.assign(new Error("HighLevel said 429: Too many requests"), { status: 429 });
    expect(await statusOf(e, [])).not.toBe("sent");
  });

  test("a database read failed before the slot (a 503, or the slot's lock timeout): not recorded as sent", async () => {
    expect(await statusOf(new Error("database 503: upstream connect error"), [])).not.toBe("sent");
    expect(await statusOf(new Error('database 500: {"code":"55P03","message":"canceling statement due to lock timeout"}'), [])).not.toBe("sent");
  });

  test("the doubt stays where it belongs: a message row that may have gone keeps the draft sent", async () => {
    const unclear = new ApiRefusal("The send may have gone; read the conversation in HighLevel before writing to the lead again (timeout)", 502, { unclear: true });
    expect(await statusOf(unclear, [{ id: "m1", state: "unclear" }])).toBe("sent");
    expect(await statusOf(new Error("database 500: the answer was lost"), [{ id: "m1", state: "sending" }])).toBe("sent");
    // The message lookup itself failed: nobody can tell, so the doubt stays.
    expect(await statusOf(new Error("HighLevel did not answer within 25 seconds"), new Error("database 503"))).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// 2. An opener whose meta row is missing (the desk died between the draft and
//    the meta, or the meta write failed): Approve all makes one without the
//    wave, and then neither the desk nor followup.send_due checks the wave.
// ---------------------------------------------------------------------------

describe("followup.batch then followup.send_due: an opener approved with no meta row keeps its wave", () => {
  test("a paused wave holds it", async () => {
    const w = setup();
    const id = w.draft(false);
    const ok = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] });
    expect(ok.count).toBe(1);
    await w.agent.actions["followup.wave"]!(boss, { request_id: crypto.randomUUID(), op: "pause", wave_id: w.waveId });
    const r = await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
    expect(w.sent()).toBe(0);
    expect(r instanceof ApiRefusal ? r.message : "").toContain("paused or stopped");
  });
});

// ---------------------------------------------------------------------------
// 3. A refusal about the template, not the lead: followup.send_due sets the
//    draft aside for a person, one draft at a time, for the whole batch.
// ---------------------------------------------------------------------------

describe("followup.send_due: the template is not set up", () => {
  for (const words of [
    "The cockpit_opener_ar template is not set up yet. A manager picks the HighLevel workflow that sends it, under Follow-ups, WhatsApp library.",
    "The cockpit's two HighLevel contact fields are not set (setting wa_fields).",
  ])
    test(`no opener is set aside for "${words.slice(0, 40)}…"`, async () => {
      const w = setup();
      const id = w.draft({ send_after: new Date(SUN_11 - 1000).toISOString(), approved_by: boss.email });
      w.knobs.send = async () => {
        throw new ApiRefusal(words, 409);
      };
      await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
      expect(w.audits.filter(a => a.action === "followup.set_aside")).toHaveLength(0);
      expect(w.meta(id)?.held_by ?? null).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 4. The "conversation moved on" check reads only the inbox copy's last
//    message: a WhatsApp reply followed by an automation's email is missed
//    (the desk reads inbound_whatsapp_at for exactly this; sales-api does not
//    even select it), and "How are you?" goes to a lead who just wrote.
// ---------------------------------------------------------------------------

describe("sendFollowup: a reply mid-batch, behind a later email", () => {
  const movedOn = lift("const madeAt = String(f.created_at);", "if (since) {", ["f", "svc", "enc"], "return { since };");
  const made = "2026-10-04T06:00:00.000Z";
  const inboxRow: Row = {
    contact_id: "stress-c1",
    conversation_id: "cv-stress-1",
    inbound_whatsapp_at: "2026-10-04T06:20:00.000Z", // the lead wrote on WhatsApp after the opener was drafted
    last_message_at: "2026-10-04T06:21:00.000Z", // then an automation's email, the conversation's last message
    last_direction: "outbound",
    last_type: "TYPE_EMAIL",
  };
  // PostgREST answers only the columns a read selects.
  const svc = async (path: string) => {
    if (!path.startsWith("cockpit_sales_inbox")) return [];
    const cols = (/[?&]select=([^&]+)/.exec(path)?.[1] ?? "*").split(",");
    return [cols[0] === "*" ? inboxRow : Object.fromEntries(cols.map(c => [c, inboxRow[c]]))];
  };

  test("the opener does not go", async () => {
    const f = { id: "f1", contact_id: "stress-c1", channel: "whatsapp_template", segment: "reactivate", created_at: made };
    const { since } = await movedOn(f, svc, encodeURIComponent);
    expect(since ?? null).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. The per-kind Off switch: followup.level stores Off for a backlog opener
//    and audits it; followup.send_due never reads it.
// ---------------------------------------------------------------------------

describe("followup.level Off for the opener's kind", () => {
  test("followup.send_due refuses an approved opener of a kind that is off", async () => {
    const w = setup();
    const out = await w.agent.actions["followup.level"]!(boss, { kind_key: "reactivate.ar.whatsapp_template", level: "off" });
    expect((out.level as Row)?.level).toBe("off");
    const id = w.draft({
      send_after: new Date(SUN_11 - 1000).toISOString(),
      approved_by: boss.email,
      kind_key: "reactivate.ar.whatsapp_template",
    });
    const r = await outcome(w.agent.desk["followup.send_due"]!(desk, { id }));
    expect(w.sent()).toBe(0);
    expect(r instanceof ApiRefusal).toBe(true);
  });
});
