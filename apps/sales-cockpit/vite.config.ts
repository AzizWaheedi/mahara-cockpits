import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// Served under the portal at cockpit.maharamedia.com/sales/, exactly as the
// editor desk is served under /editor/.
export default defineConfig({
  base: "/sales/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { port: 5190, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
});
