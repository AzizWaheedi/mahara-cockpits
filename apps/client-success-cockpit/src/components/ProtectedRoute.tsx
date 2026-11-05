import { useEffect, useMemo } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { hostFrame } from "@/present/useHost";
import { FrameLine } from "./FrameLine";
import { RouteSkeleton } from "./RouteSkeleton";

export function ProtectedRoute() {
  const { ready, session, isAuthenticated } = useCockpitAuth();
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the frame's address decides; read again when it changes
  const host = useMemo(() => hostFrame(), [location.pathname, location.search]);
  const signedOut = ready && (!session || !isAuthenticated);
  useEffect(() => {
    if (host && signedOut) host.post({ type: "signed-out" });
  }, [host, signedOut]);

  if (!ready) {
    return host ? (
      <FrameLine>Opening…</FrameLine>
    ) : (
      <RouteSkeleton label="Loading the cockpit" />
    );
  }

  if (!session || !isAuthenticated) {
    if (host) return <FrameLine>Sign in to the cockpit again.</FrameLine>;
    const wanted = `${location.pathname}${location.search}`;
    const next = wanted === "/" ? "" : `?next=${encodeURIComponent(wanted)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  return <Outlet />;
}
