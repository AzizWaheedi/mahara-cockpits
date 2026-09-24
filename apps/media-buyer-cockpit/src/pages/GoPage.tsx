import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Wordmark } from "@/components/Wordmark";

const COCKPIT_PATHS: Record<string, string> = {
  csm: "/client-success",
  creative: "/creative",
  editor: "/editor",
  sales: "/sales",
  media_buyer: "",
};

/**
 * Inter-cockpit redirector and access gate.
 * Validates permission against verified Supabase identity, then routes
 * directly to the requested cockpit with session preservation.
 */
export function GoPage() {
  const { cockpit = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { access, ready, isAuthenticated } = useCockpitAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;

    if (!isAuthenticated) {
      const wanted = window.location.pathname + window.location.search;
      navigate(`/login?next=${encodeURIComponent(wanted)}`, { replace: true });
      return;
    }

    const path = COCKPIT_PATHS[cockpit];
    if (path === undefined) {
      setError("That cockpit does not exist.");
      return;
    }

    const isAllowed =
      access?.isAdmin ||
      access?.isCeo ||
      access?.cockpits.includes(cockpit) ||
      (cockpit === "media_buyer" && access?.roles.includes("media_buyer"));

    if (!isAllowed) {
      setError("That cockpit is not on your access. Ask Aziz.");
      return;
    }

    started.current = true;
    const next = params.get("next") ?? "/dashboard";
    const cleanNext = next.startsWith("/") ? next : `/${next}`;
    const targetPath = `${path}${cleanNext === "/dashboard" && path ? "/dashboard" : cleanNext}`;

    window.location.replace(targetPath);
  }, [ready, isAuthenticated, access, cockpit, params, navigate]);

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

