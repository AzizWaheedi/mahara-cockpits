import {
  ArrowRightLeft,
  CalendarDays,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileText,
  Link2,
  type LucideIcon,
  MessageSquareText,
  Mic,
  PhoneCall,
  ShieldCheck,
  Sun,
  Target,
  UserSearch,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { useWho } from "../lib/auth";
import { otherCockpits, portalUrl } from "../lib/portal";
import { Wordmark } from "./Wordmark";

/**
 * The same shape as the other cockpits: an icon and a label per row, grouped
 * down the left, the portal's other doors underneath, the person at the
 * bottom.
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
    ],
  },
  {
    label: "Kit",
    items: [{ to: "/links", label: "Links", icon: Link2 }],
  },
  {
    label: "Manage",
    items: [
      { to: "/team", label: "Team", icon: UsersRound, managerOnly: true },
    ],
  },
];

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

  return (
    <button
      type="button"
      onClick={() => setDark(d => !d)}
      className="muted text-xs"
    >
      {dark ? "Light" : "Dark"}
    </button>
  );
}

function Badge({ n, tone }: { n: number; tone?: "urgent" }) {
  return (
    <span
      className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
      style={
        tone === "urgent"
          ? { background: "var(--destructive)", color: "#fff" }
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
  const doors = otherCockpits(cockpits, isAdmin);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
      <a href={`${portalUrl()}/`} className="px-2">
        <Wordmark size="md" />
      </a>

      <nav className="flex flex-col gap-5">
        {GROUPS.map(g => ({
          ...g,
          items: g.items.filter(i => !i.managerOnly || isManager),
        }))
          .filter(g => g.items.length)
          .map(g => (
            <div key={g.label}>
              <p className="muted mb-1 px-2 text-[10px] font-semibold tracking-[0.12em] uppercase">
                {g.label}
              </p>
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
                          `relative flex items-center gap-2.5 rounded-[var(--radius-md)] py-1.5 pr-2 pl-3 text-sm transition-colors ${
                            isActive
                              ? "bg-[color:var(--secondary)] font-medium"
                              : "muted hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive ? (
                              <span
                                aria-hidden
                                className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full"
                                style={{ background: "var(--primary)" }}
                              />
                            ) : null}
                            <Icon
                              className="size-4 shrink-0"
                              strokeWidth={1.75}
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

        <div>
          <p className="muted mb-1 px-2 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Team
          </p>
          <ul className="space-y-0.5">
            <li>
              <a
                href={`${portalUrl()}/team`}
                className="muted flex items-center gap-2.5 rounded-[var(--radius-md)] py-1.5 pr-2 pl-3 text-sm transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
              >
                <UsersRound className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="truncate">Team meetings</span>
              </a>
            </li>
          </ul>
        </div>

        {doors.length ? (
          <div>
            <p className="muted mb-1 px-2 text-[10px] font-semibold tracking-[0.12em] uppercase">
              Switch cockpit
            </p>
            <ul className="space-y-0.5">
              {doors.map(d => (
                <li key={d.key}>
                  <a
                    href={d.href}
                    className="muted flex items-center gap-2.5 rounded-[var(--radius-md)] py-1.5 pr-2 pl-3 text-sm transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
                  >
                    {d.key === "admin" ? (
                      <ShieldCheck
                        className="size-4 shrink-0"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <ArrowRightLeft
                        className="size-4 shrink-0"
                        strokeWidth={1.75}
                      />
                    )}
                    <span className="truncate">{d.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="mt-auto border-t hairline px-2 pt-3">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="muted truncate text-xs">{role}</p>
        <div className="mt-1 flex items-center gap-3">
          <ThemeToggle />
          <button type="button" onClick={signOut} className="muted text-xs">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
