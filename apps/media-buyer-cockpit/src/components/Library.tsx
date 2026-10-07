import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "@/lib/utils";

/**
 * What works, Ideation and the swipe file, as the three tabs of one Library
 * (the simplification audit, approved by Aziz on 2026-10-06: three pages in
 * the sidebar became one place). Each tab is its page as it was, at its own
 * address, so links into any of them still land.
 */
const TABS = [
  { href: "/playbook", label: "What works" },
  { href: "/ideation", label: "Ideation" },
  { href: "/swipe", label: "Swipe file" },
];

export function Library({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="space-y-6">
      <nav
        aria-label="Library"
        className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map(t => (
          <Link
            key={t.href}
            to={t.href}
            aria-current={pathname === t.href ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              pathname === t.href
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
