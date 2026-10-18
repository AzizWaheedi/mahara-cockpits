// Meta for the creative dashboard from meta-ad-days (2026-10-18):
// supabase/migrations/20261018120000_meta_dashboard_feed.sql against PGlite, on
// top of the Meta ad-day store and the creative dashboard's own tables (clients,
// sync_jobs, ads_daily_snapshots, as live on 18 Oct) and its excluded-ads
// trigger. Supabase's default privileges are emulated so a missing REVOKE shows.
// Made-up ad accounts, ads and numbers; no provider is called.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

const FILE = "20261018120000_meta_dashboard_feed.sql";
const CEO = "00000000-0000-4000-8000-0000000000c1";
const A1 = "1111111111111"; // Client One, read on the last hourly run (a days read)
const A2 = "2222222222222"; // Client Two, read on the last hourly run (listed, no spend)
const A3 = "3333333333333"; // spends, no dashboard client yet: added
const A4 = "4444444444444"; // "MaharaMedia": hidden on purpose, never added
const A5 = "5555555555555"; // Gone Client: the business no longer lists it
const A6 = "6666666666666"; // a client with a TikTok account too: the dashboard's sync keeps it
const A7 = "7777777777777"; // an inactive client
const A9 = "9999999999999"; // Mass Design: a client hidden from the dashboard, which the worker does not read
const NOW = "2026-10-18T14:30:00+03:00";
const later = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();

let db: PGlite;

const DASHBOARD = `
CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, meta_ad_account_id text UNIQUE,
  currency text NOT NULL DEFAULT 'USD', is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  meta_business_id text, platform text NOT NULL DEFAULT 'meta', tiktok_advertiser_id text, ghl_location_id text,
  hidden_from_dashboard boolean NOT NULL DEFAULT false);
CREATE TABLE public.sync_jobs(client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE, last_synced_at timestamptz,
  last_sync_status text CHECK (last_sync_status = ANY (ARRAY['success','rate_limited','error','running'])), last_error text,
  next_eligible_sync timestamptz, last_backfill_at timestamptz);
CREATE TABLE public.ads_daily_snapshots(ad_id text NOT NULL, client_id uuid NOT NULL, date date NOT NULL, ad_name text, campaign_id text,
  campaign_name text, campaign_status text, effective_status text, spend numeric NOT NULL DEFAULT 0, impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0, ctr numeric, cpm numeric, leads integer NOT NULL DEFAULT 0, thumbnail_url text,
  last_synced_at timestamptz NOT NULL DEFAULT now(), platform text NOT NULL DEFAULT 'meta', link_clicks integer, smart_plus_ad_id text,
  PRIMARY KEY (ad_id, client_id, date));`;

