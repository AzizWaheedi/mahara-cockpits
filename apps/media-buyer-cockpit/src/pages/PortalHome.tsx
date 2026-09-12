import { useConvexAuth, useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { Link, Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";
import { api } from "../../convex/_generated/api";
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
};

/**
 * The front door. Signed out: the sign-in form. Signed in: straight to the
 * one cockpit this person has; a chooser if they have several; the admin view
 * for admins. Aziz, 2026-09-12: "they open up the website and just log in, it
 * automatically brings them to their cockpit."
 */
export function PortalHome() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading)
    return (
      <div className="p-10 text-sm text-muted-foreground">One moment…</div>
    );
  if (!isAuthenticated) return <LoginPage />;
  return <Chooser />;
}

function Chooser() {
  const me = useQuery(api.roles.me, {});
  if (me === undefined)
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Checking your access…
      </div>
    );
  if (me.isAdmin) return <Navigate to="/admin" replace />;
  const cockpits: string[] = me.cockpits ?? [];
  if (cockpits.length === 1)
    return <Navigate to={COCKPIT_META[cockpits[0]].to} replace />;
  if (cockpits.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <Wordmark size="lg" className="mx-auto" />
          <h1 className="text-xl font-semibold">
            No cockpit on your account yet
          </h1>
          <p className="text-sm text-muted-foreground">
            You are signed in as {me.email}. Ask Aziz to add you in the portal's
            admin view, then reload this page.
          </p>
        </div>
      </div>
    );
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <Wordmark size="lg" className="mx-auto" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Where to, {me.name?.split(" ")[0] ?? "there"}?
          </h1>
          <p className="text-sm text-muted-foreground">
            You have more than one seat. Pick a cockpit.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {cockpits.map(c => (
            <Button
              key={c}
              variant="outline"
              className="h-auto justify-between px-4 py-4"
              asChild
            >
              <Link to={COCKPIT_META[c].to}>
                <span className="text-left">
                  <span className="block font-semibold">
                    {COCKPIT_META[c].label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {COCKPIT_META[c].blurb}
                  </span>
                </span>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
