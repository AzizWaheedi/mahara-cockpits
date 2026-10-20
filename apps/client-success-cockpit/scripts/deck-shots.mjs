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
 *
 * The video slots get their own pass (--videos no skips it), at 1920 x
 * 1080 for the full client: the quiet control with the presenter's chrome
 * awake, the player's ready, loading, didn't-load and can't-play states, and
 * the notes window and prep's Videos section. No provider is reached: every
 * player's frame is stubbed (a blank page, a page that never answers, or one
 * that posts YouTube's "embedding off" error).
 *
 * Every shot is also measured: anything painted on the slide that comes
 * within 4 px of the slide count, the mini rail or a slide's own foot line
 * is printed with the shot's name, and the run exits 1. So is a line marked
 * `data-one-line` (the partnership title's two lines) that wraps, and so
 * are any two runs of text in different blocks that overlap anywhere on the
 * slide (score round 2: a road's label drawn on the Arabic caption passed,
 * since only the foot was checked).
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

/**
 * What on the slide runs into the canvas's foot: the slide count, the mini
 * rail (its nodes, its line and its name) and the slide's own foot lines
 * (any `*-foot`). Measured in canvas pixels from what is painted: each run
 * of text, each picture or drawing, and each box with a visible border or
 * fill, clipped by the boxes that clip it, so a phone's scrolled-away rows
 * or a crop's hidden margin never count. A hit is anything within 4 px of
 * a foot part; the shot is named with what touched what, and the run fails.
 */
const collisions = page =>
  page.evaluate(() => {
    const canvas = document.querySelector(".dk-canvas");
    const slide = document.querySelector(".dk-slide");
    if (!canvas || !slide) return [];
    const c = canvas.getBoundingClientRect();
    const k = c.width / 1920 || 1;
    const toCanvas = r => ({
      l: (r.left - c.left) / k,
      t: (r.top - c.top) / k,
      r: (r.right - c.left) / k,
      b: (r.bottom - c.top) / k,
    });
    const shown = el =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      Number(getComputedStyle(el).opacity) > 0.05;
    /** The box an element is clipped to, from its clipping ancestors. */
    const clipOf = el => {
      let box = { l: 0, t: 0, r: 1920, b: 1080 };
      for (let p = el.parentElement; p && p !== canvas; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          const r = toCanvas(p.getBoundingClientRect());
          box = {
            l: Math.max(box.l, r.l),
            t: Math.max(box.t, r.t),
            r: Math.min(box.r, r.r),
            b: Math.min(box.b, r.b),
          };
        }
      }
      return box;
    };
    const clip = (r, box) => {
      const out = {
        l: Math.max(r.l, box.l),
        t: Math.max(r.t, box.t),
        r: Math.min(r.r, box.r),
        b: Math.min(r.b, box.b),
      };
      return out.r - out.l > 1 && out.b - out.t > 1 ? out : null;
    };
    const visibleColor = v => v && !/rgba\([^)]*,\s*0\)|transparent/.test(v);
    /** Every painted part under a root: text runs, pictures, ruled or filled boxes. */
    const painted = root => {
      const parts = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = walker.currentNode; n; n = walker.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) {
          if (!n.textContent.trim() || !n.parentElement || !shown(n.parentElement)) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const box = clipOf(n.parentElement);
          for (const r of range.getClientRects()) {
            const hit = clip(toCanvas(r), box);
            if (hit) parts.push({ el: n.parentElement, what: `"${n.textContent.trim().slice(0, 40)}"`, ...hit });
          }
          continue;
        }
        const el = n;
        if (!shown(el)) continue;
        const s = getComputedStyle(el);
        const tag = el.tagName.toLowerCase();
        const pic = ["img", "video", "canvas", "circle", "path", "line", "rect", "polyline"].includes(tag);
        const ruled = ["Top", "Right", "Bottom", "Left"].some(
          side => Number.parseFloat(s[`border${side}Width`]) > 0 && visibleColor(s[`border${side}Color`]) && s[`border${side}Style`] !== "none",
        );
        const filled = visibleColor(s.backgroundColor) || s.backgroundImage !== "none";
        if (!pic && !ruled && !filled) continue;
        if (tag === "svg") continue;
        const hit = clip(toCanvas(el.getBoundingClientRect()), clipOf(el));
        if (hit) parts.push({ el, what: `<${tag}${el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : ""}>`, ...hit });
      }
      return parts;
    };
    const near = (a, b, pad = 4) => a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad;
    const feet = [
      ...[...canvas.querySelectorAll(":scope > .dk-count, :scope > .dkc-rail")],
      ...[...slide.querySelectorAll('[class*="-foot"]')].filter(
        el => [...el.classList].some(x => x.endsWith("-foot")) && !el.closest(".dkc-phone, .dkc-phones"),
      ),
    ].filter(shown);
    const out = [];
    for (const foot of feet) {
      const mine = painted(foot);
      const name = [...foot.classList].find(x => x === "dk-count" || x === "dkc-rail" || x.endsWith("-foot"));
      for (const p of painted(slide)) {
        if (foot.contains(p.el) || p.el.contains(foot)) continue;
        const hit = mine.find(m => near(m, p));
        if (hit)
          out.push(`${p.what} at ${Math.round(p.l)},${Math.round(p.t)} to ${Math.round(p.r)},${Math.round(p.b)} touches ${name} ${hit.what}`);
      }
    }
    return [...new Set(out)];
  });

