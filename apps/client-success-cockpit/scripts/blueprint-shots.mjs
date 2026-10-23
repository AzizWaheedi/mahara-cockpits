#!/usr/bin/env node
/**
 * Screenshots of the Brand Blueprint call deck (docs/brand-blueprint/
 * SPEC.md 5.8): every slide and every stop, from the harness's fixtures,
 * still (reduced motion: each stop as it settles), as JPEG at quality 75,
 * plus the notes window and the prep view. Nothing is sent anywhere: the
 * harness keeps saves in memory and never frames Drive.
 *
 *   node scripts/blueprint-shots.mjs --url http://localhost:5183
 *     [--fixtures full,sparse,two,declined] [--states sent] [--langs en,ar]
 *     [--size 1920x1080] [--notes yes] [--prep yes] [--out <dir>]
 *
 * Each shot is also measured, and the run exits 1 on a hit:
 * - teal on the cover covers under 5 % of the canvas (SPEC 5.4);
 * - nothing with `data-live` (typed on live) is turned at all;
 * - nothing else is turned more than 1 degree, but the fan and the stamp;
 * - no text runs past the canvas or under the chrome's foot;
 * - no card, sheet, tag, sticky or tape runs into the foot's band: every
 *   bottom at y 960 or above (score round 1 of the design pass: Arabic
 *   cards ended at 990 to 998, on the logo, under the old 1004 line);
 * - the title's words keep 24 px from a print, the ad prints, the sheet, the
 *   run sheet and the offer tag;
 * - the read-back's headline box holds its words (.dkb-feature);
 * - (score round 2: the run printed 0 hits over four cut or covered lines)
 *   no two runs of text in different blocks overlap (deck-shots.mjs's
 *   check); no run of text is covered by something painted over it (the
 *   folder button over the sticky's last line); no run is cut by a box
 *   that clips it (overflow, or a clip-path such as the offer tag's); no
 *   run reaches past the paper it is printed on (the nearest painted box
 *   it sits in: a card, the tag, a sticky, a chip); and no card, sheet or
 *   tag that hides its overflow holds more than it shows (scrollHeight
 *   within 2 px of its height).
 *
 * --save no measures without writing the shots; --slides <id,id> walks
 * only those slides' stops.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const base = args.url ?? "http://localhost:5183";
const fixtures = (args.fixtures ?? "full").split(",");
const states = (args.states ?? "sent").split(",");
const langs = (args.langs ?? "en,ar").split(",");
const [W, H] = (args.size ?? "1920x1080").split("x").map(Number);
const out = resolve(args.out ?? "tmp/blueprint-shots");
const save = (args.save ?? "yes") === "yes";
const slides = args.slides ? args.slides.split(",") : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const where = page =>
  page.evaluate(() => {
    const s = document.querySelector(".dk-slide");
    return s ? `${s.getAttribute("data-slide")}:${s.getAttribute("data-stop")}` : "";
  });

/** The measures (SPEC 5.4, 5.8). */
const measure = page =>
  page.evaluate(() => {
    const hits = [];
    const canvas = document.querySelector(".dk-canvas");
    const slide = document.querySelector(".dk-slide");
    if (!canvas || !slide) return hits;
    const c = canvas.getBoundingClientRect();
    const k = c.width / 1920 || 1;
    const angle = el => {
      const t = getComputedStyle(el).transform;
      if (!t || t === "none") return 0;
      const m = /matrix\(([^)]+)\)/.exec(t);
      if (!m) return 0;
      const [a, b, c, d] = m[1].split(",").map(Number);
      // A mirror (scaleX(-1) in Arabic) is not a turn.
      return a * d - b * c < 0
        ? (Math.atan2(-b, -a) * 180) / Math.PI
        : (Math.atan2(b, a) * 180) / Math.PI;
    };
    // Teal on the cover.
    if (slide.getAttribute("data-slide") === "cover") {
      let area = 0;
      for (const el of slide.querySelectorAll("*")) {
        const bg = getComputedStyle(el).backgroundColor;
        const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(bg);
        if (!m) continue;
        const [r, g, b, al = "1"] = m.slice(1);
        if (Number(r) < 40 && Number(g) > 180 && Number(b) > 170 && Number(al) > 0.2) {
          const box = el.getBoundingClientRect();
          area += (box.width / k) * (box.height / k) * Math.min(1, Number(al) + 0.3);
        }
      }
      const share = area / (1920 * 1080);
      if (share >= 0.05) hits.push(`teal covers ${(share * 100).toFixed(1)} % of the cover`);
    }
    for (const el of slide.querySelectorAll("[data-live]")) {
      let p = el;
      while (p && p !== slide) {
        const a = angle(p);
        if (Math.abs(a) > 0.01) {
          hits.push(`a live card is turned ${a.toFixed(2)} degrees (${el.className})`);
          break;
        }
        p = p.parentElement;
      }
    }
    for (const el of slide.querySelectorAll("*")) {
      if (el.closest(".dkb-fan, .dkb-stamp")) continue;
      const a = angle(el);
      if (Math.abs(a) > 1.01) hits.push(`turned ${a.toFixed(2)} degrees: ${el.className}`);
    }
    // Text past the canvas, or into the foot (the logo and the count).
    const foot = 1080 - 76;
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      // The wall map's name is the foot's own, beside the map (slide 2).
      if (n.parentElement?.closest(".dkb-map-name")) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) {
        const l = (b.left - c.left) / k;
        const rr = (b.right - c.left) / k;
        const bot = (b.bottom - c.top) / k;
        const top = (b.top - c.top) / k;
        if (rr > 1920 + 1 || l < -1 || bot > 1080 + 1)
          hits.push(`text off the canvas: "${n.textContent.trim().slice(0, 40)}"`);
        else if (bot > foot && top < 1080 && (l < 420 || rr > 1680))
          hits.push(`text in the foot: "${n.textContent.trim().slice(0, 40)}"`);
      }
    }
    // A card that runs into the foot (a stack that grew past its room),
    // its tape included.
    for (const el of slide.querySelectorAll(".dkb-card, .dkb-flow, .dkb-sheet, .dkb-tag, .dkb-sticky, .dkb-tape")) {
      const b = el.getBoundingClientRect();
      if (!b.height) continue;
      const bot = (b.bottom - c.top) / k;
      if (bot > 961)
        hits.push(`ends at y ${Math.round(bot)}, past 960 (${el.className})`);
    }
    // The title's words never come within 24 px of a print, the ad prints, the
    // sheet, the run sheet or the offer tag (score round 1: in Arabic slide
    // 5's print touched the title's second line). The words' own boxes, so
    // a short title is not held to its header's full width.
    {
      const title = slide.querySelector(".dkb-title");
      if (title) {
        const r = document.createRange();
        r.selectNodeContents(title);
        const words = [...r.getClientRects()].filter(b => b.width > 1);
        for (const el of slide.querySelectorAll(
          ".dkb-print, .dkb-ads, .dkb-sheet-stack, .dkb-runsheet, .dkb-tag",
        )) {
          const b = el.getBoundingClientRect();
          if (!b.width) continue;
          const pad = 24 * k;
          for (const w of words) {
            const apart =
              w.right + pad <= b.left ||
              b.right + pad <= w.left ||
              w.bottom + pad <= b.top ||
              b.bottom + pad <= w.top;
            if (!apart) {
              hits.push(
                `the title comes within 24 px of ${el.className.split(" ").find(c => c.startsWith("dkb-") && c !== "dkb-pin" && c !== "dkb-at")}`,
              );
              break;
            }
          }
        }
      }
    }
    // The read-back's headline box cuts its words.
    for (const el of slide.querySelectorAll(".dkb-feature")) {
      if (el.scrollHeight > el.clientHeight + 2)
        hits.push(`the offer's headline box overflows by ${el.scrollHeight - el.clientHeight}px`);
    }
    // A field's words cut by its own box (a textarea that overflows).
    for (const el of slide.querySelectorAll("textarea.dkb-ruled")) {
      if (el.scrollHeight > el.clientHeight + 4)
        hits.push(`a typed field overflows its box (${el.getAttribute("aria-label")})`);
    }
    return [...new Set(hits)];
  });

