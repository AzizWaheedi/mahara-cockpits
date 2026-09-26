import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  DollarSign,
  Flame,
  LayoutGrid,
  Link2,
  ListChecks,
  ListTodo,
  LogOut,
  MessageSquare,
  Moon,
  MoonStar,
  Settings,
  Sun,
  Sunrise,
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

/**
 * Grouped so the CSM reads the sidebar as a day, not as eight equal choices: the day runs
 * top to bottom, client work sits in the middle, reference material last.
 */
const navGroups = [
  {
    label: "My day",
    items: [
      { href: "/dashboard", label: "Start of day", icon: Sunrise },
      { href: "/tasks", label: "Task list", icon: ListChecks },
      {
        href: "/meetings",
        label: "Meetings & messages",
        icon: CalendarDays,
      },
      { href: "/eod", label: "End of day", icon: MoonStar },
    ],
  },
  {
    label: "Clients",
    items: [
      { href: "/clients", label: "Clients & touchpoints", icon: MessageSquare },
      { href: "/performance", label: "Client performance", icon: BarChart3 },
      { href: "/billing", label: "Billing", icon: CalendarClock },
      { href: "/backlog", label: "Data backlog", icon: ListTodo },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/hotlist", label: "Hot list", icon: Flame },
      { href: "/money", label: "My money", icon: DollarSign },
    ],
  },
  {
    label: "Reference",
    items: [{ href: "/links", label: "Key links", icon: Link2 }],
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
              <SidebarMenuButton asChild>
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
                  isActive={location.pathname === item.href}
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
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarHeader className="border-b border-sidebar-border">
      <Link
        to="/"
        onClick={() => setOpenMobile(false)}
        className="flex items-center px-2 py-2"
      >
        <Wordmark size="sm" />
      </Link>
    </SidebarHeader>
  );
}

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeaderContent />
      <SidebarNav />
      <SidebarUserMenu />
    </Sidebar>
  );
}
