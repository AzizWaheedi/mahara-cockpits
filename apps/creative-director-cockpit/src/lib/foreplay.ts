/**
 * Foreplay: where to send somebody, and what a board is.
 *
 * Their app cannot be embedded -- foreplay.co answers with
 * `content-security-policy: frame-ancestors 'self'`, so an iframe of
 * discovery renders an empty box in any cockpit. Links in a new tab are the
 * whole of what is possible, and they are enough: everyone on the team is
 * signed in there already, so a link lands on the real page.
 *
 * The paths are their router's own, read off app.foreplay.co's bundle on
 * 2026-09-19, not guessed. Their word for the swipe file is "library".
 *
 * This file is the same in all three cockpits. Change it in one and copy it.
 */
const APP = "https://app.foreplay.co";

export const foreplay = {
  /** Every ad their crawler has, searchable. The reason to leave the cockpit. */
  discovery: `${APP}/discovery`,
  /** Discovery narrowed to advertisers rather than single ads. */
  brands: `${APP}/discovery-brands`,
  /** Everything the team has saved. */
  library: `${APP}/library`,
  /** Saves by teammate, which is how you see who is actually collecting. */
  team: `${APP}/library-team`,
  /** The boards themselves. */
  boards: `${APP}/boards`,
  /** Brands we follow, so their new ads arrive without anyone looking. */
  spyder: `${APP}/spyder`,
  /** How to save an ad from a phone: the setup page for the team. */
  onPhone: `${APP}/library-mobile-saving`,
  /** One board. */
  board: (id: string) => `${APP}/boards/${encodeURIComponent(id)}`,
} as const;

/** A Foreplay board, whether or not any of its ads have reached us yet. */
export interface ForeplayBoard {
  id: string;
  name: string | null;
  /** The drop box: saves here become ideation posts on their own. */
  feeds_ideation: boolean;
  ads: number;
  first_seen_at: string;
  last_seen_at: string;
  ads_synced_at: string | null;
}

/**
 * A board counts as new if we first saw it in the last week.
 *
 * Derived rather than stored on purpose. A "seen" flag somebody has to clear
 * is one more thing that can get stuck in the wrong position, and a board
 * permanently marked new is worse than no marking at all.
 */
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function isNew(board: ForeplayBoard): boolean {
  const at = Date.parse(board.first_seen_at ?? "");
  return Number.isFinite(at) && Date.now() - at < WEEK;
}

/**
 * The boards Foreplay had at the last sync.
 *
 * A board deleted over there should stop appearing here, but a worker that
 * has stopped running must not empty the strip. Both hold if we keep the
 * boards carrying the most recent sync's timestamp: a deleted one falls away
 * on the next run, and a dead worker just leaves the last good set on screen.
 */
export function currentBoards(
  boards: ForeplayBoard[] | null | undefined,
): ForeplayBoard[] {
  const rows = boards ?? [];
  if (!rows.length) return [];
  const newest = rows.reduce((a, b) =>
    a.last_seen_at > b.last_seen_at ? a : b,
  ).last_seen_at;
  const cutoff = Date.parse(newest) - 10 * 60 * 1000;
  return rows.filter(b => Date.parse(b.last_seen_at) >= cutoff);
}

/** One saved ad, as the worker mirrors it out of Foreplay. */
export interface SwipeAd {
  id: string;
  ad_id: string | null;
  name: string | null;
  board_id: string | null;
  board_name: string | null;
  video: string | null;
  image: string | null;
  thumbnail: string | null;
  foreplay_url: string | null;
  link_url: string | null;
  headline: string | null;
  description: string | null;
  cta_title: string | null;
  display_format: string | null;
  publisher_platform: string[] | null;
  niches: string[] | null;
  languages: string[] | null;
  market_target: string | null;
  live: boolean | null;
  started_running: string | null;
  /** Days on air: the strongest single signal that an ad is working. */
  running_duration: number | null;
  video_duration: number | null;
  full_transcription: string | null;
  persona: string | null;
}

/** Seconds as m:ss, for a clip length. */
export function clock(seconds: number | null | undefined): string {
  const n = Math.max(0, Math.round(seconds ?? 0));
  if (!n) return "";
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
