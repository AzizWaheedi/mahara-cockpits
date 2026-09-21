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
/** Set while a pass is being fetched from the portal or swapped for a session. */
const PENDING_KEY = "portal_pending_at";
/** A swap or a bounce that takes longer than this has failed; the sign-in form may show. */
const PENDING_MS = 45_000;

function setPending(on: boolean) {
  try {
    if (on) sessionStorage.setItem(PENDING_KEY, String(Date.now()));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage can be off; the shell then falls back to the sign-in form.
  }
}

/**
 * True while the portal is signing this person in: a pass is in the address
 * or one was asked for moments ago. The shell waits on it instead of showing
 * the sign-in form for the seconds the swap takes (Aziz, 2026-09-21:
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
      setPending(true);
      signInWithPortalToken(token)
        .then(() => {
          setPending(false);
          const to = sessionStorage.getItem(NEXT_KEY) || "/";
          sessionStorage.removeItem(NEXT_KEY);
          onSignedIn();
          navigate(to.startsWith("/") ? to : "/", { replace: true });
        })
        .catch(e => {
          setPending(false);
          setFailed(String((e as Error).message ?? e));
        });
      return;
    }

    if (hasSession) {
      setPending(false);
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
    if (Date.now() - last < 60_000) {
      // Not bouncing again: the sign-in form is the honest state now.
      setPending(false);
      return;
    }
    sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
    acted.current = true;
    setPending(true);
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
