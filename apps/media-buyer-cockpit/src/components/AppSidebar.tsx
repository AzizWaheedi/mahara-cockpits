import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRightLeft,
  Gauge,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  LogOut,
  Megaphone,
  MessageSquare,
  Moon,
  MoonStar,
  PanelLeft,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  Sun,
  Trophy,
} from "lucide-react";
import { Link, useLocation } from "react-router";
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

// Each nav item belongs to exactly one cockpit; nobody sees another role's screens.
const navItems = [
  {
    href: "/dashboard",
    label: "Start of day",
    icon: LayoutDashboard,
    role: "media_buyer",
  },
  {
    href: "/ads",
    label: "Ads management",
    icon: Megaphone,
    role: "media_buyer",
  },
  {
    href: "/tasks",
    label: "Task list",
    icon: ListChecks,
    role: "media_buyer",
  },
  {
    href: "/touchpoints",
    label: "Client touchpoints",
    icon: MessageSquare,
    role: "media_buyer",
  },
  {
    href: "/playbook",
    label: "What works",
    icon: Trophy,
    role: "media_buyer",
  },
  {
    href: "/ideation",
    label: "Ideation",
    icon: Lightbulb,
    role: "media_buyer",
  },
  { href: "/eod", label: "End of day", icon: MoonStar, role: "media_buyer" },
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

function SidebarNav() {
  const location = useLocation();
  const me = useQuery(api.roles.me, {});
  const allowed = me?.roles ?? [];
  const items = navItems.filter(
    item => me?.isAdmin || allowed.includes(item.role),
  );
  // Other cockpits this person may open, so switching is one click.
  const cockpits: string[] = me?.cockpits ?? [];
  const others = [
    { key: "csm", label: "Client success", href: "/go/csm" },
    { key: "creative", label: "Creative director", href: "/go/creative" },
  ].filter(c => cockpits.includes(c.key));

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {me?.isCeo ? (
              <NavLink
                href="/ceo"
                label="CEO"
                icon={Gauge}
                isActive={location.pathname.startsWith("/ceo")}
              />
            ) : null}
            {me?.isAdmin ? (
              <NavLink
                href="/admin"
                label="Admin"
                icon={ShieldCheck}
                isActive={location.pathname === "/admin"}
              />
            ) : null}
            {items.map(item => (
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
                  icon={ArrowRightLeft}
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

function SidebarUserMenu() {
  const user = useQuery(api.auth.currentUser);
  const me = useQuery(api.roles.me, {});
  // The name the admin typed in the portal, else the email's first part.
  const shownName =
    user?.name || me?.name || user?.email?.split("@")[0] || "User";
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
                    {shownName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-left">
                  <span className="text-sm font-medium truncate">
                    {shownName}
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
          to="/"
          onClick={() => setOpenMobile(false)}
          className="flex items-center px-2 py-2"
        >
          <Wordmark size="sm" />
        </Link>
      )}
      <button
        type="button"
        onClick={toggleSidebar}
        className="rounded-lg border p-2 hover:bg-sidebar-accent"
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={open}
      >
        {open ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
      </button>
    </SidebarHeader>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeaderContent />
      <SidebarNav />
      <SidebarUserMenu />
    </Sidebar>
  );
}
