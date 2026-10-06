import { lazy, Suspense } from "react";
const AuthenticatedAppRoutes = lazy(() =>
  import("./authenticated/AuthenticatedAppRoutes").then(module => ({
    default: module.AuthenticatedAppRoutes,
  })),
);

/** Native Supabase is the only staff sign-in path; public pages keep their route guards. */
export function AuthStrategyRoutes() {
  return <Suspense fallback={null}><AuthenticatedAppRoutes /></Suspense>;
}
