#!/usr/bin/env node
/** Provider-free browser acceptance of all seven fictional offer decks. VPS only. */
import {chromium} from "playwright";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {resolve} from "node:path";
if(process.platform!=="linux"||!process.cwd().startsWith("/home/hermes/upsell-build/"))throw Error("Run only in an isolated VPS build checkout.");
const base=process.env.OFFER_HARNESS_URL??"http://127.0.0.1:5312/client-success/offer-harness.html";
if(!["127.0.0.1","localhost"].includes(new URL(base).hostname))throw Error("Use the fictional loopback harness.");
const out=resolve(process.env.OFFER_SHOTS_DIR??"/home/hermes/upsell-build/media/shots/all-offers");
if(!out.startsWith("/home/hermes/upsell-build/"))throw Error("Output stays on VPS.");
const rows=JSON.parse(await readFile(new URL("../src/dev/offer/allCatalog.json",import.meta.url),"utf8"));
const keys=(process.env.OFFER_KEYS??Object.keys(rows).join(",")).split(",");
const sizes=[{width:1920,height:1080,dpr:1},{width:1366,height:768,dpr:.67}];
const langs=["en","ar"],failures=[],manifest=[];
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
      ...[...canvas.querySelectorAll(":scope > .dk-count, :scope > .dkc-rail, :scope > .dks-mahara-mark")],
      ...[...slide.querySelectorAll('[class*="-foot"]')].filter(
        el => [...el.classList].some(x => x.endsWith("-foot")) && !el.closest(".dkc-phone, .dkc-phones"),
      ),
    ].filter(shown);
    const out = [];
    for (const foot of feet) {
      const mine = painted(foot);
      const name = [...foot.classList].find(x => x === "dk-count" || x === "dkc-rail" || x === "dks-mahara-mark" || x.endsWith("-foot"));
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

async function measure(page,name,shot){
 if(await page.locator(".dks-actor-poster").count())await page.waitForFunction(()=>[...document.querySelectorAll(".dks-actor-poster")].every(im=>im.complete&&im.naturalWidth>=1080));
 const issues=(await Promise.all([collisions(page),overlaps(page),wraps(page),overflow(page)])).flat();
 for(const issue of issues)failures.push(`${name}: ${issue}`);manifest.push({name,issues});
 if(shot)await page.screenshot({path:`${out}/${name}.png`});
}
async function pageFor(browser,size){
 const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr,reducedMotion:"reduce"});
 page.on("pageerror",e=>failures.push(`Browser: ${e.message}`));
 await page.route("**/*",route=>{const u=new URL(route.request().url());
  if(u.hostname==="fast.wistia.net"||u.hostname==="www.youtube-nocookie.com")return route.fulfill({contentType:"text/html",body:"<html><body>Controlled player fixture. No provider contacted.</body></html>"});
  return ["127.0.0.1","localhost","fonts.googleapis.com","fonts.gstatic.com","fast.wistia.com","embed-ssl.wistia.com"].includes(u.hostname)||u.protocol==="data:"?route.continue():route.abort();
 });return page;
}
async function open(page,args){const u=new URL(base);for(const[k,v]of Object.entries(args))u.searchParams.set(k,v);u.searchParams.set("still","1");await page.goto(u.href,{waitUntil:"networkidle"});await page.evaluate(()=>document.fonts.ready);}
const state=page=>page.evaluate(()=>{const s=document.querySelector(".dk-slide[data-slide]"),v=document.querySelector(".dko-slide");return s&&v?`${s.getAttribute("data-slide")}-${v.getAttribute("data-stop")}`:null;});
await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});
try{
 for(const offer of keys)for(const lang of langs)for(const size of sizes){
  const page=await pageFor(browser,size),prefix=`${offer}-${lang}-${size.width}${size.dpr===1?"":"-067"}`;
  try{await open(page,{offer,lang,fixture:"full",view:"present"});await page.locator(".dko-slide").waitFor();const seen=new Set(),slides=new Set();
   for(let n=0;n<70;n++){const current=await state(page);if(!current||seen.has(current))break;seen.add(current);const slide=await page.locator(".dk-slide[data-slide]").getAttribute("data-slide");const shot=!slides.has(slide)||current==="get-1";slides.add(slide);await measure(page,`${prefix}-${current}`,shot);await page.keyboard.press("ArrowRight");await page.waitForTimeout(30);}
   for(const id of ["matters","get","investment","next"])if(!slides.has(id))failures.push(`${prefix}: missing ${id}`);
   if(offer==="ugc"){await page.goto(new URL(`${base}?offer=ugc&lang=${lang}&fixture=full&view=present&still=1#get`).href,{waitUntil:"networkidle"});await page.locator("[data-actor-examples]").waitFor();await page.waitForFunction(()=>[...document.querySelectorAll(".dks-actor-poster")].length===3&&[...document.querySelectorAll(".dks-actor-poster")].every(im=>im.complete&&im.naturalWidth>=1080&&im.naturalHeight>=1920));if(await page.locator(".dks-casting-screen iframe").count())throw Error("Actor player loaded before a click.");await page.locator(".dks-casting-screen button").first().click();await page.locator(".dks-casting-screen iframe").waitFor();const src=await page.locator(".dks-casting-screen iframe").getAttribute("src");if(!src?.startsWith("https://fast.wistia.net/embed/iframe/qlwysqfu2g"))throw Error("Actor example mismatch.");await page.screenshot({path:`${out}/${prefix}-actor-click.png`});}
  }catch(e){failures.push(`${prefix}: ${e.message}`);}finally{await page.close();}
 }
 const hub=await pageFor(browser,{width:1440,height:1000,dpr:1});await open(hub,{view:"offers"});await hub.getByRole("button",{name:`Preview ${rows.website.copy.en.name} pitch deck`,exact:true}).waitFor();await hub.screenshot({path:`${out}/hub-desktop.png`,fullPage:true});const initial=await hub.evaluate(()=>window.offerHarnessCalls.slice());
 for(const [key,row]of Object.entries(rows)){
  await hub.getByRole("button",{name:`Preview ${row.copy.en.name} pitch deck`,exact:true}).click();await hub.locator('[role="dialog"] .dk-slide').waitFor();
  const dialog=hub.getByRole("dialog");await dialog.getByRole("button",{name:"Next",exact:true}).click();await dialog.getByRole("button",{name:"العربية",exact:true}).click();await hub.evaluate(()=>document.fonts.ready);
  await measure(hub,`catalog-${key}-ar`,true);await dialog.getByRole("button",{name:"Close",exact:true}).click();
  const calls=await hub.evaluate(()=>window.offerHarnessCalls.slice());if(JSON.stringify(calls)!==JSON.stringify(initial))failures.push(`catalog ${key}: preview issued RPCs`);
 }
 await hub.close();
}finally{await browser.close();}
await writeFile(`${out}/report.json`,JSON.stringify({checks:manifest.length,failures,manifest},null,2));
console.log(JSON.stringify({checks:manifest.length,failures:failures.length,report:`${out}/report.json`}));
if(failures.length){console.error(failures.slice(0,15).join("\n"));process.exitCode=1;}