/**
 * Two runs of text that overlap anywhere on the slide: each run's line
 * boxes, clipped as painted, taken in by a sixth of their height top and
 * bottom (a line box is taller than its letters, and Arabic's most), and
 * compared with every run in another block. Runs in one block (a
 * paragraph's own lines, a mark inside its sentence) are never compared,
 * so a paragraph's tight leading is not a hit. More than 2 px of overlap
 * both ways is a hit, named with the shot, and the run fails.
 */
const overlaps = page =>
  page.evaluate(() => {
    const canvas = document.querySelector(".dk-canvas");
    const slide = document.querySelector(".dk-slide");
    if (!canvas || !slide) return [];
    const c = canvas.getBoundingClientRect();
    const k = c.width / 1920 || 1;
    const shown = el =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      Number(getComputedStyle(el).opacity) > 0.05;
    /** A run's clip: its own element too (a name cut with an ellipsis). */
    const clipOf = el => {
      let box = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let p = el; p && p !== canvas; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          const r = p.getBoundingClientRect();
          box = {
            l: Math.max(box.l, r.left),
            t: Math.max(box.t, r.top),
            r: Math.min(box.r, r.right),
            b: Math.min(box.b, r.bottom),
          };
        }
      }
      return box;
    };
    /** The run's block: its nearest box that is not inline. */
    const blockOf = el => {
      for (let p = el; p && p !== slide; p = p.parentElement) {
        const d = getComputedStyle(p).display;
        if (d !== "inline" && d !== "contents") return p;
      }
      return slide;
    };
    const runs = [];
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || !shown(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const box = clipOf(el);
      const block = blockOf(el);
      for (const r of range.getClientRects()) {
        const inset = r.height / 6;
        const l = Math.max(r.left, box.l);
        const rr = Math.min(r.right, box.r);
        const t = Math.max(r.top + inset, box.t);
        const b = Math.min(r.bottom - inset, box.b);
        if (rr - l > 1 && b - t > 1)
          runs.push({ block, what: n.textContent.trim().slice(0, 40), l, t, r: rr, b });
      }
    }
    const out = [];
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i];
        const b = runs[j];
        if (a.block === b.block || a.block.contains(b.block) || b.block.contains(a.block)) continue;
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 2 && h > 2)
          out.push(
            `"${a.what}" overlaps "${b.what}" at ${Math.round((Math.max(a.l, b.l) - c.left) / k)},${Math.round((Math.max(a.t, b.t) - c.top) / k)}`,
          );
      }
    return [...new Set(out)];
  });

/**
 * A line that must stay one line (`data-one-line`, the partnership title's
 * two lines): its text's line boxes, counted by their tops. More than one
 * is a wrap, named with the shot, and the run fails (DESIGN 20.3).
 */
const wraps = page =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".dk-slide [data-one-line]")) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set([...range.getClientRects()].filter(r => r.width > 1).map(r => Math.round(r.top)));
      if (tops.size > 1) out.push(`"${el.textContent.trim().slice(0, 50)}" wraps to ${tops.size} lines`);
    }
    return out;
  });

