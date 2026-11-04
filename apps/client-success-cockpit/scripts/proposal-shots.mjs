/** Remote-only browser checks and screenshots. Every record is fictional. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

if (process.platform === "darwin") throw Error("Run proposal screenshots on the VPS through vrun.sh.");
const args = Object.fromEntries(process.argv.slice(2).flatMap((x,i,a) => x.startsWith("--") ? [[x.slice(2),a[i+1]]] : []));
const out = resolve(args.out || "tmp/proposal-shots"); mkdirSync(out,{recursive:true});
const origin = args.url || "http://127.0.0.1:5312";
const vite = args.url ? null : spawn("bunx",["vite","--port","5312","--strictPort","--host","127.0.0.1"],{stdio:"ignore"});
const pause = ms => new Promise(r=>setTimeout(r,ms));
let browser;
const report = [];
const mobileWidths = [320,375,414,768];
// Inspect the actual glyph rectangles: html overflow-x:clip can conceal overflowing text.
const textBounds = frame => frame.evaluate(async () => {
  await document.fonts.ready;
  const issues=[];
  const root=document.querySelector(".of-proposal,.of-state");
  if(!root) return ["No rendered proposal or state"];
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(!node.textContent?.trim())continue;
    const owner=node.parentElement?.closest("h1,h2,p,li,th,td,figcaption,a,button");
    if(!owner || !owner.getClientRects().length)continue;
    const range=document.createRange();range.selectNodeContents(node);
    const box=owner.getBoundingClientRect();
    for(const rect of range.getClientRects()){
      if(rect.width && (rect.left < -1 || rect.right > innerWidth+1 || rect.left < box.left-2 || rect.right > box.right+2))
        issues.push(`${owner.tagName}.${owner.className}: ${node.textContent.slice(0,80)}`);
    }
  }
  return [...new Set(issues)];
});
try {
  for(let i=0;i<50;i++){try{if((await fetch(`${origin}/client-success/proposal-harness.html`)).ok)break;}catch{} if(i===49)throw Error("Proposal harness did not start");await pause(300);}
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>{const u=new URL(route.request().url());if(u.origin===origin||["fonts.googleapis.com","fonts.gstatic.com"].includes(u.hostname)||["data:","about:"].includes(u.protocol))return route.continue();return route.abort();});
  const navigate = async params => { await page.goto(`${origin}/client-success/proposal-harness.html?${new URLSearchParams(params)}`,{waitUntil:"networkidle"}); };
  for(const lang of ["en","ar"]){
    await page.setViewportSize({width:1440,height:1000});await navigate({lang,view:"builder"});
    await page.getByRole("heading",{name:"Website proposal",exact:true}).waitFor();
    await page.frameLocator("iframe[title='Client proposal preview']").locator(".of-proposal").waitFor();
    await page.screenshot({path:`${out}/builder-${lang}.png`,fullPage:true});
    const previewFrame=page.frames().find(f=>f.parentFrame());
    if(await previewFrame.evaluate(()=>innerWidth)!==1280)throw Error("Desktop preview is not a desktop viewport");
    await page.getByRole("button",{name:"Phone preview",exact:true}).click();
    if(await previewFrame.evaluate(()=>innerWidth)!==390)throw Error("Phone preview is not 390px");
    await page.getByRole("button",{name:"Desktop preview",exact:true}).click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error(`Builder overflows ${lang}`);
    report.push({view:"builder",lang,overflow});
    for(const width of [320,375,390,414,768,1280])for(const state of ["draft","open","expired","archived","unknown"]){
      await page.setViewportSize({width,height:1000});await navigate({lang,view:"page",state,w:String(width)});
      const frame=page.frameLocator("iframe");await frame.locator(state==="draft"||state==="open"?".of-proposal":".of-state").waitFor();
      const inner=page.frames().find(f=>f.parentFrame());
      const contentHeight=await inner.evaluate(()=>Math.max(document.body.scrollHeight,document.documentElement.scrollHeight));
      await page.locator("iframe").evaluate((el,h)=>el.style.height=`${h}px`,contentHeight);
      await page.screenshot({path:`${out}/page-${lang}-${state}-${width}.png`,fullPage:true});
      const over=await inner.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(over)throw Error(`Client page overflows ${lang}/${state}/${width}`);
      const clipped=await textBounds(inner);if(clipped.length)throw Error(`Client text exceeds its bounds ${lang}/${state}/${width}: ${clipped.join("; ")}`);
      report.push({view:"page",lang,state,width,overflow:over,textBounds:true});
    }
    for(const width of mobileWidths){
      await page.setViewportSize({width,height:1000});await navigate({lang,view:"page",state:"open"});
      const inner=page.frames().find(f=>f.parentFrame());
      await inner.locator(".of-proposal").waitFor();
      const word=lang==="ar" ? "تصميم".repeat(16) : "FictionalDesign".repeat(8);
      const stress={lang,offer:"website",title:word,clientName:word+"Client",csmFirstName:word+"CSM",validUntil:"2026-11-09",logo:null,video:null,found:[],why:word,get:[word+"Scope"],work:[],steps:word,timing:null,investment:{parts:[{label:word+"LineItem",amountUsd:2000,cadence:"one_time"}],terms:word,split:null},button:{text:lang==="ar"?"نعم، نبدأ":"Yes, let's start",whatsapp:"https://wa.me/00000000000"}};
      // Exercise the shipped parent-to-preview contract with synthetic data, no DOM substitution.
      await page.evaluate(proposal=>document.querySelector("iframe").contentWindow.postMessage({type:"offer:preview",proposal},"*"),stress);
      await inner.locator(".of-kicker").filter({hasText:stress.clientName}).waitFor();
      const clipped=await textBounds(inner);if(clipped.length)throw Error(`Long proposal text clipped ${lang}/${width}: ${clipped.join("; ")}`);
      const wrapped=await inner.evaluate(()=>[".of-heading h1",".of-kicker",".of-prepared",".of-deliverables li",".of-bill th"].map(selector=>{
        const el=document.querySelector(selector);
        const node=[...el.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
        const range=document.createRange();range.selectNodeContents(node);
        return {selector,lines:new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size};
      }));
      if(wrapped.some(row=>row.lines<2))throw Error(`Long-text fixture did not exercise wrapping ${lang}/${width}: ${JSON.stringify(wrapped)}`);
      report.push({view:"long-text",lang,width,textBounds:true,wrapped});
    }
  }
  // Test a real edit, server-confirmed preview and hidden item in the same shipped component.
  await page.setViewportSize({width:1440,height:1000});await navigate({view:"builder",mode:"fail"});
  await page.getByLabel("Personalise the reason").fill("A fictional revision to check automatic saving.");
  await page.getByRole("button",{name:"Retry save"}).waitFor();await page.getByRole("button",{name:"Retry save"}).click();
  await page.frameLocator("iframe[title='Client proposal preview']").getByText("A fictional revision to check automatic saving.").waitFor();
  await page.getByLabel("Include this item").first().uncheck();
  await page.getByRole("status").filter({hasText:"Saved"}).first().waitFor();
  await page.getByLabel("Language",{exact:true}).selectOption("ar");
  await page.frameLocator("iframe[title='Client proposal preview']").locator(".of-proposal[dir='rtl']").waitFor();
  report.push({interaction:"failed save retained, retry saved, item toggled, Arabic preview",passed:true});
  if(errors.length)throw Error(errors.join("\n"));
  writeFileSync(`${out}/report.json`,JSON.stringify({ok:true,checks:report},null,2));
  console.log(JSON.stringify({ok:true,checks:report.length,out}));
} finally {await browser?.close();vite?.kill();}