/**
 * The text checks (score round 2), in canvas pixels. Each run of text is
 * its line boxes, taken in by a sixth of their height top and bottom (a
 * line box is taller than its letters, Arabic's most), so tight leading
 * and a label's own padding are never hits.
 * - overlap: two runs in different blocks crossing by more than 2 px;
 * - covered: the run's middle and its two ends hit something that is not
 *   the run's own element, its ancestors or its children;
 * - cut: the run reaches more than 2 px past a box that clips it (overflow
 *   other than visible, or a polygon clip-path, read point by point);
 * - off its paper: the run reaches more than 2 px past the nearest painted
 *   box it sits in (an opaque background, or a clip-path);
 * - held: a card, sheet, tag or sticky that hides its overflow and holds
 *   more than 2 px past its height.
 */
const textChecks = page =>
  page.evaluate(() => {
    const canvas = document.querySelector(".dk-canvas");
    const slide = document.querySelector(".dk-slide");
    if (!canvas || !slide) return [];
    const c = canvas.getBoundingClientRect();
    const k = c.width / 1920 || 1;
    const X = v => Math.round((v - c.left) / k);
    const Y = v => Math.round((v - c.top) / k);
    const shown = el =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      Number(getComputedStyle(el).opacity) > 0.05;
    const name = el =>
      (typeof el.className === "string" && el.className
        ? el.className
            .split(" ")
            .filter(x => x.startsWith("dk"))
            .slice(0, 2)
            .join(".")
        : "") || el.tagName.toLowerCase();
    /** A polygon clip-path's points, in viewport pixels (simple % and px, and calc(100% - Npx)). */
    const polygonOf = el => {
      const cp = getComputedStyle(el).clipPath;
      if (!cp || cp === "none" || !cp.startsWith("polygon(")) return null;
      const r = el.getBoundingClientRect();
      // The polygon is drawn on the element's own box before its turn; at
      // at most a degree, its bounding box is close enough.
      const w = el.offsetWidth * k;
      const h = el.offsetHeight * k;
      const ox = r.left + (r.width - w) / 2;
      const oy = r.top + (r.height - h) / 2;
      const len = (s, full) => {
        s = s.trim();
        const calc = /^calc\((.*)\)$/.exec(s);
        if (calc) {
          const m = /^([\d.]+)%\s*([+-])\s*([\d.]+)px$/.exec(calc[1].trim());
          if (m) return (Number(m[1]) / 100) * full + (m[2] === "-" ? -1 : 1) * Number(m[3]) * k;
          return null;
        }
        if (s.endsWith("%")) return (Number.parseFloat(s) / 100) * full;
        if (s.endsWith("px")) return Number.parseFloat(s) * k;
        if (s === "0") return 0;
        return null;
      };
      const body = cp.slice(8, -1);
      const pts = [];
      let depth = 0;
      let cur = "";
      for (const ch of body) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          pts.push(cur);
          cur = "";
        } else cur += ch;
      }
      pts.push(cur);
      const out = [];
      for (const p of pts) {
        const parts = p.trim().match(/calc\([^)]*\)|[^\s]+/g) ?? [];
        if (parts.length !== 2) return null;
        const x = len(parts[0], w);
        const y = len(parts[1], h);
        if (x == null || y == null) return null;
        // Arabic mirrors the element, not its polygon: a polygon is in
        // physical pixels either way.
        out.push([ox + x, oy + y]);
      }
      return out;
    };
    const inPolygon = (pt, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
      return inside;
    };
    const opaque = el => {
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      if (!m) return false;
      const a = m[1].split(",").map(Number)[3];
      return a == null || a > 0.5;
    };
    const runs = [];
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || !shown(el)) continue;
      // The fan's strips are turned by meaning, their names on each strip's
      // free edge, so their boxes cross by design. Slide 5's ads are prints
      // now (design pass, score round 2), so their words are checked as
      // any paper's are.
      if (el.closest(".dkb-fly, .dkb-fan")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      let block = slide;
      for (let p = el; p && p !== slide; p = p.parentElement) {
        const d = getComputedStyle(p).display;
        if (d !== "inline" && d !== "contents") {
          block = p;
          break;
        }
      }
      for (const r of range.getClientRects()) {
        if (r.width < 2) continue;
        const inset = r.height / 6;
        runs.push({
          el,
          block,
          what: n.textContent.trim().slice(0, 40),
          l: r.left,
          r: r.right,
          t: r.top + inset,
          b: r.bottom - inset,
        });
      }
    }
    const out = [];
    const pad = 2 * k;
    for (const run of runs) {
      const at = `at ${X(run.l)},${Y(run.t)}`;
      // Cut by a box that clips it.
      for (let p = run.el.parentElement; p && p !== canvas; p = p.parentElement) {
        const s = getComputedStyle(p);
        const poly = polygonOf(p);
        if (poly) {
          const pts = [
            [run.l + pad, run.t + pad],
            [run.r - pad, run.t + pad],
            [run.l + pad, run.b - pad],
            [run.r - pad, run.b - pad],
          ];
          if (pts.some(pt => !inPolygon(pt, poly))) {
            out.push(`"${run.what}" is cut by ${name(p)}'s clip-path ${at}`);
            break;
          }
        }
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          if (p === slide || p.classList.contains("dkb-wall")) continue;
          if (p.matches("textarea, input")) continue;
          const b = p.getBoundingClientRect();
          if (run.l < b.left - pad || run.r > b.right + pad || run.t < b.top - pad || run.b > b.bottom + pad) {
            out.push(`"${run.what}" is cut by ${name(p)} ${at}`);
            break;
          }
        }
      }
      // Off the paper it is printed on.
      for (let p = run.el; p && p !== slide; p = p.parentElement) {
        if (p.classList.contains("dkb-wall")) break;
        if (!opaque(p) && !polygonOf(p)) continue;
        const b = p.getBoundingClientRect();
        if (run.l < b.left - pad || run.r > b.right + pad || run.t < b.top - pad || run.b > b.bottom + pad)
          out.push(`"${run.what}" runs off its paper (${name(p)}) ${at}`);
        break;
      }
      // Covered by something painted over it.
      const mid = (run.t + run.b) / 2;
      for (const x of [run.l + 4 * k, (run.l + run.r) / 2, run.r - 4 * k]) {
        const top = document.elementFromPoint(x, mid);
        if (!top || top === run.el || run.el.contains(top) || top.contains(run.el)) continue;
        if (!slide.contains(top) && !canvas.contains(top)) continue;
        out.push(`"${run.what}" is covered by ${name(top)} ${at}`);
        break;
      }
    }
    // Two runs that overlap.
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i];
        const b = runs[j];
        if (a.block === b.block || a.block.contains(b.block) || b.block.contains(a.block)) continue;
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > pad && h > pad)
          out.push(`"${a.what}" overlaps "${b.what}" at ${X(Math.max(a.l, b.l))},${Y(Math.max(a.t, b.t))}`);
      }
    // A box that hides its overflow and holds more than it shows.
    for (const el of slide.querySelectorAll(
      ".dkb-card, .dkb-sheet, .dkb-tag, .dkb-sticky, .dkb-feature, .dkb-board, .dkb-print",
    )) {
      if (!shown(el)) continue;
      const s = getComputedStyle(el);
      if (s.overflowY === "visible") continue;
      if (el.scrollHeight > el.clientHeight + 2)
        out.push(`${name(el)} holds ${el.scrollHeight - el.clientHeight}px more than it shows`);
    }
    return [...new Set(out)];
  });

