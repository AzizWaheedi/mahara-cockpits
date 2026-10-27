// Measures text widths with the film's own fonts in headless Chrome, so the
// v4 film lays its words out inside the 80% title-safe box from real metrics.
// VPS only.
//
//   echo '[{"id":"a","family":"Geist","weight":600,"size":96,"text":"Six pages"}]' | node film/measure.mjs
//
// Prints {"a": {"w": 431.2, "h": 96}}.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tool = resolve(here, "..");
const nm = resolve(tool, "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT ?? resolve(tool, "../../apps/client-success-cockpit/node_modules/playwright"),
);
const items = JSON.parse(readFileSync(0, "utf8"));
const gf = `file://${nm}/geist/dist/fonts`;
const pf = `file://${nm}/@fontsource/ibm-plex-sans-arabic/files`;
const css = `
@font-face{font-family:'Geist';src:url('${gf}/geist-sans/Geist-Regular.woff2');font-weight:400}
@font-face{font-family:'Geist';src:url('${gf}/geist-sans/Geist-Medium.woff2');font-weight:500}
@font-face{font-family:'Geist';src:url('${gf}/geist-sans/Geist-SemiBold.woff2');font-weight:600}
@font-face{font-family:'Geist Mono';src:url('${gf}/geist-mono/GeistMono-Regular.woff2');font-weight:400}
@font-face{font-family:'Geist Mono';src:url('${gf}/geist-mono/GeistMono-Medium.woff2');font-weight:500}
@font-face{font-family:'Plex Arabic';src:url('${pf}/ibm-plex-sans-arabic-arabic-400-normal.woff2');font-weight:400}
@font-face{font-family:'Plex Arabic';src:url('${pf}/ibm-plex-sans-arabic-arabic-500-normal.woff2');font-weight:500}
@font-face{font-family:'Plex Arabic';src:url('${pf}/ibm-plex-sans-arabic-arabic-600-normal.woff2');font-weight:600}
body{margin:0} span{position:absolute;white-space:nowrap;line-height:1}`;
const spans = items
  .map((it, i) => {
    const fam = it.family === "Plex Arabic" ? "'Plex Arabic','Geist',sans-serif" : it.family === "Geist Mono" ? "'Geist Mono',monospace" : "'Geist',sans-serif";
    const dir = it.family === "Plex Arabic" ? "rtl" : "ltr";
    const esc = String(it.text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<span id="m${i}" dir="${dir}" style="font-family:${fam};font-weight:${it.weight ?? 400};font-size:${it.size}px;letter-spacing:${it.ls ?? 0}em;top:${i * 4}px">${esc}</span>`;
  })
  .join("");
// The full Chrome for Testing the captures use (the headless shell may be missing).
const exe = process.env.CHROME ?? `${process.env.HOME}/upsell-studio-video/chrome/chrome/linux-152.0.7977.30/chrome-linux64/chrome`;
const b = await chromium.launch({ headless: true, executablePath: exe });
const p = await b.newPage();
await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${spans}</body></html>`);
await p.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
});
const out = await p.evaluate((n) => {
  const r = {};
  for (let i = 0; i < n; i++) {
    const b = document.getElementById(`m${i}`).getBoundingClientRect();
    r[i] = { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
  }
  return r;
}, items.length);
await b.close();
const res = {};
items.forEach((it, i) => (res[it.id ?? i] = out[i]));
console.log(JSON.stringify(res));
