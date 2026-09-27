import { Navigate, Outlet, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";

/** The portal decides who opens this cockpit; the server enforces the same rule. */
export function RoleRoute({ role }: { role: string }) {
  const { access, ready, session } = useCockpitAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Checking your access…
      </div>
    );
  }
  if (access?.isAdmin || access?.isCeo || access?.roles.includes(role)) {
    return <Outlet key={session?.user.id ?? "signed-out"} />;
  }
  if (access?.home && access.home !== location.pathname) {
    return <Navigate to={access.home} replace />;
  }

  return (
    <div className="mx-auto max-w-md space-y-2 p-10 text-center">
      <h1 className="text-lg font-semibold">This cockpit isn't yours</h1>
      <p className="text-sm text-muted-foreground">
        Ask Aziz to give you the creative director seat in the portal.
      </p>
    </div>
  );
}
