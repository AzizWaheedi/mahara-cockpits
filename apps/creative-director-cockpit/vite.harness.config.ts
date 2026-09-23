// The social calendar harness: the app's own Vite config with the Convex
// hooks swapped for an in-memory stand-in, so the calendar and its sheets
// can be checked in a browser without signing in or a deployment behind
// them. `bun run harness`, then open http://localhost:5181/harness.html
//
// Uploads are real: /__harness/sign asks storage for a single-use link the
// way convex/social.ts uploadUrl does, under harness/ in the social-media
// bucket. The storage key is read from the Convex deployment's settings by
// this dev server and never reaches the browser or a file.
import { execFileSync } from "node:child_process";
import type { IncomingMessage } from "node:http";
import path from "path";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import base from "./vite.config";

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    req.on("data", c => {
      out += c;
    });
    req.on("end", () => resolve(out));
    req.on("error", reject);
  });
}

function signer(): Plugin {
  let url = "";
  let key = "";
  const env = (name: string) =>
    // Production's settings: the dev deployment still names an old storage
    // project that no longer answers.
    execFileSync("bunx", ["convex", "env", "get", "--prod", name], {
      cwd: import.meta.dirname,
      encoding: "utf8",
    }).trim();
  return {
    name: "harness-signer",
    configureServer(server) {
      server.middlewares.use("/__harness/sign", async (req, res) => {
        try {
          if (!key) {
            url = env("SUPABASE_URL").replace(/\/+$/, "");
            key = env("SUPABASE_SERVICE_ROLE_KEY");
          }
          const { filename, contentType } = JSON.parse(await body(req)) as {
            filename: string;
            contentType: string;
          };
          const kind = contentType.startsWith("video/") ? "video" : "image";
          const safe =
            filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-60) || "file";
          const where = `harness/${Date.now()}-${safe}`;
          const r = await fetch(
            `${url}/storage/v1/object/upload/sign/social-media/${where}`,
            {
              method: "POST",
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: "{}",
            },
          );
          if (!r.ok) throw new Error(`storage said ${r.status}`);
          const signed = (await r.json()) as { url: string };
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              uploadUrl: `${url}/storage/v1${signed.url}`,
              publicUrl: `${url}/storage/v1/object/public/social-media/${where}`,
              kind,
            }),
          );
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default mergeConfig(
  base,
  defineConfig({
    base: "/",
    plugins: [signer()],
    resolve: {
      alias: {
        "convex/react": path.resolve(
          import.meta.dirname,
          "src/dev/convexStub.ts",
        ),
      },
    },
    // Only the harness page: the app's own entry pulls in the sign-in
    // library, which this stand-in does not pretend to be.
    optimizeDeps: { entries: ["harness.html"] },
    server: { port: 5181, strictPort: true },
  }),
);
