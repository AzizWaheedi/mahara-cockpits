import {
  CalendarDays,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileSignature,
  FileText,
  KanbanSquare,
  Lightbulb,
  Link2,
  LogOut,
  type LucideIcon,
  MessageSquareText,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
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
import { Avatar } from "./kit";
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
      { to: "/contracts", label: "Contracts", icon: FileSignature },
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
  "flex items-center gap-2.5 rounded-[12px] py-2 pr-2.5 pl-3 text-sm transition-all lg:py-1.5";
const ROW_IDLE =
  "muted hover:bg-white/[0.05] hover:text-[color:var(--foreground)]";
const GROUP_LABEL =
  "muted mb-1 px-3 font-mono text-[11px] tracking-[0.08em] uppercase";

function ThemeToggle({
  compact,
  iconOnly,
}: { compact?: boolean; iconOnly?: boolean } = {}) {
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
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => setDark((d: boolean) => !d)}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="flex size-7 items-center justify-center rounded-[8px] text-white/60 hover:bg-white/[0.08] hover:text-white transition-colors"
      >
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setDark((d: boolean) => !d)}
        className="flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-xs text-white/70 hover:bg-white/[0.08] hover:text-white transition-colors"
      >
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span>{dark ? "Light" : "Dark"}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setDark((d: boolean) => !d)}
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
  collapsed = false,
  onToggleCollapse,
}: {
  name: string;
  role: string;
  isAdmin: boolean;
  isManager: boolean;
  counts: Record<string, number>;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { cockpits, signOut } = useWho();
  // Team meetings are everybody's, so they sit with the doors at the foot.
  const doors = [
    { key: "team", label: "Team meetings", href: `${portalUrl()}/team` },
    ...otherCockpits(cockpits, isAdmin),
  ];

  return (
    <div
      className={`flex h-full flex-col gap-5 overflow-y-auto transition-all ${
        collapsed ? "items-center px-2 py-3" : "px-3 py-4"
      }`}
    >
      {/* Header section with brand and collapse toggle */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2">
          {onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Expand sidebar (Ctrl+B)"
              className="flex size-8 items-center justify-center rounded-[8px] text-white/60 hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          ) : null}
          <a
            href={`${portalUrl()}/`}
            title="Mahara Home"
            className="flex size-8 items-center justify-center rounded-[10px] bg-teal-500/10 font-bold text-xs text-teal-400 border border-teal-500/25"
          >
            M
          </a>
        </div>
      ) : (
        <div className="flex items-center justify-between px-2">
          <a href={`${portalUrl()}/`} className="px-1">
            <Wordmark size="md" />
          </a>
          {onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Collapse sidebar (Ctrl+B)"
              className="flex size-7 items-center justify-center rounded-[8px] text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <PanelLeftClose className="size-4" />
            </button>
          ) : null}
        </div>
      )}

      <nav className="flex w-full flex-col gap-5" aria-label="Sales cockpit">
        {GROUPS.map(g => ({
          ...g,
          items: g.items.filter(i => !i.managerOnly || isManager),
        }))
          .filter(g => g.items.length)
          .map(g => (
            <div key={g.label} className="w-full">
              {!collapsed ? <p className={GROUP_LABEL}>{g.label}</p> : null}
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
                          collapsed
                            ? `group relative flex items-center justify-center rounded-[12px] p-2.5 transition-all ${
                                isActive
                                  ? "border border-teal-500/40 bg-teal-500/15 text-teal-300 shadow-[0_0_12px_rgba(0,207,200,0.3)]"
                                  : "text-white/70 hover:bg-white/[0.08] hover:text-white"
                              }`
                            : `group cockpit-nav-link ${ROW} ${
                                isActive ? "font-medium" : ROW_IDLE
                              }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {!collapsed && isActive ? (
                              <span aria-hidden className="cockpit-nav-lamp" />
                            ) : null}
                            <div className="flex items-center justify-center transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-125 group-active:scale-95">
                              <Icon
                                className="size-4 shrink-0"
                                strokeWidth={1.8}
                                aria-hidden
                              />
                            </div>
                            {!collapsed ? (
                              <>
                                <span className="truncate">{label}</span>
                                {n > 0 ? (
                                  <Badge
                                    n={n}
                                    tone={
                                      badge === "owed" ? "urgent" : undefined
                                    }
                                  />
                                ) : null}
                              </>
                            ) : n > 0 ? (
                              <span
                                className="absolute top-1.5 right-1.5 size-2 rounded-full shadow-[0_0_6px_var(--primary)]"
                                style={{
                                  background:
                                    badge === "owed"
                                      ? "var(--owed)"
                                      : "var(--primary)",
                                }}
                              />
                            ) : null}
                            {/* macOS Floating Tooltip on Hover in Collapsed Mode */}
                            {collapsed ? (
                              <div className="pointer-events-none absolute left-full ml-3 z-50 hidden group-hover:flex items-center whitespace-nowrap rounded-lg border border-white/15 bg-[#091333]/95 px-2.5 py-1 text-xs font-semibold text-white shadow-2xl backdrop-blur-xl">
                                <span>{label}</span>
                                {n > 0 ? (
                                  <span
                                    className="ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] font-bold text-black"
                                    style={{
                                      background:
                                        badge === "owed"
                                          ? "var(--owed)"
                                          : "var(--primary)",
                                    }}
                                  >
                                    {n}
                                  </span>
                                ) : null}
                              </div>
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

      <div className="mt-auto w-full space-y-3">
        <ul className="space-y-0.5 border-t hairline pt-3" aria-label="Portal">
          {doors.map(d => {
            const Icon = COCKPIT_ICON[d.key];
            return (
              <li key={d.key}>
                <a
                  href={d.href}
                  className={
                    collapsed
                      ? "group relative flex items-center justify-center rounded-[12px] p-2 text-white/60 hover:bg-white/[0.08] hover:text-white transition-all"
                      : `group ${ROW} ${ROW_IDLE}`
                  }
                >
                  {Icon ? (
                    <div className="flex items-center justify-center transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-125 group-active:scale-95">
                      <Icon
                        className="size-4 shrink-0"
                        strokeWidth={1.8}
                        aria-hidden
                      />
                    </div>
                  ) : null}
                  {!collapsed ? (
                    <span className="truncate">{d.label}</span>
                  ) : (
                    <div className="pointer-events-none absolute left-full ml-3 z-50 hidden group-hover:flex items-center whitespace-nowrap rounded-lg border border-white/15 bg-[#091333]/95 px-2.5 py-1 text-xs font-semibold text-white shadow-2xl backdrop-blur-xl">
                      <span>{d.label}</span>
                    </div>
                  )}
                </a>
              </li>
            );
          })}
        </ul>

        {collapsed ? (
          <div className="flex flex-col items-center gap-2 border-t border-white/5 pt-2">
            <div title={`${name} · ${role}`}>
              <Avatar name={name} size={30} />
            </div>
            <ThemeToggle iconOnly />
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              className="flex size-7 items-center justify-center rounded-[8px] text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-2.5 shadow-sm">
            <div className="flex items-center gap-2.5 px-1 py-0.5">
              <Avatar name={name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold tracking-tight text-white/95">
                  {name}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-[color:var(--primary)] shadow-[0_0_6px_var(--primary)]" />
                  <p className="muted truncate text-[11px] leading-none">
                    {role}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-1 border-t border-white/5 pt-2">
              <div className="flex-1">
                <ThemeToggle compact />
              </div>
              <button
                type="button"
                onClick={signOut}
                title="Sign out"
                className="flex size-7 items-center justify-center rounded-[10px] text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
              >
                <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
