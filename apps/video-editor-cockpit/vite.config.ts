import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served under the portal at cockpit.maharamedia.com/editor/, exactly as the
// client success and creative cockpits are served under their own paths.
export default defineConfig({
  base: "/editor/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: false },
});
