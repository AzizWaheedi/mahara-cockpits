import {
  ArrowRightLeft,
  Bookmark,
  CalendarDays,
  Clapperboard,
  Film,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  MoonStar,
  Send,
  ShieldCheck,
  Trophy,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { useWho } from "../lib/auth";
import { otherCockpits, portalUrl } from "../lib/portal";
import { Wordmark } from "./Wordmark";

/**
 * The same shape as the other three cockpits: an icon and a label per row,
 * grouped down the left, the portal's other doors underneath, the person at
 * the bottom.
 *
 * The shared sections keep the names they have elsewhere. "Ideation" and
 * "What works" are literally the same rows the creative director sees, so
 * calling them something else here would make switching cockpits feel like
 * two products.
 *
 * A count beside a row is only drawn when it is something to act on: jobs
 * ready to start, meetings you have not opened. A badge that is always there
 * stops being read.
 */
interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  /** The key in `counts` whose number, when above zero, is worth a badge. */
  badge?: string;
}

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Your day",
    items: [
      { to: "/", label: "Jobs", icon: ListChecks, badge: "ready" },
      { to: "/pipeline", label: "Pipeline", icon: Clapperboard },
      { to: "/send-review", label: "Send for review", icon: Send },
      {
        to: "/meetings",
        label: "Meetings",
        icon: CalendarDays,
        badge: "meetings",
      },
      { to: "/eod", label: "End of day", icon: MoonStar, badge: "eod" },
    ],
  },
  {
    label: "The work",
    items: [{ to: "/videos", label: "Footage", icon: Film }],
  },
  {
    label: "Library",
    items: [
      { to: "/ideas", label: "Ideation", icon: Lightbulb },
      { to: "/swipe", label: "Swipe file", icon: Bookmark },
      { to: "/winners", label: "What works", icon: Trophy },
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
  isAdmin,
  counts,
  onNavigate,
}: {
  name: string;
  isAdmin: boolean;
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
        {GROUPS.map(g => (
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
                              tone={badge === "eod" ? "urgent" : undefined}
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
