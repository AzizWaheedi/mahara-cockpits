import { Navigate, Outlet, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { BackendWait } from "./BackendWait";
import { RouteSkeleton } from "./RouteSkeleton";

export function ProtectedRoute() {
  const { ready, session, isAuthenticated } = useCockpitAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <BackendWait>
        <RouteSkeleton label="Loading your cockpit" />
      </BackendWait>
    );
  }

  if (!session || !isAuthenticated) {
    // Carry the page asked for, so a hand-off to another cockpit (/go/...)
    // or a deep link resumes right after the one sign-in (Aziz, 2026-09-21).
    const wanted = `${location.pathname}${location.search}`;
    const next = wanted === "/" ? "" : `?next=${encodeURIComponent(wanted)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  return <Outlet />;
}
