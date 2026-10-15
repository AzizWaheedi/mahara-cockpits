// A372: the morning hours note (nudge.ts + supabase/migrations/20261011e_ceo_hours_nudge.sql).
// Made-up people and figures only. Nothing here reaches Slack: fetch is a fake.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { CEO, MEMBER, actor, hoursTestDb, owner, pgReceipts, service } from "../../../apps/media-buyer-cockpit/scripts/lib/hoursTestDb.ts";
import { migration } from "../../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb.ts";
import type { InsertReceipt } from "./db.ts";
import { makeSyncDoor } from "./door.ts";
import { dayLabel, kuwaitYesterday, nudgeText, runNudge, type NudgeDeps } from "./nudge.ts";

let db: PGlite;
// A Saturday: the company's first working day of the week.
const DAY = "2026-10-10";
const NOW = new Date("2026-10-11T06:05:00Z"); // 09:05 Kuwait, the cron's time
const ids: Record<string, number> = {};

function rpc(name: string, args: Record<string, unknown>) {
  return (async () => {
    await service(db);
    if (name === "cockpit_hours_nudge_list") return (await db.query<{ r: unknown }>("SELECT public.cockpit_hours_nudge_list($1::date) r", [args.p_day])).rows[0].r;
    if (name === "cockpit_hours_nudge_finish") return (await db.query<{ r: unknown }>("SELECT public.cockpit_hours_nudge_finish($1::jsonb) r", [JSON.stringify(args.p)])).rows[0].r;
    throw new Error(`Unexpected RPC ${name}`);
  })();
}

type Call = { url: string; method: string; body: unknown; auth: string | null };
function slack(answers: Record<string, { status?: number; body: unknown } | "throw">) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get("Authorization") });
    const key = Object.keys(answers).find(k => url.includes(k));
    const answer = key ? answers[key] : undefined;
    if (!answer || answer === "throw") throw new TypeError("network down");
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

function deps(fetcher: typeof fetch, token = "xoxb-test-token"): NudgeDeps {
  return {
    rpc, insertReceipt: pgReceipts(db) as unknown as InsertReceipt, fetch: fetcher, now: () => NOW,
    slackToken: () => token, ceoEmail: "aziz@maharamedia.com", hoursUrl: "https://cockpit.example.test/ceo?tab=team",
  };
}

async function person(name: string, role: string, opts: { schedule?: unknown; engagement?: string; startedOn?: string } = {}) {
  await owner(db);
  // Started before the day, so the roster triggers write an employed period and the schedule from then.
  const r = await db.query<{ id: number }>(
    "INSERT INTO public.cockpit_people(name,role,engagement,active,monthly_cost,currency,added_by,schedule,started_on) VALUES($1,$2,$3,true,500,'USD','fixture',$4::jsonb,$5) RETURNING id",
    [name, role, opts.engagement ?? "staff", opts.schedule === undefined ? null : JSON.stringify(opts.schedule), opts.startedOn ?? "2026-09-01"]);
  ids[name] = r.rows[0].id;
  return r.rows[0].id;
}
async function link(provider: "hubstaff" | "timetastic", externalId: string, personId: number) {
  await owner(db);
  await db.query("INSERT INTO public.cockpit_time_accounts(provider,external_id,name,person_id,link_method) VALUES($1,$2,$3,$4,'manual')", [provider, externalId, externalId, personId]);
}

const week = (offDay: string | null) => ({
  timezone: "Asia/Kuwait",
  exceptions: offDay ? [{ date: offDay, off: true }] : [],
  week: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(k => [k, { on: k !== "fri", start: "10:00", end: "18:00" }])),
});

