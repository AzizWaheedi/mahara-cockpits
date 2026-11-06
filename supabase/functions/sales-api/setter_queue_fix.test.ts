// bun test supabase/functions/sales-api/setter_queue_fix.test.ts
//
// The setter's one queue, after the 2026-11-06 review. Each describe is one
// review finding: the rule as it now stands, first on the pure rules
// (dialer.ts), then end to end through the real handler (index.ts) where the
// finding was about the server's reads or answers. PostgREST is testfakes.ts
// FakeDb behind the same URLs (or= filters honoured), the seat check answers
// a setter, HighLevel answers {}. Synthetic names only.
import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  type Appt,
  type Candidate,
  burstAnchor,
  endedAfterBooking,
  FIRST_CALL_NEW,
  firstTry,
  introStage,
  mergeMisses,
  quickRetryDue,
  rankForCloser,
  rankForSetter,
  secondTry,
  setterScope,
  unpairedCalls,
  voiceNoteDue,
} from "./dialer.ts";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-08T09:00:00Z"); // Sunday 12:00 Kuwait

const lead = (over: Partial<Candidate>): Candidate => ({
  contact_id: "x",
  name: null,
  phone: "+96550001234",
  created_at: NOW - 3 * DAY,
  stage: null,
  lead_class: "qualified",
  dnd: false,
  last_dial_at: null,
  reached: false,
  inbound_at: null,
  booked_at: null,
  last_call_status: null,
  last_call_type: null,
  last_call_at: null,
  due_at: null,
  callback_at: null,
  closed: null,
  claimed_by: null,
  sales_lead: true,
  stage_role: null,
  revenue: null,
  readiness: null,
  misses: 0,
  hot: false,
  hot_owner: null,
  hot_next_at: null,
  appt: null,
  ...over,
});

const intro = (over: Partial<Appt> = {}): Appt => ({
  id: "i1",
  type: "intro",
  start: NOW + 2 * HOUR,
  booked: NOW - DAY,
  status: "confirmed",
  assigned: "G-me",
  confirmed: false,
  last_try: null,
  ...over,
});

describe("finding 1: a lead from the night or the weekend gets the burst from its first call", () => {
  const created = Date.parse("2026-11-07T23:00:00Z"); // Sunday 02:00 Kuwait
  const firstCall = Date.parse("2026-11-08T07:05:00Z"); // Sunday 10:05 Kuwait, Maqsam's start
  const saved = firstCall + 40_000; // the dialer's No answer
  const night = (over: Partial<Candidate> = {}) =>
    lead({
      contact_id: "night",
      created_at: created,
      last_dial_at: saved,
      miss_times: [saved],
      first_try_at: firstCall,
      misses: 1,
      due_at: saved + 2 * MIN,
      ...over,
    });

  test("the first call that rang out starts the burst: a 2-minute second try, then the voice note", () => {
    expect(burstAnchor({ created_at: created, just_booked: null, first_try_at: firstCall }, saved)).toEqual({ at: firstCall, step: "new" });
    // dial.save on that first miss: the quick retry, the ladder unmoved.
    const anchor = burstAnchor({ created_at: created, just_booked: null, first_try_at: firstCall }, saved);
    expect(quickRetryDue(anchor, 0, saved)).toBe(saved + 2 * MIN);
    // While the two minutes run, the voice note is the lead's step.
    expect(secondTry(night(), saved + MIN)).toBe("wait");
    expect(voiceNoteDue(night(), saved + MIN)).toBe("new");
    expect(rankForSetter([night()], "me", saved + MIN)[0]).toMatchObject({ code: "voice_note", voice_step: "new" });
    // Then the second try, Call now.
    expect(secondTry(night(), saved + 2 * MIN)).toEqual({ due: saved + 2 * MIN, step: "new" });
    expect(rankForSetter([night()], "me", saved + 2 * MIN)[0]).toMatchObject({ tier: 0, code: "second_try" });
  });

  test("a lead with a call booked ahead hears the booked script", () => {
    const c = night({ booked_at: NOW + DAY });
    expect(burstAnchor(c, saved)?.step).toBe("booked");
  });

  test("not for a lead first called more than three days after it came in, nor one whose first call was answered", () => {
    const old = created - FIRST_CALL_NEW - HOUR;
    expect(burstAnchor({ created_at: old, just_booked: null, first_try_at: firstCall }, saved)).toBeNull();
    expect(secondTry(night({ first_try_at: null }), saved + 2 * MIN)).toBeNull();
    expect(voiceNoteDue(night({ first_try_at: null }), saved + MIN)).toBeNull();
    // An hour after that first call the burst is over.
    expect(burstAnchor({ created_at: created, just_booked: null, first_try_at: firstCall }, firstCall + 61 * MIN)).toBeNull();
  });

  test("the first call since the lead came in counts only when nobody picked it up", () => {
    expect(firstTry([{ at: 5, miss: true }, { at: 9, miss: false }], 1)).toBe(5);
    expect(firstTry([{ at: 5, miss: false }, { at: 9, miss: true }], 1)).toBeNull();
    // A call from before the lead came in is not its first.
    expect(firstTry([{ at: 0, miss: false }, { at: 5, miss: true }], 1)).toBe(5);
    expect(firstTry([], 1)).toBeNull();
    expect(firstTry([{ at: 5, miss: true }], null)).toBeNull();
  });

  test("a lead that came in during the hour keeps its arrival as the anchor", () => {
    const fresh = NOW - 10 * MIN;
    expect(burstAnchor({ created_at: fresh, just_booked: null, first_try_at: NOW - 5 * MIN }, NOW)).toEqual({ at: fresh, step: "new" });
  });
});

