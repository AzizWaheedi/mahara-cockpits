import {
  CalendarDays,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileText,
  KanbanSquare,
  Lightbulb,
  Link2,
  LogOut,
  type LucideIcon,
  MessageSquareText,
  Mic,
  Moon,
  PhoneCall,
  Sun,
  Target,
  UserCog,
  UserSearch,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { useWho } from "../lib/auth";
import { COCKPIT_ICON } from "../lib/cockpits";
import { otherCockpits, portalUrl } from "../lib/portal";
import { Wordmark } from "./Wordmark";

/**
 * The same shape as the other cockpits: an icon and a label per row, in
 * three groups down the left; team meetings and the portal's other doors at
 * the foot, each with its cockpit's own mark; the person at the bottom.
 *
 * A count beside a row is only drawn when it is something to act on: calls
 * owed a mark, proposals waiting on figures. A badge that is always there
 * stops being read.
 */
interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  /** The key in `counts` whose number, when above zero, is worth a badge. */
  badge?: string;
  managerOnly?: boolean;
}

export const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Your day",
    items: [
      { to: "/", label: "Today", icon: Sun },
      { to: "/dialer", label: "Dialer", icon: PhoneCall },
      { to: "/calendar", label: "Calendar", icon: CalendarDays, badge: "owed" },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
      { to: "/leads", label: "Leads", icon: UserSearch },
      {
        to: "/proposals",
        label: "Proposals",
        icon: FileText,
        badge: "proposals",
      },
      {
        to: "/followups",
        label: "Follow-ups",
        icon: MessageSquareText,
        badge: "followups",
      },
      { to: "/eod", label: "End of day", icon: ClipboardCheck },
    ],
  },
  {
    label: "How it is going",
    items: [
      { to: "/numbers", label: "Numbers", icon: ChartNoAxesColumn },
      { to: "/goals", label: "Goals", icon: Target },
      { to: "/recordings", label: "Recordings", icon: Mic },
      { to: "/intelligence", label: "Intelligence", icon: Lightbulb },
    ],
  },
  {
    label: "More",
    items: [
      { to: "/links", label: "Links", icon: Link2 },
      { to: "/team", label: "Team", icon: UserCog, managerOnly: true },
    ],
  },
];

/** One row of the rail: 40px to a thumb in the menu sheet, 32px on the rail. */
const ROW =
  "flex items-center gap-2.5 rounded-[var(--radius-md)] py-2.5 pr-2 pl-3 text-sm transition-colors lg:py-1.5";
const ROW_IDLE =
  "muted hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]";
const GROUP_LABEL =
  "muted mb-1 px-3 font-mono text-[11px] tracking-[0.08em] uppercase";

function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") return stored === "dark";
    } catch {
      // A private window forbids this; fall through to the default.
    }
    // Dark unless someone chose light: the brand's web default.
    return true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // The tool still works, it just forgets.
    }
  }, [dark]);

  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setDark(d => !d)}
      className={`${ROW} w-full ${ROW_IDLE}`}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

function Badge({ n, tone }: { n: number; tone?: "urgent" }) {
  return (
    <span
      className="ml-auto rounded-full px-1.5 text-xs font-semibold tabular-nums"
      style={
        tone === "urgent"
          ? // Calls owed a mark: the warning colour, as on the phone's tab bar.
            { background: "var(--owed)", color: "var(--warning-foreground)" }
          : {
              background:
                "color-mix(in oklch, var(--primary) 22%, transparent)",
              color: "var(--primary)",
            }
      }
    >
      {n}
    </span>
  );
}

export default function Sidebar({
  name,
  role,
  isAdmin,
  isManager,
  counts,
  onNavigate,
}: {
  name: string;
  role: string;
  isAdmin: boolean;
  isManager: boolean;
  counts: Record<string, number>;
  onNavigate?: () => void;
}) {
  const { cockpits, signOut } = useWho();
  // Team meetings are everybody's, so they sit with the doors at the foot.
  const doors = [
    { key: "team", label: "Team meetings", href: `${portalUrl()}/team` },
    ...otherCockpits(cockpits, isAdmin),
  ];

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
      <a href={`${portalUrl()}/`} className="px-3">
        <Wordmark size="md" />
      </a>

      <nav className="flex flex-col gap-6" aria-label="Sales cockpit">
        {GROUPS.map(g => ({
          ...g,
          items: g.items.filter(i => !i.managerOnly || isManager),
        }))
          .filter(g => g.items.length)
          .map(g => (
            <div key={g.label}>
              <p className={GROUP_LABEL}>{g.label}</p>
              <ul className="space-y-0.5">
                {g.items.map(({ to, label, icon: Icon, badge }) => {
                  const n = badge ? (counts[badge] ?? 0) : 0;
                  return (
                    <li key={to}>
                      <NavLink
                        to={to}
                        end={to === "/"}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `cockpit-nav-link ${ROW} ${
                            isActive ? "font-medium" : ROW_IDLE
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive ? (
                              <span aria-hidden className="cockpit-nav-lamp" />
                            ) : null}
                            <Icon
                              className="size-4 shrink-0"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                            <span className="truncate">{label}</span>
                            {n > 0 ? (
                              <Badge
                                n={n}
                                tone={badge === "owed" ? "urgent" : undefined}
                              />
                            ) : null}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
      </nav>

      <div className="mt-auto space-y-4">
        <ul className="space-y-0.5 border-t hairline pt-3" aria-label="Portal">
          {doors.map(d => {
            const Icon = COCKPIT_ICON[d.key];
            return (
              <li key={d.key}>
                <a href={d.href} className={`${ROW} ${ROW_IDLE}`}>
                  {Icon ? (
                    <Icon
                      className="size-4 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  ) : null}
                  <span className="truncate">{d.label}</span>
                </a>
              </li>
            );
          })}
        </ul>

        <div className="border-t hairline pt-3">
          <div className="px-3">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="muted truncate text-xs">{role}</p>
          </div>
          <div className="mt-2 space-y-0.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={signOut}
              className={`${ROW} w-full ${ROW_IDLE}`}
            >
              <LogOut
                className="size-4 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
