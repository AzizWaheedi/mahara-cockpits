import { COCKPIT_GUIDES, SOP_VIDEOS, type SopVideoInfo } from "./cockpits";

/**
 * The sales guides for one job rather than the whole day, laid out the way
 * client success lists its logging SOP and videos (csmLinks.ts): the Links
 * page shows each group as one card, a video row plays in place (SopVideo),
 * and the search box (Ctrl/Cmd + K) finds every row.
 *
 * The setter's day in the dialer (2026-11-06): the setter works one queue in
 * the Dialer all day, not the four Slack channels. The SOP is a Google Doc in
 * "Cockpit SOPs" and the video is in "Team how-to videos"; both addresses
 * come from COCKPIT_GUIDES.
 */

export type GuideRow = {
  label: string;
  url: string;
  note?: string;
  /** A how-to video: the Links page plays it in place. */
  video?: SopVideoInfo;
};
export type GuideGroup = {
  id: string;
  title: string;
  blurb: string;
  rows: GuideRow[];
};

export const SALES_GUIDE_GROUPS: GuideGroup[] = [
  {
    id: "setter-day",
    title: "The setter's day in the dialer",
    blurb:
      "Work one queue in the Dialer all day, from the top down. You work from it instead of the four Slack channels: new leads and texts, call confirmations, follow-up and email opened. Watch the video once, then keep the SOP open beside you.",
    rows: [
      {
        label: "The setter's day in the dialer (the SOP)",
        url: COCKPIT_GUIDES.sales.sops.setter,
        note: "It happened → what you do, then 11 steps with a picture of every step",
      },
      {
        label: "The setter's day in the dialer (video)",
        url: COCKPIT_GUIDES.sales.howTo.setter,
        video: SOP_VIDEOS.sales.setter,
      },
    ],
  },
];
