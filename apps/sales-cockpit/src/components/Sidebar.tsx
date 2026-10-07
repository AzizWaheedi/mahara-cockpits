import {
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
} from "lucide-react";
import { NavLink } from "react-router";
import { useWho } from "../lib/auth";
import { COCKPIT_ICON, COCKPIT_SOP } from "../lib/cockpits";
import { GROUP_LABELS, PAGES, type Page } from "../lib/pages";
import { otherCockpits, portalUrl } from "../lib/portal";
import { openSearch } from "../lib/search";
import { useDark } from "../lib/theme";
import { Avatar } from "./kit";
import { Wordmark } from "./Wordmark";

/**
 * The same shape as the other cockpits: an icon and a label per row, in
 * three groups down the left; team meetings and the portal's other doors at
 * the foot, each with its cockpit's own mark; the person at the bottom.
 * Each page's name comes from lib/pages.ts, the one list the menu bar and
 * the phone's dock read too.
 *
 * A count beside a row is only drawn when it is something to act on: calls
 * owed a mark, proposals waiting on figures. A badge that is always there
 * stops being read.
 */
const GROUPS = (["day", "going", "more"] as Page["group"][]).map(group => ({
  label: GROUP_LABELS[group],
  items: PAGES.filter(p => p.group === group),
}));

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
}: {
  compact?: boolean;
  iconOnly?: boolean;
} = {}) {
  const [dark, toggle] = useDark();
  const Icon = dark ? Sun : Moon;
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="flex size-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
      >
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }
  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
      >
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span>{dark ? "Light" : "Dark"}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className={`${ROW} w-full ${ROW_IDLE}`}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

/**
 * The search field at the top of the rail: it opens the search box, which
 * also opens with Ctrl/Cmd + K from any page. Folded, it is one icon.
 */
function SearchField({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  const click = () => {
    onNavigate?.();
    openSearch();
  };
  if (collapsed)
    return (
      <button
        type="button"
        onClick={click}
        aria-label="Search"
        title={`Search (${mac ? "⌘K" : "Ctrl K"})`}
        className="flex size-9 items-center justify-center rounded-[12px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
      >
        <Search className="size-4" strokeWidth={1.8} aria-hidden />
      </button>
    );
  return (
    <button
      type="button"
      onClick={click}
      className="flex h-9 w-full items-center gap-2 rounded-[12px] border border-border bg-foreground/[0.03] px-3 text-left text-sm text-muted-foreground transition-colors hover:border-[color:var(--primary)]/40 hover:text-foreground"
    >
      <Search className="size-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search leads…</span>
      <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] lg:inline">
        {mac ? "⌘K" : "Ctrl K"}
      </kbd>
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
  // The sales SOP (ClickUp, a new tab), then team meetings (everybody's),
  // then the doors.
  const doors: {
    key: string;
    label: string;
    href: string;
    newTab?: boolean;
  }[] = [
    {
      key: "sop",
      label: "How to use this cockpit",
      href: COCKPIT_SOP.sales,
      newTab: true,
    },
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
              className="flex size-8 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
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
              className="flex size-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
            >
              <PanelLeftClose className="size-4" />
            </button>
          ) : null}
        </div>
      )}

      <SearchField collapsed={collapsed} onNavigate={onNavigate} />

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
                                  ? "border border-border bg-primary/15 text-foreground shadow-[0_0_12px_rgba(0,207,200,0.3)]"
                                  : "text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
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
                  {...(d.newTab ? { target: "_blank", rel: "noreferrer" } : {})}
                  className={
                    collapsed
                      ? "group relative flex items-center justify-center rounded-[12px] p-2 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-all"
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
          <div className="flex flex-col items-center gap-2 border-t border-border pt-2">
            <div title={`${name} · ${role}`}>
              <Avatar name={name} size={30} />
            </div>
            <ThemeToggle iconOnly />
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              className="flex size-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
            >
              <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="rounded-[20px] border border-border bg-foreground/[0.03] p-2.5 shadow-sm">
            <div className="flex items-center gap-2.5 px-1 py-0.5">
              <Avatar name={name} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold tracking-tight text-foreground">
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
            <div className="mt-2 flex items-center justify-between gap-1 border-t border-border pt-2">
              <div className="flex-1">
                <ThemeToggle compact />
              </div>
              <button
                type="button"
                onClick={signOut}
                title="Sign out"
                className="flex size-7 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
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
