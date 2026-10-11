// R2 on the "Refresh now" path: client media reads the native media feed.
// Made-up clients, campaigns and amounts only.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "../../../../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite/dist/index.js";
import { clientMediaNote, clientMediaSql, combineClientMedia, mediaFeedCheck, olderClientMediaSql } from "./expenses.ts";

let db: PGlite;
const rows = async (q: string) => (await db.query<Record<string, unknown>>(q)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.clients(id uuid primary key, name text, meta_ad_account_id text, currency text);
    create table public.cockpit_campaigns(id bigserial primary key, meta_account_id text, raw_data jsonb, synced_at timestamptz, source_deleted boolean default false);
    create table public.cockpit_media_daily_stats(source_id text primary key, campaign_name text, day date, data jsonb);
    create table public.cockpit_media_feed_state(feed text primary key, ready boolean, source_rows bigint, source_snapshot_at timestamptz);
    create table public.ads_daily_snapshots(client_id uuid, date date, spend numeric, campaign_id text);
    insert into public.clients values
      ('00000000-0000-4000-8000-000000000001','Alpha Build','act_111','USD'),
      ('00000000-0000-4000-8000-000000000002','Beta Riyadh','act_222','SAR'),
      ('00000000-0000-4000-8000-000000000003','Mahara Media','act_999','USD');
    insert into public.cockpit_campaigns(meta_account_id,raw_data,synced_at,source_deleted) values
      ('111','{"campaignName":"Alpha leads"}','2026-10-10',false),
      ('000','{"campaignName":"Alpha leads"}','2026-09-01',false),   -- an older tie for the same name: the newest wins
      ('222','{"campaignName":"Beta leads"}','2026-10-01',true),     -- deleted at the source, kept for the tie
      ('999','{"campaignName":"Mahara own"}','2026-10-10',false);
    insert into public.cockpit_media_daily_stats values
      ('a1','Alpha leads','2026-10-01','{"spend":100.5,"leads":4}'),
      ('a2','Alpha leads','2026-10-02','{"spend":50,"leads":1}'),
      ('b1','Beta leads','2026-10-01','{"spend":221.66,"leads":2}'),
      ('m1','Mahara own','2026-10-01','{"spend":75,"leads":3}'),
      ('x1','Nobody knows','2026-10-02','{"spend":12.34,"leads":0}'),
      ('s1','Alpha leads','2026-09-30','{"spend":999,"leads":9}'),
      ('f1','Alpha leads','2026-08-13','{"spend":10,"leads":1}');
    insert into public.cockpit_media_feed_state values('dailyStats',true,7,'2026-10-11T10:00:00Z');
    insert into public.ads_daily_snapshots values
      ('00000000-0000-4000-8000-000000000002','2026-08-01',375,'c1'),
      ('00000000-0000-4000-8000-000000000001','2026-08-02',20,'c2'),
      ('00000000-0000-4000-8000-000000000003','2026-08-02',40,'c3'),
      ('00000000-0000-4000-8000-000000000002','2026-08-20',999,'c1');`);
});
afterAll(async () => { await db.close(); });

test("October: USD as stored, tied through the campaign's ad account, own account out, the untied campaign named", async () => {
  const [r] = await rows(clientMediaSql("date '2026-10-01'", "date '2026-11-01'"));
  expect(mediaFeedCheck(r)).toBeNull();
  const m = combineClientMedia(r, []);
  // 100.5 + 50 (Alpha) + 221.66 (Beta, already dollars: never multiplied by the SAR rate again).
  expect(m.amount).toBe(372.16);
  expect(m.clients).toBe(2);
  expect(m.ownFound).toBe(true);
  expect(m.untiedSpend).toBe(12.34);
  expect(m.untiedCampaigns).toEqual(["Nobody knows"]);
  expect(String(r.first_day)).toBe("2026-08-13");
  const note = clientMediaNote("October 2026", "2026-08-13", m);
  expect(note).toContain("1 campaign could not be tied to a client and is left out ($12): Nobody knows.");
  expect(note).toContain("Mahara's own accounts are taken out of this figure by name.");
});

test("August: days before the feed's first day come from the frozen snapshots, converted at the fixed rates", async () => {
  const [r] = await rows(clientMediaSql("date '2026-08-01'", "date '2026-09-01'"));
  const older = await rows(olderClientMediaSql("date '2026-08-01'", "least(date '2026-09-01', date '2026-08-13')"));
  const m = combineClientMedia(r, older);
  // Feed: Alpha 10 on 13 Aug. Snapshots before 13 Aug: Beta 375 SAR = $99.975, Alpha $20; Mahara's own $40 out; 20 Aug ignored.
  expect(m.olderUsd).toBe(119.98);
  expect(m.amount).toBe(129.98);
  expect(m.clients).toBe(2);
  expect(m.ownFound).toBe(true);
  expect(clientMediaNote("August 2026", "2026-08-13", m)).toContain("Days before 2026-08-13, when the feed starts, come from the old ad snapshots (frozen on 2 Oct 2026), converted at the cockpit's fixed rates: $120.");
});

test("a currency with no fixed rate is left out and said, never counted at one to one", () => {
  const m = combineClientMedia({ spend: 0, client_ids: "{}", own_clients: 0, untied_spend: 0, untied_campaigns: "{}" },
    [{ currency: "EGP", spend: 5000, client_ids: "{x}", own_rows: 0 }]);
  expect(m.amount).toBe(0);
  expect(m.unknownCurrencies).toEqual(["EGP"]);
  expect(clientMediaNote("July 2026", "2026-08-13", m)).toContain("Spend in EGP has no fixed rate and is left out");
});

test("a feed that is not ready, or is mid-import, is refused: missing, never zero", async () => {
  await db.exec("update public.cockpit_media_feed_state set source_rows=8");
  let [r] = await rows(clientMediaSql("date '2026-10-01'", "date '2026-11-01'"));
  expect(mediaFeedCheck(r)).toBe("the native media feed holds 7 rows but its state says 8, so it is mid-import");
  await db.exec("update public.cockpit_media_feed_state set source_rows=7, ready=false");
  [r] = await rows(clientMediaSql("date '2026-10-01'", "date '2026-11-01'"));
  expect(mediaFeedCheck(r)).toContain("not marked ready");
  await db.exec("update public.cockpit_media_feed_state set ready=true");
});