async function at(iso: string) {
  await owner(db);
  await db.query("SELECT set_config('test.now',$1,false)", [iso]);
}
async function service() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("SET ROLE service_role");
}
async function svc(fn: string, p: unknown = {}): Promise<any> {
  await service();
  const r = await db.query<{ r: any }>(`SELECT public.${fn}($1::jsonb) AS r`, [JSON.stringify(p)]);
  return r.rows[0].r;
}
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(sql, params)).rows;
}
async function refused(fn: () => Promise<unknown>, code: string): Promise<string> {
  let caught: { code?: string; message?: string } | null = null;
  try {
    await fn();
  } catch (e) {
    caught = e as { code?: string; message?: string };
  }
  expect(caught?.code).toBe(code);
  return caught?.message ?? "";
}
async function tick(): Promise<any> {
  return (await q<{ r: any }>("SELECT public.cockpit_meta_feed_tick() AS r"))[0].r;
}
async function adDay(account: string, adId: string, day: string, fetchedAt: string, over: Record<string, unknown> = {}) {
  const row = {
    account_id: account, account_name: `Account ${account.slice(0, 2)}`, account_currency: "USD", account_timezone: "Asia/Kuwait", day,
    campaign_id: "120000000000001", campaign_name: "Leads | Kuwait", objective: "OUTCOME_LEADS", adset_id: "120000000000002", adset_name: "Broad",
    ad_id: adId, ad_name: `Ad ${adId.slice(-3)}`, spend: 10, impressions: 1000, clicks: 30, link_clicks: 12, leads: 2, lead_actions: 2,
    fetched_at: fetchedAt, ...over,
  };
  const cols = Object.keys(row);
  await q(
    `INSERT INTO public.cockpit_meta_ad_days(${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})
     ON CONFLICT (ad_id, day) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(", ")}`,
    Object.values(row),
  );
}
async function adMeta(account: string, adId: string, status: string, thumb: string | null, changedAt: string) {
  await q(
    `INSERT INTO public.cockpit_meta_ads(ad_id, account_id, ad_name, effective_status, campaign_id, campaign_name, campaign_status, thumbnail_url, fetched_at, changed_at)
     VALUES ($1,$2,$3,$4,'120000000000001','Leads | Kuwait','ACTIVE',$5,$6,$6)
     ON CONFLICT (ad_id) DO UPDATE SET effective_status = EXCLUDED.effective_status, thumbnail_url = EXCLUDED.thumbnail_url,
       fetched_at = EXCLUDED.fetched_at, changed_at = EXCLUDED.changed_at`,
    [adId, account, `Ad ${adId.slice(-3)} (Meta)`, status, thumb, changedAt],
  );
}
const client = async (account: string) => (await q<{ id: string }>("SELECT id FROM public.clients WHERE meta_ad_account_id = $1", [`act_${account}`]))[0]?.id;
const snap = (adId: string) => q("SELECT * FROM public.ads_daily_snapshots WHERE ad_id = $1 ORDER BY date", [adId]);
const job = async (account: string) => (await q("SELECT * FROM public.sync_jobs WHERE client_id = $1", [await client(account)]))[0];
const feedState = async () => (await q("SELECT * FROM public.cockpit_sync_state WHERE key = 'meta-dashboard-feed'"))[0];

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(migration("20260921e_tap_charges.sql"));
  await db.exec("REVOKE ALL ON public.cockpit_sync_state, public.cockpit_tap_charges FROM anon, authenticated;");
  await member(db, CEO, "aziz@maharamedia.com", []);
  await owner(db);
  await db.exec(DASHBOARD);
  await db.exec(migration("20261010a_exclude_unauthorized_ads.sql"));
  await db.exec(migration("20261016121700_meta_ad_days.sql"));
  await db.exec(migration("20261016210100_meta_ad_days_checked.sql"));
  await db.exec(migration("20261017100000_meta_budgets.sql"));
  await db.exec(migration(FILE));
  // Twice: the file is safe to apply again.
  await db.exec(migration(FILE));
  await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS
    $$ SELECT current_setting('test.now')::timestamptz $$;
    REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_now() FROM PUBLIC, anon, authenticated, service_role;`);
  await at(NOW);
});

afterAll(async () => {
  await db?.close();
});

describe("tables and privileges", () => {
  test("the ads and the feed's runs have row security; the service role reads them and writes nothing directly", async () => {
    for (const t of ["cockpit_meta_ads", "cockpit_meta_feed_runs"]) {
      const [r] = await q<{ rls: boolean }>("SELECT relrowsecurity rls FROM pg_class WHERE oid = $1::regclass", [`public.${t}`]);
      expect(r.rls).toBe(true);
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const [x] = await q<{ ok: boolean }>("SELECT has_table_privilege($1, $2, $3) ok", [role, `public.${t}`, priv]);
          expect({ t, role, priv, ok: x.ok }).toEqual({ t, role, priv, ok: role === "service_role" && priv === "SELECT" });
        }
      }
    }
  });

  test("the applies and the feed run for the service role only; the feed's core and pg_cron's tick for nobody", async () => {
    const rows = await q<{ f: string; role: string; ok: boolean }>(
      `SELECT f, role, has_function_privilege(role, 'public.' || f, 'EXECUTE') ok
       FROM unnest(ARRAY['cockpit_meta_ad_days_apply(jsonb)','cockpit_meta_ads_apply(jsonb)','cockpit_meta_feed_snapshots(jsonb)',
                         'cockpit_meta_feed_run(jsonb)','cockpit_meta_feed_tick()']) f
       CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) role`,
    );
    for (const r of rows) {
      const service = ["cockpit_meta_ad_days_apply(jsonb)", "cockpit_meta_ads_apply(jsonb)", "cockpit_meta_feed_snapshots(jsonb)"].includes(r.f);
      expect(r).toEqual({ ...r, ok: service && r.role === "service_role" });
    }
  });
});

describe("a days task: all clicks and its account's ads", () => {
  let task: any;

  test("begin and claim a days task", async () => {
    await svc("cockpit_meta_ad_days_begin", {
      job: "hourly",
      requestedBy: "cron",
      graphVersion: "v25.0",
      window: { since: "2026-10-16", until: "2026-10-19" },
      accounts: [{ accountId: A1, name: "Account 11", currency: "USD", timezone: "Asia/Kuwait", status: 1, spend: 100, edge: "client" }],
      tasks: [{ kind: "days", accountId: A1, since: "2026-10-17", until: "2026-10-18" }],
      reach: null,
    });
    [task] = await svc("cockpit_meta_ad_days_claim", { limit: 5, leaseSeconds: 300 });
    expect(task.kind).toBe("days");
  });

  test("the ads land lease-checked; a value Meta did not give keeps the stored one; changed_at moves only on a change", async () => {
    const ad = (id: string, over: Record<string, unknown> = {}) => ({
      ad_id: id, ad_name: `Ad ${id.slice(-3)}`, effective_status: "ACTIVE", campaign_id: "120000000000001", campaign_name: "Leads | Kuwait",
      campaign_status: "ACTIVE", thumbnail_url: `https://scontent.xx.fbcdn.net/${id}.jpg`, ...over,
    });
    await refused(() => svc("cockpit_meta_ads_apply", { taskId: task.id, leaseToken: "00000000-0000-4000-8000-000000000000", fetchedAt: NOW, rows: [] }), "55000");
    await refused(() => svc("cockpit_meta_ads_apply", { taskId: task.id, leaseToken: task.leaseToken, fetchedAt: NOW, rows: [ad("120000000000901", { thumbnail_url: "http://x/a.jpg" })] }), "22023");
    await refused(() => svc("cockpit_meta_ads_apply", { taskId: task.id, leaseToken: task.leaseToken, fetchedAt: NOW, rows: [ad("120000000000901"), ad("120000000000901")] }), "22023");
    const first = await svc("cockpit_meta_ads_apply", {
      taskId: task.id, leaseToken: task.leaseToken, fetchedAt: NOW, complete: false, rows: [ad("120000000000901"), ad("120000000000902", { effective_status: "PAUSED" })],
    });
    expect(first).toEqual({ ok: true, written: 2, changed: 2, deleted: 0 });
    await at(later(10));
    const again = await svc("cockpit_meta_ads_apply", {
      taskId: task.id, leaseToken: task.leaseToken, fetchedAt: later(10), complete: false,
      rows: [ad("120000000000901", { thumbnail_url: null }), ad("120000000000902", { effective_status: "ACTIVE" })],
    });
    expect(again).toEqual({ ok: true, written: 2, changed: 1, deleted: 0 });
    const rows = await q("SELECT ad_id, effective_status, thumbnail_url, fetched_at, changed_at FROM public.cockpit_meta_ads ORDER BY ad_id");
    expect(rows.map(r => [r.ad_id, r.effective_status, r.thumbnail_url])).toEqual([
      ["120000000000901", "ACTIVE", "https://scontent.xx.fbcdn.net/120000000000901.jpg"],
      ["120000000000902", "ACTIVE", "https://scontent.xx.fbcdn.net/120000000000902.jpg"],
    ]);
    expect(new Date(rows[0].changed_at).toISOString()).toBe(new Date(NOW).toISOString());
    expect(new Date(rows[0].fetched_at).toISOString()).toBe(later(10));
    expect(new Date(rows[1].changed_at).toISOString()).toBe(later(10));
  });

  test("a complete read marks the account's ads of the last 40 days that it no longer returns as DELETED", async () => {
    await adDay(A1, "120000000000903", "2026-10-10", NOW);
    await adDay(A1, "120000000000904", "2026-08-20", NOW); // older than 40 days: left alone
    const r = await svc("cockpit_meta_ads_apply", {
      taskId: task.id, leaseToken: task.leaseToken, fetchedAt: later(10), complete: true,
      rows: [{ ad_id: "120000000000901" }, { ad_id: "120000000000902" }],
    });
    expect(r.deleted).toBe(1);
    const rows = await q("SELECT ad_id, effective_status FROM public.cockpit_meta_ads ORDER BY ad_id");
    expect(rows).toEqual([
      { ad_id: "120000000000901", effective_status: "ACTIVE" },
      { ad_id: "120000000000902", effective_status: "ACTIVE" },
      { ad_id: "120000000000903", effective_status: "DELETED" },
    ]);
  });

  test("the days apply stores all clicks beside link clicks, and refuses a negative count", async () => {
    const row = (adId: string, day: string, over: Record<string, unknown> = {}) => ({
      account_id: A1, day, campaign_id: "120000000000001", campaign_name: "Leads | Kuwait", objective: "OUTCOME_LEADS", adset_id: "120000000000002",
      adset_name: "Broad", ad_id: adId, ad_name: `Ad ${adId.slice(-3)}`, spend: 10.5, impressions: 1000, reach: 800, frequency: 1.25, clicks: 41,
      link_clicks: 12, leads: 2, lead_actions: 2, ...over,
    });
    await refused(() => svc("cockpit_meta_ad_days_apply", { taskId: task.id, leaseToken: task.leaseToken, fetchedAt: later(10), rows: [row("120000000000901", "2026-10-17", { clicks: -1 })], final: false }), "22023");
    await svc("cockpit_meta_ad_days_apply", { taskId: task.id, leaseToken: task.leaseToken, fetchedAt: later(10), rows: [row("120000000000901", "2026-10-17")], final: true });
    const [d] = await q("SELECT clicks, link_clicks FROM public.cockpit_meta_ad_days WHERE ad_id = '120000000000901' AND day = '2026-10-17'");
    expect([Number(d.clicks), Number(d.link_clicks)]).toEqual([41, 12]);
    await q("UPDATE public.cockpit_meta_ad_day_runs SET state = 'ok', finished_at = $1 WHERE state = 'running'", [later(10)]);
  });
});

