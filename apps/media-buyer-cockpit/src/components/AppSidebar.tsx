import { motion } from "framer-motion";
import {
  Library,
  LogOut,
  Megaphone,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Sun,
  Sunrise,
  X,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { STATUS_COLOR } from "@/components/ceo/StatusChip";
import { useCeo } from "@/components/ceo/useCeo";
import { Wordmark } from "@/components/Wordmark";
import { useTheme } from "@/contexts/ThemeContext";
import { COCKPIT_ICON, COCKPIT_SOP } from "@/lib/cockpits";
import { openSearch } from "@/lib/search";
import { ceoBadges } from "@/pages/CeoPage";
import { CEO_NAV } from "@/pages/ceo/nav";
import type { CeoTabKey } from "@/pages/ceo/types";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar";

// Each nav item belongs to exactly one cockpit; nobody sees another role's screens.
// Three places for the media buyer (the simplification audit, approved by Aziz
// on 2026-10-06): Today holds the start of day, the tasks, the touchpoints and
// the change log; Ads holds the board and each client's page; Library holds
// What works, Ideation and the swipe file as tabs. End of day opens from Today.
const navItems = [
  {
    href: "/dashboard",
    label: "Today",
    icon: Sunrise,
    role: "media_buyer",
    also: ["/eod"],
  },
  {
    href: "/ads",
    label: "Ads",
    icon: Megaphone,
    role: "media_buyer",
    also: [] as string[],
  },
  {
    href: "/playbook",
    label: "Library",
    icon: Library,
    role: "media_buyer",
    also: ["/ideation", "/swipe"],
  },
];

/** Rows are 28px in the CEO rail on a laptop, so seventeen of them fit; the sheet below 1024px keeps the full 40px for thumbs. */
const DENSE = "cockpit-nav-link lg:h-7";

/** The cockpit's SOP: a row like the others, opening ClickUp in a new tab. */
function SopLink({ href }: { href: string }) {
  const { setOpenMobile } = useSidebar();
  const Icon = COCKPIT_ICON.sop;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip="How to use this cockpit"
        className="cockpit-nav-link"
      >
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={() => setOpenMobile(false)}
        >
          <Icon />
          <span>How to use this cockpit</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  isActive,
  dense = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  dense?: boolean;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={label}
        className={dense ? DENSE : "cockpit-nav-link"}
      >
        <Link
          to={href}
          aria-current={isActive ? "page" : undefined}
          onClick={() => setOpenMobile(false)}
        >
          {isActive && (
            <motion.span
              layoutId="cockpit-nav-lamp"
              className="cockpit-nav-lamp"
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
            />
          )}
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Inside the CEO cockpit the rail is the cockpit's own sections, grouped by
 * the shape of the business, with the way out at the bottom. Nothing from
 * the media buyer's working screens shows here; being the CEO is a
 * different job from running ads.
 */
function CeoRail() {
  const [params] = useSearchParams();
  const active = (params.get("tab") ?? "today") as CeoTabKey;
  const auth = useCockpitAuth();
  const { sections } = useCeo(auth.isCeo);
  const badges = ceoBadges(sections);
  const { setOpenMobile } = useSidebar();
  // The way out: Admin and the media buyer's own cockpit. The other cockpits
  // are one click away in the user menu, so the rail stays short enough for
  // a laptop.
  const elsewhere = [
    {
      key: "team",
      label: "Team meetings",
      href: "/team",
      icon: COCKPIT_ICON.team,
    },
    ...(auth.isAdmin
      ? [
          {
            key: "admin",
            label: "Admin",
            href: "/admin",
            icon: COCKPIT_ICON.admin,
          },
        ]
      : []),
    ...(auth.roles.includes("media_buyer")
      ? [
          {
            key: "media_buyer",
            label: "Media buyer cockpit",
            href: "/dashboard",
            icon: COCKPIT_ICON.media_buyer,
          },
        ]
      : []),
  ];
  return (
    <SidebarContent className="gap-0">
      {CEO_NAV.map((group, gi) => (
        <SidebarGroup key={group.title ?? `g${gi}`} className="py-1 first:pt-2">
          {group.title ? (
            <SidebarGroupLabel className="h-7">{group.title}</SidebarGroupLabel>
          ) : null}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map(item => {
                const isActive = active === item.key;
                const badge = badges[item.key];
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className={DENSE}
                    >
                      <Link
                        to={
                          item.key === "today" ? "/ceo" : `/ceo?tab=${item.key}`
                        }
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="cockpit-nav-lamp"
                            className="cockpit-nav-lamp"
                            transition={{
                              type: "spring",
                              stiffness: 320,
                              damping: 30,
                            }}
                          />
                        )}
                        <item.icon />
                        <span>{item.label}</span>
                        {badge ? (
                          <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center gap-1 rounded-full bg-muted px-1.5 text-[11px] font-medium leading-none tabular-nums">
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full"
                              style={{
                                backgroundColor: STATUS_COLOR[badge.tone],
                              }}
                            />
                            {badge.count}
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
      {elsewhere.length ? (
        <SidebarGroup className="mt-auto border-t border-sidebar-border py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {elsewhere.map(c => (
                <NavLink
                  key={c.key}
                  href={c.href}
                  label={c.label}
                  icon={c.icon}
                  isActive={false}
                  dense
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </SidebarContent>
  );
}

function SidebarNav() {
  const location = useLocation();
  const auth = useCockpitAuth();
  const allowed = auth.roles;
  if (location.pathname.startsWith("/ceo") && auth.isCeo) return <CeoRail />;
  // Admin no longer drags the media buyer's working screens in with it. Being
  // an administrator is a job about people and access, not about running ads,
  // and mixing the two put "Start of day" above "CEO" for the one person who
  // holds both.
  const items = navItems.filter(item => allowed.includes(item.role));
  // Other cockpits this person may open, so switching is one click.
  const cockpits: string[] = auth.cockpits;
  const others = [
    { key: "csm", label: "Client success", href: "/go/csm" },
    { key: "creative", label: "Creative director", href: "/go/creative" },
    { key: "editor", label: "Editor desk", href: "/go/editor" },
    { key: "sales", label: "Sales", href: "/go/sales" },
  ].filter(c => cockpits.includes(c.key));

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {auth.isCeo ? (
              <NavLink
                href="/ceo"
                label="CEO"
                icon={COCKPIT_ICON.ceo}
                isActive={location.pathname.startsWith("/ceo")}
              />
            ) : null}
            {auth.isAdmin ? (
              <NavLink
                href="/admin"
                label="Admin"
                icon={COCKPIT_ICON.admin}
                isActive={location.pathname === "/admin"}
              />
            ) : null}
            {/* Everybody's: the team's meetings and their agendas. */}
            {auth.isAuthenticated ? (
              <NavLink
                href="/team"
                label="Team meetings"
                icon={COCKPIT_ICON.team}
                isActive={location.pathname.startsWith("/team")}
              />
            ) : null}
            {/* The media buyer's SOP, in ClickUp, in a new tab. */}
            {allowed.includes("media_buyer") ? (
              <SopLink href={COCKPIT_SOP.media_buyer} />
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {items.length ? (
        <SidebarGroup>
          <SidebarGroupLabel>Media buyer</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map(item => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  isActive={
                    location.pathname === item.href ||
                    item.also.includes(location.pathname)
                  }
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      {others.length ? (
        <SidebarGroup>
          <SidebarGroupLabel>Switch cockpit</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {others.map(c => (
                <NavLink
                  key={c.key}
                  href={c.href}
                  label={c.label}
                  icon={COCKPIT_ICON[c.key]}
                  isActive={false}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </SidebarContent>
  );
}

const OTHER_COCKPITS = [
  { key: "csm", label: "Client success", href: "/go/csm" },
  { key: "creative", label: "Creative director", href: "/go/creative" },
  { key: "editor", label: "Editor desk", href: "/go/editor" },
  { key: "sales", label: "Sales", href: "/go/sales" },
];

function SidebarUserMenu() {
  const auth = useCockpitAuth();
  const location = useLocation();
  const inCeo = location.pathname.startsWith("/ceo") && auth.isCeo;
  const cockpits: string[] = auth.cockpits;
  const switches = inCeo
    ? OTHER_COCKPITS.filter(c => cockpits.includes(c.key))
    : [];
  // The name the admin typed in the portal, else the email's first part.
  const shownName = auth.name || auth.email?.split("@")[0] || "User";
  const { theme, toggleTheme, switchable } = useTheme();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarFooter className="border-t border-sidebar-border">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                    {shownName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-left">
                  <span className="text-sm font-medium truncate">
                    {shownName}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {auth.email}
                  </span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="w-(--radix-dropdown-menu-trigger-width)"
            >
              {switches.map(c => (
                <DropdownMenuItem key={c.key} asChild>
                  <Link to={c.href} onClick={() => setOpenMobile(false)}>
                    {(() => {
                      const Icon = COCKPIT_ICON[c.key];
                      return <Icon className="size-4" />;
                    })()}
                    {c.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              {switches.length ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem asChild>
                <Link to="/settings" onClick={() => setOpenMobile(false)}>
                  <Settings className="size-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              {switchable && (
                <DropdownMenuItem onClick={toggleTheme}>
                  {theme === "light" ? (
                    <Moon className="size-4" />
                  ) : (
                    <Sun className="size-4" />
                  )}
                  {theme === "light" ? "Dark mode" : "Light mode"}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void auth.signOut();
                }}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}

function SidebarHeaderContent() {
  const { setOpenMobile, open, isMobile, toggleSidebar } = useSidebar();

  return (
    <SidebarHeader className="border-b border-sidebar-border flex-row items-center justify-between">
      {(open || isMobile) && (
        <Link
          to="/"
          onClick={() => setOpenMobile(false)}
          className="flex items-center px-2 py-2"
        >
          <Wordmark size="sm" />
        </Link>
      )}
      {/* In the sheet below 1024px this closes the menu, so it reads as a
          close button; on the laptop rail it folds the rail. */}
      {isMobile ? (
        <button
          type="button"
          onClick={() => setOpenMobile(false)}
          className="flex size-10 items-center justify-center rounded-lg border hover:bg-sidebar-accent"
          aria-label="Close menu"
        >
          <X size={18} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-lg border p-2 hover:bg-sidebar-accent"
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={open}
        >
          {open ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>
      )}
    </SidebarHeader>
  );
}

/**
 * The search field at the top of the rail: it opens the search box, which
 * also opens with Ctrl/Cmd + K or "/" from any page. A folded rail keeps the
 * icon. The CEO rail keeps every row it has; the keys still work there.
 */
function SearchField() {
  const { setOpenMobile, open, isMobile } = useSidebar();
  const location = useLocation();
  if (location.pathname.startsWith("/ceo")) return null;
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  const click = () => {
    setOpenMobile(false);
    openSearch();
  };
  if (!open && !isMobile)
    return (
      <div className="flex justify-center px-2 pt-2">
        <button
          type="button"
          onClick={click}
          aria-label="Search"
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Search aria-hidden className="size-4" />
        </button>
      </div>
    );
  return (
    <div className="px-2 pt-2">
      <button
        type="button"
        onClick={click}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search…</span>
        <kbd className="hidden shrink-0 rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] lg:inline">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
    </div>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeaderContent />
      <SearchField />
      <SidebarNav />
      <SidebarUserMenu />
    </Sidebar>
  );
}
