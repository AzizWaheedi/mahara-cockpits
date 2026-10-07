import {
  BookOpen,
  Clapperboard,
  Gauge,
  Handshake,
  HeartHandshake,
  type LucideIcon,
  Megaphone,
  Palette,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

/**
 * One icon per cockpit, the same in every switcher, menu and front door, so a
 * cockpit is recognised by its mark rather than a row of identical arrows.
 * The same file sits in each of the five apps.
 */
export const COCKPIT_ICON: Record<string, LucideIcon> = {
  ceo: Gauge,
  media_buyer: Megaphone,
  csm: HeartHandshake,
  creative: Palette,
  editor: Clapperboard,
  sales: Handshake,
  admin: ShieldCheck,
  team: UsersRound,
  sop: BookOpen,
};

/**
 * Each cockpit's SOP: one page each in the team's ClickUp doc "Cockpit SOPs"
 * (written 2026-10-06, after the simplification audit). Every sidebar links
 * its own at the foot, and the search box finds it. Signed-in ClickUp members
 * only: the doc is not shared outside the workspace.
 */
const SOP_DOC = "https://app.clickup.com/90182518398/docs/2kzmr1ky-7418";
export const COCKPIT_SOP: Record<string, string> = {
  start: `${SOP_DOC}/2kzmr1ky-3398`,
  csm: `${SOP_DOC}/2kzmr1ky-3418`,
  media_buyer: `${SOP_DOC}/2kzmr1ky-3438`,
  creative: `${SOP_DOC}/2kzmr1ky-3458`,
  editor: `${SOP_DOC}/2kzmr1ky-3478`,
  sales: `${SOP_DOC}/2kzmr1ky-3498`,
};

/**
 * Each cockpit's demo video and its two SOPs in Google Docs: the simple one
 * (the day step by step, with a picture of every step) and the in-depth one
 * (every screen). In the Drive folder "Cockpit SOPs" (2026-10-07), open to
 * maharamedia.com accounts. A re-recording replaces each file in place, so
 * these addresses stay the same.
 */
const DRIVE_FILE = "https://drive.google.com/file/d";
const GOOGLE_DOC = "https://docs.google.com/document/d";
export const COCKPIT_GUIDES: Record<
  string,
  { video: string; simple: string; deep: string }
> = {
  csm: {
    video: `${DRIVE_FILE}/1RUlOhQZUtFExNiu-nKtY9bYLSEihwnDS/view`,
    simple: `${GOOGLE_DOC}/1BpbtA5i2kwuIxKZsomRLLXrhxNXh5S34ThFmghj6RoI/edit`,
    deep: `${GOOGLE_DOC}/1_9lZfD4KSHV54NPhIPU0rkfLvFIxMFiexiAwz8q2xz8/edit`,
  },
  media_buyer: {
    video: `${DRIVE_FILE}/181jbsAfHy4vghtfGQ2gOZk7StWojCvHC/view`,
    simple: `${GOOGLE_DOC}/18VAlBnLiqhKhPJksYsFP7rJ-XtzKM4D74n6sVIzNvXM/edit`,
    deep: `${GOOGLE_DOC}/1QJR7cZhmHuRp4unjO_HVPUy5TZTWGBImLFC00gb4ho0/edit`,
  },
  creative: {
    video: `${DRIVE_FILE}/1ivCH-Ubog1R4Y-zS7B-S4xe2iLFSwF9m/view`,
    simple: `${GOOGLE_DOC}/19JKDh3TJGlxT1yLZP-LSP3a5hP5iYYK7EvHzTmSrF3M/edit`,
    deep: `${GOOGLE_DOC}/1Z1cusU9lNQh8u5i1to3kmmB3ZB7eZGa0osLFSuRnigw/edit`,
  },
  editor: {
    video: `${DRIVE_FILE}/1ubzMoMQPvOPbmjL9BWrhqMM1LY-xhnH6/view`,
    simple: `${GOOGLE_DOC}/1oZcNy_6RPsBe2YEJMLVkSqC3HoF9uvifZVjTbtYA8rg/edit`,
    deep: `${GOOGLE_DOC}/1KPWm5mXCbEgvXfy__1j7avGIx5q59euD8GLCdcVYD_w/edit`,
  },
  sales: {
    video: `${DRIVE_FILE}/1swnauUROiAJXiJ3f-DeAHift7iHz-553/view`,
    simple: `${GOOGLE_DOC}/1-tpPls6rTKLaGMw4svWeAD6DdgRvTgBxSGEEUFE_qV4/edit`,
    deep: `${GOOGLE_DOC}/1tDDpvBjwmWiomypTpBmh5-qLMzkhYH94dsV6aJbXgyI/edit`,
  },
};
