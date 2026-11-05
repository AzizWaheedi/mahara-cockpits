import { Navigate, Outlet, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { RouteSkeleton } from "@/components/RouteSkeleton";

/** The Blueprint call's notes popup (520 x 820): no cockpit shell in it. */
export const isNotesPopup = (pathname: string) =>
  /^\/blueprint\/[A-Za-z0-9_-]{1,40}\/notes\/?$/.test(pathname);

/** The popup's content skeleton while the sign-in and the seat are checked. */
export function NotesOpening() {
  return (
    <div className="min-h-dvh bg-background p-4 sm:p-6">
      <div className="mx-auto w-full max-w-3xl">
        <LoadingSkeleton variant="detail" label="Opening the notes…" rows={6} />
      </div>
    </div>
  );
}

export function ProtectedRoute() {
  const { ready, session, isAuthenticated } = useCockpitAuth();
  const location = useLocation();

  if (!ready) {
    return isNotesPopup(location.pathname) ? (
      <NotesOpening />
    ) : (
      <RouteSkeleton label="Loading the cockpit" />
    );
  }

  if (!session || !isAuthenticated) {
    const wanted = `${location.pathname}${location.search}`;
    const next = wanted === "/" ? "" : `?next=${encodeURIComponent(wanted)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  return <Outlet />;
}
