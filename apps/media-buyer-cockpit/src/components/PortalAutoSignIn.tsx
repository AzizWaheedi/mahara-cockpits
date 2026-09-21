import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * A pass minted by this portal (`portal.mintFor`) in the URL opens a session
 * here, the same way it does in the other cockpits. Inert on a normal visit.
 */
export function PortalAutoSignIn() {
  const { signIn } = useAuthActions();
  const { isLoading } = useConvexAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const acted = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (acted.current || isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("portal_token");
    if (!token) return;
    acted.current = true;
    const next = params.get("next") || "/";
    params.delete("portal_token");
    params.delete("next");
    window.history.replaceState(
      null,
      "",
      `${location.pathname}${params.toString() ? `?${params}` : ""}`,
    );
    signIn("portal", { token })
      .then(() => navigate(next, { replace: true }))
      .catch(e => setFailed(String((e as Error).message ?? e)));
  }, [isLoading, signIn, navigate, location.pathname]);

  if (failed)
    return (
      <div className="fixed inset-x-0 top-0 z-50 bg-destructive/10 px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] text-center text-sm text-destructive">
        That sign-in link was not accepted ({failed}). Sign in with your email
        instead.
      </div>
    );
  return null;
}
