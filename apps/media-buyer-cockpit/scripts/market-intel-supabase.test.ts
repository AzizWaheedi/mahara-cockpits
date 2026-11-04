/**
 * Market research, MI-1 (20261103i_market_intel.sql): the home of hermes/market-intel, dark.
 *
 * The functions 20261103i reads are cut from their canonical migrations (cockpit_form_stage4_fields and
 * cockpit_form_stage4_typeform_answers from 20261102o, cockpit_form_stage4_text from 20261102j), the identity
 * gate is 20260923m's, and stand-in tables give the reads their live columns. cockpit_csm_client_gate is a
 * stand-in that opens only the cards a test lists for a seat.
 *
 * Covered: the prerequisite and the drift guard (the file's own md5s, a changed body stops the next apply);
 * a second apply; row security and grants (SELECT only for service_role, nothing for anon or authenticated;
 * the worker's functions to service_role only, the cockpit's three to authenticated, the helpers to nobody);
 * the setting seeded off with its audit row; enqueue (one run per answer, one open run per card, the month cap
 * on a rerun); the shadow scan; claim (off, one at a time, resume first, three tries); the lease; progress
 * (spend never goes down, the switch and the caps handed back); store (evidence once, a review naming its
 * reviewer refused, flags kept); release (an outage or a pause is not a try, the wait doubles to 4 hours, 24
 * hours of outages ask for a person; an error is a try); done (a shadow run publishes nothing); input and nap
 * (never a contact value); view (findings only from a finished run), rerun and flag gated by role; prune; every
 * change to the setting audited; every write audited. Every client, card, person and answer is invented.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const FILE = "20261103i_market_intel.sql";
const O = "20261102o_stage4_match_make.sql";
const J = "20261102j_stage4_native.sql";

const TASK = "taskMiCedar1";
const TASK2 = "taskMiOlive2";
const TEST_CARD = "86eywg1cq";
const CEO = "6c1d0000-0000-4000-8000-000000000001";
const ADMIN = "6c1d0000-0000-4000-8000-000000000002";
const CSM = "6c1d0000-0000-4000-8000-000000000003";
const CREATIVE = "6c1d0000-0000-4000-8000-000000000004";
const SALES = "6c1d0000-0000-4000-8000-000000000005";

/** KFRCXPFx refs. */
const R = {
  fullName: "533f14a0-712f-4de9-9ac7-67e1be6bc0c8",
  phone: "64f2fb80-b074-4017-b8b7-b7d549947e52",
  email: "7994f0d2-baeb-451b-983a-816290873a68",
  frontDesk: "282dac48-5031-4acb-96b6-ea469e8a5a8b",
  personalPhone: "09d2e62a-51d4-4665-a3a9-30f5279b71bc",
  businessName: "514bfd3f-4ca1-469e-b9e7-87656503f65c",
  mapsLink: "f7f9f2eb-1761-4c28-83ed-a53621c2cf88",
  website: "454a425f-2ac6-4d94-92db-cec08618600e",
  instagram: "adecfe45-5d55-4319-98ff-3761e04bfc9b",
  services: "d976036f-6c2e-4d5d-999a-64cf9bb2ef02",
  focus: "6271b610-6946-4056-bb08-d03ffc274141",
  areas: "fa017616-3fb5-4e64-9fbd-39cea6e26c47",
  drive: "64d23c81-1784-4f07-8356-107af764fc95",
} as const;
/** The contact answers (invented); none may leave the database through this file's functions. */
const CONTACT = {
  fullName: "Invented Owner Person",
  phone: "+96500000011",
  email: "owner@cedar-mi.invalid",
  frontDesk: "+965 2200 0123",
  personalPhone: "+96500000044",
};
const CONTACT_VALUES = [CONTACT.fullName, CONTACT.phone, CONTACT.email, CONTACT.frontDesk, CONTACT.personalPhone,
  "22000123", "96500000011", "96500000044"];

type Row = Record<string, any>;
const a = (ref: string, value: string, title = "Stored title") => ({ ref, title, value });
const ANSWERS = [
  a(R.fullName, CONTACT.fullName, "Full Name"),
  a(R.phone, CONTACT.phone, "Phone"),
  a(R.email, CONTACT.email, "Email"),
  a(R.businessName, "Cedar Invented Interiors", "Business Name"),
  a(R.mapsLink, "https://maps.app.goo.gl/inventedCedar1", "Maps"),
  a(R.website, "https://cedar-invented.example", "Website URL"),
  a(R.instagram, "https://www.instagram.com/cedar.invented", "Instagram URL"),
  a(R.frontDesk, CONTACT.frontDesk, "Front Desk Phone"),
  a(R.personalPhone, CONTACT.personalPhone, "Personal Phone Number"),
  a(R.services, "Villa interiors, kitchens", "Services"),
  a(R.focus, "Villa interiors", "Focus"),
  a(R.areas, "Hawalli and Salmiya", "Areas"),
  a(R.drive, "https://drive.google.com/drive/folders/inventedCedarDrive", "Drive"),
];

let db: PGlite;
const json = (v: unknown) => JSON.stringify(v);

