/**
 * Exception alerts (migration 20261026150000_exception_alerts.sql, plan item 4.1) on an
 * isolated PostgreSQL.
 *
 * The file is applied twice over the live monitor wrapper (20261009n, whose body is the
 * one the file's guard names). Checks: who may read the state (the CEO, a media buyer on
 * the client, not a CSM-only seat, not anon), that the ledger is service role only, that a
 * second claim of the same rule, client, episode and person inserts nothing, and that the
 * reliability monitor's RPC lists worker:exception-alerts only once the worker has
 * reported, turns it red on a failed send in the last 24 hours, and ignores the lead sync
 * watch's mirrored rows. Every person and client is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const FILE = "20261026150000_exception_alerts.sql";
const CEO = "00000000-0000-4000-8000-0000000000e0";
const BUYER = "00000000-0000-4000-8000-0000000000e1";
const LIMITED = "00000000-0000-4000-8000-0000000000e2";
const CSM = "00000000-0000-4000-8000-0000000000e3";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Missing in ${file}: ${pattern}`);
  return hit[0];
}

let db: PGlite;

async function monitorCheck() {
  await owner(db);
  const r = await db.query<{ c: Record<string, unknown> | null }>(
    "SELECT (SELECT c FROM jsonb_array_elements(public.cockpit_native_monitor()->'checks') c WHERE c->>'key'='worker:exception-alerts') AS c",
  );
  return r.rows[0].c;
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(
    extract(
      "20260926m_cockpit_csm_state.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(
    "REVOKE ALL ON FUNCTION public.cockpit_client_allowed(text) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;",
  );
  await db.exec(`
    CREATE TABLE public.cockpit_sync_state (key text PRIMARY KEY, last_run_at timestamptz, last_ok_at timestamptz, ok boolean,
      note text, rows_seen integer, updated_at timestamptz, detail jsonb);
    -- The base snapshot is out of scope here: one fixed check stands in for it.
    CREATE FUNCTION public.cockpit_native_monitor_base() RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT jsonb_build_object('version',1,'checked_at',now(),'checks',jsonb_build_array(jsonb_build_object('key','worker:ceo-refresh','ok',true))) $$;`);
  await db.exec(
    extract(
      "20261009n_native_monitor_speed.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_native_monitor\(\)[\s\S]*?END \$function\$;/,
    ),
  );
  // The CEO gate is an email allow-list (20260923m); its first address stands in.
  await member(db, CEO, "aziz@maharamedia.com", ["ceo"]);
  await member(db, BUYER, "buyer@example.test", ["media_buyer"]);
  await member(db, LIMITED, "limited@example.test", ["media_buyer"]);
  await member(db, CSM, "csm@example.test", ["csm"]);
  await db.query(
    "UPDATE public.cockpit_members SET clients=ARRAY['Other Client'] WHERE email='limited@example.test'",
  );
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
  await db.exec(`
    INSERT INTO public.cockpit_exception_state(rule,client_key,client_name,state,reason)
    VALUES ('zero_leads','locA','Client A','open','$40.00 spent with no lead'),('cpb_over_line','locB','Other Client','too_little_data','2 bookings');`);
});

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("the guard names the live wrapper body and this file's own", async () => {
    await owner(db);
    const r = await db.query<{ h: string }>(
      "SELECT md5(prosrc) h FROM pg_proc WHERE oid='public.cockpit_native_monitor()'::regprocedure",
    );
    expect(migration(FILE)).toContain(r.rows[0].h);
    expect(migration("20261009n_native_monitor_speed.sql")).toBeTruthy();
  });

  test("the wrapper keeps service role only", async () => {
    await owner(db);
    const r = await db.query<{ a: boolean; s: boolean; anon: boolean }>(
      `SELECT has_function_privilege('authenticated','public.cockpit_native_monitor()','EXECUTE') a,
              has_function_privilege('service_role','public.cockpit_native_monitor()','EXECUTE') s,
              has_function_privilege('anon','public.cockpit_native_monitor()','EXECUTE') anon`,
    );
    expect(r.rows[0]).toEqual({ a: false, s: true, anon: false });
  });
});

describe("who reads the state", () => {
  const summary = async (id: string | null) => {
    await actor(db, id);
    try {
      return (
        await db.query<{ s: Record<string, unknown> | null }>(
          "SELECT public.cockpit_exception_summary() s",
        )
      ).rows[0].s;
    } catch {
      return "denied";
    } finally {
      await owner(db);
    }
  };
  const seen = async (id: string | null) => {
    await actor(db, id);
    try {
      return (
        await db.query<{ client_name: string }>(
          "SELECT client_name FROM public.cockpit_exception_state ORDER BY 1",
        )
      ).rows.map(r => r.client_name);
    } catch {
      return "denied";
    } finally {
      await owner(db);
    }
  };
  test("the CEO and a media buyer with every client see both rows", async () => {
    expect(await seen(CEO)).toEqual(["Client A", "Other Client"]);
    expect(await seen(BUYER)).toEqual(["Client A", "Other Client"]);
  });
  test("a media buyer limited to one client sees that client only", async () => {
    expect(await seen(LIMITED)).toEqual(["Other Client"]);
  });
  test("a CSM-only seat and anon see nothing", async () => {
    expect(await seen(CSM)).toEqual([]);
    expect(await seen(null)).toBe("denied");
  });
  test("the Today footer: nothing before the first report, refused for a CSM-only seat and anon", async () => {
    expect(await summary(CEO)).toBeNull();
    expect(await summary(LIMITED)).toBeNull();
    expect(await summary(CSM)).toBe("denied");
    expect(await summary(null)).toBe("denied");
  });
  test("the Today footer ignores another worker's health row", async () => {
    await db.exec(
      `INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,detail) VALUES ('exception-footer-probe',now(),now(),true,'x','{}')`,
    );
    expect(await summary(BUYER)).toBeNull();
    await db.exec(
      `DELETE FROM public.cockpit_sync_state WHERE key='exception-footer-probe'`,
    );
  });
  test("the ledger is service role only", async () => {
    await actor(db, CEO);
    let denied = false;
    try {
      await db.query("SELECT * FROM public.cockpit_exception_alerts");
    } catch {
      denied = true;
    }
    await owner(db);
    expect(denied).toBe(true);
  });
});

describe("one row per rule, client, episode and person", () => {
  test("a second claim inserts nothing", async () => {
    await owner(db);
    const claim = () =>
      db.query(
        `INSERT INTO public.cockpit_exception_alerts(rule,client_key,client_name,episode_id,recipient,kind,status,alert_day,body)
         VALUES ('zero_leads','locA','Client A','zero_leads:locA:2026-10-26T09:00:00.000Z','person:buyer@example.test','alert','dry','2026-10-26','x')
         ON CONFLICT (rule,client_key,episode_id,recipient,kind) DO NOTHING RETURNING id`,
      );
    expect((await claim()).rows.length).toBe(1);
    expect((await claim()).rows.length).toBe(0);
    const n = await db.query<{ n: number }>(
      "SELECT count(*)::int n FROM public.cockpit_exception_alerts WHERE client_key='locA'",
    );
    expect(n.rows[0].n).toBe(1);
  });
});

describe("the monitor check", () => {
  test("absent until the worker has reported once; the base checks pass through", async () => {
    expect(await monitorCheck()).toBeNull();
    await owner(db);
    const r = await db.query<{ n: number }>(
      "SELECT jsonb_array_length(public.cockpit_native_monitor()->'checks')::int n",
    );
    expect(r.rows[0].n).toBe(1);
  });

  test("green on a good run, red on a failed send, mirrors ignored", async () => {
    await owner(db);
    await db.exec(
      `INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note) VALUES ('exception-alerts',now(),now(),true,'19 clients')`,
    );
    expect(await monitorCheck()).toMatchObject({
      ok: true,
      failed: 0,
      max_age_min: 150,
    });
    await owner(db);
    await db.exec(`INSERT INTO public.cockpit_exception_alerts(rule,client_key,client_name,episode_id,recipient,kind,status,alert_day,body)
      VALUES ('lead_sync','locC','Client C','lead_sync:locC:e1','channel:C0AS2JLMJCB','mirror','failed','2026-10-26','x')`);
    expect(await monitorCheck()).toMatchObject({ ok: true, failed: 0 });
    await owner(db);
    await db.exec(`INSERT INTO public.cockpit_exception_alerts(rule,client_key,client_name,episode_id,recipient,kind,status,alert_day,body,error)
      VALUES ('cpb_over_line','locB','Other Client','cpb:locB:e1','person:buyer@example.test','alert','failed','2026-10-26','x','SLACK_BOT_TOKEN is missing')`);
    const c = await monitorCheck();
    expect(c).toMatchObject({ ok: false, failed: 1 });
    expect(String(c?.error)).toContain("1 alert sends failed or unknown");
  });

  test("a failure older than 24 hours no longer holds it red", async () => {
    await owner(db);
    await db.exec(
      `UPDATE public.cockpit_exception_alerts SET created_at=now()-interval '25 hours' WHERE status='failed'`,
    );
    expect(await monitorCheck()).toMatchObject({ ok: true, failed: 0 });
  });

  test("a failed run is red with its note", async () => {
    await owner(db);
    await db.exec(
      `UPDATE public.cockpit_sync_state SET ok=false, note='Run failed: timeout' WHERE key='exception-alerts'`,
    );
    expect(await monitorCheck()).toMatchObject({
      ok: false,
      error: "Run failed: timeout",
    });
  });
});

describe("the Today footer", () => {
  test("reads the health row: when, whether clean, and dry run unless the worker says live", async () => {
    await actor(db, BUYER);
    const s = (
      await db.query<{ s: Record<string, unknown> }>(
        "SELECT public.cockpit_exception_summary() s",
      )
    ).rows[0].s;
    await owner(db);
    expect(s).toMatchObject({ ok: false, delivery: "dry" });
    expect(typeof s.checkedAt).toBe("string");
    await db.exec(
      `UPDATE public.cockpit_sync_state SET detail='{"delivery":"live"}' WHERE key='exception-alerts'`,
    );
    await actor(db, CEO);
    const live = (
      await db.query<{ s: Record<string, unknown> }>(
        "SELECT public.cockpit_exception_summary() s",
      )
    ).rows[0].s;
    await owner(db);
    expect(live.delivery).toBe("live");
  });
});
