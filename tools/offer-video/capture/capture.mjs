// Real screen captures for the website video, taken on the VPS with a full
// Chrome (the headless shell draws Chrome's error page blank):
//  - Chrome's own "This site can't be reached" page for hosh.example, in
//    English and in Chrome's own Arabic (LANGUAGE=ar);
//  - the demo firm's site (demo-site/out) on desktop and phone, both languages.
// Nothing is pressed that sends or saves. Writes PNGs and boxes.json (element
// rectangles in CSS px, for the film's clouds, leaders and cursor).
//
//   node capture/capture.mjs --site demo-site/out --out <dir> --chrome <path>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    site: { type: "string" },
    out: { type: "string" },
    chrome: { type: "string" },
    playwright: { type: "string" },
  },
});
const require = createRequire(import.meta.url);
const { chromium } = require(
  a.playwright ?? resolve("../../apps/client-success-cockpit/node_modules/playwright"),
);
const site = resolve(a.site);
const out = resolve(a.out);
mkdirSync(out, { recursive: true });
const boxes = { capturedAt: new Date().toISOString() };

const IDS = [
  "hero-pic", "lang-switch", "strip", "services-row", "footer", "foot-note",
  "form", "wa-float", "list", "one",
];

async function rects(p) {
  return p.evaluate((ids) => {
    const r = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      r[id] = { x: b.x, y: b.y + window.scrollY, w: b.width, h: b.height };
    }
    const brand = document.querySelector(".top .brand");
    if (brand) {
      const b = brand.getBoundingClientRect();
      r.brand = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    const h1 = document.querySelector("h1");
    if (h1) {
      const b = h1.getBoundingClientRect();
      r.h1 = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    r.page = { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight };
    return r;
  }, IDS);
}

async function browserFor(lang) {
  return chromium.launch({
    executablePath: a.chrome,
    headless: true,
    args: [`--lang=${lang === "ar" ? "ar" : "en-US"}`, "--hide-scrollbars"],
    env: {
      ...process.env,
      LANGUAGE: lang === "ar" ? "ar" : "en-US",
      LANG: lang === "ar" ? "ar_SA.UTF-8" : "en_US.UTF-8",
    },
  });
}

for (const lang of ["en", "ar"]) {
  const b = await browserFor(lang);

  // 1. Chrome's own error page for the demo firm's reserved .example domain.
  {
    // A smaller window at 3x, so Chrome's own words fill the film's well.
    const ctx = await b.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 3 });
    const p = await ctx.newPage();
    await p.goto("http://hosh.example/").catch(() => {});
    await p.waitForTimeout(1200);
    const text = await p.evaluate(() => document.body.innerText);
    if (!/hosh\.example/.test(text)) throw new Error(`error page did not render (${lang})`);
    // The headline's own text, not its full-width block, so the cloud fits it.
    const h = await p.evaluate(() => {
      const el = document.querySelector("h1") ?? document.querySelector(".error-code");
      const r = document.createRange();
      r.selectNodeContents(el);
      const b = r.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    // The first line under the headline ("Check if there is a typo in ..."):
    // the cloud's lower scallops and halo must clear it.
    const line2 = await p.evaluate(() => {
      const h1 = document.querySelector("h1");
      const el = document.querySelector("#main-message p") ?? h1?.nextElementSibling;
      if (!el) return null;
      const r = document.createRange();
      r.selectNodeContents(el);
      const rs = [...r.getClientRects()].filter((b) => b.width > 0 && b.height > 0);
      if (!rs.length) return null;
      const top = Math.min(...rs.map((b) => b.top));
      const first = rs.filter((b) => b.top < top + 4);
      const x0 = Math.min(...first.map((b) => b.left));
      const x1 = Math.max(...first.map((b) => b.right));
      const y1 = Math.max(...first.map((b) => b.bottom));
      return { x: x0, y: top, w: x1 - x0, h: y1 - top };
    });
    boxes[`err-${lang}`] = { h1: h, ...(line2 ? { line2 } : {}), page: { w: 800, h: 500 }, text: text.split("\n").filter(Boolean) };
    await p.screenshot({ path: join(out, `err-${lang}.png`) });
    await ctx.close();
  }

  // 2. The demo site on desktop, 1440 x 1024 at 2x.
  const desk = await b.newContext({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 2 });
  // services and about since v4: the six pages stand as six sheets.
  for (const name of ["index", "projects", "project", "services", "about", "contact"]) {
    const p = await desk.newPage();
    await p.goto(`file://${site}/${lang}/${name}.html`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    boxes[`${name}-${lang}`] = await rects(p);
    await p.screenshot({ path: join(out, `${name}-${lang}.png`) });
    if (name === "projects") {
      // The whole page, for the film's one slow scroll to the first project.
      await p.screenshot({ path: join(out, `projects-full-${lang}.png`), fullPage: true });
    }
    if (name === "index") {
      // The footer, where the film marks the tracking.
      const f = await p.$("#footer");
      await f.screenshot({ path: join(out, `footer-${lang}.png`) });
    }
    await p.close();
  }
  await desk.close();

  // 3. The demo site on a phone, 390 wide at 3x: the first screen with the
  //    WhatsApp button, and the whole page (button hidden) for the scroll.
  const phone = await b.newContext({
    viewport: { width: 390, height: 845 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  {
    const p = await phone.newPage();
    await p.goto(`file://${site}/${lang}/index.html`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    boxes[`phone-${lang}`] = await rects(p);
    await p.screenshot({ path: join(out, `phone-${lang}.png`) });
    await (await p.$("#wa-float")).screenshot({ path: join(out, `phone-wa-${lang}.png`) });
    await p.addStyleTag({ content: ".wa-float{display:none!important}" });
    boxes[`phonetall-${lang}`] = await rects(p);
    await p.screenshot({ path: join(out, `phonetall-${lang}.png`), fullPage: true });
    await p.close();
  }
  await phone.close();
  await b.close();
}

writeFileSync(join(out, "boxes.json"), JSON.stringify(boxes, null, 1));
console.log(`captures: ${out}`);
