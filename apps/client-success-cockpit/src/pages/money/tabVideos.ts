import { SOP_VIDEOS, type SopVideoInfo } from "@/lib/cockpits";

/**
 * The how-to video for a Money tab, played above it (Aziz, 2026-11-02):
 * money in on Billing and Invoices, wins on Wins. Offers plays its own
 * (OffersTab). Its own file so a test can read it without the page.
 */
export const TAB_VIDEO: Readonly<Record<string, SopVideoInfo | undefined>> = {
  billing: SOP_VIDEOS.csm.money,
  invoices: SOP_VIDEOS.csm.money,
  wins: SOP_VIDEOS.csm.wins,
};
