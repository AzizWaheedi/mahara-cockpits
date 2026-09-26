import {
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
};
