/**
 * Ads placed by unauthorized actors during the October 2026 Meta account
 * compromise. Their delivery is not Mahara's or the client's advertising, so
 * it must never count toward spend, leads, CPL, CPB or any verdict. Kept by
 * immutable ad id; names were reused ("New Engagement Ad") and cannot be
 * trusted. Mirrors public.cockpit_excluded_ads in Creative Triage
 * (migration 20261010a). Evidence: workspace meta-unauthorized-ads/.
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
  "120250570737440269",
  "120250615876980269",
  "120250733492810269",
  "120250733606890269",
  "120250765395660269",
  "120250765528850269",
  "120252448730350064",
  "52557072938435",
]);

/** Ad-level grain column holding the Meta ad id (data_fb column Q). */
const AD_ID_COLUMN = 16;

export function isExcludedAd(adId: unknown): boolean {
  return EXCLUDED_AD_IDS.has(String(adId ?? "").trim());
}

/** Drop every grain row that belongs to an excluded ad. */
export function withoutExcludedAds(rows: string[][]): string[][] {
  return rows.filter(r => !isExcludedAd(r[AD_ID_COLUMN]));
}
