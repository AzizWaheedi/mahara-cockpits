import {
  CalendarDays,
  Film,
  Library,
  ListChecks,
  type LucideIcon,
  Search,
  Send,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useWho } from "../lib/auth";
import { COCKPIT_ICON } from "../lib/cockpits";
import { otherCockpits, portalUrl } from "../lib/portal";
import { openSearch } from "../lib/search";
import { Wordmark } from "./Wordmark";

/**
 * The same shape as the other cockpits: an icon and a label per row, the
 * desk's own screens first, then Team meetings and the other cockpits at
 * the foot of the rail, the person at the bottom.
 *
 * The shared sections keep the names they have elsewhere. "Ideation" and
 * "What works" are literally the same rows the creative director sees, so
 * calling them something else here would make switching cockpits feel like
 * two products.
 *
 * A mark beside a row is only drawn when it is something to act on: jobs
 * ready to start, and a dot until today's end of day is filed. A badge that
 * is always there stops being read.
 */
interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  /** The key in `counts` whose number, when above zero, is worth a mark. */
  badge?: "ready" | "eod";
  /** Other addresses that are part of this place, so it stays lit there. */
  also?: RegExp;
}

/**
 * Five places (the simplification audit, approved by Aziz on 2026-10-06):
 * Jobs is home and a job's page is part of it (the board is its second
 * view, End of day a button on it); the three library pages are one
 * Library with tabs; Meetings is one place, with the team schedule linked
 * from it.
 */
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Your desk",
    items: [
      {
        to: "/",
        label: "Jobs",
        icon: ListChecks,
        badge: "ready",
        also: /^\/(job\/|eod$)/,
      },
      { to: "/videos", label: "Footage", icon: Film },
      { to: "/send-review", label: "Send for review", icon: Send },
      {
        to: "/winners",
        label: "Library",
        icon: Library,
        also: /^\/(ideas|swipe)$/,
      },
      { to: "/meetings", label: "Meetings", icon: CalendarDays },
    ],
  },
];

const ROW =
  "flex items-center gap-2.5 py-2 pr-2 pl-3 text-sm transition-colors";

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
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      {dark ? "Light" : "Dark"}
    </button>
  );
}

function Mark({ kind, n }: { kind: "ready" | "eod"; n: number }) {
  if (n <= 0) return null;
  // Not a count: a nudge that today's end of day is still to file.
  if (kind === "eod")
    return (
      <span
        role="img"
        aria-label="Not filed yet today"
        className="ml-auto size-1.5 shrink-0 rounded-full"
        style={{ background: "var(--warning)" }}
      />
    );
  return (
    <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-xs font-medium tabular-nums text-primary">
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
  const { pathname } = useLocation();
  // The other cockpits. The team's schedule opens from Meetings, so the
  // sidebar has one Meetings, not two.
  const foot = otherCockpits(cockpits, isAdmin);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
      <a href={`${portalUrl()}/`} className="self-start px-2">
        <Wordmark size="md" />
      </a>

      {/* The search box opens from here, or with Ctrl/Cmd + K anywhere. */}
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          openSearch();
        }}
        className="flex h-10 w-full items-center gap-2 rounded-lg border bg-background/60 px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search…</span>
        <kbd className="hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] lg:inline">
          {typeof navigator !== "undefined" &&
          /Mac|iPhone|iPad/.test(navigator.platform ?? "")
            ? "⌘K"
            : "Ctrl K"}
        </kbd>
      </button>

      <nav className="flex flex-col gap-5">
        {GROUPS.map(g => (
          <div key={g.label}>
            <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon, badge, also }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `cockpit-nav-link ${ROW} ${
                        isActive || also?.test(pathname)
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`
                    }
                  >
                    {({ isActive: exact }) => {
                      const isActive = exact || Boolean(also?.test(pathname));
                      return (
                        <>
                          {isActive ? (
                            <span aria-hidden className="cockpit-nav-lamp" />
                          ) : null}
                          <Icon
                            className="size-4 shrink-0"
                            strokeWidth={1.75}
                          />
                          <span className="truncate">{label}</span>
                          {badge ? (
                            <Mark kind={badge} n={counts[badge] ?? 0} />
                          ) : null}
                        </>
                      );
                    }}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <ul className="space-y-0.5 border-t pt-3">
          {foot.map(d => {
            const Icon = COCKPIT_ICON[d.key];
            return (
              <li key={d.key}>
                <a
                  href={d.href}
                  className={`${ROW} rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground`}
                >
                  {Icon ? (
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                  ) : null}
                  <span className="truncate">{d.label}</span>
                </a>
              </li>
            );
          })}
        </ul>

        <div className="border-t px-2 pt-3">
          <p className="truncate text-sm font-medium">{name}</p>
          <div className="mt-1 flex items-center gap-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={signOut}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
