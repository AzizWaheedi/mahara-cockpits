import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "../../convex/_generated/api";

/**
 * Sign-in through the portal.
 *
 * Every employee signs in once at the portal; it sends them here with a
 * two-minute `portal_token` in the URL, which this component swaps for this
 * cockpit's own year-long session. Someone who opens this cockpit's link
 * directly without a session is sent to the portal, which brings them
 * straight back signed in (or asks them to sign in first, once).
 */

export const COCKPIT = "csm";
const OWN_HOSTS = [
  "mahara-client-success.vercel.app",
  "mahara-creative-director.vercel.app",
];

const PORTAL_URL = "https://cockpit.maharamedia.com";

export function portalUrl(): string {
  const env = (import.meta.env.VITE_PORTAL_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, "");
  // Rendered without a browser (the contract tests): the portal's own address.
  if (typeof window === "undefined") return PORTAL_URL;
  // Proxied under the portal's domain: the portal is this origin.
  if (!OWN_HOSTS.includes(window.location.host)) return window.location.origin;
  return PORTAL_URL;
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
const REFRESH_KEY = "portal_refreshed_at";
/** How old the portal's word on this person may get before a fresh pass is fetched. */
const MEMBER_TTL_MS = 60 * 60_000;

export function PortalAutoSignIn() {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const acted = useRef(false);
  // The portal refresh is judged once per page load. Left to the effect
  // below it would fire on the next route change after the hour is up and
  // drop whatever the CSM had half-typed.
  const checkedMember = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Only once signed in: the query needs a session.
  const me = useQuery(api.roles.me, isAuthenticated ? {} : "skip");
  const memberAt: number | null = me?.memberAt ?? null;

  useEffect(() => {
    if (acted.current || isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("portal_token");
    const next = params.get("next");
    const wanted =
      location.pathname === "/"
        ? "/dashboard"
        : location.pathname + location.search;
    const goThroughPortal = () => {
      acted.current = true;
      setPending(true);
      window.location.replace(
        `${portalUrl()}/go/${COCKPIT}?next=${encodeURIComponent(wanted)}`,
      );
    };
    if (token) {
      acted.current = true;
      if (next) sessionStorage.setItem(NEXT_KEY, next);
      // Drop the token from the address bar before anything else sees it.
      params.delete("portal_token");
      params.delete("next");
      // window.location keeps the /client-success base; the router's pathname does not.
      const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", clean);
      setPending(true);
      // A pass that arrives while a session is already open (the hourly
      // refresh, or a second switch) must not be swapped on top of it: the
      // old session's token refresh then fails and wipes the new tokens,
      // which left the login page behind every other switch (2026-09-21).
      // Close the old session first, then open the new one; one retry for
      // a passing server error.
      const swap = () => signIn("portal", { token });
      const opened = isAuthenticated
        ? signOut()
            .catch(() => undefined)
            .then(swap)
        : swap();
      opened
        .catch(() => new Promise(r => setTimeout(r, 1500)).then(swap))
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
    const onAuthPage =
      location.pathname === "/login" || location.pathname === "/signup";
    if (isAuthenticated) {
      setPending(false);
      const to = sessionStorage.getItem(NEXT_KEY);
      if (to) {
        sessionStorage.removeItem(NEXT_KEY);
        navigate(to, { replace: true });
        return;
      }
      // Seats and client lists change in the portal's admin view and only
      // travel on a fresh pass. At most once an hour per tab, and only on a
      // page load, go through the portal again so a change does not wait for
      // a sign-out. A live portal session brings them straight back.
      if (onAuthPage) return;
      if (memberAt === null || checkedMember.current) return;
      checkedMember.current = true;
      if (Date.now() - memberAt < MEMBER_TTL_MS) return;
      const lastRefresh = Number(sessionStorage.getItem(REFRESH_KEY) ?? 0);
      if (Date.now() - lastRefresh < MEMBER_TTL_MS) return;
      sessionStorage.setItem(REFRESH_KEY, String(Date.now()));
      goThroughPortal();
      return;
    }
    // No session and no token: let the portal sign them in. Once per minute,
    // so a person the portal will not admit lands on the login page instead
    // of bouncing forever.
    const last = Number(sessionStorage.getItem(BOUNCE_KEY) ?? 0);
    if (Date.now() - last < 60_000 || onAuthPage) {
      // Not bouncing again: the login page is the honest state now.
      setPending(false);
      return;
    }
    sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    goThroughPortal();
  }, [
    isAuthenticated,
    isLoading,
    memberAt,
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
