import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { portalDoor, portalUrl, signInWithPortalToken } from "../lib/portal";

/**
 * Swap the portal's two-minute pass for a session, or go and fetch one.
 *
 * Someone who opens this cockpit's own link without a session is sent to the
 * portal, which brings them straight back signed in, or asks them to sign in
 * there once. The password form underneath stays reachable, so the desk is
 * still openable on a day the portal is not.
 */

const NEXT_KEY = "portal_next";
const BOUNCE_KEY = "portal_bounced_at";

export function PortalAutoSignIn({
  hasSession,
  ready,
  onSignedIn,
}: {
  hasSession: boolean;
  ready: boolean;
  onSignedIn: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const acted = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (acted.current || !ready) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("portal_token");
    const next = params.get("next");

    if (token) {
      acted.current = true;
      if (next) sessionStorage.setItem(NEXT_KEY, next);
      // Drop the pass from the address bar before anything else sees it.
      params.delete("portal_token");
      params.delete("next");
      const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", clean);
      signInWithPortalToken(token)
        .then(() => {
          const to = sessionStorage.getItem(NEXT_KEY) || "/";
          sessionStorage.removeItem(NEXT_KEY);
          onSignedIn();
          navigate(to.startsWith("/") ? to : "/", { replace: true });
        })
        .catch(e => setFailed(String((e as Error).message ?? e)));
      return;
    }

    if (hasSession) {
      const to = sessionStorage.getItem(NEXT_KEY);
      if (to) {
        sessionStorage.removeItem(NEXT_KEY);
        navigate(to.startsWith("/") ? to : "/", { replace: true });
      }
      return;
    }

    // No session and no pass: let the portal try. Once a minute, so someone
    // the portal will not admit lands on the sign-in form instead of
    // bouncing between the two forever.
    const last = Number(sessionStorage.getItem(BOUNCE_KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    acted.current = true;
    const wanted = location.pathname + location.search;
    window.location.replace(portalDoor(wanted === "/" ? "/" : wanted));
  }, [
    hasSession,
    ready,
    navigate,
    onSignedIn,
    location.pathname,
    location.search,
  ]);

  if (!failed) return null;
  return (
    <div
      className="px-4 py-2 text-center text-sm"
      style={{
        background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
      }}
    >
      The portal pass was not accepted ({failed}). Open the portal again at{" "}
      <a className="underline underline-offset-2" href={portalUrl()}>
        {portalUrl().replace(/^https?:\/\//, "")}
      </a>
      , or sign in below.
    </div>
  );
}
