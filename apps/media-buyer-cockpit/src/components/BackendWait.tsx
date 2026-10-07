import { type ReactNode, useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import {
  type BackendAvailability,
  probeCockpitBackend,
} from "@/lib/backendAvailability";

const PROBE_AFTER_MS = 4_000;
const RETRY_MS = 20_000;

type State = "waiting" | "down" | "offline";

function useBackendState(): State {
  const [state, setState] = useState<State>("waiting");
  useEffect(() => {
    let stopped = false;
    let wasDown = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      const answer: BackendAvailability = await probeCockpitBackend(url, anonKey);
      if (stopped) return;
      if (answer === "up") {
        if (wasDown) window.location.reload();
        return;
      }
      wasDown = true;
      setState(answer);
      timer = setTimeout(run, RETRY_MS);
    };
    timer = setTimeout(run, PROBE_AFTER_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return state;
}

export function BackendWait({ children }: { children: ReactNode }) {
  const state = useBackendState();
  if (state === "waiting") return <>{children}</>;
  return (
    <div className="flex min-h-[70vh] flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center" role="alert">
        <Wordmark size="lg" className="mx-auto" />
        {state === "down" ? (
          <>
            <h1 className="text-xl font-semibold">
              The cockpits are offline right now
            </h1>
            <p className="text-sm text-muted-foreground">
              The backend service is refusing requests, so nothing can load.
              Nothing is lost. This page reloads by itself as soon as it answers
              again.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">No connection</h1>
            <p className="text-sm text-muted-foreground">
              This device cannot reach the cockpit. Check the internet
              connection; the page tries again by itself.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
