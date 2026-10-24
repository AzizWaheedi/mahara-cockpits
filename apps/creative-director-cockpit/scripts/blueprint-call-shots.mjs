#!/usr/bin/env node
/**
 * Screenshots of the Brand Blueprint call inside the creative director
 * cockpit (docs/brand-blueprint/EMBED.md 6), from the harness: the call
 * page per record state in both deck languages, presenting, full screen,
 * the closed deck with its two buttons, the notes popup at 520 x 820, every
 * state=, a rehearsal, a read-only seat and the light theme. JPEG at
 * quality 75. Nothing is sent anywhere: both harnesses keep saves in memory.
 *
 * Run both dev servers first (the CD one forwards /client-success):
 *   apps/client-success-cockpit:   bunx vite --port 5191 --strictPort
 *   apps/creative-director-cockpit:
 *     CS_DEV=http://localhost:5191 bunx vite --port 5192 --strictPort
 * then
 *   node scripts/blueprint-call-shots.mjs --url http://localhost:5192
 *     [--sizes 1440x900,1920x1080] [--out <dir>] [--save yes|no]
 *
 * The run exits 1 on any hit:
 * - the top page's address leaves /creative/ at any moment;
 * - a page other than the notes popup opens, or the popup is not at a
 *   /creative/ address;
 * - a frame sits on a path other than the deck harness's (the Blueprint's
 *   own path on the portal);
 * - while presenting, the prep frame is not inert or the deck frame does
 *   not have the keyboard;
 * - the page or the stage scrolls sideways at 1024, 1440 or 1920 wide.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (acc, a, i, all) =>
        a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc,
      [],
    ),
);
const base = (args.url ?? "http://localhost:5192").replace(/\/$/, "");
const sizes = (args.sizes ?? "1440x900,1920x1080")
  .split(",")
  .map(s => s.split("x").map(Number));
const out = resolve(args.out ?? "tmp/blueprint-call-shots");
const save = (args.save ?? "yes") === "yes";
const DECK = "/client-success/present-harness.html";
const hits = [];
const hit = h => {
  hits.push(h);
  console.log(`HIT  ${h}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (save) mkdirSync(out, { recursive: true });

const harness = q =>
  `${base}/creative/blueprint-harness.html?${new URLSearchParams({
    view: "call",
    fixture: "full",
    ...q,
  })}`;

async function shoot(page, name) {
  if (!save) return;
  await page.screenshot({
    path: join(out, `${name}.jpg`),
    type: "jpeg",
    quality: 75,
  });
}

/** Every navigation of every frame, checked as it happens. */
function watch(page, label) {
  page.on("framenavigated", f => {
    const u = new URL(f.url());
    if (u.href === "about:blank") return;
    if (f === page.mainFrame()) {
      if (!u.pathname.startsWith("/creative/"))
        hit(`${label}: the page left /creative/ for ${u.pathname}`);
    } else if (u.pathname !== DECK)
      hit(`${label}: a frame sat on ${u.pathname}`);
  });
  page.on("pageerror", e => hit(`${label}: page error ${e.message}`));
}

async function sideways(page, label) {
  const r = await page.evaluate(() => {
    const stage = document.querySelector("[data-stage]");
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      stage: stage ? stage.scrollWidth - stage.clientWidth : 0,
    };
  });
  if (r.page > 1) hit(`${label}: the page scrolls ${r.page}px sideways`);
  if (r.stage > 1) hit(`${label}: the stage scrolls ${r.stage}px sideways`);
  const prep = page.frame({ url: /view=prep/ });
  if (prep) {
    const inner = await prep
      .evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      .catch(() => 0);
    if (inner > 1) hit(`${label}: the prep scrolls ${inner}px sideways`);
  }
}

const prepFrame = page =>
  page.frameLocator('iframe[title="Brand Blueprint prep"]');
const deckFrame = page =>
  page.frameLocator('iframe[title="Brand Blueprint deck"]');

async function openCall(page, q, hash = "") {
  await page.goto(`${harness(q)}${hash}`);
  await page.waitForSelector('[data-stage="ready"]', { timeout: 30_000 });
  await sleep(500);
}

/** The deck's chrome steps aside while presenting; a real move wakes it. */
async function wake(page) {
  await page.mouse.move(500, 400);
  await page.mouse.move(540, 430, { steps: 6 });
  await sleep(250);
}

let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
} catch {
  browser = await chromium.launch();
}

