import {
  CalendarDays,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileSignature,
  FileText,
  KanbanSquare,
  Lightbulb,
  Link2,
  type LucideIcon,
  MessageSquareText,
  Mic,
  PhoneCall,
  Presentation,
  Sun,
  Target,
  UserCog,
  UserSearch,
} from "lucide-react";

/**
 * Every page's one name (the simplification audit, approved by Aziz on
 * 2026-10-06). The sidebar, the menu bar along the top, the phone's dock
 * and the search box all read their names from here, so "Today" is never
 * also "Today's Agenda".
 */
export interface Page {
  to: string;
  label: string;
  icon: LucideIcon;
  group: "day" | "going" | "more";
  /** The key in the sidebar's counts whose number, above zero, earns a badge. */
  badge?: "owed" | "proposals" | "followups";
  managerOnly?: boolean;
  /** Other words people use for it, for the search box. */
  words?: string;
}

export const PAGES: Page[] = [
  { to: "/", label: "Today", icon: Sun, group: "day", words: "agenda home" },
  {
    to: "/dialer",
    label: "Dialer",
    icon: PhoneCall,
    group: "day",
    words: "power dialer call next lead",
  },
  {
    to: "/calendar",
    label: "Calendar",
    icon: CalendarDays,
    group: "day",
    badge: "owed",
    words: "calls owed marks appointments",
  },
  {
    to: "/pipeline",
    label: "Pipeline",
    icon: KanbanSquare,
    group: "day",
    words: "stages deals board",
  },
  {
    to: "/leads",
    label: "Leads",
    icon: UserSearch,
    group: "day",
    words: "directory contacts",
  },
  {
    to: "/proposals",
    label: "Proposals",
    icon: FileText,
    group: "day",
    badge: "proposals",
    words: "studio drafts figures",
  },
  {
    to: "/contracts",
    label: "Contracts",
    icon: FileSignature,
    group: "day",
    words: "client contracts sign",
  },
  {
    to: "/followups",
    label: "Follow-ups",
    icon: MessageSquareText,
    group: "day",
    badge: "followups",
    words: "follow up queue whatsapp",
  },
  {
    to: "/deck",
    label: "Pitch deck",
    icon: Presentation,
    group: "day",
    words: "slides presentation pitch",
  },
  {
    to: "/eod",
    label: "End of day",
    icon: ClipboardCheck,
    group: "day",
    words: "eod report",
  },
  {
    to: "/numbers",
    label: "Numbers",
    icon: ChartNoAxesColumn,
    group: "going",
    words: "scorecard dials pay",
  },
  {
    to: "/goals",
    label: "Goals",
    icon: Target,
    group: "going",
    words: "pace targets month",
  },
  {
    to: "/recordings",
    label: "Recordings",
    icon: Mic,
    group: "going",
    words: "calls listen review coach",
  },
  {
    to: "/intelligence",
    label: "Intelligence",
    icon: Lightbulb,
    group: "going",
    words: "prospect research objections",
  },
  {
    to: "/links",
    label: "Links",
    icon: Link2,
    group: "more",
    words: "key links resources forms",
  },
  {
    to: "/team",
    label: "Team",
    icon: UserCog,
    group: "more",
    managerOnly: true,
    words: "sales team seats management",
  },
];

export const GROUP_LABELS: Record<Page["group"], string> = {
  day: "Your day",
  going: "How it is going",
  more: "More",
};

/**
 * The phone's dock: six, because nine ran off a 375px screen. The rest are
 * one tap away under More.
 */
export const DOCK = [
  "/",
  "/dialer",
  "/calendar",
  "/leads",
  "/pipeline",
  "/proposals",
];

/** A page's name, for the menu bar along the top. */
export function pageTitle(pathname: string): string {
  const page = PAGES.find(p => p.to === pathname);
  if (page) return page.label;
  if (pathname.startsWith("/lead/")) return "Lead";
  if (pathname.startsWith("/call/")) return "Call";
  if (pathname.startsWith("/proposal/")) return "Proposal";
  if (pathname.startsWith("/recording/")) return "Recording";
  if (pathname.startsWith("/review/")) return "Review";
  return "Sales";
}
