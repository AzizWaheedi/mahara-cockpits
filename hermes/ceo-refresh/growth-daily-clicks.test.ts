import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dailySql, uniqueLinkClicksOf } from "./native/adapters/growth.js";

/**
 * The Goals sheet's Unique link clicks fills in by day from the CEO growth section's 365-day daily series
 * (2026-11-02): lead-gen unique link clicks by Meta day, on exactly the rows the daily lead-gen `spend` reads
 * (the webinar's campaigns left out), so a day's clicks and spend always describe the same ads.
 */
const SQL = dailySql("2026-10-01", "2026-11-01");
const META = SQL.slice(
  SQL.indexOf("meta as ("),
  SQL.indexOf("\n),", SQL.indexOf("meta as (")),
);
const filterOf = (column: string, alias: string) => {
  const m = META.match(
    new RegExp(
      `sum\\(s\\.${column}\\) filter \\(where ([\\s\\S]+?)\\) as ${alias},`,
    ),
  );
  if (!m) throw new Error(`no ${alias} in the meta step`);
  return m[1];
};

describe("the daily series carries lead-gen unique link clicks with the spend column's filter", () => {
  test("unique link clicks are summed with exactly the lead-gen spend filter, webinar left out", () => {
    const spend = filterOf("spend", "spend");
    expect(spend).toContain(
      "public.b2b_campaign_type(s.campaign_name) = 'lead_gen'",
    );
    expect(spend).toContain("and not (coalesce(s.campaign_name, '') ~*");
    expect(spend).toContain("from public.lt_events e");
    expect(filterOf("unique_inline_link_clicks", "unique_link_clicks")).toBe(
      spend,
    );
    // The raw link clicks (not unique) never feed the daily series.
    expect(SQL).not.toContain("s.inline_link_clicks");
  });

  test("the same day rule as spend: one Meta-day step, the same date range", () => {
    expect(META).toContain("select s.date as d,");
    expect(META).toContain(
      "where s.date between '2026-10-01'::date and '2026-11-01'::date",
    );
    expect(META).toContain("group by 1");
    expect(META).toContain(") as spend,");
    expect(META).toContain(") as unique_link_clicks,");
  });

  test("a lead-gen ad that spent with no unique count makes the day unknown, not smaller", () => {
    expect(META).toContain(
      `count(*) filter (where ${filterOf("spend", "spend")} and s.spend > 0 and s.unique_inline_link_clicks is null) as unique_link_clicks_missing`,
    );
    expect(SQL).toContain(
      "case when coalesce(meta.unique_link_clicks_missing, 0) > 0 then null\n    else coalesce(meta.unique_link_clicks, 0) end as unique_link_clicks",
    );
  });

  test("the row mapping keeps a count, a true zero and an unknown day apart", () => {
    expect(uniqueLinkClicksOf({ unique_link_clicks: "153" })).toBe(153);
    expect(uniqueLinkClicksOf({ unique_link_clicks: 41 })).toBe(41);
    expect(uniqueLinkClicksOf({ unique_link_clicks: "0" })).toBe(0);
    expect(uniqueLinkClicksOf({ unique_link_clicks: null })).toBeNull();
    expect(uniqueLinkClicksOf({})).toBeNull();
  });

  test("each day of the daily series maps uniqueLinkClicks", () => {
    const src = readFileSync(
      new URL("./native/adapters/growth.js", import.meta.url),
      "utf8",
    );
    const daily = src.slice(
      src.indexOf('attempt("The 365-day daily series"'),
      src.indexOf('attempt("The rep scorecard"'),
    );
    expect(daily).toContain("spendRetargeting: num(r.spend_rt),");
    expect(daily).toContain("uniqueLinkClicks: uniqueLinkClicksOf(r),");
  });
});
