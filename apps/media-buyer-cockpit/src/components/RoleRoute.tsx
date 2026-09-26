import { useQuery } from "convex/react";
import { Navigate, Outlet, useLocation } from "react-router";
import { api } from "../../convex/_generated/api";
import { Spinner } from "./ui/spinner";

/**
 * One cockpit per role, one link per cockpit. A media buyer who opens the client
 * success link is sent to her own screen, and if she has no role at all she is told
 * plainly instead of shown an empty dashboard. The server enforces the same rule.
 */
export function RoleRoute({ role }: { role: string }) {
  const me = useQuery(api.roles.me, {});
  const location = useLocation();

  if (me === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Checking your access…
      </div>
    );
  }
  if (me.isAdmin || me.roles.includes(role)) return <Outlet />;
  if (me.home && me.home !== location.pathname)
    return <Navigate to={me.home} replace />;

  return (
    <div className="mx-auto max-w-md space-y-2 py-10 text-center">
      <h1 className="text-lg font-semibold">This cockpit isn't yours</h1>
      <p className="text-sm text-muted-foreground">
        Ask Aziz to give you this seat in the portal's admin view.
      </p>
    </div>
  );
}
