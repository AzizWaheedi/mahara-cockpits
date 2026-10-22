#!/usr/bin/env node
/**
 * Screenshots of every slide and every stop of a client deck, from the
 * harness's fixtures, at 1920 x 1080 and 1366 x 768 (and the notes window
 * and the prep view once each), so a person can look at them before a call.
 *
 *   node scripts/deck-shots.mjs [--deck onboarding|launch] [--fixtures full,sparse,dwy]
 *     [--langs en,ar] [--sizes 1920x1080,1366x768] [--still yes|no]
 *     [--parts no] [--drive no] [--film no] [--only drive] [--out <dir>] [--url http://localhost:5199]
 *
 * The launch deck also gets the Drive box's pass (--drive no skips it,
 * --only drive runs it alone): its sheet of states, prep's ads panel, a
 * pasted message run until the files are in the tray, and the notes window.
 *
 * Both decks are shot still by default (reduced motion: the call's stages
 * whole, the lines drawn, every arrival set), so each stop is what it
 * settles to (DESIGN 22.3.4). --still no shoots them moving.
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
const still = (args.still ?? "yes") === "yes";

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

/**
 * A tag (`.dk-tag`) that sits within 12 px, above or below, of another
 * block it overlaps across: two blocks that read as one collided block
 * without touching (the score round's starter tag over "Your page and
 * logo"). Each a hit, and the run fails.
 */
const nearTags = page =>
  page.evaluate(() => {
    const slide = document.querySelector(".dk-slide");
    const canvas = document.querySelector(".dk-canvas");
    if (!slide || !canvas) return [];
    const c = canvas.getBoundingClientRect();
    const k = c.width / 1920 || 1;
    const shown = el =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      Number(getComputedStyle(el).opacity) > 0.05;
    const box = el => {
      const r = el.getBoundingClientRect();
      return { l: (r.left - c.left) / k, t: (r.top - c.top) / k, r: (r.right - c.left) / k, b: (r.bottom - c.top) / k };
    };
    /** The text blocks on the slide: each element with its own text run. */
    const blocks = [];
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || !shown(el) || el.closest(".dk-tag")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        if (r.width > 1 && r.height > 1)
          blocks.push({
            what: n.textContent.trim().slice(0, 30),
            l: (r.left - c.left) / k, t: (r.top - c.top) / k, r: (r.right - c.left) / k, b: (r.bottom - c.top) / k,
          });
    }
    const out = [];
    for (const tag of slide.querySelectorAll(".dk-tag")) {
      if (!shown(tag)) continue;
      const t = box(tag);
      for (const b of blocks) {
        const across = Math.min(t.r, b.r) - Math.max(t.l, b.l) > 2;
        if (!across) continue;
        const gap = b.t >= t.b ? b.t - t.b : t.t >= b.b ? t.t - b.b : -1;
        if (gap >= 0 && gap < 12)
          out.push(`tag "${tag.textContent.trim().slice(0, 30)}" sits ${Math.round(gap)} px from "${b.what}"`);
      }
    }
    return [...new Set(out)];
  });

/**
 * Journey stop 6 (DESIGN 22.6.1): the statement and its fork are one block,
 * no more than 64 px apart.
 */
const forkGap = page =>
  page.evaluate(() => {
    const slide = document.querySelector(".dk-slide");
    if (slide?.getAttribute("data-slide") !== "journey" || slide.getAttribute("data-stop") !== "5") return [];
    const words = slide.querySelector('[data-swap="in"] .dkc-fork-pic .dkc-stop-words .dk-body');
    const fork = slide.querySelector('[data-swap="in"] .dkc-fork');
    if (!words || !fork) return ["journey stop 6: the statement or its fork is missing"];
    const gap = fork.getBoundingClientRect().top - words.getBoundingClientRect().bottom;
    const k = (document.querySelector(".dk-canvas")?.getBoundingClientRect().width ?? 1920) / 1920;
    return gap / k > 64 ? [`journey stop 6: the statement is ${Math.round(gap / k)} px from its fork (64 at most)`] : [];
  });

/** The portal's figure: its top and end edges (DESIGN 22.6.3), in canvas px. */
const portalEdges = page =>
  page.evaluate(() => {
    const slide = document.querySelector(".dk-slide");
    if (slide?.getAttribute("data-slide") !== "portal") return null;
    const fig = slide.querySelector('[data-swap="in"] .dkc-portal-screen-in > .dkc-tagged');
    const tag = slide.querySelector('[data-swap="in"] .dkc-tagged > figcaption');
    if (!fig) return null;
    const c = document.querySelector(".dk-canvas").getBoundingClientRect();
    const k = c.width / 1920 || 1;
    const r = fig.getBoundingClientRect();
    const rtl = document.querySelector(".dk-canvas")?.getAttribute("dir") === "rtl";
    return {
      top: (r.top - c.top) / k,
      end: rtl ? (r.left - c.left) / k : (r.right - c.left) / k,
      tag: tag ? (tag.getBoundingClientRect().bottom - c.top) / k : null,
    };
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
  /** The portal's first figure: every later stop's edges must match it. */
  let portal = null;
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
    for (const c of await nearTags(page)) hits.push(`${file}: ${c}`);
    for (const c of await forkGap(page)) hits.push(`${file}: ${c}`);
    const edges = await portalEdges(page);
    if (edges) {
      if (portal && (Math.abs(portal.top - edges.top) > 2 || Math.abs(portal.end - edges.end) > 2 ||
          (portal.tag != null && edges.tag != null && Math.abs(portal.tag - edges.tag) > 2)))
        hits.push(`${file}: the portal's figure moved (top ${Math.round(portal.top)} to ${Math.round(edges.top)}, end ${Math.round(portal.end)} to ${Math.round(edges.end)})`);
      portal = portal ?? edges;
    }
    n++;
    last = at;
    await page.keyboard.press("ArrowRight");
    await sleep(900);
  }
  await page.close();
  return { dir, count: n - 1, errors, hits };
}

