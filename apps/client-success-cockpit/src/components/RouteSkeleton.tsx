import { matchPath, useLocation } from "react-router";
import { ShellSkeleton } from "./ShellSkeleton";
import { PAGE_SKELETONS, type PageSkeletonEntry } from "./skeletons/routes";
import { Skeleton } from "./ui/skeleton";

/** The pages that show without a session, so they never draw the app shell. */
export const PUBLIC_PATHS = ["/", "/login", "/signup", "/first-sign-in"];

/** Addresses under these prefixes are public too. */
const PUBLIC_PREFIXES: string[] = [];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
  );
}

function findEntry(pathname: string): PageSkeletonEntry | undefined {
  return PAGE_SKELETONS.find(entry =>
    matchPath({ path: entry.path, end: true }, pathname),
  );
}

/** The header most pages open with, drawn as blocks. */
export function HeaderOnlySkeleton() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-1 h-4 w-64 max-w-full" />
      </div>
    </header>
  );
}

/**
 * The whole first picture of a page: the app shell plus the page's own
 * skeleton. A public page draws only its background.
 */
export function RouteSkeleton({ label }: { label: string }) {
  const { pathname } = useLocation();
  const entry = findEntry(pathname);
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {isPublicPath(pathname) ? (
        <div aria-hidden="true" className="min-h-dvh bg-background" />
      ) : (
        <ShellSkeleton>
          {entry ? <entry.Skeleton /> : <HeaderOnlySkeleton />}
        </ShellSkeleton>
      )}
    </div>
  );
}

/** The page's own skeleton only, for loading states inside AppLayout. */
export function ContentSkeleton({ label }: { label: string }) {
  const { pathname } = useLocation();
  const entry = findEntry(pathname);
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {isPublicPath(pathname) ? (
        <div aria-hidden="true" className="min-h-dvh bg-background" />
      ) : entry ? (
        <entry.Skeleton />
      ) : (
        <HeaderOnlySkeleton />
      )}
    </div>
  );
}
