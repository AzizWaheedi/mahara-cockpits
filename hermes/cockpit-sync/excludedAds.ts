/**
 * Ads placed by unauthorized actors during the October 2026 Meta account
 * compromise. Their delivery is not Mahara's or the client's advertising, so
 * it must never count toward spend, leads, CPL, CPB or any verdict. Kept by
 * immutable ad id; names were reused ("New Engagement Ad") and cannot be
 * trusted. Mirrors public.cockpit_excluded_ads in Creative Triage
 * (migrations 20261010a, 20261021b and 20261023p, 23 ads). Evidence: workspace
 * meta-unauthorized-ads/, the 20261021b header and, for SAFAD's two ads, the
 * 20261023p header (the CEO's "Yes" of 23 Oct 2026, D0a).
 */
export const EXCLUDED_AD_IDS: ReadonlySet<string> = new Set([
  "120246624477980705",
  "120246699622910088",
  "120246747852310705",
  "120246747887330705",
  "120246795745520088",
  "120246876560950088",
  "120246877123380088",
  "120246911751100088",
  "120246911853480088",
  "120246912291150088",
  "120246912291170088",
  // 20261021b: Munshaat Khalida act_1275190574533155, made after 10 Oct.
  "120247012327250088", // "29/8 - Copy", Jonathan Rbn, 15 Oct (US, pixel purchases)
  "120247083365360088", // "New Engagement Campaign", Lucas J Ortiz, 20 Oct (Egypt)
  "120250570737440269",
  "120250615876980269",
  "120250733492810269",
  "120250733606890269",
  "120250765395660269",
  "120250765528850269",
  "120252448730350064",
  "52557072938435",
  // 20261023p: SAFAD act_774492648699300, outsiders' ads (CEO, 23 Oct 2026, D0a).
  "120254791600360066", // "New Engagement Campaign", Mercedes Garcia, 13 Oct (Egypt), $375.10, no lead
  "120254896955290066", // "New Engagement Campaign", Lucas J Ortiz, 20 Oct (Saudi Arabia), $0
]);

/**
 * The ad accounts that hold a listed ad (the account column of the same
 * migrations, without "act_"). The market lens reads such an account's
 * ad-level window to find listed ads Meta leaves off an ad set's /ads edge.
 */
export const EXCLUDED_AD_ACCOUNTS: ReadonlySet<string> = new Set([
  "1009665871644699", // Ideal Elite
  "1034584029438250", // ARCWANI
  "1275190574533155", // Munshaat Khalida
  "1938709086836136", // Liwan
  "774492648699300", // SAFAD (20261023p)
  "985366551096162", // RM Designs
]);

export function holdsExcludedAd(accountId: unknown): boolean {
  return EXCLUDED_AD_ACCOUNTS.has(String(accountId ?? "").trim().replace(/^act_/, ""));
}

/** Ad-level grain column holding the Meta ad id (data_fb column Q). */
const AD_ID_COLUMN = 16;

export function isExcludedAd(adId: unknown): boolean {
  return EXCLUDED_AD_IDS.has(String(adId ?? "").trim());
}

/** Drop every grain row that belongs to an excluded ad. */
export function withoutExcludedAds(rows: string[][]): string[][] {
  return rows.filter(r => !isExcludedAd(r[AD_ID_COLUMN]));
}
