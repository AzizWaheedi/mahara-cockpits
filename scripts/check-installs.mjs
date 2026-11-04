#!/usr/bin/env node
// Check in seconds that the installed packages are complete, before a ship
// spends 20 minutes on the readiness builds and tests.
//
// On 3 and 4 November 2026, four ships stopped after 20 to 35 minutes on a
// package with files missing (date-fns _lib, lucide-react icons) or cut short
// (zod), in a worktree whose packages were hard links. `bun install` saw the
// folders and reported nothing. Importing each package loads its files, so a
// missing or broken file shows up here at once.
//
//   node scripts/check-installs.mjs            the folders ship.sh builds and tests in
//   node scripts/check-installs.mjs <dir>...   only these folders
//
// Exit 1 names each broken package and the reinstall command. A package that
// cannot load in Node for another reason (it needs a browser, or has no
// JavaScript entry) is not a broken install and is skipped.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The same folders as scripts/prepare-worktree.sh: the readiness check builds
// all five apps whichever one ships.
const DEFAULT_DIRS = [
  ".",
  "apps/media-buyer-cockpit",
  "apps/client-success-cockpit",
  "apps/creative-director-cockpit",
  "apps/video-editor-cockpit",
  "apps/sales-cockpit",
  "hermes/media-native",
];
const PER_IMPORT_MS = 15000;
const PER_DIR_MS = 180000;

// Runs inside each folder (cwd), so bare names resolve from its node_modules.
const CHILD = String.raw`
import { readFileSync } from "node:fs";
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const names = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
  .filter((n) => !n.startsWith("@types/") && n !== "bun-types");
const LIMIT = Number(process.env.CHECK_INSTALLS_IMPORT_MS || 15000);
const inModules = (p) => /node_modules/.test(p || "");
const results = [];
for (const name of names) {
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r("timeout"), LIMIT); });
  try {
    const got = await Promise.race([import(name).then(() => "ok"), timeout]);
    results.push({ name, state: got });
  } catch (e) {
    const msg = String((e && e.message) || e);
    const code = e && e.code;
    let state = "skipped";
    let detail = "";
    const file = /Cannot find module '([^']+)'/.exec(msg);
    const pkgMissing = /Cannot find package '([^']+)'/.exec(msg);
    if (pkgMissing && pkgMissing[1] === name) {
      state = "missing";
    } else if ((code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") && file
               && (inModules(file[1]) || /^\.\.?[\\/]/.test(file[1]))) {
      state = "broken";
      detail = "missing file " + file[1];
    } else if (e instanceof SyntaxError && /compileSourceTextModule|wrapSafe|compileFunction/.test(String(e.stack))) {
      // A package file that does not parse: cut short or corrupted on disk.
      state = "broken";
      detail = "unreadable file: " + msg.split("\n")[0];
    }
    results.push({ name, state, detail });
  } finally {
    clearTimeout(timer);
  }
}
process.stdout.write("\n@@RESULTS@@" + JSON.stringify(results) + "\n");
process.exit(0);
`;

function checkDir(dir) {
  const abs = resolve(repo, dir);
  if (!existsSync(join(abs, "package.json"))) return Promise.resolve({ dir, skipped: true });
  if (!existsSync(join(abs, "node_modules"))) {
    return Promise.resolve({ dir, problems: [`${dir}: no installed packages (node_modules is missing)`] });
  }
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD], {
      cwd: abs,
      env: { ...process.env, CHECK_INSTALLS_IMPORT_MS: String(PER_IMPORT_MS), NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    const timer = setTimeout(() => child.kill(), PER_DIR_MS);
    child.on("close", () => {
      clearTimeout(timer);
      const at = out.lastIndexOf("@@RESULTS@@");
      if (at < 0) {
        done({ dir, unchecked: `${dir}: the package check did not finish in ${PER_DIR_MS / 1000} s, so its packages are not checked` });
        return;
      }
      const results = JSON.parse(out.slice(at + "@@RESULTS@@".length).trim());
      const problems = [];
      const slow = [];
      for (const r of results) {
        if (r.state === "missing") problems.push(`${dir}: ${r.name} is not installed`);
        if (r.state === "broken") problems.push(`${dir}: ${r.name} is incomplete (${r.detail})`);
        if (r.state === "timeout") slow.push(r.name);
      }
      done({ dir, problems, count: results.length, slow });
    });
  });
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DIRS;
const started = Date.now();
const all = await Promise.all(dirs.map(checkDir));
const problems = all.flatMap((r) => r.problems || []);
const brokenDirs = [...new Set(all.filter((r) => r.problems?.length).map((r) => r.dir))];
for (const r of all) {
  if (r.unchecked) console.log(`  warning: ${r.unchecked}`);
  if (r.slow?.length) console.log(`  warning: ${r.dir}: ${r.slow.join(", ")} did not load in ${PER_IMPORT_MS / 1000} s, so not checked`);
}
const secs = ((Date.now() - started) / 1000).toFixed(0);
if (problems.length === 0) {
  const checked = all.reduce((n, r) => n + (r.count || 0), 0);
  console.log(`Installed packages: ${checked} checked in ${all.filter((r) => r.count).length} folders, none broken (${secs} s).`);
  process.exit(0);
}
console.log(`Installed packages: ${problems.length} broken. The ship would fail on these after about 20 minutes.`);
for (const p of problems) console.log(`  - ${p}`);
const missingOnly = all.every((r) => (r.problems || []).every((p) => / is not installed$|node_modules is missing/.test(p)));
if (missingOnly) {
  console.log("Install them, then ship again: scripts/prepare-worktree.sh --apply");
} else {
  console.log("Reinstall them with real copies (not hard links), then ship again:");
  for (const d of brokenDirs) console.log(`  (cd ${d} && bun install --force --frozen-lockfile --backend=copyfile)`);
}
process.exit(1);
