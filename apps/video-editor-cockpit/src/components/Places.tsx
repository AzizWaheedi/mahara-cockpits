import { MoonStar } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import JobsPage from "../pages/JobsPage";
import PipelinePage from "../pages/PipelinePage";
import { chip } from "./bits";
import { buttonClass } from "./ui/button";

/**
 * The desk's places (the simplification audit, approved by Aziz on
 * 2026-10-06). Jobs is home: the list, or the board one column per status
 * (?view=board, which was the Pipeline page), with End of day one button
 * away. What works, Ideation and the swipe file are one Library, with tabs.
 */

export function JobsHome({ eodDue }: { eodDue: boolean }) {
  const [params] = useSearchParams();
  const board = params.get("view") === "board";
  const actions = (
    <>
      <nav aria-label="How to show the jobs" className="flex gap-1.5">
        <Link
          to="/"
          aria-current={board ? undefined : "page"}
          className={chip(!board)}
        >
          List
        </Link>
        <Link
          to="/?view=board"
          aria-current={board ? "page" : undefined}
          className={chip(board)}
        >
          Board
        </Link>
      </nav>
      <Link
        to="/eod"
        className={buttonClass({ variant: "outline", size: "sm" })}
      >
        <MoonStar aria-hidden />
        End of day
        {eodDue ? (
          <span
            role="img"
            aria-label="Not filed yet today"
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: "var(--warning)" }}
          />
        ) : null}
      </Link>
    </>
  );
  return board ? (
    <PipelinePage actions={actions} />
  ) : (
    <JobsPage actions={actions} />
  );
}

const LIBRARY = [
  { to: "/winners", label: "What works" },
  { to: "/ideas", label: "Ideation" },
  { to: "/swipe", label: "Swipe file" },
];

/** The Library's tabs above each of its three pages, each at its own address. */
export function Library({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <>
      <nav
        aria-label="Library"
        className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto border-b px-4 pt-6 no-scrollbar sm:px-6 lg:px-8"
      >
        {LIBRARY.map(t => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={pathname === t.to ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pathname === t.to
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
