import { describe, expect, test } from "bun:test";
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
    expect(EXCLUDED_AD_IDS.size).toBe(19);
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
});
