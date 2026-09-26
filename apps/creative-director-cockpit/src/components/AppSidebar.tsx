import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  Bookmark,
  CalendarDays,
  FileText,
  Filter,
  LayoutGrid,
  Lightbulb,
  Link2,
  LogOut,
  MessageSquare,
  Moon,
  MoonStar,
  PanelLeft,
  PanelLeftClose,
  Send,
  Settings,
  Share2,
  Sparkles,
  Sun,
  Sunrise,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import { portalUrl } from "@/components/PortalAutoSignIn";
import { Wordmark } from "@/components/Wordmark";
import { useTheme } from "@/contexts/ThemeContext";
import { COCKPIT_ICON } from "@/lib/cockpits";
import { api } from "../../convex/_generated/api";
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

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

/** The day in order, then the people, then what he writes from. */
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Your day",
    items: [
      { href: "/dashboard", label: "Start of day", icon: Sunrise },
      { href: "/work", label: "Middle of the day", icon: Sun },
      {
        href: "/touchpoints",
        label: "Client touchpoints",
        icon: MessageSquare,
      },
      { href: "/review", label: "Send for review", icon: Send },
      { href: "/eod", label: "End of day", icon: MoonStar },
    ],
  },
  {
    label: "Clients",
    items: [
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/meetings", label: "Meetings & messages", icon: CalendarDays },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/scripting", label: "Scripting database", icon: Sparkles },
      { href: "/scripts", label: "Scripts we made", icon: FileText },
      { href: "/social", label: "Social media", icon: Share2 },
      { href: "/ideation", label: "Ideation", icon: Lightbulb },
      { href: "/swipe", label: "Swipe file", icon: Bookmark },
      { href: "/what-works", label: "What works", icon: Trophy },
      { href: "/funnels", label: "Funnels and forms", icon: Filter },
      { href: "/links", label: "Key links", icon: Link2 },
    ],
  },
];

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
  const me = useQuery(api.roles.me, {});
  const portal = portalUrl();
  const roles: string[] = me?.portalRoles ?? [];
  const isAdmin = Boolean(me?.isAdmin);
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
      show: isAdmin || roles.includes("csm"),
    },
    {
      key: "creative",
      label: "Creative director",
      href: `${portal}/go/creative`,
      show: false,
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
  // Team meetings are everybody's, so they sit with the doors at the foot.
  const rows = [
    { key: "team", label: "Team meetings", href: `${portal}/team` },
    ...doors,
  ];
  return (
    <SidebarGroup className="mt-auto border-t border-sidebar-border">
      <SidebarGroupContent>
        <SidebarMenu>
          {rows.map(d => (
            <SidebarMenuItem key={d.key}>
              <SidebarMenuButton asChild tooltip={d.label}>
                <a href={d.href}>
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
      {navGroups.map(group => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map(item => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  isActive={
                    location.pathname === item.href ||
                    location.pathname.startsWith(`${item.href}/`)
                  }
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
      <PortalGroup />
    </SidebarContent>
  );
}

function SidebarUserMenu() {
  const user = useQuery(api.auth.currentUser);
  const { signOut } = useAuthActions();
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
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-left">
                  <span className="text-sm font-medium truncate">
                    {user?.name || "User"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {user?.email}
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
                onClick={() => signOut()}
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
          to="/dashboard"
          onClick={() => setOpenMobile(false)}
          className="flex items-center px-2 py-2"
        >
          <Wordmark size="sm" />
        </Link>
      )}
      {/* Below 1024px the rail is a sheet with no close button of its own,
          so this is how it closes: an X with a full 40px target. */}
      {isMobile ? (
        <button
          type="button"
          onClick={() => setOpenMobile(false)}
          className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label="Close menu"
        >
          <X className="size-5" />
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

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeaderContent />
      <SidebarNav />
      <SidebarUserMenu />
    </Sidebar>
  );
}