beforeAll(async () => {
  db = await hoursTestDb();
  await owner(db);
  await db.exec(migration("20260921a_cockpit_settings.sql"));
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS cron;
    CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
    CREATE OR REPLACE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(n,s,c) RETURNING jobid $$;
    CREATE OR REPLACE FUNCTION cron.unschedule(id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid=id RETURNING true $$;`);
  await db.exec(migration("20261011e_ceo_hours_nudge.sql"));
  await db.exec(migration("20261011e_ceo_hours_nudge.sql")); // safe to apply twice

  // Required to track (call centre and media buyer roles), optional, and exempt people.
  const agentA = await person("Agent A", "Call centre agent", { schedule: week(null) });
  const agentB = await person("Agent B", "Call centre agent", { schedule: week(null) });
  const agentC = await person("Agent C", "Call centre agent", { schedule: week(null) });
  await person("Agent D", "Call centre agent", { schedule: week(DAY) });
  const agentE = await person("Agent E", "Call centre agent", { schedule: week(null) });
  await person("Agent F", "Call centre agent", { schedule: week(null), startedOn: "2026-10-11" });
  await person("Buyer", "Media buyer", { schedule: week(null) });
  // Pay follows hours (the media buyer default) and no schedule is saved: the Hours tab expects nothing of them that day.
  await person("Buyer two", "Media buyer");
  const editor = await person("Editor", "Video editor", { schedule: week(null) });
  await person("Shared inbox", "Bot", { engagement: "bot" });
  await link("hubstaff", "hs-a", agentA);
  await link("hubstaff", "hs-b", agentB);
  await link("hubstaff", "hs-c", agentC);
  await link("timetastic", "tt-c", agentC);
  await link("hubstaff", "hs-ed", editor);
  await owner(db);
  await db.query("INSERT INTO public.cockpit_hubstaff_days(hubstaff_user_id,day,tracked_s) VALUES('hs-b',$1,25200),('hs-a',$1,0)", [DAY]);
  await db.query("INSERT INTO public.cockpit_timetastic_bookings(booking_id,tt_user_id,leave_type_id,status,start_at,start_type,end_at,end_type,booking_unit) VALUES('bk-1','tt-c','lt-1','Approved',$1,'Morning',$1,'Afternoon','Days')", [`${DAY} 00:00`]);
  await db.query("INSERT INTO public.cockpit_timetastic_days(tt_user_id,day,kind,entity_key) VALUES('tt-c',$1,'booking','bk-1')", [DAY]);
  // Timetastic's own working week calls Saturday non-working; the cockpit's schedule says it is a working day, as on the Hours tab.
  await link("timetastic", "tt-a", agentA);
  await db.query("INSERT INTO public.cockpit_timetastic_days(tt_user_id,day,kind,entity_key) VALUES('tt-a',$1,'non_working','nwd')", [DAY]);
  // A public holiday added for Agent E only.
  await db.query("INSERT INTO public.cockpit_hours_holiday_overrides(day,action,name,scope,scope_value,reason,set_by) VALUES($1,'add','Fixture day','person',$2,'A fixture holiday','fixture')", [DAY, String(agentE)]);
}, 60_000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await owner(db);
  await db.exec("DELETE FROM public.cockpit_hours_coverage WHERE provider='hubstaff'");
  await db.query("INSERT INTO public.cockpit_hours_coverage(provider,day,last_ok_at,read_started_at) VALUES('hubstaff',$1,'2026-10-11T05:17:00Z','2026-10-11T05:16:00Z')", [DAY]);
  await db.exec("UPDATE public.cockpit_settings SET value='{\"on\":false}' WHERE key='hours.nudge'");
});

async function lastState() {
  await owner(db);
  return (await db.query<{ ok: boolean; note: string; rows_seen: number | null }>("SELECT ok,note,rows_seen FROM public.cockpit_sync_state WHERE key='hours-nudge'")).rows[0];
}
async function audits(action: string) {
  await owner(db);
  return (await db.query<{ after: Record<string, unknown>; actor_email: string }>("SELECT after,actor_email FROM public.cockpit_audit_log WHERE action=$1 ORDER BY created_at,id", [action])).rows;
}

describe("the words", () => {
  test("yesterday is the Kuwait day before", () => {
    expect(kuwaitYesterday(new Date("2026-10-11T06:05:00Z"))).toBe("2026-10-10");
    expect(kuwaitYesterday(new Date("2026-10-10T21:30:00Z"))).toBe("2026-10-10"); // 00:30 on the 11th in Kuwait
    expect(dayLabel("2026-10-10")).toBe("Sat 10 Oct");
  });
  test("one line per person with the role first, and the link", () => {
    const text = nudgeText({ day: DAY, on: true, ready: true, hubstaffReadAt: null, required: 3, note: null, people: [
      { personId: 1, name: "Agent A", role: "Call centre agent", reason: "nothing_tracked" },
      { personId: 2, name: "Buyer", role: "Media buyer", reason: "no_hubstaff_account" },
    ] }, "https://x.test/ceo?tab=team");
    expect(text).toBe([
      "Hours check for Sat 10 Oct: 2 people who should have tracked did not.",
      "• Call centre agent (Agent A): nothing tracked in Hubstaff.",
      "• Media buyer (Buyer): no Hubstaff account linked.",
      "Open Team & payroll, Hours and pay, to decide each day: https://x.test/ceo?tab=team",
    ].join("\n"));
  });
});

describe("the list", () => {
  test("required, working, not on leave, nothing tracked: listed; everyone else is not", async () => {
    const list = await rpc("cockpit_hours_nudge_list", { p_day: DAY }) as Record<string, any>;
    expect(list.ready).toBe(true);
    expect(list.on).toBe(false);
    // Agent B tracked 7 h, Agent C was on approved leave, Agent D had the day off on the schedule,
    // Agent E had a public holiday, Agent F started after the day, Buyer two has no schedule on hours pay.
    // Agent A's Timetastic "non-working" Saturday does not excuse it.
    expect(list.required).toBe(3); // Agent A, Agent B, Buyer
    expect(list.people).toEqual([
      { personId: ids["Agent A"], name: "Agent A", role: "Call centre agent", reason: "nothing_tracked" },
      { personId: ids.Buyer, name: "Buyer", role: "Media buyer", reason: "no_hubstaff_account" },
    ]);
  });
  test("Hubstaff not read since the day ended: nobody is listed and it says why", async () => {
    await owner(db);
    await db.exec("UPDATE public.cockpit_hours_coverage SET last_ok_at='2026-10-10T12:00:00Z' WHERE provider='hubstaff'");
    const list = await rpc("cockpit_hours_nudge_list", { p_day: DAY }) as Record<string, any>;
    expect(list.ready).toBe(false);
    expect(list.people).toEqual([]);
    expect(list.note).toBe("Hubstaff has not been read since Sat 10 Oct ended, so nobody is listed.");
  });
  test("today and the future are refused", async () => {
    await expect(rpc("cockpit_hours_nudge_list", { p_day: new Date().toISOString().slice(0, 10) })).rejects.toThrow(/finished day/);
  });
  test("only the service role reads the list or writes a run", async () => {
    await actor(db, CEO);
    await expect(db.query("SELECT public.cockpit_hours_nudge_list($1::date)", [DAY])).rejects.toThrow(/permission denied/);
    await expect(db.query("SELECT public.cockpit_hours_nudge_finish('{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await owner(db);
  });
});

describe("the switch", () => {
  test("ships off; the CEO turns it on and off, with an audit row each time", async () => {
    await actor(db, CEO);
    let state = (await db.query<{ r: any }>("SELECT public.cockpit_ceo_hours_nudge_get() r")).rows[0].r;
    expect(state.on).toBe(false);
    state = (await db.query<{ r: any }>("SELECT public.cockpit_ceo_hours_nudge_set(true) r")).rows[0].r;
    expect(state.on).toBe(true);
    expect(state.updatedBy).toBe("aziz@maharamedia.com");
    state = (await db.query<{ r: any }>("SELECT public.cockpit_ceo_hours_nudge_set(false) r")).rows[0].r;
    expect(state.on).toBe(false);
    const rows = await audits("hours.nudge.set");
    expect(rows.map(r => (r.after as any).value.on)).toEqual([true, false]);
    expect(rows.every(r => r.actor_email === "aziz@maharamedia.com")).toBe(true);
  });
  test("nobody else can read or set it", async () => {
    await actor(db, MEMBER);
    await expect(db.query("SELECT public.cockpit_ceo_hours_nudge_set(true)")).rejects.toThrow(/founder/);
    await expect(db.query("SELECT public.cockpit_ceo_hours_nudge_get()")).rejects.toThrow(/founder/);
    await actor(db, null);
    await expect(db.query("SELECT public.cockpit_ceo_hours_nudge_set(true)")).rejects.toThrow(/permission denied/);
    await owner(db);
  });
  test("the cron job is daily at 09:05 Kuwait", async () => {
    await owner(db);
    const jobs = (await db.query<{ jobname: string; schedule: string; command: string }>("SELECT jobname,schedule,command FROM cron.job WHERE jobname='mahara-hours-nudge'")).rows;
    expect(jobs).toEqual([{ jobname: "mahara-hours-nudge", schedule: "5 6 * * *", command: "SELECT public.cockpit_hours_nudge_kick();" }]);
  });
});

describe("a run", () => {
  test("switched off: nothing is sent; the state and an audit row say what it would have listed", async () => {
    const { calls, fetcher } = slack({});
    const r = await runNudge(deps(fetcher));
    expect(r).toMatchObject({ ok: true, sent: false, listed: 2 });
    expect(calls).toEqual([]);
    const s = await lastState();
    expect(s).toMatchObject({ ok: true, rows_seen: 2 });
    expect(s.note).toBe("Switched off, so nothing was sent. It would have listed 2: Call centre agent (Agent A), Media buyer (Buyer).");
    const a = (await audits("hours.nudge")).at(-1)!;
    expect(a.actor_email).toBe("service-role");
    expect(a.after).toMatchObject({ day: DAY, ok: true, sent: false, listed: 2 });
  });
  test("switched on: one message to the CEO, both Slack calls receipted", async () => {
    await owner(db);
    await db.exec("UPDATE public.cockpit_settings SET value='{\"on\":true}' WHERE key='hours.nudge'");
    await db.exec("DELETE FROM public.cockpit_hours_provider_health WHERE provider='slack'");
    const { calls, fetcher } = slack({
      "users.lookupByEmail": { body: { ok: true, user: { id: "U-CEO" } } },
      "chat.postMessage": { body: { ok: true, ts: "1.2" } },
    });
    const r = await runNudge(deps(fetcher));
    expect(r).toMatchObject({ ok: true, sent: true, listed: 2 });
    expect(calls.map(c => [c.method, c.url])).toEqual([
      ["GET", "https://slack.com/api/users.lookupByEmail?email=aziz%40maharamedia.com"],
      ["POST", "https://slack.com/api/chat.postMessage"],
    ]);
    expect(calls[1].body).toMatchObject({ channel: "U-CEO" });
    expect(String((calls[1].body as any).text)).toContain("• Call centre agent (Agent A): nothing tracked in Hubstaff.");
    expect(calls.every(c => c.auth === "Bearer xoxb-test-token")).toBe(true);
    await owner(db);
    const receipts = (await db.query<{ resource: string; phase: string; http_status: number | null; error: string | null }>(
      "SELECT resource,phase,http_status,error FROM public.cockpit_hours_provider_health WHERE provider='slack' ORDER BY id")).rows;
    expect(receipts).toEqual([
      { resource: "users.lookupByEmail", phase: "intent", http_status: null, error: null },
      { resource: "users.lookupByEmail", phase: "response", http_status: 200, error: null },
      { resource: "chat.postMessage", phase: "intent", http_status: null, error: null },
      { resource: "chat.postMessage", phase: "response", http_status: 200, error: null },
    ]);
    const all = (await db.query<{ t: string }>("SELECT string_agg(coalesce(error,'')||resource, ' ') t FROM public.cockpit_hours_provider_health")).rows[0].t;
    expect(all).not.toContain("xoxb");
    expect((await lastState()).note).toBe("Sent to the CEO on Slack: 2 listed (Call centre agent (Agent A), Media buyer (Buyer)).");
  });
  test("Slack refuses: nothing sent, the code is said, the run is not ok", async () => {
    await owner(db);
    await db.exec("UPDATE public.cockpit_settings SET value='{\"on\":true}' WHERE key='hours.nudge'");
    const { fetcher } = slack({ "users.lookupByEmail": { body: { ok: false, error: "missing_scope" } } });
    const r = await runNudge(deps(fetcher));
    expect(r).toMatchObject({ ok: false, sent: false });
    expect(r.note).toContain("missing_scope");
    expect((await lastState()).ok).toBe(false);
  });
  test("no token: nothing sent and it says which secret", async () => {
    await owner(db);
    await db.exec("UPDATE public.cockpit_settings SET value='{\"on\":true}' WHERE key='hours.nudge'");
    const { calls, fetcher } = slack({});
    const r = await runNudge(deps(fetcher, ""));
    expect(calls).toEqual([]);
    expect(r.note).toContain("SLACK_BOT_TOKEN is not set");
  });
  test("Hubstaff not read: not ok, nothing sent, even when on", async () => {
    await owner(db);
    await db.exec("UPDATE public.cockpit_settings SET value='{\"on\":true}' WHERE key='hours.nudge'");
    await db.exec("DELETE FROM public.cockpit_hours_coverage WHERE provider='hubstaff'");
    const { calls, fetcher } = slack({});
    const r = await runNudge(deps(fetcher));
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ ok: false, sent: false, listed: null });
    expect((await lastState()).note).toBe("Hubstaff has not been read since Sat 10 Oct ended, so nobody is listed.");
  });
  test("a dry run sends nothing and writes nothing", async () => {
    await owner(db);
    const before = (await db.query<{ n: number }>("SELECT count(*)::int n FROM public.cockpit_audit_log WHERE action='hours.nudge'")).rows[0].n;
    const { calls, fetcher } = slack({});
    const r = await runNudge(deps(fetcher), { dryRun: true });
    expect(calls).toEqual([]);
    expect(r.text).toContain("Hours check for Sat 10 Oct: 2 people");
    await owner(db);
    expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.cockpit_audit_log WHERE action='hours.nudge'")).rows[0].n).toBe(before);
  });
});

describe("the door", () => {
  const base = { rpc: async () => ({}), insertReceipt: async () => {}, fetch, sleep: async () => {}, now: () => NOW };
  test("the cron secret is still required", async () => {
    let ran = false;
    const door = makeSyncDoor({ ...base, cronSecret: () => "s3cret", waitUntil: () => {}, nudge: async () => { ran = true; return { ok: true, sent: false, day: DAY, listed: 0, note: "" }; } });
    const res = await door(new Request("https://x.test/", { method: "POST", body: JSON.stringify({ op: "nudge" }) }));
    expect(res.status).toBe(401);
    expect(ran).toBe(false);
  });
  test("a nudge answers 202 and runs in the background; a dry run answers with the result", async () => {
    const queued: Promise<unknown>[] = [];
    const seen: unknown[] = [];
    const door = makeSyncDoor({ ...base, cronSecret: () => "s3cret", waitUntil: w => { queued.push(w); },
      nudge: async opts => { seen.push(opts); return { ok: true, sent: false, day: DAY, listed: 0, note: "fixture" }; } });
    const headers = { "x-cron-secret": "s3cret" };
    const res = await door(new Request("https://x.test/", { method: "POST", headers, body: JSON.stringify({ op: "nudge" }) }));
    expect(res.status).toBe(202);
    expect(queued.length).toBe(1);
    const dry = await door(new Request("https://x.test/", { method: "POST", headers, body: JSON.stringify({ op: "nudge", dryRun: true }) }));
    expect(dry.status).toBe(200);
    expect(await dry.json()).toMatchObject({ note: "fixture" });
    expect(seen).toEqual([{}, { dryRun: true }]);
  });
});