describe("the feed into ads_daily_snapshots", () => {
  beforeAll(async () => {
    await at(NOW);
    await q("DELETE FROM public.cockpit_meta_ad_days");
    await q("DELETE FROM public.cockpit_meta_ads");
    await q("DELETE FROM public.cockpit_meta_ad_day_runs");
    await q("DELETE FROM public.cockpit_meta_spend_reads");
    await q("DELETE FROM public.cockpit_meta_account_state");
    await q(`INSERT INTO public.clients(name, meta_ad_account_id, is_active, tiktok_advertiser_id) VALUES
      ('Client One', 'act_${A1}', true, NULL), ('Client Two', 'act_${A2}', true, NULL), ('Gone Client', 'act_${A5}', true, NULL),
      ('Both Platforms', 'act_${A6}', true, '7000000000000000001'), ('Paused Client', 'act_${A7}', false, NULL)`);
    await q(`INSERT INTO public.clients(name, meta_ad_account_id, is_active, hidden_from_dashboard) VALUES ('Mass Design', 'act_${A9}', true, true)`);
    const fetched = later(-10);
    await adDay(A1, "120000000000100", "2026-10-17", fetched);
    await adDay(A1, "120000000000100", "2026-10-18", fetched, { spend: 7.5, impressions: 500, clicks: 20, link_clicks: 5, leads: 1, lead_actions: 1 });
    await adDay(A1, "120000000000101", "2026-10-18", fetched); // excluded
    await adDay(A2, "120000000000200", "2026-10-18", fetched, { clicks: null, spend: 20, impressions: 2000, link_clicks: 40, leads: null, objective: "OUTCOME_ENGAGEMENT" });
    await adDay(A3, "120000000000300", "2026-10-18", fetched, { account_name: "New Client", spend: 5 });
    await adDay(A4, "120000000000400", "2026-10-18", fetched, { account_name: "MaharaMedia", spend: 5 });
    await adDay(A7, "120000000000700", "2026-10-18", fetched);
    await adMeta(A1, "120000000000100", "ACTIVE", "https://scontent.xx.fbcdn.net/100.jpg", fetched);
    await adMeta(A2, "120000000000200", "PAUSED", null, fetched);
    await q("INSERT INTO public.cockpit_excluded_ads(ad_id, account_id, reason) VALUES ('120000000000101', $1, 'test')", [`act_${A1}`]);
    // The dashboard's own row for ad 200 from before 2 Oct's stop: its all-clicks and thumbnail stay.
    await q(
      `INSERT INTO public.ads_daily_snapshots(ad_id, client_id, date, ad_name, effective_status, spend, impressions, clicks, leads, thumbnail_url, last_synced_at, platform, link_clicks)
       VALUES ('120000000000200', $1, '2026-10-18', 'Ad 200', 'ACTIVE', 3, 300, 55, 0, 'https://scontent.xx.fbcdn.net/old-200.jpg', '2026-10-02T15:32:00Z', 'meta', 6)`,
      [await client(A2)],
    );
    // The worker's last hourly run, and what it read.
    await q(`INSERT INTO public.cockpit_meta_ad_day_runs(job, state, requested_by, started_at, finished_at) VALUES ('hourly','ok','cron',$1,$2)`, [later(-23), later(-16)]);
    await q(`INSERT INTO public.cockpit_meta_spend_reads(account_id, source, since, until, read_at) VALUES ($1,'days','2026-10-17','2026-10-18',$2), ($3,'discovery','2026-10-16','2026-10-19',$4)`, [A1, later(-20), A2, later(-23)]);
  });

  test("a dry run says what it would do and keeps nothing", async () => {
    const r = await svc("cockpit_meta_feed_snapshots", { dryRun: true, requestedBy: "test" });
    expect(r).toMatchObject({ ok: true, dryRun: true, mode: "tick", read: 7, unmapped: 2, inserted: 3, updated: 1, clientsCurrent: 3 });
    expect(r.clientsAdded).toEqual([{ name: "New Client", account: `act_${A3}` }]);
    expect(r.clientsUnread).toEqual([{ name: "Gone Client", account: A5 }, { name: "Mass Design", account: A9 }]);
    expect(await snap("120000000000100")).toEqual([]);
    expect(await client(A3)).toBeUndefined();
    expect(await q("SELECT * FROM public.sync_jobs")).toEqual([]);
    expect(await feedState()).toBeUndefined();
    const runs = await q("SELECT mode, dry_run, ok, requested_by FROM public.cockpit_meta_feed_runs");
    expect(runs).toEqual([{ mode: "tick", dry_run: true, ok: true, requested_by: "test" }]);
  });

  test("a tick writes the dashboard rows, adds a new spending account, and says which Meta clients were read", async () => {
    const r = await tick();
    expect(r).toMatchObject({ ok: true, read: 7, unmapped: 2, inserted: 3, updated: 1 });
    const one = await snap("120000000000100");
    expect(one.map(s => [s.date instanceof Date ? s.date.toISOString().slice(0, 10) : s.date, Number(s.spend), s.impressions, s.clicks, s.link_clicks,
      Number(s.ctr), Number(s.cpm), s.leads, s.effective_status, s.campaign_status, s.thumbnail_url, s.platform])).toEqual([
      ["2026-10-17", 10, 1000, 30, 12, 3, 10, 2, "ACTIVE", "ACTIVE", "https://scontent.xx.fbcdn.net/100.jpg", "meta"],
      ["2026-10-18", 7.5, 500, 20, 5, 4, 15, 1, "ACTIVE", "ACTIVE", "https://scontent.xx.fbcdn.net/100.jpg", "meta"],
    ]);
    expect(new Date(one[0].last_synced_at).toISOString()).toBe(later(-10));
    // The excluded ad stays out.
    expect(await snap("120000000000101")).toEqual([]);
    // The stored row keeps what the worker does not hold: all clicks and the thumbnail; the rest is the worker's.
    const [two] = await snap("120000000000200");
    expect([Number(two.spend), two.impressions, two.clicks, two.link_clicks, two.leads, two.effective_status, two.thumbnail_url, Number(two.ctr)]).toEqual([
      20, 2000, 55, 40, 0, "PAUSED", "https://scontent.xx.fbcdn.net/old-200.jpg", 2.75,
    ]);
    // A new spending account becomes a client; MaharaMedia (hidden) and the inactive client stay out.
    const added = await q("SELECT name, currency, is_active, platform FROM public.clients WHERE meta_ad_account_id = $1", [`act_${A3}`]);
    expect(added).toEqual([{ name: "New Client", currency: "USD", is_active: true, platform: "meta" }]);
    expect((await snap("120000000000300")).length).toBe(1);
    expect(await client(A4)).toBeUndefined();
    expect(await snap("120000000000700")).toEqual([]);
    // sync_jobs: read on the last hourly run, or not; the TikTok client and the inactive one are left alone.
    for (const a of [A1, A2, A3]) {
      const j = await job(a);
      expect([j.last_sync_status, j.last_error, new Date(j.last_synced_at).toISOString()]).toEqual(["success", null, later(-16)]);
    }
    const gone = await job(A5);
    expect([gone.last_sync_status, gone.last_synced_at]).toEqual(["error", null]);
    expect(gone.last_error).toBe(`meta: Mahara's business does not list act_${A5} to meta-ad-days, so no numbers come in for it. Share the ad account with the business, or set the client inactive.`);
    expect(gone.last_error).not.toMatch(/API access blocked|OAuthException/);
    expect((await job(A9)).last_error).toBe(`meta: act_${A9} is hidden on purpose (Mahara's own account, a client hidden from the dashboard, or kept out on the board), so meta-ad-days does not read it.`);
    expect(await job(A6)).toBeUndefined();
    expect(await job(A7)).toBeUndefined();
    // The freshness signal.
    const s = await feedState();
    expect([s.ok, new Date(s.last_ok_at).toISOString(), s.detail.failingSinceOk, s.detail.clientsCurrent, s.detail.clientsUnread]).toEqual([true, later(0), 0, 3, 2]);
    expect(new Date(s.detail.through).toISOString()).toBe(later(-10));
  });

  test("the next tick changes only what changed: a new read, an ad's new status or thumbnail", async () => {
    await at(later(10));
    expect(await tick()).toMatchObject({ ok: true, read: 7, inserted: 0, updated: 0 });
    await adDay(A1, "120000000000100", "2026-10-18", later(5), { spend: 9, impressions: 600, clicks: 24, link_clicks: 6, leads: 1, lead_actions: 1 });
    await adMeta(A2, "120000000000200", "ACTIVE", "https://scontent.xx.fbcdn.net/new-200.jpg", later(8));
    const r = await tick();
    expect(r).toMatchObject({ ok: true, inserted: 0, updated: 2 });
    const [, today] = await snap("120000000000100");
    expect([Number(today.spend), today.clicks, new Date(today.last_synced_at).toISOString()]).toEqual([9, 24, later(5)]);
    const [two] = await snap("120000000000200");
    expect([two.effective_status, two.thumbnail_url, two.clicks]).toEqual(["ACTIVE", "https://scontent.xx.fbcdn.net/new-200.jpg", 55]);
    expect(new Date((await feedState()).detail.through).toISOString()).toBe(later(8));
  });

  test("with no hourly run finished in 3 hours, no Meta client is called current", async () => {
    await at(later(240));
    const r = await tick();
    expect(r).toMatchObject({ ok: true, clientsCurrent: 0 });
    const j = await job(A1);
    expect(j.last_sync_status).toBe("error");
    expect(j.last_error).toBe("meta: the meta-ad-days worker has not finished an hourly run since 18 Oct 14:14 Kuwait time. Read its last runs (cockpit_meta_ad_day_runs) or run its doctor.");
    // The last good read stays its last good read.
    expect(new Date(j.last_synced_at).toISOString()).toBe(later(-16));
    expect((await feedState()).note).toContain("The worker has not finished an hourly run in 3 hours.");
  });

  test("a window for one account rewrites those days only, and moves neither the watermark nor sync_jobs", async () => {
    const before = await feedState();
    const jobBefore = await job(A2);
    await q("UPDATE public.ads_daily_snapshots SET spend = 1 WHERE ad_id = '120000000000100'");
    const r = await svc("cockpit_meta_feed_snapshots", { since: "2026-10-17", until: "2026-10-17", accounts: [`act_${A1}`] });
    expect(r).toMatchObject({ ok: true, mode: "window", read: 1, updated: 1, through: null });
    expect((await snap("120000000000100")).map(s => Number(s.spend))).toEqual([10, 1]);
    expect((await feedState()).detail).toEqual(before.detail);
    expect(await job(A2)).toEqual(jobBefore);
    await refused(() => svc("cockpit_meta_feed_snapshots", { since: "2026-10-17" }), "22023");
    await refused(() => svc("cockpit_meta_feed_snapshots", { since: "2026-01-01", until: "2026-10-17" }), "22023");
    await refused(() => svc("cockpit_meta_feed_snapshots", { accounts: "act_1" }), "22023");
  });

  test("a failed tick writes nothing, keeps the watermark and the last good time, and counts the failure", async () => {
    await at(later(250));
    const before = await feedState();
    await owner(db);
    await db.exec(`CREATE FUNCTION public.test_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the snapshot table refused the row'; END $$;
      CREATE TRIGGER test_refuse BEFORE INSERT ON public.ads_daily_snapshots FOR EACH ROW EXECUTE FUNCTION public.test_refuse();`);
    await adDay("8888888888888", "120000000000800", "2026-10-18", later(249), { account_name: "Another New Client" });
    const r = await tick();
    expect(r).toMatchObject({ ok: false, inserted: 0, updated: 0, clientsAdded: [] });
    expect(r.note).toBe("The feed failed and wrote nothing: the snapshot table refused the row");
    expect(await client("8888888888888")).toBeUndefined();
    const s = await feedState();
    expect([s.ok, s.last_ok_at, s.detail.through, s.detail.failingSinceOk]).toEqual([false, before.last_ok_at, before.detail.through, 1]);
    const [run] = await q("SELECT ok, through, detail FROM public.cockpit_meta_feed_runs ORDER BY id DESC LIMIT 1");
    expect([run.ok, run.through, run.detail.error]).toEqual([false, null, "the snapshot table refused the row"]);
    await owner(db);
    await db.exec("DROP TRIGGER test_refuse ON public.ads_daily_snapshots; DROP FUNCTION public.test_refuse();");
    expect(await tick()).toMatchObject({ ok: true, inserted: 1 });
    expect((await feedState()).detail.failingSinceOk).toBe(0);
  });
});
