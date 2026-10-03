import path from "node:path";
import { mergeConfig } from "vite";
import config from "../../vite.config";
export default mergeConfig(config, {
  define: {
    "import.meta.env.VITE_VIKTOR_SPACES_ACCESS_MODE":
      JSON.stringify("authenticated"),
  },
  resolve: {
    alias: {
      "convex/react": path.resolve(import.meta.dirname, "convex.tsx"),
      "@convex-dev/auth/react": path.resolve(import.meta.dirname, "auth.tsx"),
    },
  },
  optimizeDeps: { entries: ["scripts/design-preview/index.html"] },
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
});
