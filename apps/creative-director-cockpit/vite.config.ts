import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// The portal serves this app and the client success app on one origin, and
// the Brand Blueprint call frames the client success deck from a /creative
// page (docs/brand-blueprint/EMBED.md 6). In dev, CS_DEV names the client
// success dev server (CS_DEV=http://localhost:5191) and /client-success is
// forwarded to it, so dev has the portal's one origin too. Nothing changes
// for the build.
const csDev = process.env.CS_DEV?.trim();

export default defineConfig({
  // Served under the portal domain at /creative/ (see vercel.json).
  base: "/creative/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: csDev
    ? {
        proxy: {
          "/client-success": { target: csDev, changeOrigin: true, ws: true },
        },
      }
    : undefined,
});
