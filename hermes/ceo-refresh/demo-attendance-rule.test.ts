import { expect, test } from "bun:test";
import { dailySql } from "./native/adapters/growth.js";
import { treeSql as adsSql } from "./native/adapters/b2bAds.js";

test("demo attendance requires a past time and separates invalid from qualified", async () => {
  const sql = dailySql("2026-11-01", "2026-11-05");
  const held = sql.match(/count\(\*\) filter \(where call_type = 'demo' and \(start_at <= now\(\) and status in \('showed', 'confirmed', 'invalid'\)\)\) as demos_shown/)?.[0];
  const qualified = sql.match(/count\(\*\) filter \(where call_type = 'demo' and \(start_at <= now\(\) and status in \('showed', 'confirmed'\)\)\) as demos_qualified/)?.[0];
  expect(held).toBeDefined();
  expect(qualified).toBeDefined();
  const { PGlite } = await import("../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite");
  const db = new PGlite();
  const result = await db.query(`select ${held}, ${qualified} from (values
    ('demo', 'showed', now() - interval '1 hour'),
    ('demo', 'confirmed', now() - interval '1 hour'),
    ('demo', 'invalid', now() - interval '1 hour'),
    ('demo', 'noshow', now() - interval '1 hour'),
    ('demo', 'showed', now() + interval '1 hour'),
    ('demo', 'confirmed', now() + interval '1 hour'),
    ('intro', 'showed', now() - interval '1 hour')
  ) as calls(call_type, status, start_at)`);
  expect(Number(result.rows[0].demos_shown)).toBe(3);
  expect(Number(result.rows[0].demos_qualified)).toBe(2);
  const ads = adsSql("2026-11-01", "2026-11-01", "2026-11-05");
  expect(ads).toContain("d.start_at <= now() and d.status in ('showed','confirmed','invalid')");
  expect(ads).toContain("c.start_at <= now() and c.status in ('showed','confirmed','invalid')");
  await db.close();
});
