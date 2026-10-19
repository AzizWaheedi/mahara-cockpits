#!/usr/bin/env node
/**
 * Screenshots of every slide and every stop of a client deck, from the
 * harness's fixtures, at 1920 x 1080 and 1366 x 768 (and the notes window
 * and the prep view once each), so a person can look at them before a call.
 *
 *   node scripts/deck-shots.mjs [--deck onboarding|launch] [--fixtures full,sparse,dwy]
 *     [--langs en,ar] [--sizes 1920x1080,1366x768] [--still yes|no]
 *     [--parts no] [--out <dir>] [--url http://localhost:5199]
 *
 * The launch deck is shot still by default (reduced motion: the call's
 * stages whole, the lines drawn), so each stop is what it settles to.
 *
 * Without --url it starts the Vite dev server itself and stops it after.
 * Files land in <out>/<deck>/<fixture>-<lang>/<width>x<height>/NN-<slide>-<stop>.png.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const deck = args.deck ?? "onboarding";
const fixtures = (
  args.fixtures ?? (deck === "launch" ? "full,sparse,dwy,starter" : "full,sparse,dwy")
).split(",");
const langs = (args.langs ?? "en,ar").split(",");
const out = resolve(args.out ?? join(app, "tmp", "deck-shots"));
const sizes = (args.sizes ?? "1920x1080,1366x768")
  .split(",")
  .map(x => x.split("x").map(Number));
const still = (args.still ?? (deck === "launch" ? "yes" : "no")) === "yes";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startVite() {
  const port = 5199;
  const vite = spawn("bunx", ["vite", "--port", String(port), "--strictPort"], {
    cwd: app,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/client-success/present-harness.html`);
      if (r.ok) return { url, stop: () => vite.kill() };
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  vite.kill();
  throw Error("The Vite dev server did not start.");
}

/** Where the deck is: the mounted slide's id and stop. */
const where = page =>
  page.evaluate(() => {
    const s = document.querySelector(".dk-slide");
    return s ? `${s.getAttribute("data-slide")}:${s.getAttribute("data-stop")}` : "";
  });

async function walk(browser, base, fixture, lang, [w, h]) {
  const dir = join(out, deck, `${fixture}-${lang}`, `${w}x${h}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    `${base}/client-success/present-harness.html?fixture=${fixture}&deck=${deck}&lang=${lang}${still ? "&still=1" : ""}`,
  );
  await page.waitForSelector(".dk-slide");
  await page.evaluate(() => document.fonts.ready);
  // The chrome hides after 2.5 s without the mouse; the shots are taken idle.
  await sleep(2800);
  let n = 1;
  let last = "";
  for (let guard = 0; guard < 90; guard++) {
    let at = await where(page);
    if (at === last) {
      // A slide may take one press first (the call finishes its stage).
      await page.keyboard.press("ArrowRight");
      await sleep(900);
      at = await where(page);
      if (at === last) break;
    }
    const [id, stop] = at.split(":");
    await page.screenshot({ path: join(dir, `${String(n).padStart(2, "0")}-${id}-${stop}.png`) });
    n++;
    last = at;
    await page.keyboard.press("ArrowRight");
    await sleep(900);
  }
  await page.close();
  return { dir, count: n - 1, errors };
}

/** The launch deck's shared pieces, drawn once (the harness's parts sheet). */
async function parts(browser, base, lang) {
  const dir = join(out, "parts", lang);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const sheet of [0, 1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${base}/client-success/present-harness.html?view=parts&lang=${lang}&sheet=${sheet}`);
    await page.waitForSelector(".dk-slide");
    await page.evaluate(() => document.fonts.ready);
    await sleep(800);
    await page.screenshot({ path: join(dir, `sheet-${sheet}.png`) });
    await page.close();
  }
  return dir;
}

async function views(browser, base, fixture, lang) {
  const dir = join(out, deck, `${fixture}-${lang}`, "views");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [view, w, h] of [
    ["prep", 1440, 900],
    ["notes", 520, 820],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(
      `${base}/client-success/present-harness.html?fixture=${fixture}&deck=${deck}&lang=${lang}&view=${view}${still ? "&still=1" : ""}`,
    );
    await sleep(1800);
    await page.screenshot({ path: join(dir, `${view}.png`), fullPage: view === "notes" });
    await page.close();
  }
  return dir;
}

const server = args.url ? { url: args.url, stop: () => {} } : await startVite();
// Playwright's own browser when it is installed, else the Chrome on this Mac
// (a Playwright bump can leave the cached build behind or incomplete).
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ channel: "chrome" });
}
let failed = false;
try {
  for (const fixture of fixtures)
    for (const lang of langs) {
      for (const size of sizes) {
        const r = await walk(browser, server.url, fixture, lang, size);
        console.log(`${deck} ${fixture} ${lang} ${size.join("x")}: ${r.count} shots in ${r.dir}`);
        if (r.errors.length) {
          failed = true;
          console.error(`  page errors:\n  ${r.errors.join("\n  ")}`);
        }
      }
      console.log(`  views: ${await views(browser, server.url, fixture, lang)}`);
    }
  if (args.parts !== "no")
    for (const lang of langs) console.log(`parts ${lang}: ${await parts(browser, server.url, lang)}`);
} finally {
  await browser.close();
  server.stop();
}
process.exit(failed ? 1 : 0);
