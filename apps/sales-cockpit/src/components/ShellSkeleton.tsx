import type { ReactNode } from "react";
import { DOCK, GROUP_LABELS, PAGES, type Page } from "../lib/pages";
import { Skeleton } from "./ui/skeleton";
import { Wordmark } from "./Wordmark";

// The same groups and rows the rail draws, in the same order.
const GROUPS = (["day", "going", "more"] as Page["group"][]).map(group => ({
  label: GROUP_LABELS[group],
  items: PAGES.filter(p => p.group === group),
}));

const GROUP_LABEL =
  "muted mb-1 px-3 font-mono text-[11px] tracking-[0.08em] uppercase";

const ROW =
  "flex items-center gap-2.5 rounded-[12px] py-2 pr-2.5 pl-3 text-sm lg:py-1.5";

/** The rail: brand, search, every page's row and the foot, as blocks. */
function Rail() {
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      <div className="flex items-center justify-between px-2">
        <span className="px-1">
          <Wordmark size="md" />
        </span>
        <Skeleton className="size-7 rounded-[8px]" />
      </div>

      <div className="flex h-9 w-full items-center gap-2 rounded-[12px] border border-border bg-foreground/[0.03] px-3">
        <Skeleton className="size-4 shrink-0 rounded-[4px]" />
        <Skeleton className="h-3.5 flex-1" />
        <Skeleton className="h-4 w-10 rounded border border-border" />
      </div>

      <nav className="flex w-full flex-col gap-5" aria-label="Sales cockpit">
        {GROUPS.map(group => (
          <div key={group.label} className="w-full">
            <p className={GROUP_LABEL}>{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.to}>
                  <div className={ROW}>
                    <Skeleton className="size-4 shrink-0 rounded-[4px]" />
                    <Skeleton className="h-5 w-28 max-w-full" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-auto w-full space-y-3">
        <ul className="space-y-0.5 border-t hairline pt-3">
          {[0, 1, 2, 3, 4].map(i => (
            <li key={i}>
              <div className={ROW}>
                <Skeleton className="size-4 shrink-0 rounded-[4px]" />
                <Skeleton className="h-5 w-32 max-w-full" />
              </div>
            </li>
          ))}
        </ul>
        <div className="rounded-[20px] border border-border bg-foreground/[0.03] p-2.5 shadow-sm">
          <div className="flex items-center gap-2.5 px-1 py-0.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-24 max-w-full" />
              <Skeleton className="h-3 w-16 max-w-full" />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-1 border-t border-border pt-2">
            <Skeleton className="h-6 w-16 rounded-[10px]" />
            <Skeleton className="size-7 rounded-[10px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The desktop menu bar: the same 40px row, with its clock and chips held back. */
function MenuBar() {
  return (
    <header className="sticky top-0 z-20 flex h-10 w-full items-center justify-between border-b hairline bg-[color:var(--background)]/80 px-3 text-xs backdrop-blur-xl transition-all">
      <div className="flex items-center gap-2">
        <Skeleton className="size-7 rounded-[8px]" />
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Wordmark size="sm" />
          <span className="muted font-normal">/</span>
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>
      <Skeleton className="hidden h-6 w-44 rounded-full sm:block" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="size-7 rounded-[8px]" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
    </header>
  );
}

/**
 * The cockpit's frame before its pages draw: the floating rail, the menu bar,
 * the phone's header and dock, exactly as App.tsx lays them out. The page
 * skeleton goes inside, and nothing here is announced or pressable.
 */
export function ShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-full lg:pt-[env(safe-area-inset-top,0px)]"
    >
      {/* Floating Detached Sidebar Island */}
      <div className="hidden lg:flex lg:flex-col lg:justify-center my-2.5 ml-3 shrink-0">
        <aside className="h-[calc(100dvh-1.25rem)] rounded-[26px] border border-border bg-background/90 backdrop-blur-2xl shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden flex flex-col w-60">
          <Rail />
        </aside>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
        <div className="hidden lg:block">
          <MenuBar />
        </div>

        {/* Mobile header */}
        <header className="pt-safe sticky top-0 z-10 flex items-center justify-between border-b hairline bg-[color:var(--background)]/85 px-4 py-2.5 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-3">
            <Wordmark size="sm" />
            <span className="muted text-sm">Sales</span>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="size-10 rounded-[12px]" />
          </div>
        </header>

        {children}
      </div>

      {/* The phone's dock, with the same six pages and More. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-2 lg:hidden">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <div className="floating-dock flex items-center gap-2 p-2.5 shadow-2xl">
            {DOCK.map(to => (
              <Skeleton key={to} className="size-9 rounded-[12px]" />
            ))}
          </div>
          <Skeleton className="size-10 rounded-full" />
        </div>
      </div>
    </div>
  );
}
