import { Outlet, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { portalUrl } from "@/lib/portal";
import { isNotesPopup, NotesOpening } from "./ProtectedRoute";

/** The portal decides who opens this cockpit; the server enforces the same rule. */
export function RoleRoute({ role }: { role: string }) {
  const { access, ready, session } = useCockpitAuth();
  const { pathname } = useLocation();

  if (!ready) {
    // The Blueprint's notes popup keeps its one centred line throughout.
    if (isNotesPopup(pathname)) return <NotesOpening />;
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Checking your access…
      </div>
    );
  }
  if (access?.isAdmin || access?.isCeo || access?.roles.includes(role)) {
    return <Outlet key={session?.user.id ?? "signed-out"} />;
  }

  return <NotYourCockpit home={access?.home ?? null} />;
}

/** A seat without the creative director's role (the harness draws it too). */
export function NotYourCockpit({ home }: { home: string | null }) {
  return (
    <div className="mx-auto max-w-md space-y-2 p-10 text-center">
      <h1 className="text-lg font-semibold">This cockpit isn't yours</h1>
      <p className="text-sm text-muted-foreground">
        Ask Aziz to give you the creative director seat in the portal.
      </p>
      {home && (
        <a className="text-sm underline" href={`${portalUrl()}${home}`}>
          Open your cockpit
        </a>
      )}
    </div>
  );
}
