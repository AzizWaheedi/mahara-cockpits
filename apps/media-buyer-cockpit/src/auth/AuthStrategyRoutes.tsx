import { lazy, Suspense } from "react";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

const AuthenticatedAppRoutes = lazy(() =>
  import("./authenticated/AuthenticatedAppRoutes").then(module => ({
    default: module.AuthenticatedAppRoutes,
  })),
);

/** Native Supabase is the only staff sign-in path; public pages keep their route guards. */
export function AuthStrategyRoutes() {
  return (
    <Suspense
      fallback={
        <LoadingSkeleton
          variant="page"
          label="Loading the cockpit"
          className="mx-auto max-w-6xl p-6"
        />
      }
    >
      <AuthenticatedAppRoutes />
    </Suspense>
  );
}
