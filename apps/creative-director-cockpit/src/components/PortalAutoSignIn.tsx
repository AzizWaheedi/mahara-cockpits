import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Sign-in through the portal.
 *
 * Every employee signs in once at the portal; it sends them here with a
 * two-minute `portal_token` in the URL, which this component swaps for this
 * cockpit's own year-long session. Someone who opens this cockpit's link
 * directly without a session is sent to the portal, which brings them
 * straight back signed in (or asks them to sign in first, once).
 */

export const COCKPIT = "creative";
const OWN_HOSTS = [
  "mahara-client-success.vercel.app",
  "mahara-creative-director.vercel.app",
];

export function portalUrl(): string {
  const env = (import.meta.env.VITE_PORTAL_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, "");
  // Proxied under the portal's domain: the portal is this origin.
  if (!OWN_HOSTS.includes(window.location.host)) return window.location.origin;
  return "https://cockpit.maharamedia.com";
}

const NEXT_KEY = "portal_next";
/** Set while a pass is being fetched from the portal or swapped for a session. */
const PENDING_KEY = "portal_pending_at";
/** A swap or a bounce that takes longer than this has failed; the login page may show. */
const PENDING_MS = 45_000;

function setPending(on: boolean) {
  try {
    if (on) sessionStorage.setItem(PENDING_KEY, String(Date.now()));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage can be off; the route guard then falls back to the login page.
  }
}

/**
 * True while the portal is signing this person in: a pass is in the address
 * or one was asked for moments ago. The route guards wait on it instead of
 * showing the login page for the seconds the swap takes (Aziz, 2026-09-21:
 * switching cockpits must not pass through a login screen).
 */
export function portalSignInPending(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has("portal_token"))
      return true;
    const at = Number(sessionStorage.getItem(PENDING_KEY) ?? 0);
    return at > 0 && Date.now() - at < PENDING_MS;
  } catch {
    return false;
  }
}
const BOUNCE_KEY = "portal_bounced_at";

export function PortalAutoSignIn() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const acted = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (acted.current || isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("portal_token");
    const next = params.get("next");
    if (token) {
      acted.current = true;
      if (next) sessionStorage.setItem(NEXT_KEY, next);
      // Drop the token from the address bar before anything else sees it.
      params.delete("portal_token");
      params.delete("next");
      // window.location keeps the /creative base; the router's pathname does not.
      const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", clean);
      setPending(true);
      signIn("portal", { token })
        .then(() => {
          setPending(false);
          const to = sessionStorage.getItem(NEXT_KEY) || "/dashboard";
          sessionStorage.removeItem(NEXT_KEY);
          navigate(to, { replace: true });
        })
        .catch(e => {
          setPending(false);
          setFailed(String((e as Error).message ?? e));
        });
      return;
    }
    if (isAuthenticated) {
      setPending(false);
      const to = sessionStorage.getItem(NEXT_KEY);
      if (to) {
        sessionStorage.removeItem(NEXT_KEY);
        navigate(to, { replace: true });
      }
      return;
    }
    // No session and no token: let the portal sign them in. Once per minute,
    // so a person the portal will not admit lands on the login page instead
    // of bouncing forever.
    const last = Number(sessionStorage.getItem(BOUNCE_KEY) ?? 0);
    if (
      Date.now() - last < 60_000 ||
      location.pathname === "/login" ||
      location.pathname === "/signup"
    ) {
      // Not bouncing again: the login page is the honest state now.
      setPending(false);
      return;
    }
    acted.current = true;
    setPending(true);
    sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    const wanted =
      location.pathname === "/"
        ? "/dashboard"
        : location.pathname + location.search;
    window.location.replace(
      `${portalUrl()}/go/${COCKPIT}?next=${encodeURIComponent(wanted)}`,
    );
  }, [
    isAuthenticated,
    isLoading,
    signIn,
    navigate,
    location.pathname,
    location.search,
  ]);

  if (failed)
    return (
      <div className="fixed inset-x-0 top-0 z-50 bg-destructive/10 px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] text-center text-sm text-destructive">
        The portal pass was not accepted ({failed}). Open the portal again from{" "}
        <a className="underline" href={portalUrl()}>
          {portalUrl().replace(/^https?:\/\//, "")}
        </a>
        .
      </div>
    );
  return null;
}
