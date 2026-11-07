import { expect, test } from "bun:test";
import { treeSql } from "./native/adapters/b2bAds.js";

test("the Ads attendance rule counts only a past showed, confirmed or disqualified demo", async () => {
  const sql = treeSql("2026-11-01", "2026-11-01", "2026-11-05");
  const rule = sql.match(/d\.start_at <= now\(\) and d\.status in \('showed','confirmed','invalid'\)/)?.[0];
  expect(rule).toBeDefined();
  const { PGlite } = await import("../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite");
  const db = new PGlite();
  const result = await db.query(`select count(*) filter (where ${rule}) as held from (values
    ('showed', now() - interval '1 hour'),
    ('confirmed', now() - interval '1 hour'),
    ('invalid', now() - interval '1 hour'),
    ('noshow', now() - interval '1 hour'),
    ('cancelled', now() - interval '1 hour'),
    ('showed', now() + interval '1 hour'),
    ('confirmed', now() + interval '1 hour')
  ) as d(status, start_at)`);
  expect(Number(result.rows[0].held)).toBe(3);
  await db.close();
});

test("guarded B2B change fixes future showed while preserving disqualification", async () => {
  const { PGlite } = await import("../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`create table public.calls(call_type text, status text, start_at timestamptz);
    insert into public.calls values
      ('demo','showed',now()-interval '1 hour'),
      ('demo','confirmed',now()-interval '1 hour'),
      ('demo','invalid',now()-interval '1 hour'),
      ('demo','showed',now()+interval '1 hour'),
      ('demo','noshow',now()-interval '1 hour');
    create function public.b2b_window_metrics(p_from date,p_to date,p_campaigns text[])
    returns json language sql stable as $body$
      select json_build_object(
        'held', count(*) filter (where call_type='demo'  and (status='showed' or (status in ('confirmed','invalid') and start_at <= now()))),
        'qualified', count(*) filter (where call_type='demo'  and (status='showed' or (status='confirmed' and start_at <= now())))
      ) from public.calls
    $body$;`);
  const query = `select public.b2b_window_metrics('2026-11-01','2026-11-30',null) as m`;
  expect((await db.query(query)).rows[0].m).toEqual({ held: 4, qualified: 3 });
  const patch = await Bun.file(new URL("../../tools/b2b-reporting/demo-attendance-rule.sql", import.meta.url)).text();
  await db.exec(patch);
  expect((await db.query(query)).rows[0].m).toEqual({ held: 3, qualified: 2 });
  await db.exec(patch);
  expect((await db.query(query)).rows[0].m).toEqual({ held: 3, qualified: 2 });
  await db.close();
});

test("guarded B2B change refuses an unrecognized function", async () => {
  const { PGlite } = await import("../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`create function public.b2b_window_metrics(p_from date,p_to date,p_campaigns text[])
    returns json language sql stable as $body$ select '{}'::json $body$;`);
  const patch = await Bun.file(new URL("../../tools/b2b-reporting/demo-attendance-rule.sql", import.meta.url)).text();
  await expect(db.exec(patch)).rejects.toThrow("B2B demo rules changed");
  await db.close();
});
