import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Clapperboard,
  Cpu,
  Film,
  Handshake,
  HeartHandshake,
  Lightbulb,
  Megaphone,
  Phone,
  ReceiptText,
  Server,
  Sun,
  Target,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { CeoTabKey } from "./types";

/**
 * The CEO cockpit's own navigation, in the left rail. Grouped by the shape of
 * the business rather than by where the data comes from: money, then the
 * front of the business (growth), the content Mahara puts out, the back of
 * the business (delivery), the people, and the machine that feeds it all.
 */
export type CeoNavItem = { key: CeoTabKey; label: string; icon: LucideIcon };

export const CEO_NAV: { title: string | null; items: CeoNavItem[] }[] = [
  {
    title: null,
    items: [
      { key: "today", label: "Today", icon: Sun },
      { key: "goals", label: "Goals", icon: Target },
      { key: "money", label: "Money", icon: Wallet },
      { key: "billing", label: "Billing", icon: CalendarClock },
      { key: "transactions", label: "Transactions", icon: ReceiptText },
    ],
  },
  {
    title: "Growth",
    items: [
      { key: "frontend", label: "Frontend", icon: TrendingUp },
      { key: "marketing", label: "Marketing", icon: Megaphone },
      { key: "ads", label: "Ads", icon: Megaphone },
      { key: "sales", label: "Sales", icon: Handshake },
    ],
  },
  {
    title: "Content",
    items: [
      { key: "organic", label: "Content", icon: Film },
      { key: "ideation", label: "Ideation", icon: Lightbulb },
      { key: "posting", label: "Posting", icon: Clapperboard },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "backend", label: "Backend", icon: Server },
      { key: "delivery", label: "Delivery", icon: Truck },
      { key: "calls", label: "Calls", icon: Phone },
      { key: "client-success", label: "Client success", icon: HeartHandshake },
    ],
  },
  {
    title: "People",
    items: [
      { key: "team", label: "Team & payroll", icon: Users },
      { key: "hiring", label: "Recruiting", icon: UserPlus },
      { key: "management", label: "Management", icon: Wrench },
    ],
  },
  {
    title: null,
    items: [{ key: "machine", label: "Machine", icon: Cpu }],
  },
];

export const CEO_LABELS: Record<CeoTabKey, string> = Object.fromEntries(
  CEO_NAV.flatMap(g => g.items.map(i => [i.key, i.label])),
) as Record<CeoTabKey, string>;
