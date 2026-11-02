/**
 * Where the offer art lives (docs/upsell-studio/ART.md).
 *
 * Masters never enter git: they stay on the VPS under MEDIA. The exports
 * (webp at 1920x1080) are copied into the two places the repo serves them
 * from: the cockpit's deck folder and the offer site's folder.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SET = "website";
export const REPO = resolve(import.meta.dir, "../..");
export const MEDIA =
  process.env.OFFER_ART_MEDIA || join(homedir(), "upsell-build/media/art");
export const SET_DIR = join(MEDIA, SET);
export const DIRS = {
  raw: join(SET_DIR, "raw"),
  master: join(SET_DIR, "master"),
  export: join(SET_DIR, "export"),
  review: join(SET_DIR, "review"),
} as const;
export const JOBS = join(SET_DIR, "jobs.json");
export const LEDGER = join(SET_DIR, "ledger.jsonl");
export const CUBE = join(SET_DIR, "grade.cube");
export const REPORT = join(DIRS.export, "report.json");
export const PROMPTS = join(import.meta.dir, `prompts.${SET}.json`);

export const COCKPIT_ART = join(
  REPO,
  "apps/client-success-cockpit/src/present/offer/art",
  SET,
);
export const SITE_ART = join(REPO, "sites/offer/art", SET);
export const ICONS_TSX = join(
  REPO,
  "apps/client-success-cockpit/src/present/offer/art/icons.tsx",
);
export const SPRITE = join(SITE_ART, "icons.svg");

/** The four pictures of a set and the file each one exports to. */
export const SLOTS = ["hero", "stone", "drawing", "site"] as const;
export type Slot = (typeof SLOTS)[number];
export const FILES: Record<Slot, string> = {
  hero: "hero.webp",
  stone: "bg-stone.webp",
  drawing: "bg-drawing.webp",
  site: "bg-site.webp",
};
export const isBackground = (s: Slot) => s !== "hero";

/** CONTRACT 5.7: per offer, in bytes (1 KB = 1000 bytes, the strict reading). */
export const BUDGET = {
  hero: 250_000,
  background: 150_000,
  total: 800_000,
} as const;
export const EXPORT_SIZE = { width: 1920, height: 1080 } as const;
