#!/usr/bin/env node
/** VPS-only, provider-free acceptance shots. Vite is started by the coordinating run. */
import { chromium } from "playwright";
import { mkdir,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
if(process.platform!=="linux"||!process.cwd().startsWith("/home/hermes/upsell-build/repo/"))throw Error("Offer screenshots run only inside the VPS build mirror. No local command or output was started.");
const base=process.env.OFFER_HARNESS_URL??"http://127.0.0.1:5311/client-success/offer-harness.html";
if(!["127.0.0.1","localhost"].includes(new URL(base).hostname))throw Error("Use the fictional local harness on the VPS.");
const out=resolve(process.env.OFFER_SHOTS_DIR??"/home/hermes/upsell-build/media/shots/deck");
if(!out.startsWith("/home/hermes/upsell-build/"))throw Error("Screenshot output stays inside the VPS build workspace.");
const fixtures=(process.env.OFFER_SHOT_FIXTURES??"full,sparse,dwy,noprice,saudi,refused,asked").split(",");
const langs=(process.env.OFFER_SHOT_LANGS??"en,ar").split(",");
const sizes=[{width:1920,height:1080,dpr:1},{width:1366,height:768,dpr:1},{width:1366,height:768,dpr:.67}];
const STOPS={saw:["capture","cloud","ask"],matters:["words","tie"],get:["drawn","pages","portfolio","whatsapp","form","tracking","care","need"],investment:["bill","beside","ask"],next:["commit","close"]};
const failures=[],manifest=[];
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
        // The slide root paints the canvas ground, not content above its footer.
        // Its descendants still go through the same collision checks.
        if (el === slide || !shown(el)) continue;
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


const overflow=page=>page.evaluate(()=>{const canvas=document.querySelector(".dk-canvas"),slide=document.querySelector(".dko-slide");if(!canvas||!slide)return ["The canvas is missing."];const c=canvas.getBoundingClientRect(),k=c.width/1920;const out=[];for(const el of slide.querySelectorAll("h1,h2,p,blockquote,small,strong,label,bdi,.dko-record,.dko-bill,.dko-return,.dko-commit,.dko-capture-well,.dko-browser,.dko-sentence")){if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;const r=el.getBoundingClientRect();if(r.left<c.left-k||r.right>c.right+k||r.top<c.top-k||r.bottom>c.bottom+k)out.push(`${el.tagName} ${el.className}: outside canvas at ${Math.round((r.left-c.left)/k)},${Math.round((r.top-c.top)/k)} to ${Math.round((r.right-c.left)/k)},${Math.round((r.bottom-c.top)/k)}`);if(el.clientWidth>0&&el.scrollWidth>el.clientWidth+2&&!el.closest(".dko-capture-well"))out.push(`${el.tagName} ${el.className}: horizontal content overflow`);}return out;});
async function measure(page,name){const issues=(await Promise.all([collisions(page),overlaps(page),wraps(page),overflow(page)])).flat();for(const issue of issues)failures.push(`${name}: ${issue}`);manifest.push({name,issues});await page.screenshot({path:`${out}/${name}.png`});}
async function pageFor(browser,size){const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr,reducedMotion:"reduce"});page.on("pageerror",e=>failures.push(`Browser: ${e.message}`));await page.route("**/*",route=>{const u=new URL(route.request().url());if(u.hostname==="www.youtube-nocookie.com")return route.fulfill({contentType:"text/html",body:"<html><body>Fictional player fixture. No provider contacted.</body></html>"});return ["127.0.0.1","localhost","fonts.googleapis.com","fonts.gstatic.com"].includes(u.hostname)||u.protocol==="data:"?route.continue():route.abort();});return page;}
async function open(page,args){const u=new URL(base);for(const [k,v] of Object.entries(args))u.searchParams.set(k,String(v));u.searchParams.set("still","1");await page.goto(u.href,{waitUntil:"networkidle"});await page.evaluate(()=>document.fonts.ready);}
await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});
try{
for(const fixture of fixtures)for(const lang of langs)for(const size of sizes){const page=await pageFor(browser,size);const prefix=`${fixture}-${lang}-${size.width}${size.dpr===1?"":"-scale067"}`;await open(page,{fixture,lang,view:"present"});if(fixture==="refused"){await page.locator(".dk-closed").waitFor();await page.screenshot({path:`${out}/${prefix}-refused.png`});await page.close();continue;}await page.locator(".dko-slide").waitFor();for(const [slide,stops] of Object.entries(STOPS)){if((fixture==="sparse"&&slide==="saw")||(fixture==="noprice"&&slide==="investment"))continue;for(const stop of stops){await page.waitForFunction(({slide,stop})=>document.querySelector(`.dko-${slide}`)?.getAttribute("data-stop")===stop,{slide,stop},{timeout:5000});await measure(page,`${prefix}-${slide}-${stop}`);await page.keyboard.press("ArrowRight");}}
// A hidden process sheet is reached only with H; V uses the offer registry.
await page.keyboard.press("h");await page.locator(".dko-runs").waitFor();await measure(page,`${prefix}-runs-steps`);if(fixture!=="sparse"){await page.keyboard.press("v");await page.locator(".dkv-dialog").waitFor();await page.screenshot({path:`${out}/${prefix}-video-player.png`});await page.keyboard.press("Escape");}await page.close();}
for(const view of ["prep","notes","picker","hotrow","offers"]){for(const role of view==="offers"?["csm","ceo"]:["csm"]){const page=await pageFor(browser,{width:1440,height:1000,dpr:1});await open(page,{fixture:"full",lang:"en",view,role});await page.screenshot({path:`${out}/${view}-${role}.png`,fullPage:true});await page.close();}}
}finally{await browser.close();}
await writeFile(`${out}/report.json`,JSON.stringify({shots:manifest.length,failures,manifest},null,2));if(failures.length)throw Error(`${failures.length} layout/browser problems. See ${out}/report.json\n${failures.slice(0,12).join("\n")}`);process.stdout.write(`Verified ${manifest.length} canvas shots, plus private views and players.\n`);
