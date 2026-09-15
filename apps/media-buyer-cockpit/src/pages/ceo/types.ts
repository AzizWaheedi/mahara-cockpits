import type { CeoSections } from "@/components/ceo/useCeo";

export const CEO_TAB_KEYS = [
  "today",
  "money",
  "growth",
  "delivery",
  "calls",
  "clients",
  "team",
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
