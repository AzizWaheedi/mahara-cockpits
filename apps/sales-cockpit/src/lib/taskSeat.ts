import type { SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { useWho } from "@/lib/auth";
import { portalUrl } from "@/lib/portal";
import { supabase } from "@/lib/supabase";
import { toast } from "@/lib/toast";

/**
 * The seat as the shared task and request screens need it
 * (docs/requests/CONTRACT.md 6.2). One per cockpit, not shared: the sales cockpit
 * reads its own sign-in (useWho), its own Supabase client and its own small
 * toast; the portal's requests pages are on the same origin, one link away.
 */
export type TaskCockpit = "portal" | "csm" | "creative" | "editor" | "sales";

export interface TaskSeat {
  client: SupabaseClient | null;
  ready: boolean;
  signedIn: boolean;
  cockpit: TaskCockpit;
  /** A portal page's address from this cockpit. */
  portalHref(path: string): string;
  inPortal: boolean;
  toast: { success(message: string): void; error(message: string): void };
}

export function useTaskSeat(): TaskSeat {
  const { session, ready } = useWho();
  const signedIn = Boolean(session);
  return useMemo(
    () => ({
      client: supabase,
      ready,
      signedIn,
      cockpit: "sales",
      portalHref: (path: string) => `${portalUrl()}${path}`,
      inPortal: false,
      toast: {
        success: (message: string) => toast.success(message),
        error: (message: string) => toast.error(message),
      },
    }),
    [ready, signedIn],
  );
}
