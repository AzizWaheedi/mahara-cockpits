import { type ReactNode, useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";

/**
 * What a page shows while the sign-in is still loading, until it is clear
 * that the backend is not there.
 *
 * 2026-09-23: the Convex team went over the free plan and every deployment
 * was switched off. A signed-in person's session has to be renewed through
 * Convex before any page can open, so everybody sat on "One moment…" or an
 * empty skeleton with no word of why. After a few seconds of waiting this
 * asks the deployment one public question that needs no sign-in
 * (portal:info). If that fails too, the page says the cockpits are offline,
 * keeps asking, and reloads itself once the answer comes back.
 */

const PROBE_AFTER_MS = 4_000;
const RETRY_MS = 20_000;

type Answer = "up" | "down" | "offline";
type State = "waiting" | "down" | "offline";

async function probe(): Promise<Answer> {
  const base = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!base) return "up";
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "portal:info", args: {}, format: "json" }),
    });
    const body = (await res.json().catch(() => null)) as {
      status?: string;
    } | null;
    return res.ok && body?.status === "success" ? "up" : "down";
  } catch {
    // The request never left or never came back: this device's connection.
    return "offline";
  }
}

function useBackendState(): State {
  const [state, setState] = useState<State>("waiting");
  useEffect(() => {
    let stopped = false;
    let wasDown = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const answer = await probe();
      if (stopped) return;
      if (answer === "up") {
        // The sign-in gave up while the backend was away; start clean.
        if (wasDown) window.location.reload();
        // Up and still loading is a slow sign-in, not an outage: stop asking.
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

/** Shows `children` (the usual loading screen) unless the backend is gone. */
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
              Convex, the service every cockpit runs on, is refusing every
              request, so nothing can load. Nothing is lost. This page reloads
              by itself as soon as it answers again.
            </p>
            <p className="text-sm text-muted-foreground">
              Aziz: the Convex dashboard says why. Last time it was the plan's
              usage limit, and upgrading the team brought everything back.
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
