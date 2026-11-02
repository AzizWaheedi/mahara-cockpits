#!/usr/bin/env node
/** Fictional browser acceptance only. No client record or provider write. VPS only. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
if(process.platform!=="linux" || !process.cwd().startsWith("/home/hermes/upsell-build/"))throw Error("VPS isolated checkout only");
const base=process.env.OFFER_HARNESS_URL??"http://127.0.0.1:5314/client-success/offer-harness.html";
if(!["127.0.0.1","localhost"].includes(new URL(base).hostname))throw Error("Fictional loopback harness only");
const out=resolve(process.env.OFFER_SHOTS_DIR??"/home/hermes/upsell-build/media/shots/quick-pitch");
if(!out.startsWith("/home/hermes/upsell-build/"))throw Error("Keep output on VPS");
await mkdir(out,{recursive:true});
const keys=["website","second_campaign","seo_geo","smm","cameraman","ugc","closer"],issues=[],checks=[];
const browser=await chromium.launch({headless:true});
async function settle(page){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll(".dk-canvas img,.dkq-library img")].map(im=>im.complete?Promise.resolve():new Promise(r=>{im.addEventListener("load",r,{once:true});im.addEventListener("error",r,{once:true});setTimeout(r,5000);})))});}
async function choose(page,id){
  const text=await page.locator(`.dkq-chapters select option[value="${id}"]`).textContent();
  await page.locator('.dkq-chapters [role="combobox"]').click();
  await page.getByRole('option',{name:text,exact:true}).click();
}
async function measure(page,name){
  const problems=await page.evaluate(()=>{
    const canvas=document.querySelector(".dk-canvas"),slide=document.querySelector(".dko-slide");
    if(!canvas||!slide)return ["Missing canvas"];
    const c=canvas.getBoundingClientRect(),k=c.width/1920,problems=[],runs=[];
    for(const el of slide.querySelectorAll("h1,h2,p,blockquote,small,strong,figcaption,.dks-example-label,.dko-eyebrow")){
      if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;
      const range=document.createRange();range.selectNodeContents(el);
      for(const b of range.getClientRects()){
        if(b.width<1||b.height<1)continue;
        if(b.left<c.left-k*2||b.right>c.right+k*2||b.top<c.top-k*2||b.bottom>c.bottom+k*2)problems.push("Text outside canvas: "+el.textContent.slice(0,60));
        runs.push({el,b});
      }
      if(el.clientWidth&&el.scrollWidth>el.clientWidth+2)problems.push("Text overflow: "+el.textContent.slice(0,60));
    }
    for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++){
      const a=runs[i],b=runs[j];if(a.el===b.el||a.el.contains(b.el)||b.el.contains(a.el))continue;
      const w=Math.min(a.b.right,b.b.right)-Math.max(a.b.left,b.b.left),h=Math.min(a.b.bottom-a.b.height/6,b.b.bottom-b.b.height/6)-Math.max(a.b.top+a.b.height/6,b.b.top+b.b.height/6);
      if(w>k*3&&h>k*3)problems.push("Text overlap: "+a.el.textContent.slice(0,30)+" / "+b.el.textContent.slice(0,30));
    }
    for(const im of slide.querySelectorAll("img")){if(im.checkVisibility()&&(!im.complete||im.naturalWidth===0))problems.push("Broken image: "+im.className);}
    const mark=canvas.querySelector(".dks-mahara-mark img");if(!mark||!mark.complete||mark.naturalWidth===0)problems.push("Missing genuine logo");
    return [...new Set(problems)];
  });
  checks.push({name,issues:problems});for(const p of problems)issues.push(`${name}: ${p}`);
}
try{
  for(const width of [390,820,1440]){
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:"reduce"});
    await page.goto(`${base}?view=offers`,{waitUntil:"networkidle"});await settle(page);
    if(await page.locator('.dkq-deck-card').count()!==7)issues.push(`hub-${width}: seven decks missing`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);if(overflow)issues.push(`hub-${width}: horizontal overflow`);
    await page.screenshot({path:`${out}/hub-${width}.png`,fullPage:true});
    await page.goto(`${base}?view=picker&fixture=noprice`,{waitUntil:"networkidle"});
    if(await page.getByRole("button",{name:"Quick pitch",exact:true}).count()!==7)issues.push(`picker-${width}: missing quick entry`);
    if(await page.getByRole("link",{name:"Prepare for client",exact:true}).count()!==7)issues.push(`picker-${width}: missing preparation entry`);
    await page.screenshot({path:`${out}/picker-${width}.png`,fullPage:true});await page.close();
  }
  for(const width of [1366,1920]){
    const page=await browser.newPage({viewport:{width,height:width===1920?1080:768},reducedMotion:"reduce"});
    page.on("pageerror",e=>issues.push(`browser: ${e.message}`));
    // Exercise the fallback explicitly rather than depending on headless full-screen permission.
    await page.addInitScript(()=>{ Element.prototype.requestFullscreen=()=>Promise.reject(new DOMException("Fixture blocks native full screen","NotAllowedError")); });
    await page.route("**/*",route=>{const u=new URL(route.request().url());if(["127.0.0.1","localhost","fonts.googleapis.com","fonts.gstatic.com","embed-ssl.wistia.com"].includes(u.hostname)||u.protocol==="data:")return route.continue();return route.abort();});
    await page.goto(`${base}?view=offers`,{waitUntil:"networkidle"});
    const initial=await page.evaluate(()=>[...window.offerHarnessCalls]);
    for(let i=0;i<keys.length;i++){
      const key=keys[i];await page.locator('.dkq-deck-card').nth(i).click();await page.locator(`[data-quick-pitch="${key}"]`).waitFor();await settle(page);
      if(await page.locator('.dkq-chapters option[value="investment"]').count())issues.push(`${key}: investment was automatic`);
      if(i===0){
        await page.getByRole("button",{name:"Full screen",exact:true}).click();
        await page.locator('.dkq-expanded').waitFor();
        if(await page.locator('.dkq-private-head').isVisible())issues.push(`fullscreen-${width}: private controls still visible`);
        const fills=await page.locator('.dkq-expanded').evaluate(el=>{const r=el.getBoundingClientRect();return Math.abs(r.width-innerWidth)<2&&Math.abs(r.height-innerHeight)<2;});
        if(!fills)issues.push(`fullscreen-${width}: fallback does not fill viewport`);
        await choose(page,'runs');
        if(await page.locator('.dkq-chapters select').inputValue()!=="runs")issues.push(`fullscreen-${width}: chapter picker failed inside presentation`);
        await page.keyboard.press("Escape");
        await page.locator('.dkq-expanded').waitFor({state:"detached"});
        if(!(await page.locator(`[data-quick-pitch="${key}"]`).isVisible()))issues.push(`fullscreen-${width}: Escape closed the whole deck`);
      }
      for(const lang of ["en","ar"]){
        if(lang==="ar")await page.getByRole("button",{name:"العربية",exact:true}).click();
        const options=await page.locator('.dkq-chapters option').evaluateAll(xs=>xs.map(x=>x.value));
        for(const id of options){
          await choose(page,id);await settle(page);
          const chapter=await page.locator('.dkq-chapters>span:not(.sr-only)').textContent();
          const total=Number((chapter??'').split('·')[1]?.split('/')[1]?.replace(/[٠-٩]/g,x=>"٠١٢٣٤٥٦٧٨٩".indexOf(x))??1);
          for(let stop=0;stop<total;stop++){
            await settle(page);await measure(page,`${key}-${lang}-${width}-${id}-${stop}`);
            if(stop===0 && (id==="matters"||id==="get"||id==="next"))await page.screenshot({path:`${out}/${key}-${lang}-${width}-${id}.png`});
            if(stop<total-1)await page.getByRole("button",{name:lang==="en"?"Next":"التالي",exact:true}).click();
          }
        }
      }
      // Optional pricing is local, reversible, and resets for each presentation.
      const price=page.getByLabel("Include list price",{exact:true});
      if(await price.count()){
        await price.check();
        await page.locator('.dkq-chapters option[value="investment"]').waitFor({state:"attached"});
        await choose(page,'next');
        await price.uncheck();
        if(await page.locator('.dkq-chapters select').inputValue()!=="matters")issues.push(`${key}: removing price did not safely reset chapter`);
        await price.check();
      }
      // Keyboard on the actual embedded canvas, no PresentApp callback.
      await page.locator('.dkq-example-banner').click();
      await page.keyboard.press("Home");
      if(await page.locator('.dkq-chapters select').inputValue()!=="matters")issues.push(`${key}: Home did not navigate`);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("l");await page.keyboard.press("End");
      await page.getByRole("button",{name:"Close",exact:true}).first().click();
      await page.locator(`[data-quick-pitch="${key}"]`).waitFor({state:"detached"});
      await page.locator('.dkq-deck-card').nth(i).click();
      await page.locator(`[data-quick-pitch="${key}"]`).waitFor();
      if(await page.locator('.dkq-chapters option[value="investment"]').count())issues.push(`${key}: reopened with pricing enabled`);
      if(!(await page.locator('[data-quick-pitch] .dkq-example-banner').textContent()).includes("Example"))issues.push(`${key}: fullscreen subtree missing example label`);
      await page.getByRole("button",{name:"Close",exact:true}).last().click();
      await page.locator(`[data-quick-pitch="${key}"]`).waitFor({state:"detached"});
    }
    const after=await page.evaluate(()=>window.offerHarnessCalls);
    if(JSON.stringify(initial)!==JSON.stringify(after))issues.push(`quick-${width}: unexpected RPC/model write: ${JSON.stringify(after)}`);
    await page.close();
  }
} finally {await browser.close();}
await writeFile(`${out}/report.json`,JSON.stringify({checks:checks.length,issues,manifest:checks},null,2));
console.log(JSON.stringify({checks:checks.length,issues:issues.length,out}));
if(issues.length){console.error(issues.slice(0,30).join("\n"));process.exit(1);}
