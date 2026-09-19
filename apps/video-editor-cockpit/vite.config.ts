import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// Served under the portal at cockpit.maharamedia.com/editor/, exactly as the
// client success and creative cockpits are served under their own paths.
export default defineConfig({
  base: "/editor/",
  plugins: [react(), tailwindcss()],
  // `@/` points at src, as it does in the other three cockpits, so a page
  // shared with them can keep its imports.
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: { outDir: "dist", sourcemap: false },
});
