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
  return "https://mahara-media-buyer.vercel.app";
}

const NEXT_KEY = "portal_next";
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
      const clean = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", clean);
      signIn("portal", { token })
        .then(() => {
          const to = sessionStorage.getItem(NEXT_KEY) || "/dashboard";
          sessionStorage.removeItem(NEXT_KEY);
          navigate(to, { replace: true });
        })
        .catch(e => setFailed(String((e as Error).message ?? e)));
      return;
    }
    if (isAuthenticated) {
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
    if (Date.now() - last < 60_000) return;
    if (location.pathname === "/login" || location.pathname === "/signup")
      return;
    acted.current = true;
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
      <div className="fixed inset-x-0 top-0 z-50 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        The portal pass was not accepted ({failed}). Open the portal again from{" "}
        <a className="underline" href={portalUrl()}>
          {portalUrl().replace(/^https?:\/\//, "")}
        </a>
        .
      </div>
    );
  return null;
}