describe("finding 2: a lead the setter closed after its intro was booked is not confirmed or called at its minute", () => {
  for (const closed of ["not_ready", "not_interested", "disqualified", "wrong_number"]) {
    test(`closed ${closed} after the booking: no confirmation, no pinned intro`, () => {
      const c = lead({
        contact_id: "jb",
        appt: intro(),
        booked_at: NOW + 2 * HOUR,
        closed,
        closed_at: NOW - 10 * MIN,
        reached: true,
        last_dial_at: NOW - 10 * MIN,
        stage_role: closed === "disqualified" ? "disqualified" : "nurture_long",
      });
      expect(endedAfterBooking(c)).toBe(true);
      expect(rankForSetter([c], "me", NOW, "G-me")).toEqual([]);
      expect(rankForSetter([c], "me", NOW + 2 * HOUR, "G-me")).toEqual([]);
    });
  }

  test("the intro is still marked once its time has passed (the mark item), so it is recorded", () => {
    const appt = intro({ start: NOW - HOUR });
    const c = lead({ contact_id: "jb", appt: null, closed: "not_ready", closed_at: NOW - 3 * HOUR, unmarked_intro: appt, unmarked: appt });
    expect(rankForSetter([c], "me", NOW, "G-me")[0]).toMatchObject({ code: "mark_call" });
  });

  test("a booking after the close (the lead came back) is confirmed and called as usual", () => {
    const c = lead({ contact_id: "back", appt: intro({ booked: NOW - 5 * HOUR }), booked_at: NOW + 2 * HOUR, closed: "not_interested", closed_at: NOW - 2 * DAY });
    expect(endedAfterBooking(c)).toBe(false);
    expect(rankForSetter([c], "me", NOW, "G-me")[0]).toMatchObject({ code: "confirm", tier: 0 });
  });

  test("a call whose booking time is not known is worked as before", () => {
    const c = lead({ contact_id: "unk", appt: intro({ booked: null }), booked_at: NOW + 2 * HOUR, closed: "not_ready", closed_at: NOW - HOUR });
    expect(endedAfterBooking(c)).toBe(false);
  });
});

