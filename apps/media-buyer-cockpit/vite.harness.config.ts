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
      alias: {
        "convex/react": path.resolve(
          import.meta.dirname,
          "src/dev/convexStub.ts",
        ),
        "@convex-dev/auth/react": path.resolve(
          import.meta.dirname,
          "src/dev/authStub.ts",
        ),
      },
    },
    server: { port: 5179, strictPort: true },
  }),
);
