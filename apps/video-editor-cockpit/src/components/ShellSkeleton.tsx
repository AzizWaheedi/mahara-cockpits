import type { ReactNode } from "react";
import { Wordmark } from "./Wordmark";

/**
 * The app shell drawn with no data, so the first picture of a page is the
 * page it becomes. It mirrors the layout App.tsx renders: the floating rail
 * from 1024px, the phone header, and the padded page area. Everything here
 * is decorative; the page's own skeleton goes inside.
 */

function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`min-w-0 max-w-full rounded-[var(--radius-md)] bg-muted motion-safe:animate-pulse ${className}`}
    />
  );
}

const NAV_ROWS = [0, 1, 2, 3, 4];
const FOOT_ROWS = [0, 1, 2, 3, 4];

export function ShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div aria-hidden="true" className="flex h-full">
      <aside
        className="hidden shrink-0 p-2 lg:block"
        style={{ width: "15rem" }}
      >
        <div className="h-full overflow-hidden rounded-2xl border border-sidebar-border/70 bg-sidebar/95 shadow-lg shadow-black/5 backdrop-blur-md">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 border-b p-2">
              <span className="px-2 py-2">
                <Wordmark size="sm" />
              </span>
              <Block className="size-8 rounded-lg" />
            </div>
            <div className="px-2 pt-2">
              <Block className="h-10 w-full rounded-lg" />
            </div>
            <nav
              aria-label="The desk"
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              <ul className="space-y-0.5">
                {NAV_ROWS.map(row => (
                  <li key={`nav-${row}`}>
                    <div className="flex h-10 w-full items-center gap-2 px-2 lg:h-8">
                      <Block className="size-4 shrink-0" />
                      <Block className="h-3.5 w-24" />
                    </div>
                  </li>
                ))}
              </ul>
            </nav>
            <ul className="space-y-0.5 border-t p-2">
              {FOOT_ROWS.map(row => (
                <li key={`foot-${row}`}>
                  <div className="flex h-10 w-full items-center gap-2 rounded-xl px-2 lg:h-8">
                    <Block className="size-4 shrink-0" />
                    <Block className="h-3.5 w-28" />
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t p-2">
              <div className="flex h-12 items-center gap-2 px-2">
                <Block className="size-8 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Block className="h-3.5 w-24" />
                  <Block className="h-3 w-32" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 border-b bg-background/90 px-2 pt-safe backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2">
            <Block className="size-10 rounded-lg" />
            <Wordmark size="sm" />
            <span className="text-sm text-muted-foreground">Editor desk</span>
            <span className="ml-auto">
              <Block className="size-10 rounded-lg" />
            </span>
            <Block className="size-10 rounded-lg" />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pt-4 pb-12 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
          <div className="hidden lg:block">
            <div className="tk-bell-bar">
              <Block className="h-8 w-24 rounded-lg" />
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
