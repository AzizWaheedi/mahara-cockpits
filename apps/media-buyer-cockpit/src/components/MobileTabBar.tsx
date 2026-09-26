import { useQuery } from "convex/react";
import type { LucideIcon } from "lucide-react";
import {
  Gauge,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Menu,
  MessageSquare,
  MousePointerClick,
  ShieldCheck,
  Sun,
  Truck,
  Wallet,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router";
import { COCKPIT_ICON } from "@/lib/cockpits";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import { useSidebar } from "./ui/sidebar";

type Item = {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
  active: boolean;
};

/**
 * The bar at the foot of a phone screen: the four places a thumb goes most,
 * and "More" for the rest of the rail. Which four depends on where you are:
 * the CEO cockpit's own sections on /ceo, the media buyer's day for a media
 * buyer, otherwise the CEO, Admin and Team meetings doors a seat has.
 * Hidden from 1024px up, where the rail is on the left. The labels are the
 * rail's own words (Start of day, Touchpoints), shortened only where the
 * rail's longer name would not fit (Ads, Tasks).
 */
export function MobileTabBar() {
  const { setOpenMobile, isMobile } = useSidebar();
  const location = useLocation();
  const [params] = useSearchParams();
  const me = useQuery(api.roles.me, {});
  if (!isMobile || !me) return null;
  const path = location.pathname;
  const inCeo = path.startsWith("/ceo") && me.isCeo === true;
  const tab = params.get("tab") ?? "today";
  const roles: string[] = me.roles ?? [];
  const items: Item[] = inCeo
    ? [
        {
          key: "today",
          label: "Today",
          icon: Sun,
          to: "/ceo",
          active: tab === "today",
        },
        {
          key: "money",
          label: "Money",
          icon: Wallet,
          to: "/ceo?tab=money",
          active: tab === "money",
        },
        {
          key: "ads",
          label: "Ads",
          icon: MousePointerClick,
          to: "/ceo?tab=ads",
          active: tab === "ads",
        },
        {
          key: "delivery",
          label: "Delivery",
          icon: Truck,
          to: "/ceo?tab=delivery",
          active: tab === "delivery",
        },
      ]
    : roles.includes("media_buyer")
      ? [
          {
            key: "day",
            label: "Start of day",
            icon: LayoutDashboard,
            to: "/dashboard",
            active: path === "/dashboard",
          },
          {
            key: "ads",
            label: "Ads",
            icon: Megaphone,
            to: "/ads",
            active: path === "/ads",
          },
          {
            key: "tasks",
            label: "Tasks",
            icon: ListChecks,
            to: "/tasks",
            active: path === "/tasks",
          },
          {
            key: "clients",
            label: "Touchpoints",
            icon: MessageSquare,
            to: "/touchpoints",
            active: path === "/touchpoints",
          },
        ]
      : [
          ...(me.isCeo
            ? [
                {
                  key: "ceo",
                  label: "CEO",
                  icon: Gauge,
                  to: "/ceo",
                  active: path.startsWith("/ceo"),
                },
              ]
            : []),
          ...(me.isAdmin
            ? [
                {
                  key: "admin",
                  label: "Admin",
                  icon: ShieldCheck,
                  to: "/admin",
                  active: path === "/admin",
                },
              ]
            : []),
          // Everybody's: without it a seat with no cockpit here had "More"
          // alone and nobody reached the meetings from the bar.
          {
            key: "team",
            label: "Team",
            icon: COCKPIT_ICON.team,
            to: "/team",
            active: path.startsWith("/team"),
          },
        ];
  const cell =
    "flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none";
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/95 pb-safe text-sidebar-foreground backdrop-blur lg:hidden"
    >
      <ul className="grid auto-cols-fr grid-flow-col">
        {items.map(it => (
          <li key={it.key}>
            <Link
              to={it.to}
              aria-current={it.active ? "page" : undefined}
              className={cn(
                cell,
                it.active
                  ? "text-[color:var(--mahara-teal,#00cfc8)]"
                  : "text-sidebar-foreground/70",
              )}
            >
              <it.icon className="size-5" aria-hidden />
              {it.label}
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className={cn(cell, "text-sidebar-foreground/70")}
          >
            <Menu className="size-5" aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
