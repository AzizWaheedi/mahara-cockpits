import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import {
  ArrowRightLeft,
  Bookmark,
  CalendarDays,
  Clapperboard,
  FileText,
  Filter,
  LayoutGrid,
  Lightbulb,
  Link2,
  LogOut,
  MessageSquare,
  Moon,
  MoonStar,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunrise,
  Trophy,
  Users,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import { portalUrl } from "@/components/PortalAutoSignIn";
import { Wordmark } from "@/components/Wordmark";
import { useTheme } from "@/contexts/ThemeContext";
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
      { href: "/work", label: "Middle of the day", icon: Clapperboard },
      {
        href: "/touchpoints",
        label: "Client touchpoints",
        icon: MessageSquare,
      },
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
      <SidebarMenuButton asChild isActive={isActive}>
        <Link to={href} onClick={() => setOpenMobile(false)}>
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
  ].filter(d => d.show);
  if (doors.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Switch cockpit</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {doors.map(d => (
            <SidebarMenuItem key={d.key}>
              <SidebarMenuButton asChild>
                <a href={d.href}>
                  {d.key === "admin" ? (
                    <ShieldCheck className="size-4" />
                  ) : (
                    <ArrowRightLeft className="size-4" />
                  )}
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
      <PortalGroup />
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
