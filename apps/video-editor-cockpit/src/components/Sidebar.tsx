import {
  CalendarDays,
  Film,
  LayoutGrid,
  Library,
  ListChecks,
  LogOut,
  type LucideIcon,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  Send,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useWho } from "../lib/auth";
import { COCKPIT_ICON } from "../lib/cockpits";
import { otherCockpits, portalUrl } from "../lib/portal";
import { openSearch } from "../lib/search";
import { Wordmark } from "./Wordmark";

/**
 * The same rail as the client success and media buyer cockpits: a floating
 * card that folds to its icons (the button at the top, or Ctrl/Cmd + B), the
 * desk's own places first, then the guide, Team meetings, Client
 * performance and the other cockpits at the foot, the person at the bottom.
 * Below 1024px it is a full-width sheet with a Close menu button.
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
 * Library with tabs; Meetings is the desk's own recordings. The team's
 * meetings, their agendas and the shared doc are the portal's Team meetings,
 * at the foot of the rail (Aziz, 2026-10-17).
 */
const PLACES: Item[] = [
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
];

/** 40px rows for a thumb in the sheet, the compact 32px on the laptop rail. */
function row(folded: boolean): string {
  return folded
    ? "cockpit-nav-link mx-auto flex size-10 items-center justify-center lg:size-8"
    : "cockpit-nav-link flex h-10 w-full items-center gap-2 px-2 text-sm lg:h-8";
}

function useDark(): [boolean, () => void] {
  // index.html sets the class before the first paint (dark unless someone
  // chose light); this only reads it. No document when rendered in a test.
  const [dark, setDark] = useState(
    () =>
      typeof document === "undefined" ||
      document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // A private window forbids this; the desk still works, it just forgets.
    }
  }, [dark]);
  return [dark, () => setDark(d => !d)];
}

