import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Wordmark } from "@/components/Wordmark";
import { api } from "../../convex/_generated/api";

/**
 * The door into a cockpit that lives on another deployment. Mints a
 * two-minute pass from the portal and hands it to the cockpit, which opens
 * its own session and drops the pass from the address bar.
 */
export function GoPage() {
  const { cockpit = "" } = useParams();
  const [params] = useSearchParams();
  const mint = useAction(api.portal.mintToken);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mint({ cockpit })
      .then(({ token, path }) => {
        const next = params.get("next") ?? "/dashboard";
        const q = new URLSearchParams({ portal_token: token, next });
        // A real route, not the bare root, so the proxy rule always matches.
        window.location.replace(`${path}/dashboard?${q}`);
      })
      .catch(e => setError(String((e as Error).message ?? e)));
  }, [mint, cockpit, params]);

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