describe("finding 3: the confirmation's voice note shows for a call booked from the dialer", () => {
  const appt = intro({ last_try: NOW - 5 * MIN, last_miss: NOW - 5 * MIN });
  const base = { contact_id: "cv", appt, booked_at: appt.start, reached: true, last_dial_at: NOW - 5 * MIN, closed: "booked" };

  test("closed booked, the 2.5 h call rang out: the voice note is on the queue until the 60-minute try", () => {
    const c = lead(base);
    expect(rankForSetter([c], "me", NOW, "G-me")[0]).toMatchObject({ code: "voice_note", voice_step: "confirm" });
    expect(rankForSetter([c], "me", appt.start - 61 * MIN, "G-me")[0]).toMatchObject({ code: "voice_note" });
    // At 60 minutes the call itself comes back first.
    expect(rankForSetter([c], "me", appt.start - 59 * MIN, "G-me")[0]).toMatchObject({ code: "confirm_last" });
  });

  test("another rep's call is not his to send a confirmation note for", () => {
    const c = lead({ ...base, appt: { ...appt, assigned: "G-other" } });
    expect(rankForSetter([c], "me", NOW, "G-me").some(r => r.code === "voice_note")).toBe(false);
  });

  test("a lead closed for another reason still gets nothing", () => {
    expect(rankForSetter([lead({ ...base, closed: "handled" })], "me", NOW, "G-me")).toEqual([]);
  });
});

describe("finding 4: his unmarked intro stays when the closer's demo, booked straight after it, passes its 20 minutes", () => {
  const mine = intro({ id: "i", start: NOW - 2 * HOUR });
  const demo: Appt = { ...mine, id: "d", type: "demo", start: NOW - 90 * MIN, assigned: "G-closer" };
  const c = lead({ contact_id: "m", reached: true, last_dial_at: NOW - 3 * HOUR, demo_rep: "G-closer", unmarked: demo, unmarked_intro: mine, unmarked_demo: demo });

  test("the setter is asked to mark his intro, the closer his demo", () => {
    expect(rankForSetter([c], "me", NOW, "G-me")[0]).toMatchObject({ code: "mark_call", mark: { id: "i" } });
    const closer = rankForCloser([{ ...c, demo_at: demo.start, demo_status: "confirmed", signed: false }], "closer", NOW, "G-closer");
    expect(closer[0]).toMatchObject({ code: "mark_call", mark: { id: "d" } });
  });

  test("an older server's single `unmarked` still works", () => {
    const old = lead({ contact_id: "o", unmarked: mine });
    expect(rankForSetter([old], "me", NOW, "G-me")[0]).toMatchObject({ code: "mark_call" });
  });
});

describe("finding 5: one missed call counts once, however slow the save", () => {
  test("a save 3.5 minutes (or nine) after Maqsam's call started is that call", () => {
    const start = NOW - 10 * MIN;
    expect(mergeMisses([start + 3.5 * MIN], [start])).toEqual([start + 3.5 * MIN]);
    expect(mergeMisses([start + 9 * MIN], [start])).toHaveLength(1);
    // Over ten minutes it is another call.
    expect(mergeMisses([start + 11 * MIN], [start])).toHaveLength(2);
  });

  test("a second call started after the first save is never that save's", () => {
    const t1 = NOW - 6 * MIN;
    const s1 = t1 + 40_000;
    const t2 = t1 + 3 * MIN;
    expect(mergeMisses([s1], [t1, t2])).toEqual([s1, t2]);
    // A softphone miss with no save stays apart from the dialer's call and its save.
    expect(unpairedCalls([t2 + 30_000], [t1, t2])).toEqual([t1]);
  });

  test("so the second try is offered after a slow first save", () => {
    const start = NOW - 6 * MIN;
    const saved = start + 3.5 * MIN;
    const c = lead({ contact_id: "n", created_at: NOW - 8 * MIN, last_dial_at: saved, miss_times: mergeMisses([saved], [start]), due_at: saved + 2 * MIN });
    expect(secondTry(c, saved + 2 * MIN)).toEqual({ due: saved + 2 * MIN, step: "new" });
    expect(rankForSetter([c], "me", saved + 2 * MIN)[0]?.code).toBe("second_try");
  });
});