function fnDef(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Canonical definition missing: ${name}`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$;", open + 2);
  return sql.slice(start, close + 3);
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
}
async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code ?? "", message: x.message };
  }
  throw new Error("Expected a refusal");
}
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await owner(db);
  await db.exec("SET ROLE service_role");
  try {
    return await fn();
  } finally {
    await owner(db);
  }
}
const md5Of = (fn: string) =>
  one<string>(
    "SELECT md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS r FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
    [`public.${fn}`],
  );
/** The (function, after md5) pairs the file's drift guard names. */
function guardPairs(sql: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /\('public\.(cockpit_market_intel_[a-z_]+\([^)]*\))', '([0-9a-f]{32})'\)/g;
  for (const m of sql.matchAll(re)) out.push([m[1], m[2]]);
  return out;
}
const audits = (action: string) =>
  one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = $1", [action]);
const setting = (value: Row) =>
  db.query("UPDATE public.cockpit_settings SET value = value || $1::jsonb WHERE key = 'market_intel'", [json(value)]);
async function response(opts: { task?: string; id?: string; answers?: Row; mode?: string; at?: string; form?: string } = {}) {
  await owner(db);
  const id = opts.id ?? crypto.randomUUID();
  await db.query(
    `INSERT INTO public.cockpit_form_responses(id, form_key, form_version, source, task_id, mode, state, answers, created_by, submitted_at)
     VALUES ($1, $2, 1, 'typeform_sync', $3, $4, 'submitted', $5::jsonb, 'import', $6::timestamptz)`,
    [id, opts.form ?? "onboarding", opts.task ?? TASK, opts.mode ?? "live", json(opts.answers ?? { fields: ANSWERS }),
     opts.at ?? new Date().toISOString()],
  );
  return id;
}
const enqueue = (task: string, resp: string, reason: string, note: string | null = null) =>
  asService(() => one<Row>("SELECT public.cockpit_market_intel_enqueue($1, $2::uuid, $3, 'test', $4) AS r", [task, resp, reason, note]));
const claim = () => asService(() => one<Row>("SELECT public.cockpit_market_intel_claim('worker-test') AS r"));
const runRow = (id: string) => one<Row>("SELECT to_jsonb(x) AS r FROM public.cockpit_market_intel_runs x WHERE x.id = $1::uuid", [id]);
async function clearRuns() {
  await owner(db);
  await db.exec(`DELETE FROM public.cockpit_market_intel_competitors; DELETE FROM public.cockpit_market_intel_findings;
    DELETE FROM public.cockpit_market_intel_evidence; DELETE FROM public.cockpit_market_intel_runs;`);
}
const SHA = "a".repeat(64);
const ev = (eid: string, extra: Row = {}) => ({
  eid, kind: "maps_place", subject: "client", url: "https://maps.example/place/1", retrievedAt: "2026-11-02T10:00:00Z",
  source: "compass/crawler-google-places", usd: 0.003, body: { rating: 4.6 }, sha256: SHA, ...extra,
});

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const o = migration(O);
  const j = migration(J);
  await db.exec(`
    CREATE TABLE public.cockpit_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.cockpit_form_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), form_key text NOT NULL,
      form_version integer NOT NULL, source text NOT NULL, external_id text, task_id text, client_name text, mode text NOT NULL,
      state text NOT NULL DEFAULT 'draft', answers jsonb NOT NULL DEFAULT '{}'::jsonb, answer_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      hidden jsonb NOT NULL DEFAULT '{}'::jsonb, revision integer NOT NULL DEFAULT 1, created_by text NOT NULL, created_by_id uuid,
      submitted_by text, submitted_at timestamptz, confirmed_by text, confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), invite_id uuid, signer text, lang text);
    CREATE TABLE public.cockpit_client_onboarding (clickup_task_id text PRIMARY KEY, client_name text, links jsonb NOT NULL DEFAULT '{}'::jsonb,
      forms jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE public.cockpit_billing_accounts (clickup_task_id text PRIMARY KEY, client_name text, country text);
    CREATE TABLE public.cockpit_blueprints (task_id text PRIMARY KEY, answers jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE public.test_csm_clients (actor uuid, task_id text);
    CREATE FUNCTION public.cockpit_csm_client_gate(p_task_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path = '' AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.test_csm_clients t WHERE t.actor = auth.uid() AND t.task_id = p_task_id) THEN
        RAISE EXCEPTION 'That client is not on your access list' USING ERRCODE = '42501';
      END IF;
      RETURN jsonb_build_object('taskId', p_task_id);
    END $$;
    GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_gate(text) TO authenticated;`);
  // Without what it stands on, the file stops.
  const stop = await refusal(() => db.exec(migration(FILE)));
  expect(stop.message).toContain("Apply 20261102o before 20261103i.");
  await db.exec("ROLLBACK");
  await db.exec(fnDef(j, "cockpit_form_stage4_text"));
  await db.exec(fnDef(o, "cockpit_form_stage4_fields"));
  await db.exec(fnDef(o, "cockpit_form_stage4_typeform_answers"));
  await db.exec(migration(FILE));
  await member(db, CEO, "aziz@maharamedia.com", ["ceo"]);
  await member(db, ADMIN, "admin@mi-test.invalid", ["admin"]);
  await member(db, CSM, "csm@mi-test.invalid", ["csm"]);
  await member(db, CREATIVE, "creative@mi-test.invalid", ["creative"]);
  await member(db, SALES, "sales@mi-test.invalid", ["sales"]);
  await owner(db);
  await db.query("INSERT INTO public.test_csm_clients VALUES ($1, $2)", [CSM, TASK]);
  await db.query(
    "INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, links, forms) VALUES ($1, 'Cedar Invented', $2::jsonb, $3::jsonb)",
    [TASK, json({ drive: "https://drive.google.com/drive/folders/inventedCedarCard", website: "https://cedar-invented.example" }),
     json({ kickoff: { answers: [a("c0000001-0000-4000-8000-000000000007", "Interior design")] } })],
  );
  await db.query("INSERT INTO public.cockpit_billing_accounts VALUES ($1, 'Cedar Invented', 'QT')", [TASK]);
  await db.query("INSERT INTO public.cockpit_blueprints VALUES ($1, $2::jsonb)", [TASK, json({ competitors: "Invented Rival Studio" })]);
});

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("its drift guard names this file's own bodies, and a second apply changes nothing", async () => {
    await owner(db);
    const pairs = guardPairs(migration(FILE));
    expect(pairs.length).toBe(23);
    for (const [fn, after] of pairs) expect({ fn, md5: await md5Of(fn) }).toEqual({ fn, md5: after });
    const before = await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log");
    const value = await one<Row>("SELECT value AS r FROM public.cockpit_settings WHERE key = 'market_intel'");
    await db.exec(migration(FILE));
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log")).toBe(before);
    expect(await one<Row>("SELECT value AS r FROM public.cockpit_settings WHERE key = 'market_intel'")).toEqual(value);
    expect(await audits("market_intel.setting_seeded")).toBe(1);
  });

  test("a changed body stops the next apply", async () => {
    await owner(db);
    await db.exec("BEGIN");
    try {
      await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_market_intel_effect() RETURNS jsonb LANGUAGE sql IMMUTABLE
        SECURITY DEFINER SET search_path = '' AS $$ SELECT '{}'::jsonb $$;`);
      const r = await refusal(() => db.exec(migration(FILE).replace(/^BEGIN;/m, "").replace(/COMMIT;\s*$/m, "")));
      expect(r.message).toContain("cockpit_market_intel_effect() changed since 20261103i");
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  test("the setting is seeded off, in shadow, with the caps; odd values fall back to the safe default", async () => {
    await owner(db);
    const v = await one<Row>("SELECT value AS r FROM public.cockpit_settings WHERE key = 'market_intel'");
    expect(v).toMatchObject({ on: false, mode: "shadow", apply_drive: false, apply_clickup: false, apply_kb: false,
      only_cards: [], usd_cap_run: 2, usd_cap_month: 25, refresh_on_kickoff: false });
    expect(typeof v.shadow_since).toBe("string");
    await db.exec("BEGIN");
    try {
      await setting({ on: "yes", mode: "loud", usd_cap_run: 900, usd_cap_month: -1 });
      const s = await one<Row>("SELECT public.cockpit_market_intel_settings() AS r");
      expect(s).toMatchObject({ on: false, mode: "shadow", usd_cap_run: 2, usd_cap_month: 25 });
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  test("the effect is catalogued, not wired", async () => {
    await owner(db);
    expect(await one<Row>("SELECT public.cockpit_market_intel_effect() AS r")).toEqual({
      key: "market_intel", label: "Market research", owner: "cockpit", delivery: "sql" });
  });
});

describe("row security and grants", () => {
  const TABLES = ["cockpit_market_intel_runs", "cockpit_market_intel_evidence", "cockpit_market_intel_findings",
    "cockpit_market_intel_competitors"];
  test("row security on; service_role reads only; anon and authenticated get nothing", async () => {
    await owner(db);
    for (const t of TABLES) {
      expect(await one<boolean>("SELECT relrowsecurity AS r FROM pg_class WHERE oid = $1::regclass", [`public.${t}`])).toBe(true);
      for (const [role, priv, want] of [["service_role", "SELECT", true], ["service_role", "INSERT", false],
        ["service_role", "UPDATE", false], ["service_role", "DELETE", false], ["authenticated", "SELECT", false],
        ["anon", "SELECT", false]] as const) {
        expect({ t, role, priv, has: await one<boolean>("SELECT has_table_privilege($1, $2, $3) AS r", [role, `public.${t}`, priv]) })
          .toEqual({ t, role, priv, has: want });
      }
    }
  });

  test("the worker's functions to service_role only, the cockpit's three to authenticated, the helpers to nobody", async () => {
    await owner(db);
    const can = (role: string, fn: string) =>
      one<boolean>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS r", [role, `public.${fn}`]);
    const worker = ["cockpit_market_intel_enqueue(text,uuid,text,text,text)", "cockpit_market_intel_scan(integer)",
      "cockpit_market_intel_claim(text,integer)", "cockpit_market_intel_progress(uuid,uuid,text,jsonb,jsonb)",
      "cockpit_market_intel_store(uuid,uuid,text,jsonb)", "cockpit_market_intel_release(uuid,uuid,text,integer,text)",
      "cockpit_market_intel_done(uuid,uuid,text,text,jsonb)", "cockpit_market_intel_input(uuid)", "cockpit_market_intel_preview(text)",
      "cockpit_market_intel_nap(uuid,text)", "cockpit_market_intel_prune(integer)", "cockpit_market_intel_month_usd()",
      "cockpit_market_intel_settings()", "cockpit_market_intel_effect()"];
    for (const fn of worker) {
      expect({ fn, s: await can("service_role", fn), u: await can("authenticated", fn), a: await can("anon", fn) })
        .toEqual({ fn, s: true, u: false, a: false });
    }
    for (const fn of ["cockpit_market_intel_view(text)", "cockpit_market_intel_rerun(text,text)",
      "cockpit_market_intel_flag_competitor(uuid,text,text)"]) {
      expect({ fn, u: await can("authenticated", fn), a: await can("anon", fn) }).toEqual({ fn, u: true, a: false });
    }
    for (const fn of ["cockpit_market_intel_audit(text,uuid,text,jsonb,jsonb,jsonb)", "cockpit_market_intel_lease(uuid,uuid)",
      "cockpit_market_intel_answers(uuid)", "cockpit_market_intel_seat()", "cockpit_market_intel_input_core(text,uuid)",
      "cockpit_market_intel_setting_audit()"]) {
      expect({ fn, s: await can("service_role", fn), u: await can("authenticated", fn) }).toEqual({ fn, s: false, u: false });
    }
  });
});

describe("the queue", () => {
  test("enqueue: one run per stored answer, one open run per card, every refusal a sentence", async () => {
    await clearRuns();
    const resp = await response();
    const first = await enqueue(TASK, resp, "shadow");
    expect(first).toMatchObject({ ok: true, reused: false });
    expect(await enqueue(TASK, resp, "shadow")).toEqual({ ok: true, runId: first.runId, reused: true });
    const second = await response();
    expect(await enqueue(TASK, second, "shadow")).toMatchObject({ ok: false, open: true, runId: first.runId,
      sentence: "Research is already running for this client. Wait for it to finish." });
    expect(await enqueue(TASK, resp, "rerun", "short")).toEqual({ ok: false, sentence: "Give a reason of 10 to 300 characters." });
    const kickoff = await response({ form: "kickoff" });
    expect((await enqueue(TASK, kickoff, "shadow")).sentence).toBe("That is not a submitted onboarding answer on this card.");
    expect((await enqueue(TASK2, resp, "shadow")).sentence).toBe("That is not a submitted onboarding answer on this card.");
    const shadowMode = await response({ task: TASK2, mode: "shadow" });
    expect((await enqueue(TASK2, shadowMode, "shadow")).sentence).toBe("That onboarding answer is not live, so it is not researched.");
    const canary = await response({ task: TEST_CARD, mode: "shadow" });
    expect((await enqueue(TEST_CARD, canary, "shadow")).ok).toBe(true);
    const bad = await refusal(() => enqueue(TASK, resp, "whenever"));
    expect(bad.code).toBe("22023");
    const row = await runRow(first.runId);
    expect(row).toMatchObject({ state: "queued", mode: "shadow", reason: "shadow", requested_by: "test", attempts: 0 });
    expect(await audits("market_intel.enqueued")).toBeGreaterThanOrEqual(2);
  });

  test("a rerun or backfill is refused once the month's budget is spent", async () => {
    await clearRuns();
    const resp = await response();
    await owner(db);
    await db.query(
      "INSERT INTO public.cockpit_market_intel_runs(task_id, response_id, reason, state, requested_by, usd_apify, usd_scrapecreators) VALUES ($1, $2::uuid, 'shadow', 'done', 'test', 24.5, 0.6)",
      [TASK, resp],
    );
    expect(Number(await asService(() => one("SELECT public.cockpit_market_intel_month_usd() AS r")))).toBeCloseTo(25.1, 4);
    const out = await enqueue(TASK, resp, "rerun", "The client changed city");
    expect(out).toEqual({ ok: false,
      sentence: "This month's research budget is spent (USD 25.10 of 25.00). Raise usd_cap_month or wait for the 1st." });
    // Last month's spend does not count.
    await owner(db);
    await db.exec("UPDATE public.cockpit_market_intel_runs SET requested_at = now() - interval '45 days'");
    expect((await enqueue(TASK, resp, "rerun", "The client changed city")).ok).toBe(true);
  });

  test("scan: nothing while off; on, every live answer since shadow_since gets one shadow run, once", async () => {
    await clearRuns();
    await owner(db);
    await db.exec("DELETE FROM public.cockpit_form_responses");
    const old = await response({ at: "2026-01-01T00:00:00Z" });
    const fresh = await response({ task: TASK2 });
    expect(await asService(() => one<Row>("SELECT public.cockpit_market_intel_scan(20) AS r"))).toMatchObject({ on: false, enqueued: 0 });
    await setting({ on: true });
    try {
      const out = await asService(() => one<Row>("SELECT public.cockpit_market_intel_scan(20) AS r"));
      expect(out).toMatchObject({ on: true, enqueued: 1 });
      const runs = await one<Row[]>("SELECT jsonb_agg(jsonb_build_object('task', task_id, 'resp', response_id, 'reason', reason)) AS r FROM public.cockpit_market_intel_runs");
      expect(runs).toEqual([{ task: TASK2, resp: fresh, reason: "shadow" }]);
      expect((await asService(() => one<Row>("SELECT public.cockpit_market_intel_scan(20) AS r"))).enqueued).toBe(0);
      expect(old).toBeTruthy();
    } finally {
      await owner(db);
      await setting({ on: false });
    }
  });
});

describe("claim, lease, progress, store, release, done", () => {
  test("claim: off says so; one run at a time; a lapsed lease resumes first; three tries end it", async () => {
    await clearRuns();
    const r1 = (await enqueue(TASK, await response(), "shadow")).runId;
    const r2 = (await enqueue(TASK2, await response({ task: TASK2 }), "shadow")).runId;
    expect(await claim()).toEqual({ off: true, sentence: "Market research is off (cockpit_settings market_intel)." });
    await owner(db);
    await setting({ on: true });
    try {
      const c1 = await claim();
      expect(c1).toMatchObject({ runId: r1, taskId: TASK, state: "claimed", attempts: 1, mode: "shadow",
        caps: { run: 2, month: 25 } });
      expect(await claim()).toEqual({ busy: true, runId: r1 });
      // The lease lapses mid-pull: the next claim resumes that run (its stage kept) before the queued one.
      await asService(() => db.query("SELECT public.cockpit_market_intel_progress($1::uuid, $2::uuid, 'pulling', '{\"a\":\"done\"}'::jsonb, NULL)", [r1, c1.claim]));
      await owner(db);
      await db.query("UPDATE public.cockpit_market_intel_runs SET claim_until = now() - interval '1 minute' WHERE id = $1::uuid", [r1]);
      const c2 = await claim();
      expect(c2).toMatchObject({ runId: r1, state: "pulling", attempts: 2, stageProgress: { a: "done" } });
      expect(c2.claim).not.toBe(c1.claim);
      // The old claim cannot write any more.
      const lost = await refusal(() => asService(() => db.query(
        "SELECT public.cockpit_market_intel_progress($1::uuid, $2::uuid, NULL, NULL, NULL)", [r1, c1.claim])));
      expect(lost.code).toBe("55000");
      expect(lost.message).toContain("lease has lapsed or belongs to another worker");
      await owner(db);
      await db.query("UPDATE public.cockpit_market_intel_runs SET claim_until = now() - interval '1 minute', attempts = 3, sentence = 'The engine did not answer.' WHERE id = $1::uuid", [r1]);
      const c3 = await claim();
      expect(c3.runId).toBe(r2);
      const ended = await runRow(r1);
      expect(ended).toMatchObject({ state: "failed", claim: null,
        sentence: "Research stopped after 3 tries. The engine did not answer." });
      expect(await audits("market_intel.failed")).toBe(1);
    } finally {
      await owner(db);
      await setting({ on: false });
    }
  });

  test("progress keeps spend cumulative, store writes evidence once and refuses a named reviewer, done ends it", async () => {
    await clearRuns();
    const run = (await enqueue(TASK, await response(), "shadow")).runId;
    await owner(db);
    await setting({ on: true });
    try {
      const c = await claim();
      const progress = (state: string | null, spend: Row) => asService(() => one<Row>(
        "SELECT public.cockpit_market_intel_progress($1::uuid, $2::uuid, $3, '{}'::jsonb, $4::jsonb) AS r",
        [run, c.claim, state, json(spend)]));
      expect(await progress("pulling", { usdApify: 0.4, usdScrapeCreators: 0.02, creditsScrapeCreators: 10 }))
        .toMatchObject({ ok: true, state: "pulling", on: true, caps: { run: 2, month: 25 } });
      // The switch and the caps as they are now: the worker stops or tightens mid-run.
      await owner(db);
      await setting({ on: false, usd_cap_run: 0.5 });
      expect(await progress(null, {})).toMatchObject({ on: false, caps: { run: 0.5, month: 25 } });
      await owner(db);
      await setting({ on: true, usd_cap_run: 2 });
      await progress(null, { usdApify: 0.1, usdScrapeCreators: 0.01, creditsScrapeCreators: 3 });
      const row = await runRow(run);
      expect([Number(row.usd_apify), Number(row.usd_scrapecreators), row.credits_scrapecreators]).toEqual([0.4, 0.02, 10]);
      expect((await refusal(() => progress("done", {}))).code).toBe("22023");
      expect((await refusal(() => progress(null, { usdApify: -1 }))).message).toContain("never negative");

      const store = (kind: string, rows: Row[]) => asService(() => one<Row>(
        "SELECT public.cockpit_market_intel_store($1::uuid, $2::uuid, $3, $4::jsonb) AS r", [run, c.claim, kind, json(rows)]));
      expect(await store("evidence", [ev("E1"), ev("E2", { kind: "review", body: { text: "Fast and tidy", stars: 5 } })]))
        .toEqual({ ok: true, rows: 2, written: 2 });
      // A resume sends the same evidence again: nothing is rewritten.
      expect(await store("evidence", [ev("E1", { body: { rating: 1 } })])).toEqual({ ok: true, rows: 1, written: 0 });
      expect(await one("SELECT body->>'rating' AS r FROM public.cockpit_market_intel_evidence WHERE eid = 'E1'")).toBe("4.6");
      const named = await refusal(() => store("evidence", [ev("E3", { kind: "review", body: { text: "Ok", reviewerName: "Someone" } })]));
      expect(named.message).toContain("names its reviewer");
      expect(await store("findings", [{ lang: "en", findings: { sections: [] }, checks: { schema: "pass" }, schemaVersion: "mi.findings.v1" }]))
        .toMatchObject({ written: 1 });
      expect(await store("competitors", [{ cid: "C1", name: "Invented Rival Studio", rating: 4.4, reviewsN: 120,
        placeUrl: "https://maps.example/place/rival", evidence: ["E1"] }])).toMatchObject({ written: 1 });
      await owner(db);
      await db.exec("UPDATE public.cockpit_market_intel_competitors SET flagged_wrong_by = 'x@mi-test.invalid'");
      await store("competitors", [{ cid: "C1", name: "Invented Rival Studio", rating: 4.5, reviewsN: 121, evidence: ["E1", "E2"] }]);
      expect(await one<Row>("SELECT to_jsonb(c) AS r FROM public.cockpit_market_intel_competitors c")).toMatchObject({
        rating: 4.5, reviews_n: 121, flagged_wrong_by: "x@mi-test.invalid", evidence: ["E1", "E2"] });
      expect((await refusal(() => store("bodies", []))).code).toBe("22023");

      const done = (state: string, summary: Row) => asService(() => one<Row>(
        "SELECT public.cockpit_market_intel_done($1::uuid, $2::uuid, $3, 'Research finished in shadow.', $4::jsonb) AS r",
        [run, c.claim, state, json(summary)]));
      const pub = await refusal(() => done("done", { docUrl: "https://docs.google.com/document/d/x/edit" }));
      expect(pub.message).toBe("A shadow run publishes nothing: no Doc, no card field, no comment.");
      expect((await refusal(() => done("done", { fieldState: "written" }))).code).toBe("22023");
      expect(await done("done", { sourcesN: 31, competitorsN: 6 })).toEqual({ ok: true, state: "done" });
      expect(await runRow(run)).toMatchObject({ state: "done", claim: null, sources_n: 31, competitors_n: 6,
        field_state: "not_due", sentence: "Research finished in shadow." });
      expect(await audits("market_intel.done")).toBe(1);
      expect(await audits("market_intel.stored")).toBeGreaterThanOrEqual(5);
      // Audit rows carry counts and states, never a body.
      const meta = await one<string>("SELECT string_agg(coalesce(after::text,'') || metadata::text, ' ') AS r FROM public.cockpit_audit_log WHERE action LIKE 'market_intel.%'");
      expect(meta).not.toContain("Fast and tidy");
    } finally {
      await owner(db);
      await setting({ on: false });
    }
  });

  test("release sends a run back to wait, and claim leaves it until then", async () => {
    await clearRuns();
    const run = (await enqueue(TASK, await response(), "shadow")).runId;
    await owner(db);
    await setting({ on: true });
    try {
      const c = await claim();
      expect(await asService(() => one<Row>(
        "SELECT public.cockpit_market_intel_release($1::uuid, $2::uuid, 'The Claude sign-in on the VPS has lapsed.', 30) AS r",
        [run, c.claim]))).toEqual({ ok: true, state: "queued", retryMinutes: 30 });
      expect(await runRow(run)).toMatchObject({ state: "queued", claim: null, sentence: "The Claude sign-in on the VPS has lapsed.",
        attempts: 1, outages: 0, outage_since: null });
      expect(await claim()).toEqual({ idle: true });
      await owner(db);
      await db.query("UPDATE public.cockpit_market_intel_runs SET not_before = now() - interval '1 minute' WHERE id = $1::uuid", [run]);
      expect((await claim()).runId).toBe(run);
    } finally {
      await owner(db);
      await setting({ on: false });
    }
  });

  const release = (run: string, claimId: string, sentence: string, minutes: number, kind: string) =>
    asService(() => one<Row>("SELECT public.cockpit_market_intel_release($1::uuid, $2::uuid, $3, $4, $5) AS r",
      [run, claimId, sentence, minutes, kind]));
  const due = (run: string) =>
    db.query("UPDATE public.cockpit_market_intel_runs SET not_before = now() - interval '1 minute' WHERE id = $1::uuid", [run]);

  test("an engine outage is not a try: four in a row leave the run queued, each wait longer, up to 4 hours", async () => {
    await clearRuns();
    const run = (await enqueue(TASK, await response(), "shadow")).runId;
    await owner(db);
    await setting({ on: true });
    const failedBefore = await audits("market_intel.failed");
    try {
      const waits: number[] = [];
      for (let i = 0; i < 4; i++) {
        const c = await claim();
        expect(c).toMatchObject({ runId: run, attempts: 1 });
        const out = await release(run, c.claim, "The Claude plan on the VPS is at its usage limit.", 60, "outage");
        expect(out.state).toBe("queued");
        waits.push(out.retryMinutes);
        await owner(db);
        await due(run);
      }
      expect(waits).toEqual([60, 120, 240, 240]);
      const row = await runRow(run);
      expect(row).toMatchObject({ state: "queued", attempts: 0, outages: 4 });
      expect(row.outage_since).not.toBeNull();
      // A fifth claim still runs it: no "Research stopped after 3 tries".
      expect(await claim()).toMatchObject({ runId: run, attempts: 1 });
      expect(await audits("market_intel.failed")).toBe(failedBefore);
      expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action = 'market_intel.released' AND entity_id = $1 AND metadata->>'kind' = 'outage'", [run]))
        .toBe(4);
    } finally {
      await owner(db);
      await setting({ on: false });
    }
  });

  test("24 hours of outages ask for a person; a pause starts the clock again; an error is a try", async () => {
    await clearRuns();
    const run = (await enqueue(TASK, await response(), "shadow")).runId;
    await owner(db);
    await setting({ on: true });
    try {
      let c = await claim();
      await release(run, c.claim, "The Claude proxy is not answering.", 60, "outage");
      await owner(db);
      await due(run);
      // Research turned off mid-run: not a try, and the outage clock starts again.
      c = await claim();
      expect(await release(run, c.claim, "Market research was turned off.", 5, "paused")).toMatchObject({ state: "queued", retryMinutes: 5 });
      expect(await runRow(run)).toMatchObject({ attempts: 0, outages: 1, outage_since: null });
      await owner(db);
      await due(run);
      // An unexpected error counts.
      c = await claim();
      await release(run, c.claim, "Research stopped on an unexpected error.", 30, "error");
      expect(await runRow(run)).toMatchObject({ state: "queued", attempts: 1 });
      expect((await refusal(() => release(run, c.claim, "x", 30, "whenever"))).code).toBe("55000");
      await owner(db);
      await due(run);
      c = await claim();
      expect((await refusal(() => release(run, c.claim, "Odd kind.", 30, "whenever"))).code).toBe("22023");
      await release(run, c.claim, "The Claude proxy is not answering.", 60, "outage");
      await owner(db);
      await db.query("UPDATE public.cockpit_market_intel_runs SET outage_since = now() - interval '25 hours', not_before = NULL WHERE id = $1::uuid", [run]);
      c = await claim();
      const out = await release(run, c.claim, "The Claude proxy is not answering.", 60, "outage");
      expect(out).toEqual({ ok: true, state: "needs_person",
        sentence: "Research waited 24 hours and stopped: The Claude proxy is not answering. Fix it, then run research again from the cockpit." });
      expect(await runRow(run)).toMatchObject({ state: "needs_person", claim: null, not_before: null });
      expect(await audits("market_intel.needs_person")).toBe(1);
      expect(await claim()).toEqual({ idle: true });
    } finally {
      await owner(db);
      await setting({ on: false });
    }
  });
});

describe("the setting", () => {
  test("every change to market_intel writes an audit row with the value before and after; other keys are left alone", async () => {
    await owner(db);
    const rows = () => one<number>("SELECT count(*)::int AS r FROM public.cockpit_audit_log WHERE action LIKE 'market_intel.setting_%' AND action <> 'market_intel.setting_seeded'");
    const before = await rows();
    await db.query("UPDATE public.cockpit_settings SET value = jsonb_set(value, '{apply_clickup}', 'true'), updated_by = 'ops@mi-test.invalid' WHERE key = 'market_intel'");
    const last = await one<Row>("SELECT to_jsonb(a) AS r FROM public.cockpit_audit_log a WHERE action = 'market_intel.setting_set' AND after->'value'->>'apply_clickup' = 'true'");
    expect(last).toMatchObject({ entity_type: "cockpit_settings", entity_id: "market_intel", actor_email: "ops@mi-test.invalid",
      before: { value: { apply_clickup: false } }, after: { value: { apply_clickup: true } }, metadata: { op: "update", key: "market_intel" } });
    // Who: the session's audit actor first.
    await db.exec("BEGIN");
    await db.query("SELECT set_config('cockpit.audit_actor', 'ceo-seat@mi-test.invalid', true)");
    await db.query("UPDATE public.cockpit_settings SET value = jsonb_set(value, '{apply_clickup}', 'false') WHERE key = 'market_intel'");
    await db.exec("COMMIT");
    expect(await one<string[]>("SELECT array_agg(actor_email) AS r FROM public.cockpit_audit_log WHERE action = 'market_intel.setting_set' AND before->'value'->>'apply_clickup' = 'true' AND after->'value'->>'apply_clickup' = 'false'"))
      .toEqual(["ceo-seat@mi-test.invalid"]);
    expect(await rows()).toBe(before + 2);
    // The same value again, and another key, write nothing here.
    await db.query("UPDATE public.cockpit_settings SET value = value, updated_by = 'again' WHERE key = 'market_intel'");
    await db.query("INSERT INTO public.cockpit_settings(key, value) VALUES ('forms.mi_test', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    expect(await rows()).toBe(before + 2);
  });
});

describe("what the worker reads", () => {
  test("input: the research subset and the answers tab, never a contact value; nap answers a word", async () => {
    await clearRuns();
    await owner(db);
    await db.query(
      "INSERT INTO public.cockpit_settings(key, value) VALUES ('onboarding.raw_titles', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [json({ fields: [{ ref: R.services, title: "The form's full services title" }] })],
    );
    const run = (await enqueue(TASK, await response(), "shadow")).runId;
    const input = await asService(() => one<Row>("SELECT public.cockpit_market_intel_input($1::uuid) AS r", [run]));
    const text = JSON.stringify(input);
    for (const v of CONTACT_VALUES) expect({ v, found: text.includes(v) }).toEqual({ v, found: false });
    for (const ref of [R.fullName, R.phone, R.email, R.frontDesk, R.personalPhone]) expect(text.includes(ref)).toBe(false);
    expect(input.answers).toEqual({ businessName: "Cedar Invented Interiors", mapsLink: "https://maps.app.goo.gl/inventedCedar1",
      website: "https://cedar-invented.example", instagram: "https://www.instagram.com/cedar.invented",
      services: "Villa interiors, kitchens", serviceFocus: "Villa interiors", serviceAreas: "Hawalli and Salmiya" });
    expect(input.tab.map((t: Row) => t.ref)).toEqual([R.businessName, R.mapsLink, R.website, R.instagram, R.services, R.focus,
      R.areas, R.drive]);
    expect(input.tab.find((t: Row) => t.ref === R.services).title).toBe("The form's full services title");
    expect(input.card).toEqual({ name: "Cedar Invented", country: "QA", phoneCountry: "KW",
      drive: "https://drive.google.com/drive/folders/inventedCedarCard", website: "https://cedar-invented.example",
      marketResearch: null, serviceAdvertised: "Interior design" });
    expect(input).toMatchObject({ runId: run, taskId: TASK, reason: "shadow", mode: "shadow", source: "typeform_sync",
      blueprintCompetitors: "Invented Rival Studio", notCompetitors: [] });
    const nap = (phone: string | null) => asService(() => one<string>("SELECT public.cockpit_market_intel_nap($1::uuid, $2) AS r", [run, phone]));
    expect(await nap("+965 2200 0123")).toBe("match");
    expect(await nap("2200 0123")).toBe("match");
    expect(await nap("+965 2200 9999")).toBe("differs");
    expect(await nap(null)).toBe("not_checked");
    expect(await nap("123")).toBe("not_checked");
  });

  test("preview: the same read for a card's newest live answer, with no run (the dry run's plan)", async () => {
    await clearRuns();
    await response({ at: "2026-10-01T00:00:00Z", answers: { fields: [a(R.businessName, "Older Name Invented")] } });
    await response();
    const out = await asService(() => one<Row>("SELECT public.cockpit_market_intel_preview($1) AS r", [TASK]));
    expect(out).toMatchObject({ preview: true, taskId: TASK, answers: { businessName: "Cedar Invented Interiors" } });
    expect(out.runId).toBeUndefined();
    const text = JSON.stringify(out);
    for (const v of CONTACT_VALUES) expect(text.includes(v)).toBe(false);
    expect((await refusal(() => asService(() => one("SELECT public.cockpit_market_intel_preview('taskNoAnswer9') AS r"))))
      .message).toBe("This client has no onboarding answer to research yet.");
    expect(await one<number>("SELECT count(*)::int AS r FROM public.cockpit_market_intel_runs")).toBe(0);
  });

  test("a native answer (keyed by the form's keys) reads the same way", async () => {
    await clearRuns();
    const native = await response({ task: TASK2, answers: { businessName: "Olive Invented Build", frontDeskPhone: "+966 11 000 0000",
      fullName: "Invented Native Person", email: "native@olive-mi.invalid", serviceAreas: "Riyadh north" } });
    const run = (await enqueue(TASK2, native, "shadow")).runId;
    const input = await asService(() => one<Row>("SELECT public.cockpit_market_intel_input($1::uuid) AS r", [run]));
    expect(input.answers).toEqual({ businessName: "Olive Invented Build", serviceAreas: "Riyadh north" });
    expect(input.card).toMatchObject({ name: null, country: null, phoneCountry: "SA" });
    const text = JSON.stringify(input);
    expect(text).not.toContain("Invented Native Person");
    expect(text).not.toContain("native@olive-mi.invalid");
    expect(text).not.toContain("000 0000");
  });
});

describe("the cockpit", () => {
  async function seededRun() {
    await clearRuns();
    const run = (await enqueue(TASK, await response(), "shadow")).runId;
    await owner(db);
    await db.query("UPDATE public.cockpit_market_intel_runs SET state = 'done', sentence = 'Research finished in shadow.', sources_n = 31, competitors_n = 6, usd_apify = 0.7 WHERE id = $1::uuid", [run]);
    await db.query("INSERT INTO public.cockpit_market_intel_competitors(run_id, cid, name, rating, evidence) VALUES ($1::uuid, 'C1', 'Invented Rival Studio', 4.4, '{E1}')", [run]);
    return run;
  }
  const view = async (who: string | null, task = TASK) => {
    await actor(db, who);
    try {
      return await one<Row>("SELECT public.cockpit_market_intel_view($1) AS r", [task]);
    } finally {
      await owner(db);
    }
  };

  test("view: CEO, admin, a CSM on their own client, creative; never sales or anon; no contact value", async () => {
    await clearRuns();
    expect(await view(CEO)).toEqual({ state: "none", on: false, canRerun: true,
      sentence: "No research yet. Market research is off; it starts once it is turned on." });
    const run = await seededRun();
    const ceo = await view(CEO);
    expect(ceo).toMatchObject({ state: "done", canRerun: true, sentence: "Research finished in shadow.",
      run: { id: run, sourcesN: 31, competitorsN: 6, usd: 0.7 }, budget: { capMonth: 25, capRun: 2 } });
    expect(ceo.competitors).toEqual([expect.objectContaining({ cid: "C1", name: "Invented Rival Studio", rating: 4.4, flagged: false })]);
    expect((await view(ADMIN)).canRerun).toBe(true);
    const csm = await view(CSM);
    expect(csm).toMatchObject({ state: "done", canRerun: false });
    expect(csm.budget).toBeNull();
    expect((await refusal(() => view(CSM, TASK2))).code).toBe("42501");
    expect((await view(CREATIVE)).state).toBe("done");
    await db.query("UPDATE public.cockpit_market_intel_runs SET state = 'pulling', started_at = '2026-11-02T11:05:00Z' WHERE id = $1::uuid", [run]);
    expect((await view(CSM)).sentence).toBe("Researching since 02 Nov 14:05 (Kuwait).");
    await db.query("UPDATE public.cockpit_market_intel_runs SET state = 'needs_person', sentence = 'Research is too thin to write.' WHERE id = $1::uuid", [run]);
    expect((await view(CSM)).sentence).toBe("Research needs a person: Research is too thin to write.");
    // Findings that failed the checks are kept for a person, never shown to readers.
    await db.query("INSERT INTO public.cockpit_market_intel_findings(run_id, lang, findings, checks, schema_version) VALUES ($1::uuid, 'en', '{\"sections\":[{\"key\":\"summary\"}]}', '{\"r7_contact\":{\"ok\":false}}', 'mi.findings.v1')", [run]);
    for (const who of [CEO, CSM, CREATIVE]) expect({ who, findings: (await view(who)).findings }).toEqual({ who, findings: null });
    await db.query("UPDATE public.cockpit_market_intel_runs SET state = 'done', sentence = 'Research finished in shadow.' WHERE id = $1::uuid", [run]);
    expect((await view(CSM)).findings).toEqual({ sections: [{ key: "summary" }] });
    expect((await refusal(() => view(SALES))).message).toContain("open to client success, creative, media buying and the CEO");
    expect((await refusal(() => view(null))).code).toBe("42501");
    const text = JSON.stringify(ceo);
    for (const v of CONTACT_VALUES) expect(text.includes(v)).toBe(false);
  });

  test("rerun: CEO or admin, setting on, a reason, no open run; enqueued with who asked", async () => {
    await seededRun();
    const rerun = async (who: string, reason: string, task = TASK) => {
      await actor(db, who);
      try {
        return await one<Row>("SELECT public.cockpit_market_intel_rerun($1, $2) AS r", [task, reason]);
      } finally {
        await owner(db);
      }
    };
    expect((await refusal(() => rerun(CSM, "The client moved to a new city"))).code).toBe("42501");
    expect((await refusal(() => rerun(CEO, "The client moved to a new city"))).message)
      .toBe("Market research is off. Turn it on first (cockpit_settings market_intel).");
    await setting({ on: true });
    try {
      expect((await refusal(() => rerun(CEO, "too short"))).message).toBe("Give a reason of 10 to 300 characters.");
      expect((await refusal(() => rerun(CEO, "The client moved to a new city", "taskNoAnswer9"))).message)
        .toBe("This client has no onboarding answer to research yet.");
      const out = await rerun(ADMIN, "The client moved to a new city");
      expect(out).toMatchObject({ ok: true, sentence: "Running. About 20 minutes." });
      expect(await runRow(out.runId)).toMatchObject({ reason: "rerun", requested_by: "admin@mi-test.invalid",
        request_note: "The client moved to a new city", state: "queued" });
      expect((await refusal(() => rerun(CEO, "The client moved to a new city"))).message)
        .toBe("Research is already running for this client. Wait for it to finish.");
    } finally {
      await owner(db);
      await setting({ on: false });
    }
  });

  test("flag: CEO or admin marks a competitor wrong, once, with an audit row; the next input leaves it out", async () => {
    const run = await seededRun();
    const flag = async (who: string, cid: string, reason: string) => {
      await actor(db, who);
      try {
        return await one<Row>("SELECT public.cockpit_market_intel_flag_competitor($1::uuid, $2, $3) AS r", [run, cid, reason]);
      } finally {
        await owner(db);
      }
    };
    expect((await refusal(() => flag(CREATIVE, "C1", "A supplier, not a rival"))).code).toBe("42501");
    expect((await refusal(() => flag(CEO, "C9", "A supplier, not a rival"))).message).toBe("That competitor is not in this research run.");
    expect(await flag(CEO, "C1", "A supplier, not a rival")).toEqual({ ok: true, already: false, sentence: "Marked. The next run leaves it out." });
    expect((await flag(ADMIN, "C1", "A supplier, not a rival")).already).toBe(true);
    expect(await audits("market_intel.competitor_flagged")).toBe(1);
    const next = (await enqueue(TASK, await response(), "backfill", "Backfill after the flag")).runId;
    const input = await asService(() => one<Row>("SELECT public.cockpit_market_intel_input($1::uuid) AS r", [next]));
    expect(input.notCompetitors).toEqual([{ name: "Invented Rival Studio", placeUrl: null, website: null }]);
    expect(await one("SELECT flag_reason AS r FROM public.cockpit_market_intel_competitors WHERE run_id = $1::uuid AND cid = 'C1'", [run]))
      .toBe("A supplier, not a rival");
  });
});

describe("prune", () => {
  test("raw bodies go after the days given; ids, URLs and hashes stay", async () => {
    await clearRuns();
    const run = (await enqueue(TASK, await response(), "shadow")).runId;
    await owner(db);
    await db.query(
      "INSERT INTO public.cockpit_market_intel_evidence(run_id, eid, kind, subject, url, retrieved_at, source, body, sha256, created_at) VALUES ($1::uuid, 'E1', 'review', 'client', 'https://maps.example/r', now(), 'reviews', '{\"text\":\"Old\"}', $2, now() - interval '200 days'), ($1::uuid, 'E2', 'review', 'client', 'https://maps.example/r2', now(), 'reviews', '{\"text\":\"New\"}', $2, now())",
      [run, SHA],
    );
    expect(await asService(() => one<Row>("SELECT public.cockpit_market_intel_prune(180) AS r"))).toEqual({ ok: true, pruned: 1, days: 180 });
    const rows = await one<Row[]>("SELECT jsonb_agg(jsonb_build_object('eid', eid, 'body', body, 'url', url) ORDER BY eid) AS r FROM public.cockpit_market_intel_evidence");
    expect(rows).toEqual([{ eid: "E1", body: null, url: "https://maps.example/r" }, { eid: "E2", body: { text: "New" }, url: "https://maps.example/r2" }]);
    expect(await audits("market_intel.pruned")).toBe(1);
  });
});
