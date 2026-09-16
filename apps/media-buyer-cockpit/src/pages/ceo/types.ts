import type { CeoSections } from "@/components/ceo/useCeo";

/**
 * Every CEO tab, in screen order. The key is the value in ?tab=.
 *
 * Frontend is the curated rollup of Marketing and Sales, ending in cash won.
 * Backend is the curated rollup of Delivery, Calls and Client success. The
 * detail tabs sit next to the rollup they feed, so a number is always one
 * click from the place it came from.
 */
export const CEO_TAB_KEYS = [
  "today",
  "frontend",
  "marketing",
  "sales",
  "backend",
  "delivery",
  "calls",
  "client-success",
  "management",
  "money",
  "machine",
] as const;

export type CeoTabKey = (typeof CEO_TAB_KEYS)[number];

/** What every CEO tab receives from the page. */
export type CeoTabProps = {
  /** Every section, typed per key; null means not computed yet. */
  sections: CeoSections;
  /** Current time, ticking every 30 seconds (epoch ms). */
  now: number;
  /** Kuwait day from the server, "YYYY-MM-DD", or null before the first result. */
  day: string | null;
  /** Switch tabs, e.g. the Today machine strip opening the Machine tab. */
  goTab: (tab: CeoTabKey) => void;
};