async function walk(browser, base, fixture, lang, [w, h]) {
  const dir = join(out, deck, `${fixture}-${lang}`, `${w}x${h}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  const hits = [];
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
    const file = `${String(n).padStart(2, "0")}-${id}-${stop}.png`;
    await page.screenshot({ path: join(dir, file) });
    for (const c of await collisions(page)) hits.push(`${file}: ${c}`);
    for (const c of await wraps(page)) hits.push(`${file}: ${c}`);
    for (const c of await overlaps(page)) hits.push(`${file}: ${c}`);
    n++;
    last = at;
    await page.keyboard.press("ArrowRight");
    await sleep(900);
  }
  await page.close();
  return { dir, count: n - 1, errors, hits };
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

/** The five providers' embed hosts: never reached from a shot. */
const PROVIDERS =
  /^https:\/\/(www\.loom\.com|www\.youtube-nocookie\.com|fast\.wistia\.net|player\.vimeo\.com|drive\.google\.com)\//;
const STUB_PAGE = `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0e1a42;color:#a9b4c8;font:28px system-ui">The provider's own player (stubbed for the shots)</body></html>`;
const BLOCKED_PAGE = `<!doctype html><html><body style="margin:0;background:#000"><script>parent.postMessage(JSON.stringify({event:"onError",info:150,channel:"widget",id:1}),"*")</script></body></html>`;

/** Stub every provider frame: "ready" loads a blank player, "hang" never answers, "blocked" posts YouTube's error. */
async function stubProviders(page, mode) {
  await page.route(
    url => PROVIDERS.test(url.toString()),
    route => {
      if (mode === "hang") return;
      return route.fulfill({
        contentType: "text/html",
        body: mode === "blocked" ? BLOCKED_PAGE : STUB_PAGE,
      });
    },
  );
}

/** The slide the deck is on, its control's text, and whether the player is up. */
const videoState = page =>
  page.evaluate(() => ({
    slide: document.querySelector(".dk-slide")?.getAttribute("data-slide"),
    control: document.querySelector(".dkv-control")?.textContent ?? null,
    opacity: (() => {
      const c = document.querySelector(".dkv-control");
      return c ? getComputedStyle(c).opacity : null;
    })(),
    player: Boolean(document.querySelector(".dkv-veil")),
    line: document.querySelector(".dkv-line")?.textContent ?? null,
  }));

/**
 * The video slots' own shots (DESIGN 21.9): the control awake on the slide
 * with a filled slot, the player's states with the frame stubbed, and the
 * notes window and prep's Videos section beside a deck window.
 */
async function videoShots(browser, base, lang) {
  const dir = join(out, deck, `videos-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const notes = [];
  const url = (extra = "") =>
    `${base}/client-success/present-harness.html?fixture=full&deck=${deck}&lang=${lang}&still=1${extra}`;
  const slides = deck === "launch" ? ["creative-freedom", "portal", "your-part"] : ["welcome", "this-week"];
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await stubProviders(page, "ready");
  for (const id of slides) {
    await page.goto(`${url()}#${id}`);
    await page.waitForSelector(".dk-slide");
    await page.evaluate(() => document.fonts.ready);
    await sleep(2800);
    const asleep = await videoState(page);
    notes.push(`${id} at rest: control opacity ${asleep.opacity}`);
    await page.mouse.move(960, 540);
    await page.mouse.move(980, 560);
    await sleep(500);
    await page.screenshot({ path: join(dir, `awake-${id}.png`) });
    notes.push(`${id} awake: ${JSON.stringify(await videoState(page))}`);
  }
  // The player, ready (the stub loaded), from V on the first slide.
  await page.goto(`${url()}#${slides[0]}`);
  await page.waitForSelector(".dk-slide");
  await sleep(1200);
  await page.keyboard.press("v");
  await sleep(1500);
  await page.screenshot({ path: join(dir, "player-ready.png") });
  notes.push(`player ready: ${JSON.stringify(await videoState(page))}`);
  // The notes window beside it, on the same slide.
  const pad = await ctx.newPage();
  await pad.setViewportSize({ width: 520, height: 820 });
  await pad.goto(url("&view=notes"));
  await sleep(2000);
  await pad.screenshot({ path: join(dir, "notes-playing.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await sleep(600);
  notes.push(`after Esc: ${JSON.stringify(await videoState(page))}`);
  await pad.screenshot({ path: join(dir, "notes-closed.png"), fullPage: true });
  await pad.close();
  await page.close();
  // Prep's Videos section.
  const prep = await ctx.newPage();
  await prep.setViewportSize({ width: 1440, height: 900 });
  await stubProviders(prep, "ready");
  await prep.goto(url("&view=prep"));
  await sleep(1800);
  await prep.locator("aside").screenshot({ path: join(dir, "prep-videos.png") });
  await prep.close();
  await ctx.close();
  if (deck !== "launch") return { dir, notes };
  // Loading, then didn't load: a frame that never answers.
  const slow = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await stubProviders(slow, "hang");
  await slow.goto(`${url()}#${slides[0]}`);
  await slow.waitForSelector(".dk-slide");
  await sleep(1200);
  await slow.keyboard.press("v");
  await sleep(1200);
  await slow.screenshot({ path: join(dir, "player-loading.png") });
  notes.push(`player loading: ${JSON.stringify(await videoState(slow))}`);
  await sleep(15_500);
  await slow.screenshot({ path: join(dir, "player-failed.png") });
  notes.push(`player failed: ${JSON.stringify(await videoState(slow))}`);
  await slow.close();
  // Can't play here: YouTube's own error from the stubbed frame.
  const blocked = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await stubProviders(blocked, "blocked");
  await blocked.goto(`${url("&video=youtube")}#${slides[0]}`);
  await blocked.waitForSelector(".dk-slide");
  await sleep(1200);
  await blocked.keyboard.press("v");
  await sleep(2000);
  await blocked.screenshot({ path: join(dir, "player-blocked.png") });
  notes.push(`player blocked: ${JSON.stringify(await videoState(blocked))}`);
  await blocked.close();
  return { dir, notes };
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
        if (r.hits.length) {
          failed = true;
          console.error(`  runs into the foot, wraps or overlaps:\n  ${r.hits.join("\n  ")}`);
        }
      }
      console.log(`  views: ${await views(browser, server.url, fixture, lang)}`);
    }
  if (args.parts !== "no")
    for (const lang of langs) console.log(`parts ${lang}: ${await parts(browser, server.url, lang)}`);
  if (args.videos !== "no")
    for (const lang of langs) {
      const r = await videoShots(browser, server.url, lang);
      console.log(`videos ${lang}: ${r.dir}\n  ${r.notes.join("\n  ")}`);
    }
} finally {
  await browser.close();
  server.stop();
}
process.exit(failed ? 1 : 0);
