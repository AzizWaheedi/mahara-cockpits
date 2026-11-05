import { lazy, Suspense } from "react";
import { RouteSkeleton } from "@/components/RouteSkeleton";

const AuthenticatedAppRoutes = lazy(() =>
  import("./authenticated/AuthenticatedAppRoutes").then(module => ({
    default: module.AuthenticatedAppRoutes,
  })),
);

/** Native Supabase is the only staff sign-in path; public pages keep their route guards. */
export function AuthStrategyRoutes() {
  return (
    <Suspense fallback={<RouteSkeleton label="Loading the cockpit" />}>
      <AuthenticatedAppRoutes />
    </Suspense>
  );
}
