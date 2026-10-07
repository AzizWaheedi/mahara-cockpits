import { Link, Navigate } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { BackendWait } from "@/components/BackendWait";
import { Spinner } from "@/components/ui/spinner";
import { Wordmark } from "@/components/Wordmark";
import { COCKPIT_ICON } from "@/lib/cockpits";

import { LoginPage } from "./LoginPage";

export const COCKPIT_META: Record<
  string,
  { label: string; blurb: string; to: string; external: boolean }
> = {
  media_buyer: {
    label: "Media buyer",
    blurb: "Ads, launches, budgets, tracking.",
    to: "/dashboard",
    external: false,
  },
  csm: {
    label: "Client success",
    blurb: "Clients, calls, reports, WhatsApp.",
    to: "/go/csm",
    external: true,
  },
  creative: {
    label: "Creative director",
    blurb: "Briefs, scripts, winners, brand DNA.",
    to: "/go/creative",
    external: true,
  },
  editor: {
    label: "Editor desk",
    blurb: "Video jobs, footage, brand rules, cuts.",
    to: "/go/editor",
    external: true,
  },
  sales: {
    label: "Sales",
    blurb: "Calls, leads, scripts, follow-ups, pay.",
    to: "/go/sales",
    external: true,
  },
};

/**
 * The front door. Signed out: the sign-in form. Signed in: straight to the
 * one cockpit this person has; a chooser if they have several; the admin view
 * for admins. Aziz, 2026-09-12: "they open up the website and just log in, it
 * automatically brings them to their cockpit."
 */
export function PortalHome() {
  const { ready, session, isAuthenticated } = useCockpitAuth();

  if (!ready) {
    return (
      <BackendWait>
        <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Spinner />
          One moment…
        </div>
      </BackendWait>
    );
  }

  if (!session || !isAuthenticated) {
    return <LoginPage />;
  }

  return <Chooser />;
}

function Chooser() {
  const { isCeo, isAdmin, cockpits, email, name, ready } = useCockpitAuth();

  if (!ready)
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Checking your access…
      </div>
    );

  if (isCeo) return <Navigate to="/ceo" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;

  if (cockpits.length === 1 && COCKPIT_META[cockpits[0]]) {
    return <Navigate to={COCKPIT_META[cockpits[0]].to} replace />;
  }

  if (cockpits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <Wordmark size="lg" className="mx-auto" />
          <h1 className="text-xl font-semibold">
            No cockpit on your account yet
          </h1>
          <p className="text-sm text-muted-foreground">
            You are signed in as {email}. Ask Aziz to add you in the portal's
            admin view, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <Wordmark size="lg" className="mx-auto" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Where to, {name ? name.split(" ")[0] : "there"}?
          </h1>
          <p className="text-sm text-muted-foreground">
            You have more than one seat. Pick a cockpit.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {cockpits.map(c => {
            if (!COCKPIT_META[c]) return null;
            const Icon = COCKPIT_ICON[c];
            return (
              <Link
                key={c}
                to={COCKPIT_META[c].to}
                className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-[color:var(--mahara-teal)]/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-[color:var(--mahara-teal)]">
                  {Icon ? <Icon className="size-5" aria-hidden /> : null}
                </span>
                <span className="min-w-0 text-left">
                  <span className="block font-semibold">
                    {COCKPIT_META[c].label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {COCKPIT_META[c].blurb}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
