import type { SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";

/**
 * The seat as the shared task and request screens need it
 * (docs/requests/CONTRACT.md 6.2). One per cockpit, not shared: the portal
 * reads the cockpit sign-in and sonner, and its requests pages are its own
 * routes, so a portal path is the address itself.
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
  const { client, ready, isAuthenticated } = useCockpitAuth();
  return useMemo(
    () => ({
      client,
      ready,
      signedIn: isAuthenticated,
      cockpit: "portal",
      portalHref: (path: string) => path,
      inPortal: true,
      toast: {
        success: (message: string) => toast.success(message),
        error: (message: string) => toast.error(message),
      },
    }),
    [client, ready, isAuthenticated],
  );
}
