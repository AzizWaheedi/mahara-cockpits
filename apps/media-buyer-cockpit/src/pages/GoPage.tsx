import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { cockpitSwitchPath } from "@/auth/cockpitNavigation";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Wordmark } from "@/components/Wordmark";

/**
 * Inter-cockpit redirector and access gate.
 * Validates permission against verified Supabase identity, then routes
 * directly to the requested cockpit with session preservation.
 */
export function GoPage() {
  const { cockpit = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const {
    access,
    ready,
    isAuthenticated,
    error: accessError,
  } = useCockpitAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    if (accessError) {
      setError(accessError);
      return;
    }

    if (!isAuthenticated) {
      const wanted = window.location.pathname + window.location.search;
      navigate(`/login?next=${encodeURIComponent(wanted)}`, { replace: true });
      return;
    }

    try {
      const targetPath = cockpitSwitchPath(
        access,
        cockpit,
        params.get("next") ?? "/dashboard",
      );
      started.current = true;
      window.location.replace(targetPath);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not open that cockpit. Try again.",
      );
    }
  }, [ready, isAuthenticated, access, accessError, cockpit, params, navigate]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <Wordmark size="lg" className="mx-auto" />
        {error ? (
          <>
            <h1 className="text-lg font-semibold">
              Could not open that cockpit
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Link className="text-sm underline" to="/">
              Back to the portal
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Opening your cockpit…</p>
        )}
      </div>
    </div>
  );
}