describe("finding 7: no 'tried to call you' note after the second try was answered", () => {
  const created = NOW - 10 * MIN;
  const miss = NOW - 6 * MIN;

  test("answered, then a call-back saved: no voice note; with no call-back set either", () => {
    const c = lead({ contact_id: "cb", created_at: created, miss_times: [miss], last_dial_at: NOW - MIN, reached: true, callback_at: NOW + 3 * HOUR });
    expect(voiceNoteDue(c, NOW)).toBeNull();
    expect(rankForSetter([c], "me", NOW).some(r => r.code === "voice_note")).toBe(false);
    expect(voiceNoteDue({ ...c, callback_at: null }, NOW)).toBeNull();
  });

  test("still due while the second try waits, and after the second miss", () => {
    const waiting = lead({ contact_id: "w", created_at: created, miss_times: [miss], last_dial_at: miss });
    expect(voiceNoteDue(waiting, miss + MIN)).toBe("new");
    const twice = lead({ contact_id: "t", created_at: created, miss_times: [miss, miss + 3 * MIN], last_dial_at: miss + 3 * MIN });
    expect(voiceNoteDue(twice, miss + 4 * MIN)).toBe("new");
  });
});

describe("finding 8: no confirmation note to a lead who confirmed, or after a message", () => {
  test("confirmed after the 2.5 h miss (a call or the CONFIRMED stage): no voice note", () => {
    const c = lead({ contact_id: "ok", appt: intro({ confirmed: true, last_try: NOW - 5 * MIN, last_miss: NOW - 5 * MIN }), booked_at: NOW + 2 * HOUR });
    expect(voiceNoteDue(c, NOW)).toBeNull();
    expect(rankForSetter([c], "me", NOW, "G-me").some(r => r.code === "voice_note")).toBe(false);
  });

  test("the 60-minute call answered after the miss: no voice note", () => {
    const appt = intro({ start: NOW + 55 * MIN, last_try: NOW - 95 * MIN, last_miss: NOW - 95 * MIN });
    const c = lead({ contact_id: "a", appt, booked_at: appt.start, last_dial_at: NOW - 3 * MIN });
    expect(voiceNoteDue(c, NOW)).toBeNull();
  });

  test("a message sent is a try, not a call that rang out: no voice note", () => {
    const c = lead({ contact_id: "m", appt: intro({ last_try: NOW - 5 * MIN, last_miss: null }), booked_at: NOW + 2 * HOUR });
    expect(voiceNoteDue(c, NOW)).toBeNull();
  });

  test("not confirmed and the call rang out: the voice note", () => {
    const c = lead({ contact_id: "n", appt: intro({ last_try: NOW - 5 * MIN, last_miss: NOW - 5 * MIN }), booked_at: NOW + 2 * HOUR, last_dial_at: NOW - 5 * MIN });
    expect(voiceNoteDue(c, NOW)).toBe("confirm");
  });
});

describe("finding 6: no voice-note step while the voice notes cannot be read", () => {
  test("voice_known false: nothing is due, so nothing has to be cleared", () => {
    const c = lead({ contact_id: "v", created_at: NOW - 8 * MIN, miss_times: [NOW - MIN], last_dial_at: NOW - MIN, voice_known: false });
    expect(voiceNoteDue(c, NOW)).toBeNull();
    expect(rankForSetter([c], "me", NOW).some(r => r.code === "voice_note")).toBe(false);
  });
});

