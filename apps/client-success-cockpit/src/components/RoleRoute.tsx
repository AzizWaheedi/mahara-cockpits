import { Outlet } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { portalUrl } from "@/lib/portal";

/**
 * One cockpit per role, one link per cockpit. A media buyer who opens the client
 * success link is sent to her own screen, and if she has no role at all she is told
 * plainly instead of shown an empty dashboard. The server enforces the same rule.
 */
export function RoleRoute({
  role,
  anyOf = [],
}: {
  role?: string;
  anyOf?: string[];
}) {
  const { access, ready, session } = useCockpitAuth();

  if (!ready) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Checking your access…
      </div>
    );
  }
  if (
    access?.isAdmin ||
    access?.isCeo ||
    [...(role ? [role] : []), ...anyOf].some(r => access?.roles.includes(r))
  ) {
    return <Outlet key={session?.user.id ?? "signed-out"} />;
  }

  return (
    <div className="mx-auto max-w-md space-y-2 p-10 text-center">
      <h1 className="text-lg font-semibold">This cockpit isn't yours</h1>
      <p className="text-sm text-muted-foreground">
        Each role has its own link, and this one is for a different seat. Ask
        your manager for yours.
      </p>
      {access?.home && (
        <a className="text-sm underline" href={`${portalUrl()}${access.home}`}>
          Open your cockpit
        </a>
      )}
    </div>
  );
}

/**
 * Shared review shell avoids CSM-only data providers for media buyers. Sales
 * seats open the invoice page in it too (`wide`, the invoice page's width).
 */
export function BillingReviewLayout({ wide = false }: { wide?: boolean }) {
  const { access } = useCockpitAuth();
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className={`mx-auto mb-5 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
        <a
          className="text-sm text-muted-foreground underline"
          href={`${portalUrl()}${access?.home || "/"}`}
        >
          Back to your cockpit
        </a>
      </div>
      <Outlet />
    </main>
  );
}
