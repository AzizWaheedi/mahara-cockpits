import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Placeholder while the CEO cockpit screens are built. */
export function CeoPage() {
  const me = useQuery(api.roles.me, {});
  const data = useQuery(api.ceo.queries.today, me?.isCeo ? {} : "skip");
  if (me && !me.isCeo)
    return (
      <div className="p-10 text-sm text-muted-foreground">
        The CEO cockpit is Aziz's only.
      </div>
    );
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">CEO</h1>
      <pre className="mt-4 overflow-auto rounded-lg border bg-card p-4 text-xs">
        {data
          ? JSON.stringify(Object.keys(data.sections), null, 2)
          : "Loading..."}
      </pre>
    </div>
  );
}
