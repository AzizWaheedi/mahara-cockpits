import { ArrowRight } from "lucide-react";
import { Link, Navigate } from "react-router";
import { BackendWait } from "@/components/BackendWait";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
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
        <div className="p-10 text-sm text-muted-foreground">One moment…</div>
      </BackendWait>
    );
  }

  if (!session || !isAuthenticated) {
    return <LoginPage />;
  }

  return <Chooser />;
}

function Chooser() {
  const { isCeo, isAdmin, cockpits, email, name } = useCockpitAuth();

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
            const meta = COCKPIT_META[c];
            if (!meta) return null;
            return (
              <Button
                key={c}
                variant="outline"
                className="h-auto justify-between px-4 py-4"
                asChild
              >
                <Link to={meta.to}>
                  <span className="text-left">
                    <span className="block font-semibold">
                      {meta.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {meta.blurb}
                    </span>
                  </span>
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
