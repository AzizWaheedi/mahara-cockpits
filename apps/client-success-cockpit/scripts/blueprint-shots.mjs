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
 * - no card ends inside the foot (every .dkb-card bottom above y 1004);
 * - the title's words keep 24 px from a print, the phones, the sheet, the
 *   run sheet and the offer tag;
 * - the read-back's headline box holds its words (.dkb-feature).
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
    // A card that runs into the foot (a stack that grew past its room).
    for (const el of slide.querySelectorAll(".dkb-card, .dkb-flow")) {
      const b = el.getBoundingClientRect();
      if (!b.height) continue;
      const bot = (b.bottom - c.top) / k;
      if (bot >= 1004)
        hits.push(`a card ends at y ${Math.round(bot)}, inside the foot (${el.className})`);
    }
    // The title's words never come within 24 px of a print, the phones, the
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

async function deckShots(browser, fixture, state, lang) {
  const dir = join(out, `${fixture}-${state}-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  const hits = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    `${base}/client-success/present-harness.html?fixture=${fixture}&deck=blueprint&bp=${state}&lang=${lang}&still=1`,
  );
  await page.waitForSelector(".dk-slide");
  await page.evaluate(() => document.fonts.ready);
  await sleep(2800);
  let n = 1;
  let last = "";
  for (let guard = 0; guard < 40; guard++) {
    const at = await where(page);
    if (at === last) break;
    const [id, stop] = at.split(":");
    const file = `${String(n).padStart(2, "0")}-${id}-${stop}.jpg`;
    await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 75 });
    for (const h of await measure(page)) hits.push(`${file}: ${h}`);
    n++;
    last = at;
    await page.keyboard.press("ArrowRight");
    await sleep(500);
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
