// The layout harness: the app's own Vite config with the Convex hooks
// swapped for fixture-backed stand-ins. `bun run harness`, then open
// http://localhost:5179/harness.html?tab=ads
import path from "path";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        {
          find: "convex/react",
          replacement: path.resolve(
            import.meta.dirname,
            "src/dev/convexStub.ts",
          ),
        },
        {
          find: "@convex-dev/auth/react",
          replacement: path.resolve(import.meta.dirname, "src/dev/authStub.ts"),
        },
        // A signed-in CEO, since the CEO page waits for one (authHarness.ts).
        {
          find: /^@\/auth\/SupabaseAuthProvider$/,
          replacement: path.resolve(
            import.meta.dirname,
            "src/dev/authHarness.ts",
          ),
        },
        // Hours and pay: the month comes from the hand-made fixture, not
        // the rule (src/dev/hoursFixture.ts, picked with ?hours=).
        {
          find: /^\.\.\/types\/ceo\/hoursModel$/,
          replacement: path.resolve(
            import.meta.dirname,
            "src/dev/hoursModelHarness.ts",
          ),
        },
      ],
    },
    // The harness reads no real data: the cockpit's Supabase client is built
    // with a placeholder key and its rpc answers from fixtures (hoursHarness.ts).
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        "https://bldgtotkfmhoxmlzowdx.supabase.co",
      ),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
        "harness-placeholder-key",
      ),
    },
    server: { port: 5179, strictPort: true },
  }),
);