describe("finding 17: a lead past its demo is the closer's, even with the demo older than the calendar window", () => {
  const didnt = lead({ contact_id: "dc", owner: "closer@x", owner_role: "closer", stage: "😭Showed - Didn't Close", stage_role: "no_progress", demo_rep: null, inbound_at: NOW - 20 * MIN });

  test("'Showed - Didn't Close' is after a demo; 'Didn't Convert' (after an intro) is not", () => {
    expect(introStage(didnt)).toBe(false);
    expect(setterScope(didnt, "setter@x", "G-me", false)).toBe(false);
    expect(rankForSetter([didnt], "setter@x", NOW, "G-me")).toEqual([]);
    const convert = { ...didnt, stage: "Didn't Convert" };
    expect(introStage(convert)).toBe(true);
    // A manager still sees it.
    expect(setterScope(didnt, "boss@x", null, true)).toBe(true);
  });
});

describe("finding 15: the rooms sweep's phone check lists the same outcomes as roomlogic.ts", () => {
  test("the newest migration defining cockpit_sales_rooms_sweep has every PHONE_TALKED outcome", () => {
    const src = readFileSync(new URL("./roomlogic.ts", import.meta.url), "utf8");
    const list = /const PHONE_TALKED = new Set\(\[([^\]]+)\]\)/.exec(src)?.[1] ?? "";
    const outcomes = [...list.matchAll(/"([a-z_]+)"/g)].map(m => m[1] as string);
    expect(outcomes).toContain("not_ready");
    const dir = new URL("../../migrations/", import.meta.url);
    const newest = readdirSync(dir)
      .filter(f => f.endsWith(".sql"))
      .sort()
      .filter(f => /create or replace function public\.cockpit_sales_rooms_sweep\(\)/i.test(readFileSync(new URL(f, dir), "utf8")))
      .at(-1) as string;
    expect(newest).toBe("20261105x_sales_rooms_sweep_not_ready.sql");
    const sql = readFileSync(new URL(newest, dir), "utf8");
    const sqlList = /or \(pa\.outcome in \(([^)]+)\)/.exec(sql)?.[1] ?? "";
    const sqlOutcomes = [...sqlList.matchAll(/'([a-z_]+)'/g)].map(m => m[1] as string);
    expect([...sqlOutcomes].sort()).toEqual([...outcomes].sort());
  });
});

// ---------------------------------------------------------------------------
// Through the real handler
// ---------------------------------------------------------------------------

const DB = "https://db.setterfix.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-f@setterfix.invalid";
const db = new FakeDb({
  get now() {
    return Date.now();
  },
} as { now: number });
let handler: ((req: Request) => Promise<Response>) | undefined;
const seen: string[] = [];

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  seen.push(url);
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: SETTER, name: "Fay Setter", role: "setter", ghl_user_id: "G-setter", maqsam_email: SETTER });
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    // or= filters are honoured here (flat lists, as the reads write them).
    const path = decodeURIComponent(url.slice(`${DB}/rest/v1/`.length));
    const prefer = new Headers(init.headers as HeadersInit).get("prefer") ?? "";
    try {
      const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) return reply({});
  throw new Error(`no fake for ${method} ${url}`);
}

const realNow = Date.now.bind(Date);
let offset = 0;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: DB, SUPABASE_SERVICE_ROLE_KEY: "svc-f", SUPABASE_ANON_KEY: "anon-f", SALES_GHL_TOKEN: "ghl-f" };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  Date.now = () => realNow() + offset;
  await import("./index.ts");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(action: string, body: Row = {}): Promise<{ status: number; body: Row }> {
  globalThis.fetch = fakeFetch as typeof fetch;
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.setterfix.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer s", "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const iso = (t: number) => new Date(t).toISOString();
const row = (id: string, over: Row = {}): Row => ({
  contact_id: id,
  name: `${id} Person`,
  phone: "+96550007001",
  phone8: "50007001",
  lead_created_at: iso(Date.now() - 20 * DAY),
  stage_id: "s-new",
  stage_name: "🚨New Lead",
  pipeline_id: "p-sales",
  lead_class: "qualified",
  dnd: false,
  contact_type: "lead",
  assigned_to: null,
  tags: ["roas-qualified"],
  country: "KW",
  ...over,
});

/** A fresh world, five minutes after the last (past every 20 s and one-minute cache). */
function world() {
  db.tables = {};
  db.faults = [];
  offset += 5 * MIN;
  db.seed("cockpit_sales_settings", [{ key: "pipeline", value: { auto_moves: true, id: "p-sales", roles: { "s-new": "new" } } }]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Fay Setter", name_ar: "فاي", role: "setter", ghl_user_id: "G-setter", active: true, via_portal: true, maqsam_email: SETTER },
  ]);
}

