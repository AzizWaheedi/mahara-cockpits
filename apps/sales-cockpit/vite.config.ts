import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import { supabaseEnvProblem } from "./src/lib/env";

// Served under the portal at cockpit.maharamedia.com/sales/, exactly as the
// editor desk is served under /editor/.
export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    // A wrong Supabase value used to build cleanly and open on a blank page
    // (2026-09-24). Now the build stops, so the deploy fails where it can be
    // seen. On Vercel the values come from the project's variables.
    const env = loadEnv(mode, import.meta.dirname, "VITE_");
    const problem = supabaseEnvProblem(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_ANON_KEY,
    );
    if (problem)
      throw new Error(
        `${problem} Set it on the Vercel project mahara-sales (or in .env.local) and build again.`,
      );
  }
  return {
    base: "/sales/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    server: { port: 5190, strictPort: true },
    build: { outDir: "dist", sourcemap: false },
  };
});