function Mark({
  kind,
  n,
  folded,
}: {
  kind: "ready" | "eod";
  n: number;
  folded: boolean;
}) {
  if (n <= 0) return null;
  // Not a count: a nudge that today's end of day is still to file. Folded,
  // a count shrinks to the same dot so the row keeps its icon.
  if (kind === "eod" || folded)
    return (
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${folded ? "absolute top-1.5 right-1.5" : "ml-auto"}`}
        style={{
          background: kind === "eod" ? "var(--warning)" : "var(--primary)",
        }}
      />
    );
  return (
    <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-xs font-medium tabular-nums text-primary">
      {n}
    </span>
  );
}

/**
 * The foot of the rail: the desk's guide first, then Team meetings, Ask a
 * team and the Client Performance board (the portal's, everybody's), then
 * the other cockpits this person may open.
 */
export function footLinks(
  cockpits: string[],
  isAdmin: boolean,
): { key: string; label: string; href: string; inApp?: boolean }[] {
  return [
    {
      key: "sop",
      label: "How to use this desk",
      href: "/guide",
      inApp: true,
    },
    { key: "team", label: "Team meetings", href: `${portalUrl()}/team` },
    // Ask another team: the portal's Requests page (2026-10-26).
    { key: "requests", label: "Ask a team", href: `${portalUrl()}/requests` },
    {
      key: "performance",
      label: "Client performance",
      href: `${portalUrl()}/performance`,
    },
    ...otherCockpits(cockpits, isAdmin),
  ];
}

/** The person at the foot of the rail, and their menu: theme, the portal,
 * sign out (the CSM rail's account menu, without a library). */
function Account({
  name,
  email,
  folded,
}: {
  name: string;
  email: string;
  folded: boolean;
}) {
  const { signOut } = useWho();
  const [dark, toggleDark] = useDark();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = name || email.split("@")[0] || "You";

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const item =
    "flex h-10 w-full items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted lg:h-9";
  return (
    <div ref={box} className="relative border-t p-2">
      {open ? (
        <div
          role="menu"
          className="absolute right-2 bottom-full left-2 z-30 mb-2 min-w-48 rounded-xl border bg-card p-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={toggleDark}
            className={item}
          >
            {dark ? (
              <Sun aria-hidden className="size-4" />
            ) : (
              <Moon aria-hidden className="size-4" />
            )}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <a role="menuitem" href={`${portalUrl()}/`} className={item}>
            <LayoutGrid aria-hidden className="size-4" />
            Mahara portal
          </a>
          <div className="my-1 border-t" />
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className={`${item} txt-bad`}
          >
            <LogOut aria-hidden className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={folded ? shown : undefined}
        onClick={() => setOpen(o => !o)}
        className={`flex w-full items-center gap-2 rounded-lg text-left hover:bg-muted ${
          folded ? "justify-center p-1" : "h-12 px-2"
        }`}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
          {shown.charAt(0).toUpperCase()}
        </span>
        {folded ? null : (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{shown}</span>
            <span className="truncate text-xs text-muted-foreground">
              {email}
            </span>
          </span>
        )}
      </button>
    </div>
  );
}

export default function Sidebar({
  name,
  isAdmin,
  counts,
  folded = false,
  onToggleFold,
  onNavigate,
  onClose,
}: {
  name: string;
  isAdmin: boolean;
  counts: Record<string, number>;
  /** The laptop rail folded to its icons. */
  folded?: boolean;
  onToggleFold?: () => void;
  onNavigate?: () => void;
  /** Present in the phone and tablet sheet, which closes instead of folding. */
  onClose?: () => void;
}) {
  const { cockpits, email } = useWho();
  const { pathname } = useLocation();
  const foot = footLinks(cockpits, isAdmin);
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? "");

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex items-center gap-2 border-b p-2 ${folded ? "justify-center" : "justify-between"}`}
      >
        {/* The logo opens the day. A folded rail keeps only the button that
            unfolds it. */}
        {folded ? null : (
          <Link to="/" onClick={onNavigate} className="px-2 py-2">
            <Wordmark size="sm" />
          </Link>
        )}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid size-10 place-items-center rounded-lg border hover:bg-muted"
          >
            <X aria-hidden className="size-[18px]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleFold}
            aria-label={folded ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!folded}
            title={`${folded ? "Expand" : "Collapse"} (${mac ? "⌘" : "Ctrl"} B)`}
            className="rounded-lg border p-2 hover:bg-muted"
          >
            {folded ? (
              <PanelLeft aria-hidden size={16} />
            ) : (
              <PanelLeftClose aria-hidden size={16} />
            )}
          </button>
        )}
      </div>

      {/* The search box opens from here, or with Ctrl/Cmd + K anywhere. A
          folded rail keeps the icon. */}
      <div className={`px-2 pt-2 ${folded ? "flex justify-center" : ""}`}>
        {folded ? (
          <button
            type="button"
            onClick={openSearch}
            aria-label="Search jobs, footage and the library"
            title="Search"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Search aria-hidden className="size-4" />
          </button>
        ) : (
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
              {mac ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
        )}
      </div>

      <nav aria-label="The desk" className="min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {PLACES.map(({ to, label, icon: Icon, badge, also }) => (
            <li key={to} className="relative">
              <NavLink
                to={to}
                end={to === "/"}
                onClick={onNavigate}
                title={folded ? label : undefined}
                aria-label={folded ? label : undefined}
                className={({ isActive }) =>
                  `${row(folded)} ${
                    isActive || also?.test(pathname)
                      ? "font-medium text-foreground"
                      : "rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
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
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                      {folded ? null : (
                        <span className="truncate">{label}</span>
                      )}
                      {badge ? (
                        <Mark
                          kind={badge}
                          n={counts[badge] ?? 0}
                          folded={folded}
                        />
                      ) : null}
                    </>
                  );
                }}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <ul className="space-y-0.5 border-t p-2">
        {foot.map(d => {
          const Icon = COCKPIT_ICON[d.key];
          const inner = (
            <>
              {Icon ? (
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              ) : null}
              {folded ? null : <span className="truncate">{d.label}</span>}
            </>
          );
          const look = `${row(folded)} rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground`;
          return (
            <li key={d.key}>
              {d.inApp ? (
                <Link
                  to={d.href}
                  onClick={onNavigate}
                  title={folded ? d.label : undefined}
                  aria-label={folded ? d.label : undefined}
                  className={look}
                >
                  {inner}
                </Link>
              ) : (
                <a
                  href={d.href}
                  title={folded ? d.label : undefined}
                  aria-label={folded ? d.label : undefined}
                  className={look}
                >
                  {inner}
                </a>
              )}
            </li>
          );
        })}
      </ul>

      <Account name={name} email={email} folded={folded} />
    </div>
  );
}