describe("through the handler", () => {
  test("finding 1: dial.save on a lead from the night: its first miss comes back in two minutes, the second goes on the ladder", async () => {
    world();
    const now = Date.now();
    db.seed("cockpit_sales_leads", [row("nite", { lead_created_at: iso(now - 9 * HOUR) })]);
    const first = await call("dial.save", { contact_id: "nite", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect(first.status).toBe(200);
    const st = first.body.state as Row;
    expect(Number(st.step)).toBe(0);
    expect(Date.parse(String(st.due_at)) - Date.now()).toBeLessThanOrEqual(2 * MIN);
    expect(first.body.next_step).toMatchObject({ kind: "voice_note", facts: { step: "new" } });
    offset += 3 * MIN;
    const second = await call("dial.save", { contact_id: "nite", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect(second.status).toBe(200);
    expect(Date.parse(String((second.body.state as Row).due_at)) - Date.now()).toBeGreaterThan(10 * MIN);
    expect((second.body.next_step as Row | null)?.second_try_at ?? null).toBeNull();
  });

  test("finding 7: a no-answer after the lead was reached in the burst goes on the ladder, with no voice note", async () => {
    world();
    const now = Date.now();
    db.seed("cockpit_sales_leads", [row("spoke", { lead_created_at: iso(now - 12 * MIN) })]);
    db.seed("cockpit_sales_attempts", [
      { id: "00000000-0000-4000-8000-00000000f701", contact_id: "spoke", rep_email: SETTER, state: "saved", outcome: "callback", item_kind: "lead", started_at: iso(now - 8 * MIN), saved_at: iso(now - 6 * MIN) },
    ]);
    const out = await call("dial.save", { contact_id: "spoke", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect(out.status).toBe(200);
    expect(out.body.next_step).toBeNull();
    const due = (out.body.state as Row).due_at;
    expect(due === null || Date.parse(String(due)) - Date.now() > 10 * MIN).toBe(true);
  });

  test("finding 5: a slow save of the dialer's own call is still the burst's first miss (its Maqsam record is this call)", async () => {
    world();
    const now = Date.now();
    db.seed("cockpit_sales_leads", [row("slow", { lead_created_at: iso(now - 20 * MIN) })]);
    const attemptId = "00000000-0000-4000-8000-00000000f501";
    db.seed("cockpit_sales_attempts", [
      { id: attemptId, contact_id: "slow", rep_email: SETTER, state: "placed", manual: false, item_kind: "lead", started_at: iso(now - 4 * MIN), maqsam_ref: "ref-1", maqsam_call_id: "mq-1" },
    ]);
    // Maqsam's record of that same call, 3.9 minutes before the save.
    db.seed("cockpit_sales_dials", [
      { call_id: "mq-1", contact_id: "slow", lead_phone8: "50007001", occurred_at: iso(now - 3.9 * MIN), state: "no_answer", direction: "outbound" },
    ]);
    const out = await call("dial.save", { attempt_id: attemptId, outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect(out.status).toBe(200);
    const st = out.body.state as Row;
    expect(Number(st.step)).toBe(0);
    expect(Date.parse(String(st.due_at)) - Date.now()).toBeLessThanOrEqual(2 * MIN);
  });

  test("finding 6: before the database update a no-answer offers no voice note (it could not be recorded)", async () => {
    world();
    db.faults.push({
      prefix: "cockpit_sales_touches",
      error: new DbError('database 404: {"code":"PGRST205","message":"Could not find the table"}', 404, "PGRST205"),
      times: 1000,
    });
    db.seed("cockpit_sales_leads", [row("pre", { lead_created_at: iso(Date.now() - 5 * MIN) })]);
    const out = await call("dial.save", { contact_id: "pre", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect(out.status).toBe(200);
    expect(out.body.next_step).toBeNull();
  });

  test("finding 13: a call Maqsam refused, let go with Skip, is not the lead's first call; a placed one is", async () => {
    world();
    const now = Date.now();
    db.seed("cockpit_sales_leads", [
      row("refused", { lead_created_at: iso(now - 2 * MIN), phone: "+96550007002", phone8: "50007002" }),
      row("rang", { lead_created_at: iso(now - 2 * MIN), phone: "+96550007003", phone8: "50007003" }),
    ]);
    db.seed("cockpit_sales_attempts", [
      { id: "a-r", contact_id: "refused", rep_email: SETTER, manual: false, state: "released", started_at: iso(now - 90_000), error: "Maqsam refused the call", call_state: null, maqsam_ref: null, item_kind: "lead" },
      { id: "a-d", contact_id: "refused", rep_email: SETTER, manual: false, state: "released", started_at: iso(now - 60_000), error: null, maqsam_ref: null, item_kind: "lead" },
      { id: "a-p", contact_id: "rang", rep_email: SETTER, manual: false, state: "saved", outcome: "no_answer", started_at: iso(now - 60_000), saved_at: iso(now - 20_000), maqsam_ref: "ref-p", item_kind: "lead" },
    ]);
    const { status, body } = await call("dial.queue", { as: "setter" });
    expect(status).toBe(200);
    expect(body.speed).toMatchObject({ leads: 2, called: 1, not_called: 1 });
    expect((body.speed as Row).oldest_waiting).toMatchObject({ contact_id: "refused" });
  });

  test("finding 14: one cold dial.queue reads the heavy rows once", async () => {
    world();
    db.seed("cockpit_sales_leads", [row("h")]);
    seen.length = 0;
    const { status } = await call("dial.queue", { as: "setter" });
    expect(status).toBe(200);
    const leads30 = seen.filter(u => u.includes("/rest/v1/cockpit_sales_leads?select=contact_id,name,phone,phone8,lead_created_at") && u.includes("lead_created_at=gte."));
    const cal60 = seen.filter(u => u.includes("/rest/v1/cockpit_sales_calendar?select=appointment_id,contact_id,call_type,start_at,booked_at,status,assigned_user_id"));
    expect([leads30.length, cal60.length]).toEqual([1, 1]);
  });

  // book.create and book.move answer with saveOutcome's fields spread in: a
  // save after anything but a no-answer or a held intro adds no field, so
  // the booking's answer the lead page's Calls card reads is as it was.
  test("campaign: a save that is not a no-answer or a held intro answers with exactly the fields it had", async () => {
    world();
    const now = Date.now();
    db.seed("cockpit_sales_leads", [row("bk")]);
    const cb = await call("dial.save", { contact_id: "bk", outcome: "callback", note: "Call after lunch.", callback_at: iso(now + 3 * HOUR), item_kind: "lead", as: "setter" });
    expect(cb.status).toBe(200);
    expect(Object.keys(cb.body).sort()).toEqual(["attempt", "ok", "stage_move", "state"]);
    const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(src).toContain('const out = await saveOutcome(who, attempt, p.contact, "booked"');
    expect(src).toContain("return { attempt: saved, state, stage_move: moving ? { state: \"pending\" } : null, ...after };");
    expect(src).toContain('const out: { next_step?: Row | null; hot_offer?: Row | null } = s.outcome === "no_answer" ? { next_step } : {};');
  });
});
