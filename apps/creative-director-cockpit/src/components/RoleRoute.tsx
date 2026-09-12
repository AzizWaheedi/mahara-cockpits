import { useQuery } from "convex/react";
import { Outlet } from "react-router";
import { api } from "../../convex/_generated/api";
import { portalUrl } from "./PortalAutoSignIn";

/** The portal decides who opens this cockpit; the server enforces the same rule. */
export function RoleRoute({ role }: { role: string }) {
  const me = useQuery(api.roles.me, {});
  if (me === undefined)
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Checking your access…
      </div>
    );
  if (me.roles.includes(role)) return <Outlet />;
  return (
    <div className="mx-auto max-w-md space-y-2 p-10 text-center">
      <h1 className="text-lg font-semibold">This cockpit isn't yours</h1>
      <p className="text-sm text-muted-foreground">
        Ask Aziz to give you the creative director seat in the portal, then open{" "}
        <a className="underline" href={portalUrl()}>
          the portal
        </a>{" "}
        again.
      </p>
    </div>
  );
}
