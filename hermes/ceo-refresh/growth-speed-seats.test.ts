import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CALLS_COPY_SQL,
  callsCopyStale,
  dailySql,
  FIRST_CALL_JOIN,
  firstCallsSql,
  firstCallsStep,
  windowsSql,
} from "./native/adapters/growth.js";
import { DEFAULT_WORKING_HOURS } from "./native/workingHours.js";

/**
 * Speed to lead counts the setter's calls (2026-11-05). The CEO cockpit read
 * first calls from B2B's maqsam_calls, which since 7 October holds none of
 * the sales team's calls (every window read "0 called"). It now reads them
 * from Creative Triage with the sales cockpit's rule (apps/sales-cockpit/
 * src/lib/calls.ts salesLineCall and speedToLead), so both cockpits agree:
 * checked live on 5 November, the four windows matched the sales cockpit's
 * rule to the lead and the minute (mtd 16 leads, 11 called, median 892.5).
 */
const FC = firstCallsSql("2025-11-06");
const RANGES = { mtd: ["2026-11-01", "2026-11-05"] };
const ROWS = [
  { c: "contactA", t: "2026-11-02T08:00:00.000Z" },
  { c: "contactA", t: "2026-11-01T08:00:00.000Z" },
  { c: "it's", t: "2026-11-03T08:00:00.000Z" },
  { c: "", t: "2026-11-03T08:00:00.000Z" },
  { c: "noTime", t: null },
];

describe("the first calls: the sales cockpit's rule, read from Triage", () => {
  test("a sales seat's call: B2B's rep id, or made from a seat's or a roster rep's Maqsam address", () => {
    expect(FC).toContain("from public.cockpit_sales_people as p where position('@' in coalesce(p.maqsam_email, '')) > 0");
    expect(FC).toContain("from public.cockpit_sales_reps as r where position('@' in coalesce(r.maqsam_email, '')) > 0");
    expect(FC).toContain("(d.sales_rep_id is not null or lower(btrim(coalesce(d.agent_email, ''))) in (select e from line))");
    expect(FC).toContain("from public.cockpit_sales_dials as d");
    // Either direction and any outcome: nothing filters them.
    expect(FC).not.toContain("direction");
    expect(FC).not.toContain("state");
  });

  test("a linked call counts for its contact only; an unlinked one by the last eight digits", () => {
    expect(FC).toContain(
      "((sc.contact_id is not null and sc.contact_id = l.contact_id)\n     or (sc.contact_id is null and l.phone8 is not null and sc.lead_phone8 = l.phone8))",
    );
    expect(FC).toContain("join seat_calls as sc on sc.occurred_at >= l.lead_created_at");
    expect(FC).toContain("to_char(min(sc.occurred_at) at time zone 'UTC'");
    expect(FC).toContain("group by l.contact_id");
  });

  test("from the start of a Riyadh day; a bad day is refused before any SQL is written", () => {
    expect(FC).toContain("('2025-11-06'::date::timestamp at time zone 'Asia/Riyadh')");
    expect(() => firstCallsSql("2025-11-06'; drop table x; --")).toThrow();
  });

  test("the sales cockpit's copy of the rule says the same", () => {
    const app = readFileSync(new URL("../../apps/sales-cockpit/src/lib/calls.ts", import.meta.url), "utf8");
    expect(app).toContain("if (c.sales_rep_id) return true;\n  const a = lineAddress(c.agent_email);\n  return a.includes(\"@\") && line.has(a);");
    const migration = readFileSync(new URL("../../supabase/migrations/20261105s_setter_speed_line.sql", import.meta.url), "utf8");
    expect(migration).toContain("select p.maqsam_email from public.cockpit_sales_people as p");
    expect(migration).toContain("select r.maqsam_email from public.cockpit_sales_reps as r");
  });
});

describe("the windows and the daily series join B2B's leads to those first calls", () => {
  const step = firstCallsStep(ROWS);
  test("one first call per contact, the earliest; rows with no contact or no time dropped; quotes doubled", () => {
    expect(step).toContain("select fcr.c as contact_id, min(fcr.t) as first_call");
    expect(step).toContain("group by fcr.c");
    expect(step).toContain('"c":"it\'\'s"');
    expect(step).not.toContain('"c":""');
    expect(step).not.toContain("noTime");
    expect(firstCallsStep([])).toContain("jsonb_to_recordset('[]'::jsonb)");
  });

  test("the windows' speed step reads no Maqsam copy of B2B's any more", () => {
    const sql = windowsSql(RANGES, DEFAULT_WORKING_HOURS, [], ROWS);
    const speed = sql.slice(sql.indexOf("speed as ("), sql.indexOf("\n),", sql.indexOf("speed as (")));
    expect(speed).toContain(`left join first_calls fc on ${FIRST_CALL_JOIN}`);
    expect(speed).not.toContain("maqsam_calls");
    expect(sql).toContain("first_calls as (");
    expect(FIRST_CALL_JOIN).toBe("fc.contact_id = l.contact_id and fc.first_call >= l.lead_created_at");
  });

  test("the daily series' speed columns read the same first calls", () => {
    const sql = dailySql("2026-10-01", "2026-10-31", ROWS);
    const ld = sql.slice(sql.indexOf("ld as ("), sql.indexOf("\n),", sql.indexOf("ld as (")));
    expect(ld).toContain(`left join first_calls fc on ${FIRST_CALL_JOIN}`);
    expect(ld).not.toContain("maqsam_calls");
    expect(ld).toContain("count(fc.first_call) filter (where");
  });

  test("the refresh reads the first calls once, before the core windows read, and gives them to both", () => {
    const src = readFileSync(new URL("./native/adapters/growth.js", import.meta.url), "utf8");
    expect(src).toContain("const firstCalls = await sql(TRIAGE, firstCallsSql(addDays(today, -364)));");
    expect(src).toContain("windowsSql(ranges, wh.hours, ecomConfirmRows, firstCalls)");
    expect(src).toContain("dailySql(addDays(today, -364), today, firstCalls, callsCopy?.first_at ?? null)");
  });
});