/**
 * The portal's phone recording, live (still shots never render the video):
 * the stop shot without still=1 at 1.2 s and 6 s after the press, and the
 * video's own box measured against its screen (it must cover the frame;
 * Tailwind's preflight once capped it at 440 px, 2026-10-20).
 */
async function filmShots(browser, base, lang) {
  const dir = join(out, deck, `film-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const notes = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${base}/client-success/present-harness.html?fixture=full&deck=launch&lang=${lang}#portal`);
  await page.waitForSelector(".dk-slide");
  await page.evaluate(() => document.fonts.ready);
  for (let guard = 0; guard < 6; guard++) {
    const at = await where(page);
    if (at === "portal:2") break;
    await page.keyboard.press("ArrowRight");
    await sleep(600);
  }
  const t0 = Date.now();
  for (const [ms, name] of [[1200, "1.2s"], [6000, "6s"]]) {
    await sleep(Math.max(0, ms - (Date.now() - t0)));
    await page.screenshot({ path: join(dir, `phone-${name}.png`) });
    const m = await page.evaluate(() => {
      const film = document.querySelector('[data-swap="in"] .dkc-film');
      const v = film?.querySelector("video");
      if (!film || !v) return null;
      const f = film.getBoundingClientRect();
      const r = v.getBoundingClientRect();
      return {
        covers: r.left <= f.left + 1 && r.top <= f.top + 1 && r.right >= f.right - 1 && r.bottom >= f.bottom - 1,
        time: v.currentTime, w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    notes.push(`${name}: ${m ? `video ${m.w} x ${m.h}, covers the screen: ${m.covers}, at ${m.time.toFixed(1)} s` : "no video (still, or the file's size changed)"}`);
  }
  await page.close();
  return { dir, notes };
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

/** The Drive box's field in a page. */
const DRIVE_FIELD = "input[inputmode=url]";

/** Paste a message into the Drive box the way a browser does (a ClipboardEvent). */
const pasteInto = (page, text) =>
  page.evaluate(
    ([sel, t]) => {
      const el = document.querySelector(sel);
      el.focus();
      const data = new DataTransfer();
      data.setData("text/plain", t);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [DRIVE_FIELD, text],
  );

/** The box's words (field help and progress), and whether the panel scrolls sideways. */
const driveState = page =>
  page.evaluate(sel => {
    const field = document.querySelector(sel);
    const box = field?.closest("form")?.parentElement;
    const aside = document.querySelector("aside");
    return {
      button: field?.parentElement?.querySelector("button")?.textContent ?? null,
      help: box?.querySelector("form > div:last-child")?.textContent ?? null,
      status: box?.querySelector("[role=status]")?.innerText ?? null,
      field: field?.value ?? null,
      invalid: field?.getAttribute("aria-invalid") ?? null,
      overflow: aside ? aside.scrollWidth > aside.clientWidth + 1 : null,
      tray: document.querySelector(".dkc-tray-count")?.textContent ?? null,
    };
  }, DRIVE_FIELD);

/**
 * The Drive box (DESIGN 22.7): every state on the harness's sheet, the box
 * in prep's ads panel for three scenarios, a pasted WhatsApp message with
 * two Drive links and a Docs link run through the pretend worker until the
 * files are in the tray, a typed refusal, and the notes window beside a
 * deck window. Each shot's words are read back and printed; a page error,
 * a panel that scrolls sideways or a paste that brings nothing fails the run.
 */
async function driveShots(browser, base, lang) {
  const dir = join(out, "launch", `drive-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const notes = [];
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  const harness = q => `${base}/client-success/present-harness.html?${q}`;
  await page.goto(harness(`view=drive&lang=${lang}`));
  await page.waitForSelector("[data-drive-sheet]");
  await page.evaluate(() => document.fonts.ready);
  await sleep(500);
  await page.screenshot({ path: join(dir, "sheet.png"), fullPage: true });
  notes.push(`sheet: ${await page.locator("[data-drive-card]").count()} states`);
  const prep = async scenario => {
    await page.goto(harness(`fixture=full&deck=launch&lang=${lang}&view=prep&still=1&drive=${scenario}`));
    await page.waitForSelector("aside");
    await page.locator("ol button", { hasText: /Your ads/ }).first().click();
    await page.waitForSelector(`aside ${DRIVE_FIELD}`);
    await sleep(900);
  };
  for (const scenario of ["working", "some", "nobody", "several"]) {
    await prep(scenario);
    await page.locator("aside").screenshot({ path: join(dir, `prep-${scenario}.png`) });
    const st = await driveState(page);
    notes.push(`prep ${scenario}: ${JSON.stringify(st)}`);
    if (st.overflow) errors.push(`prep ${scenario}: the panel scrolls sideways`);
  }
  // A typed link that is not one: the sentence on leaving the field, the button off.
  await prep("idle");
  await page.locator(`aside ${DRIVE_FIELD}`).fill("https://docs.google.com/document/d/1AbCdEfGhIjK/edit");
  await page.locator("aside h2").first().click();
  await sleep(200);
  await page.locator("aside").screenshot({ path: join(dir, "prep-typed-refused.png") });
  notes.push(`typed refused: ${JSON.stringify(await driveState(page))}`);
  // The paste: a WhatsApp message with two Drive links, a Docs link and a full stop.
  await prep("idle");
  const before = (await driveState(page)).tray;
  await pasteInto(
    page,
    "Hi Sara, the project photos: https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing\nand the reel https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHg/view. The brief is https://docs.google.com/document/d/1AbCdEfGhIjK/edit",
  );
  await sleep(150);
  await page.locator("aside").screenshot({ path: join(dir, "paste-1-checking.png") });
  notes.push(`paste, checking: ${JSON.stringify(await driveState(page))}`);
  await sleep(900);
  await page.locator("aside").screenshot({ path: join(dir, "paste-2-started.png") });
  notes.push(`paste, started: ${JSON.stringify(await driveState(page))}`);
  await sleep(6500);
  await page.locator("aside").screenshot({ path: join(dir, "paste-3-working.png") });
  notes.push(`paste, working: ${JSON.stringify(await driveState(page))}`);
  let done = null;
  for (let i = 0; i < 40 && !done; i++) {
    await sleep(1000);
    const st = await driveState(page);
    if ((st.status ?? "").match(/Brought in|جبنا/g)?.length >= 2) done = st;
  }
  await page.locator("aside").screenshot({ path: join(dir, "paste-4-done.png") });
  const after = await driveState(page);
  notes.push(`paste, done: ${JSON.stringify(after)} (tray ${before} before)`);
  if (!done) errors.push("the pasted links did not finish within 40 s");
  if (after.tray === before) errors.push(`the tray did not grow: ${before} before, ${after.tray} after`);
  await page.close();
  // The notes window beside a deck window on the ads slide.
  const deckPage = await ctx.newPage();
  await deckPage.setViewportSize({ width: 1920, height: 1080 });
  await deckPage.goto(`${harness(`fixture=full&deck=launch&lang=${lang}&still=1&drive=working`)}#ads`);
  await deckPage.waitForSelector(".dk-slide");
  await sleep(1200);
  const pad = await ctx.newPage();
  pad.on("pageerror", e => errors.push(String(e)));
  await pad.setViewportSize({ width: 520, height: 820 });
  await pad.goto(harness(`fixture=full&deck=launch&lang=${lang}&still=1&view=notes&drive=working`));
  await pad.waitForSelector(DRIVE_FIELD, { timeout: 8000 }).catch(() => errors.push("the notes window shows no Drive box on the ads slide"));
  await sleep(900);
  await pad.screenshot({ path: join(dir, "notes-working.png"), fullPage: true });
  notes.push(`notes: ${JSON.stringify(await driveState(pad))}`);
  await ctx.close();
  return { dir, notes, errors };
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
  // --only drive: the Drive box's pass alone (the launch deck's prep and notes).
  if (args.only !== "drive") for (const fixture of fixtures)
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
  if (args.parts !== "no" && args.only !== "drive")
    for (const lang of langs) console.log(`parts ${lang}: ${await parts(browser, server.url, lang)}`);
  if (deck === "launch" && args.drive !== "no")
    for (const lang of langs) {
      const r = await driveShots(browser, server.url, lang);
      console.log(`drive ${lang}: ${r.dir}\n  ${r.notes.join("\n  ")}`);
      if (r.errors.length) {
        failed = true;
        console.error(`  drive box:\n  ${r.errors.join("\n  ")}`);
      }
    }
  if (args.videos !== "no" && args.only !== "drive")
    for (const lang of langs) {
      const r = await videoShots(browser, server.url, lang);
      console.log(`videos ${lang}: ${r.dir}\n  ${r.notes.join("\n  ")}`);
    }
  if (deck === "launch" && args.film !== "no" && args.only !== "drive")
    for (const lang of langs) {
      const r = await filmShots(browser, server.url, lang);
      console.log(`film ${lang}: ${r.dir}\n  ${r.notes.join("\n  ")}`);
    }
} finally {
  await browser.close();
  server.stop();
}
process.exit(failed ? 1 : 0);
