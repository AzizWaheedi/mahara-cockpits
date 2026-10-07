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