try {
  for (const [W, H] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const pages = [];
    ctx.on("page", p => pages.push(p));
    const page = await ctx.newPage();
    pages.length = 0;
    const tag = `${W}`;
    watch(page, tag);

    // The call page, per record state, in both deck languages.
    for (const bp of ["open", "part1", "sent", "closed"])
      for (const lang of ["en", "ar"]) {
        await page.goto(`${base}/creative/blueprint-harness.html?view=card`);
        await page.evaluate(l => localStorage.setItem("csm_deck_lang", l), lang);
        await openCall(page, { bp });
        await sideways(page, `${tag} ${bp} ${lang}`);
        await shoot(page, `call-${bp}-${lang}-${tag}`);
      }

    // Present, from the prep's own button.
    await page.evaluate(() => localStorage.setItem("csm_deck_lang", "en"));
    await openCall(page, { bp: "part1" });
    await prepFrame(page).getByRole("button", { name: "Present", exact: true }).click();
    await page.waitForSelector('[data-layer="live"]', { timeout: 30_000 });
    await sleep(600);
    const held = await page.evaluate(() => ({
      inert: document
        .querySelector('iframe[title="Brand Blueprint prep"]')
        ?.hasAttribute("inert"),
      focus: document.activeElement?.getAttribute("title"),
    }));
    if (!held.inert) hit(`${tag}: the prep frame is not inert while presenting`);
    if (held.focus !== "Brand Blueprint deck")
      hit(`${tag}: the deck frame does not have the keyboard (${held.focus})`);
    await page.keyboard.press("ArrowRight");
    await sleep(500);
    await shoot(page, `presenting-${tag}`);

    // Full screen (F), then out again.
    await page.keyboard.press("f");
    await sleep(600);
    const full = await page.evaluate(
      () => document.fullscreenElement?.getAttribute?.("title") ?? null,
    );
    if (full !== "Brand Blueprint deck")
      console.log(`note: full screen held by ${full} (headless may refuse it)`);
    await shoot(page, `fullscreen-${tag}`);
    await page.evaluate(() =>
      document.fullscreenElement ? document.exitFullscreen() : null,
    );
    await sleep(300);

    // N: the notes popup, at a /creative address.
    const popupP = ctx.waitForEvent("page", { timeout: 10_000 });
    await page.keyboard.press("n");
    const popup = await popupP.catch(() => null);
    if (!popup) hit(`${tag}: N opened no notes window`);
    else {
      await popup.setViewportSize({ width: 520, height: 820 });
      await popup.waitForLoadState();
      await popup
        .frameLocator('iframe[title="Brand Blueprint notes"]')
        .locator("footer")
        .waitFor({ timeout: 30_000 })
        .catch(() => hit(`${tag}: the notes did not draw`));
      await sleep(600);
      const u = new URL(popup.url());
      if (!u.pathname.startsWith("/creative/"))
        hit(`${tag}: the notes window opened at ${u.pathname}`);
      await shoot(popup, `notes-${tag}`);
    }
    await page.bringToFront();

    // Back on the deck: closed, with Back to prep and Present again.
    await wake(page);
    await deckFrame(page).locator(".dk-chrome button").first().click();
    await page.waitForSelector('[data-layer="ended"]', { timeout: 10_000 });
    await sleep(300);
    await shoot(page, `ended-${tag}`);
    await page.getByRole("button", { name: "Present again" }).click();
    await page.waitForSelector('[data-layer="live"]', { timeout: 30_000 });
    await sleep(600);
    await wake(page);
    await deckFrame(page).locator(".dk-chrome button").first().click();
    await page.waitForSelector('[data-layer="ended"]', { timeout: 10_000 });
    await page.getByRole("button", { name: "Back to prep" }).click();
    await page.waitForSelector("[data-layer]", {
      state: "detached",
      timeout: 5_000,
    });
    const after = await page.evaluate(() => ({
      root: document.getElementById("root")?.hasAttribute("inert"),
      prep: document
        .querySelector('iframe[title="Brand Blueprint prep"]')
        ?.hasAttribute("inert"),
    }));
    if (after.root || after.prep)
      hit(`${tag}: the cockpit stayed out of reach after Back to prep`);

    // Open part 1 lands the prep at its part, and the frame still loads.
    await openCall(page, { bp: "part1" }, "#part1");
    const landed = await page
      .frame({ url: /view=prep/ })
      ?.evaluate(() => window.location.hash);
    if (landed !== "#part1")
      hit(`${tag}: #part1 did not reach the prep (${landed})`);

    // Finish part 2 lands the prep at its part.
    await openCall(page, { bp: "sent" });
    await page.evaluate(() => {
      window.location.hash = "#part2";
    });
    await sleep(800);
    await shoot(page, `part2-${tag}`);

    // Every state the page draws by itself.
    for (const state of [
      "loading",
      "slow",
      "failed",
      "offline",
      "signedout",
      "wronghost",
      "badid",
    ]) {
      await page.goto(harness({ bp: "part1", state }));
      await sleep(700);
      await sideways(page, `${tag} state=${state}`);
      await shoot(page, `state-${state}-${tag}`);
    }

    // A rehearsal, a read-only seat, and the light theme once.
    await openCall(page, { bp: "part1", rehearse: "1" });
    await shoot(page, `rehearse-${tag}`);
    await openCall(page, { bp: "part1", readonly: "1" });
    await shoot(page, `readonly-${tag}`);
    if (W === sizes[0][0]) {
      await openCall(page, { bp: "part1", theme: "light" });
      await shoot(page, `light-${tag}`);
    }

    const others = pages.filter(
      p => !new URL(p.url()).pathname.startsWith("/creative/"),
    );
    if (others.length)
      hit(`${tag}: other pages opened: ${others.map(p => p.url()).join(", ")}`);
    if (pages.length > 1)
      hit(`${tag}: ${pages.length} new pages opened; only the notes popup may`);
    await ctx.close();
  }

  // No sideways scroll at 1024 either.
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  watch(page, "1024");
  await openCall(page, { bp: "part1" });
  await sideways(page, "1024");
  await shoot(page, "call-part1-en-1024");
  await ctx.close();
} finally {
  await browser.close();
}

console.log(
  hits.length ? `${hits.length} hit(s)` : `no hits${save ? `; shots in ${out}` : ""}`,
);
process.exit(hits.length ? 1 : 0);
