/**
 * The Ads tab's meter for an ad with spend and no lead (Aziz, 23 Oct 2026,
 * cost per booking decisions, 4): "Depends on how much spend if 2x target cpl
 * then yes bad if below that then not enough data". Red only at or over 2 x
 * the $15 cost per lead gate, judged on the cents shown; under it a neutral
 * dot and "too few to judge"; an amount in another currency gets no tone,
 * since the line is in dollars. Every figure here is made up.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);

afterAll(() => {
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
});

const { Meter, noLeadMeter } = await import("../src/components/ClientAds");
const { noLeadLine } = await import("../src/lib/kpi");

const metrics = (spend: number, leads = 0) => ({
  spend,
  leads,
  impressions: 1000,
  linkClicks: 10,
  booked: 0,
  attended: 0,
  ...(leads > 0 ? { cpl: spend / leads } : {}),
});

const draw = (spend: number, currency = "USD", leads = 0) =>
  renderToStaticMarkup(
    createElement(Meter, { t: metrics(spend, leads), avg: 12, currency }),
  );

describe("an ad with spend and no lead", () => {
  test("the line is 2 x the $15 gate", () => {
    expect(noLeadLine()).toBe(30);
  });

  test("under $30: a neutral dot and too few to judge", () => {
    for (const spend of [0.49, 11.09, 29.99, 29.994])
      expect(noLeadMeter(spend, "USD")?.tone).toBe("neutral");
    expect(noLeadMeter(11.09, "USD")?.words).toBe(
      "No leads yet from $11.09: too few to judge",
    );
    const html = draw(11.09);
    expect(html).toContain("No leads yet from $11.09: too few to judge");
    expect(html).toContain("bg-muted-foreground/60");
    expect(html).not.toContain("bg-destructive");
  });

  test("$30.00 or more: red, as before", () => {
    for (const spend of [29.995, 30, 41.65])
      expect(noLeadMeter(spend, "USD")?.tone).toBe("bad");
    expect(noLeadMeter(41.65, "USD")?.words).toBe(
      "No leads from $41.65 in this period",
    );
    const html = draw(30);
    expect(html).toContain("No leads from $30.00 in this period");
    expect(html).not.toContain("bg-muted-foreground/60");
  });

  test("an amount in another currency gets no tone, only the words", () => {
    expect(noLeadMeter(112.53, "SAR")).toEqual({
      tone: null,
      words: "No leads from SAR 112.53 in this period",
    });
    expect(noLeadMeter(5, "BHD")?.tone).toBeNull();
    const html = draw(112.53, "SAR");
    expect(html).toContain("No leads from SAR 112.53 in this period");
    expect(html).not.toContain("rounded-full");
  });

  test("no spend says nothing; a lead brings back the comparison", () => {
    expect(noLeadMeter(0, "USD")).toBeNull();
    expect(draw(0)).toBe("");
    const html = draw(36, "USD", 3);
    expect(html).toContain("average of $12.00 a lead");
    expect(html).not.toContain("No leads");
  });
});
