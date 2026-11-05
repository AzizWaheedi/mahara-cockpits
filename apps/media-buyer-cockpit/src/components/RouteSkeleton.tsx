import { matchPath, useLocation } from "react-router";
import { ShellSkeleton } from "@/components/ShellSkeleton";
import { PAGE_SKELETONS } from "@/components/skeletons/routes";
import { Skeleton } from "@/components/ui/skeleton";

/** Pages anyone may open without a session. */
export const PUBLIC_PATHS = ["/", "/login", "/signup", "/first-sign-in"];

/** Public sections where every address below the prefix belongs to the public. */
const PUBLIC_PREFIXES: string[] = [];

function isPublic(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
  );
}

/** The page header most pages draw, held back to its blocks. */
export function HeaderOnlySkeleton() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
    </header>
  );
}

function PageSkeleton() {
  const { pathname } = useLocation();
  const entry = PAGE_SKELETONS.find(item =>
    matchPath({ path: item.path, end: true }, pathname),
  );
  return entry ? <entry.Skeleton /> : <HeaderOnlySkeleton />;
}

/** The whole loading picture for a page about to draw itself. */
export function RouteSkeleton({ label }: { label: string }) {
  const { pathname } = useLocation();
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {isPublic(pathname) ? (
        <div aria-hidden="true" className="min-h-dvh bg-background" />
      ) : (
        <ShellSkeleton>
          <PageSkeleton />
        </ShellSkeleton>
      )}
    </div>
  );
}

/** The same page picture for loading states that already sit inside AppLayout. */
export function ContentSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <PageSkeleton />
    </div>
  );
}
