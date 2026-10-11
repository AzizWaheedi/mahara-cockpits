/**
 * The layout harness's sign-in: since the native Supabase cutover the CEO
 * page waits for a verified CEO session, which the harness never has. This
 * stands in for `@/auth/SupabaseAuthProvider` (vite.harness.config.ts) with
 * a ready CEO and the cockpit's own client, whose rpc answers from made-up
 * fixtures (hoursHarness.ts). Everything else is the real module. Never
 * imported by the production app.
 */
import {
  type CockpitAuthState,
  getCockpitSupabaseClient,
} from "../auth/SupabaseAuthProvider";

export * from "../auth/SupabaseAuthProvider";

let state: CockpitAuthState | null = null;

export function useCockpitAuth(): CockpitAuthState {
  if (!state) {
    const access = {
      email: "ceo@example.test",
      name: "The CEO",
      roles: ["ceo"],
      clients: [],
      isAdmin: true,
      isCeo: true,
      cockpits: ["csm", "creative", "editor", "sales"],
      home: "/ceo",
    };
    // ?reads=1 gives the harness a made-up session, so the reads that wait
    // for one (useQuery, useQueryState: the LTV card, the proposals card)
    // run against the fixtures in hoursHarness.ts. Off by default, as before.
    const reads =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("reads") === "1";
    state = {
      client: getCockpitSupabaseClient(),
      session: reads
        ? ({
            user: { id: "harness-ceo", email: "ceo@example.test" },
          } as unknown as CockpitAuthState["session"])
        : null,
      access,
      ready: true,
      error: null,
      isAuthenticated: true,
      isAdmin: true,
      isCeo: true,
      email: access.email,
      name: access.name,
      roles: access.roles,
      clients: access.clients,
      cockpits: access.cockpits,
      home: access.home,
      signOut: async () => {},
      refreshAccess: async () => {},
    };
  }
  return state;
}