async function deckShots(browser, fixture, state, lang) {
  const dir = join(out, `${fixture}-${state}-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  if (save) mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  const hits = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text());
  });
  const url = `${base}/client-success/present-harness.html?fixture=${fixture}&deck=blueprint&bp=${state}&lang=${lang}&still=1`;
  let n = 1;
  // --slides: only those slides (each opened by its hash), every stop.
  for (const only of slides ?? [null]) {
    await page.goto(only ? `${url}#${only}` : url);
    if (only) await page.reload();
    await page.waitForSelector(".dk-slide");
    await page.evaluate(() => document.fonts.ready);
    await sleep(only ? 1600 : 2800);
    let last = "";
    for (let guard = 0; guard < 40; guard++) {
      const at = await where(page);
      if (at === last) break;
      const [id, stop] = at.split(":");
      if (only && id !== only) break;
      const file = `${String(n).padStart(2, "0")}-${id}-${stop}.jpg`;
      if (save) await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 75 });
      for (const h of await measure(page)) hits.push(`${file}: ${h}`);
      for (const h of await textChecks(page)) hits.push(`${file}: ${h}`);
      n++;
      last = at;
      await page.keyboard.press("ArrowRight");
      await sleep(500);
    }
  }
  await page.close();
  return { dir, count: n - 1, errors, hits };
}

