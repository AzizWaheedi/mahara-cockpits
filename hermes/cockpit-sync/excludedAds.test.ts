import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EXCLUDED_AD_IDS, isExcludedAd, withoutExcludedAds } from "./excludedAds";

function row(adId: string, cost: string): string[] {
  const r = new Array(25).fill("");
  r[0] = "2026-10-08";
  r[1] = "ARCWANI";
  r[2] = "Arcwani | Leads | Sep2026 | MHM™";
  r[4] = cost;
  r[16] = adId;
  r[17] = "New Engagement Ad";
  return r;
}

describe("unauthorized ad exclusion", () => {
  test("lists every incident ad once", () => {
    expect(EXCLUDED_AD_IDS.size).toBe(21);
    expect(isExcludedAd("120250765528850269")).toBe(true);
    expect(isExcludedAd(" 52557072938435 ")).toBe(true);
    expect(isExcludedAd("120250159648130269")).toBe(false);
    expect(isExcludedAd(undefined)).toBe(false);
  });

  test("removes only the excluded ad rows, by id not by name", () => {
    const kept = row("120250159648130269", "40");
    const out = withoutExcludedAds([row("120250765528850269", "58.57"), kept, row("120246912291150088", "96.93")]);
    expect(out).toEqual([kept]);
  });

  test("pins the two Munshaat Khalida ads of 20261021b", () => {
    const khalida = ["120247012327250088", "120247083365360088"];
    for (const id of khalida) expect(isExcludedAd(id)).toBe(true);
    // An exact id match: a made-up neighbour and another account's ad stay counted.
    expect(isExcludedAd("120247012327250089")).toBe(false);
    expect(isExcludedAd("900000000000123")).toBe(false);
    const kept = row("900000000000123", "12.5");
    expect(withoutExcludedAds([row(khalida[0], "9"), kept, row(khalida[1], "1")])).toEqual([kept]);
  });

  test("holds exactly the ads the migrations list in public.cockpit_excluded_ads", () => {
    const fromTable = new Set([...listedBy("20261010a_exclude_unauthorized_ads.sql"), ...listedBy("20261021b_exclude_khalida_unauthorized_ads.sql")]);
    expect(listedBy("20261021b_exclude_khalida_unauthorized_ads.sql")).toEqual(["120247012327250088", "120247083365360088"]);
    expect(fromTable.size).toBe(21);
    expect([...EXCLUDED_AD_IDS].sort()).toEqual([...fromTable].sort());
  });
});

/** The ad ids a migration inserts into public.cockpit_excluded_ads ('<ad>', 'act_<account>', ...). */
function listedBy(file: string): string[] {
  const sql = readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
  return [...sql.matchAll(/\(\s*'(\d+)',\s*'act_\d+'/g)].map(m => m[1]);
}
