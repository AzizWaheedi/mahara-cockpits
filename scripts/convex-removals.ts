#!/usr/bin/env bun
/**
 * What a Convex deploy would take away from production.
 *
 * `convex deploy` replaces every function in the deployment with the ones in
 * this clone. Work another agent shipped from a branch goes with it, without
 * a word: on 2026-10-05 a ship from main removed the client check-in
 * booking's functions and its checkInBookings.by_key index, which had
 * reached the client success deployment from an unmerged branch. Aziz:
 * "make sure that if any other agents are working side by side, you don't
 * delete each other's work."
 *
 * So before the deploy, ship.sh runs this: every function production has must
 * still be exported by this clone, or the ship stops and names it. Merge the
 * other work first; or, when a removal is meant, name it:
 *
 *   SHIP_ALLOW_REMOVE="checkIns.js:prepare,checkIns.js:book" scripts/ship.sh client-success
 *   SHIP_ALLOW_REMOVE="checkIns.js" ...   (a whole module)
 *
 * HTTP routes are not compared (the auth library adds its own at run time).
 * When production cannot be read the ship stops too; SHIP_SKIP_REMOVAL_CHECK=1
 * overrides that, for an outage, not for convenience.
 *
 *   bun scripts/convex-removals.ts apps/client-success-cockpit
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The names a module exports, as Convex sees them (module.js:name). */
export function exportedNames(source: string): Set<string> {
  const out = new Set<string>();
  const add = (name: string) => {
    const n = name.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
  };
  // export const x = ..., export function x(, export async function x(, export class x
  for (const m of source.matchAll(
    /export\s+(?:const|let|var|function\*?|async\s+function\*?|class)\s+([A-Za-z_$][\w$]*)/g,
  ))
    add(m[1]);
  // export const { a, b: c, ...rest } = ... (convexAuth's signIn, signOut, store)
  for (const m of source.matchAll(
    /export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/g,
  ))
    for (const part of m[1].split(",")) {
      const p = part.replace(/^\s*\.\.\./, "").split("=")[0];
      add(p.includes(":") ? p.split(":")[1] : p);
    }
  // export { a, b as c } and export { a } from "./x"
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (!p) continue;
      add(/\sas\s/.test(p) ? p.split(/\sas\s/)[1] : p);
    }
  if (/export\s+default\b/.test(source)) out.add("default");
  return out;
}

/** "ceo/queries.js:history" -> ["ceo/queries", "history"]. */
export function splitIdentifier(id: string): [string, string] | null {
  const m = /^(.+)\.(?:js|ts|tsx|mjs|cjs):(.+)$/.exec(id);
  return m ? [m[1], m[2]] : null;
}

/**
 * The production functions this clone would remove. `modules` maps a module
 * path without extension ("ceo/queries") to its source; `allow` holds the
 * identifiers or module names ("checkIns.js") that may go.
 */
export function removals(
  deployed: string[],
  modules: Map<string, string>,
  allow: string[] = [],
): string[] {
  const allowed = new Set(allow.map(a => a.trim()).filter(Boolean));
  const names = new Map<string, Set<string>>();
  const out: string[] = [];
  for (const id of deployed) {
    const parts = splitIdentifier(id);
    if (!parts) continue;
    const [mod, name] = parts;
    if (allowed.has(id) || allowed.has(`${mod}.js`)) continue;
    const source = modules.get(mod);
    if (source === undefined) {
      out.push(id);
      continue;
    }
    if (!names.has(mod)) names.set(mod, exportedNames(source));
    if (!names.get(mod)?.has(name)) out.push(id);
  }
  return out.sort();
}

/** Every module under convex/, keyed by its path without extension. */
function readModules(convexDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "_generated" || entry === "node_modules") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry) && !/\.d\.ts$/.test(entry))
        out.set(
          relative(convexDir, path).replace(/\.(ts|tsx|js|mjs|cjs)$/, ""),
          readFileSync(path, "utf8"),
        );
    }
  };
  walk(convexDir);
  return out;
}

async function main() {
  const appDir = process.argv[2];
  if (!appDir) {
    console.error("usage: bun scripts/convex-removals.ts <app dir>");
    process.exit(2);
  }
  const proc = Bun.spawn(["bunx", "convex", "function-spec", "--prod"], {
    cwd: appDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [text, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  let deployed: string[] = [];
  try {
    if (code !== 0) throw new Error(`exit ${code}`);
    const spec = JSON.parse(text.slice(text.indexOf("{")));
    deployed = ((spec.functions ?? []) as { identifier?: string }[])
      .map(f => f.identifier ?? "")
      .filter(Boolean);
  } catch (e) {
    if (process.env.SHIP_SKIP_REMOVAL_CHECK === "1") {
      console.log(
        `  production's functions could not be read (${String(e)}); SHIP_SKIP_REMOVAL_CHECK=1, shipping anyway`,
      );
      return;
    }
    console.error(
      `  production's functions could not be read (${String(e)}), so nothing proves this deploy keeps everyone's work. Try again, or SHIP_SKIP_REMOVAL_CHECK=1 during an outage.`,
    );
    process.exit(1);
  }
  const allow = (process.env.SHIP_ALLOW_REMOVE ?? "").split(",");
  const gone = removals(deployed, readModules(join(appDir, "convex")), allow);
  if (gone.length === 0) {
    console.log(
      `  keeps all ${deployed.length} production functions (${appDir})`,
    );
    return;
  }
  console.error(
    `  this deploy would remove ${gone.length} function${gone.length === 1 ? "" : "s"} production has, probably someone else's work:`,
  );
  for (const id of gone) console.error(`    - ${id}`);
  console.error(
    "  Merge that work into main first. If the removal is meant, name it: SHIP_ALLOW_REMOVE=\"<identifier or module.js>,...\".",
  );
  process.exit(1);
}

if (import.meta.main) await main();