async function windowShots(browser, fixture, state) {
  const dir = join(out, `${fixture}-${state}-windows`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const shots = [];
  if ((args.notes ?? "yes") === "yes") {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const deck = await ctx.newPage();
    await deck.goto(`${base}/client-success/present-harness.html?fixture=${fixture}&deck=blueprint&bp=${state}&lang=en&still=1`);
    await deck.waitForSelector(".dk-slide");
    const notes = await ctx.newPage();
    await notes.setViewportSize({ width: 520, height: 820 });
    await notes.goto(`${base}/client-success/present-harness.html?fixture=${fixture}&deck=blueprint&bp=${state}&view=notes`);
    await sleep(1500);
    for (const slide of ["so-far", "first-ads", "next"]) {
      await deck.evaluate(id => {
        window.location.hash = `#${id}`;
      }, slide);
      await deck.reload();
      await deck.waitForSelector(".dk-slide");
      if (slide === "first-ads") {
        await deck.keyboard.press("ArrowRight");
      }
      await sleep(1200);
      const file = join(dir, `notes-${slide}.jpg`);
      await notes.screenshot({ path: file, type: "jpeg", quality: 75, fullPage: true });
      shots.push(file);
    }
    await ctx.close();
  }
  if ((args.prep ?? "yes") === "yes") {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/client-success/present-harness.html?fixture=${fixture}&deck=blueprint&bp=${state}&view=prep&still=1`);
    await sleep(1800);
    const file = join(dir, "prep.jpg");
    await page.screenshot({ path: file, type: "jpeg", quality: 75, fullPage: true });
    shots.push(file);
    await page.close();
  }
  return shots;
}

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch {
  browser = await chromium.launch();
}
let failed = 0;
try {
  for (const fixture of fixtures)
    for (const state of states) {
      for (const lang of langs) {
        const r = await deckShots(browser, fixture, state, lang);
        console.log(`${r.dir}: ${r.count} shots`);
        for (const e of r.errors) console.log(`  error: ${e}`);
        for (const h of r.hits) console.log(`  HIT ${h}`);
        failed += r.hits.length + r.errors.length;
      }
      if ((args.windows ?? "yes") === "yes")
        for (const s of await windowShots(browser, fixture, state)) console.log(`  ${s}`);
    }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
