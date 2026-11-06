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
