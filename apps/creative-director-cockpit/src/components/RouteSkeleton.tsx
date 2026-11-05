import { matchPath, useLocation } from "react-router";
import { ShellSkeleton } from "./ShellSkeleton";
import { PAGE_SKELETONS } from "./skeletons/routes";
import { Skeleton } from "./ui/skeleton";

/** Pages that draw without the cockpit shell, taken from the public routes. */
export const PUBLIC_PATHS = ["/", "/login", "/signup", "/first-sign-in"];

/** Public areas with their own addresses under a fixed first segment. */
export const PUBLIC_PREFIXES: string[] = [];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(prefix),
  );
}

function matchedSkeleton(pathname: string) {
  return PAGE_SKELETONS.find(entry =>
    matchPath({ path: entry.path, end: true }, pathname),
  );
}

/** The header most pages open with: a title block and one muted line. */
export function HeaderOnlySkeleton() {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-1 h-4 w-64 max-w-full" />
      </div>
    </header>
  );
}

function PageContent({ pathname }: { pathname: string }) {
  const entry = matchedSkeleton(pathname);
  return entry ? <entry.Skeleton /> : <HeaderOnlySkeleton />;
}

/**
 * The loading picture before a page draws itself. It carries the shell plus
 * the page's own skeleton, chosen by the address.
 */
export function RouteSkeleton({ label }: { label: string }) {
  const { pathname } = useLocation();
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {isPublic(pathname) ? (
        <div aria-hidden="true" className="min-h-dvh bg-background" />
      ) : (
        <ShellSkeleton>
          <PageContent pathname={pathname} />
        </ShellSkeleton>
      )}
    </div>
  );
}

/** The page's skeleton alone, for a loading state already inside AppLayout. */
export function ContentSkeleton({ label }: { label: string }) {
  const { pathname } = useLocation();
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <PageContent pathname={pathname} />
      </div>
    </div>
  );
}