describe("2026-11-06 review: where the calls copy starts, and a copy that stopped", () => {
  const START = "2025-12-04T06:10:00.000Z";

  test("days before the calls copy starts read B2B's own copy too, the earlier call counting", () => {
    const sql = dailySql("2025-11-07", "2026-11-06", ROWS, START);
    const fc = sql.slice(sql.indexOf("b2b_first_calls as ("), sql.indexOf("\nmeta as ("));
    expect(fc).toContain("join public.maqsam_calls m on m.occurred_at >= l.lead_created_at");
    expect(fc).toContain("l.lead_created_at < '2025-12-04T06:10:00.000Z'::timestamptz");
    expect(fc).toContain("l.lead_created_at >= ('2025-11-07'::date::timestamp at time zone 'Asia/Riyadh')");
    expect(fc).toContain("select x.contact_id, min(x.first_call) as first_call");
    expect(fc).toContain("union all");
    // The day columns still read one first-calls step through the same join.
    const ld = sql.slice(sql.indexOf("ld as ("), sql.indexOf("\n),", sql.indexOf("ld as (")));
    expect(ld).toContain(`left join first_calls fc on ${FIRST_CALL_JOIN}`);
  });

  test("a series that starts on or after the copy needs no B2B read; a bad start is refused", () => {
    expect(dailySql("2025-12-05", "2026-11-06", ROWS, START)).not.toContain("maqsam_calls");
    expect(dailySql("2025-11-07", "2026-11-06", ROWS, null)).not.toContain("maqsam_calls");
    expect(() => firstCallsStep(ROWS, { from: "2025-11-07", at: "x'; drop table y; --" })).toThrow();
  });

  test("the copy is read for its start, newest call and copy time", () => {
    expect(CALLS_COPY_SQL).toContain("min(d.occurred_at)");
    expect(CALLS_COPY_SQL).toContain("max(d.occurred_at)");
    expect(CALLS_COPY_SQL).toContain("max(d.mirrored_at)");
    expect(CALLS_COPY_SQL).toContain("from public.cockpit_sales_dials as d");
  });

  test("stale after a working day; two days across the Friday off; missing is stale", () => {
    const H = 3_600_000;
    const tue = Date.parse("2026-11-03T09:00:00Z"); // Tuesday 12:00 Kuwait
    const sat = Date.parse("2026-11-07T09:00:00Z"); // Saturday 12:00 Kuwait
    expect(callsCopyStale(tue - 20 * H, tue)).toBe(false);
    expect(callsCopyStale(tue - 30 * H, tue)).toBe(true);
    expect(callsCopyStale(sat - 40 * H, sat)).toBe(false);
    expect(callsCopyStale(sat - 50 * H, sat)).toBe(true);
    expect(callsCopyStale(Number.NaN, tue)).toBe(true);
  });

  test("no first call in a year is a broken copy: the core read fails and the last good payload stays; the card stamps the copy", () => {
    const src = readFileSync(new URL("./native/adapters/growth.js", import.meta.url), "utf8");
    expect(src).toContain("const [callsCopy] = await sql(TRIAGE, CALLS_COPY_SQL);");
    expect(src).toContain("if (!firstCalls.length)\n            throw new Error(");
    expect(src).toContain('name: "Sales calls (the sales cockpit\'s Maqsam copy, cockpit_sales_dials)"');
    expect(src).toContain("callsCopyStale(newestMs, Date.now())");
  });

  test("the speed definitions name both databases and the seat rule; SOURCES.md says where the calls come from", () => {
    const metrics = readFileSync(new URL("./native/metrics.ts", import.meta.url), "utf8");
    for (const id of ["speed_to_lead_median_min", "speed_to_lead_called", "speed_to_lead_never_called", "speed_to_lead_within_5_share"]) {
      const at = metrics.indexOf(`"growth.${id}"`);
      const block = metrics.slice(at, metrics.indexOf("\n  d(", at));
      expect(block).toContain("SPEED_SOURCE");
      expect(block).not.toContain("sales rep's");
    }
    expect(metrics).toContain("cockpit_sales_dials, bldgtotkfmhoxmlzowdx");
    const sources = readFileSync(new URL("../../apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md", import.meta.url), "utf8");
    expect(sources).toContain("**Maqsam, through the sales cockpit's copy in Creative Triage** (`cockpit_sales_dials`");
    expect(sources).not.toContain("**Maqsam, through the same B2B database** (`maqsam_calls`): the setters' phone calls.");
  });
});
