import { motion } from "framer-motion";
import {
  Inbox,
  LayoutGrid,
  Link2,
  LogOut,
  Moon,
  Search,
  Settings,
  Sun,
  Sunrise,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Wordmark } from "@/components/Wordmark";
import { useTheme } from "@/contexts/ThemeContext";
import { COCKPIT_ICON, COCKPIT_SOP } from "@/lib/cockpits";
import { portalUrl } from "@/lib/portal";
import { openSearch } from "@/lib/search";
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar";

/**
 * Five places, in the order the day runs (the simplification audit, approved
 * by Aziz on 2026-10-06): Today for the day itself, Inbox for WhatsApp,
 * Clients for any one client, Money for billing, renewals, the hot list,
 * churn and pay, and Links for the SOPs and forms. Everything else is a tab
 * inside one of them or a step away in the search box.
 */
const navItems = [
  { href: "/dashboard", label: "Today", icon: Sunrise },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/links", label: "Links", icon: Link2 },
];

/** A place stays lit on its own pages too: a client's page is under Clients. */
function isActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  // End of day and the data fixes are Today's own pages.
  return (
    href === "/dashboard" && (pathname === "/eod" || pathname === "/backlog")
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={label}
        className="cockpit-nav-link"
      >
        <Link
          to={href}
          aria-current={isActive ? "page" : undefined}
          onClick={() => setOpenMobile(false)}
        >
          {/* The same teal lamp as the other cockpits' rails. */}
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

/** The portal's other doors: the admin view and the cockpits this person also has. */
function PortalGroup() {
  const auth = useCockpitAuth();
  const portal = portalUrl();
  const roles: string[] = auth.roles ?? [];
  const isAdmin = Boolean(auth.isAdmin);
  const doors = [
    { key: "admin", label: "Admin", href: `${portal}/admin`, show: isAdmin },
    {
      key: "media_buyer",
      label: "Media buyer",
      href: `${portal}/dashboard`,
      show: isAdmin || roles.includes("media_buyer"),
    },
    {
      key: "csm",
      label: "Client success",
      href: `${portal}/go/csm`,
      show: false,
    },
    {
      key: "creative",
      label: "Creative director",
      href: `${portal}/go/creative`,
      show: isAdmin || roles.includes("creative"),
    },
    {
      key: "editor",
      label: "Editor desk",
      href: `${portal}/go/editor`,
      show: isAdmin || roles.includes("editor"),
    },
    {
      key: "sales",
      label: "Sales",
      href: `${portal}/go/sales`,
      show: isAdmin || roles.includes("sales"),
    },
  ].filter(d => d.show);
  // This cockpit's SOP, then team meetings (everybody's), then the doors.
  const rows: { key: string; label: string; href: string; newTab?: boolean }[] =
    [
      {
        key: "sop",
        label: "How to use this cockpit",
        href: COCKPIT_SOP.csm,
        newTab: true,
      },
      { key: "team", label: "Team meetings", href: `${portal}/team` },
      ...doors,
    ];
  return (
    <SidebarGroup className="mt-auto border-t border-sidebar-border">
      <SidebarGroupContent>
        <SidebarMenu>
          {rows.map(d => (
            <SidebarMenuItem key={d.key}>
              <SidebarMenuButton asChild>
                <a
                  href={d.href}
                  {...(d.newTab ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  {(() => {
                    const Icon = COCKPIT_ICON[d.key];
                    return Icon ? <Icon className="size-4" /> : null;
                  })()}
                  <span>{d.label}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SidebarNav() {
  const location = useLocation();

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {navItems.map(item => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                isActive={isActive(location.pathname, item.href)}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <PortalGroup />
    </SidebarContent>
  );
}

/**
 * The search field at the top of the rail: it opens the search box, which
 * also opens with Ctrl/Cmd + K or "/" from any page.
 */
function SearchField() {
  const { setOpenMobile } = useSidebar();
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  return (
    <div className="px-2 pb-2">
      <button
        type="button"
        onClick={() => {
          setOpenMobile(false);
          openSearch();
        }}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search clients, links…</span>
        <kbd className="hidden shrink-0 rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] lg:inline">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
    </div>
  );
}

function SidebarUserMenu() {
  const auth = useCockpitAuth();
  const { theme, toggleTheme, switchable } = useTheme();
  const { setOpenMobile } = useSidebar();
  const name = auth.name || auth.email?.split("@")[0] || "User";

  return (
    <SidebarFooter className="border-t border-sidebar-border">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                    {name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-left">
                  <span className="text-sm font-medium truncate">{name}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {auth.email}
                  </span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="w-[--radix-dropdown-menu-trigger-width]"
            >
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
              <DropdownMenuItem asChild>
                {/* Back to the portal: the admin view, or the other cockpits. */}
                <a href={`${portalUrl()}/`}>
                  <LayoutGrid className="size-4" />
                  Mahara portal
                </a>
              </DropdownMenuItem>
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
  const { setOpenMobile, isMobile } = useSidebar();

  return (
    <SidebarHeader className="flex-row items-center justify-between border-b border-sidebar-border">
      {/* The logo opens the day, not the marketing page at "/". */}
      <Link
        to="/dashboard"
        onClick={() => setOpenMobile(false)}
        className="flex items-center px-2 py-2"
      >
        <Wordmark size="sm" />
      </Link>
      {/* Below 1024px the rail is a sheet whose own close button is hidden,
          so it carries one here. From 1024px up the rail is always there. */}
      {isMobile ? (
        <button
          type="button"
          onClick={() => setOpenMobile(false)}
          aria-label="Close menu"
          className="inline-flex size-10 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <X className="size-5" aria-hidden />
        </button>
      ) : null}
    </SidebarHeader>
  );
}

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeaderContent />
      <SearchField />
      <SidebarNav />
      <SidebarUserMenu />
    </Sidebar>
  );
}
