/** Fictional-data browser acceptance. Provider writes and production are out of scope. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base=process.env.OFFER_HARNESS_URL??"http://127.0.0.1:5316/client-success/offer-harness.html";
if(process.platform!=="linux"||!process.cwd().startsWith("/home/hermes/upsell-build/")||new URL(base).hostname!=="127.0.0.1") throw Error("Isolated VPS loopback harness only");
const out="/home/hermes/upsell-build/media/shots/offer-journey-review";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const checks=[],issues=[],activity=[];
function check(ok,name){checks.push(name);if(!ok)issues.push(name);}
async function choose(page,id){const name=await page.locator(`.dkq-chapters option[value="${id}"]`).textContent();await page.locator('.dkq-chapters [role="combobox"]').click();await page.getByRole('option',{name,exact:true}).click();}
try {
 for(const width of [1366,1920]) for(const lang of ['en','ar']) {
  const page=await browser.newPage({viewport:{width,height:width===1366?900:1080},reducedMotion:'reduce'});
  page.on('pageerror',e=>issues.push(e.message));
  await page.goto(`${base}?view=offers`,{waitUntil:'networkidle'});
  await page.locator('.dkq-deck-card').first().waitFor();
  const before=await page.evaluate(()=>[...window.offerHarnessCalls]);
  const keys=['website','second_campaign','seo_geo','smm','cameraman','ugc','closer'];
  for(let n=0;n<keys.length;n++) {
   const key=keys[n];await page.locator('.dkq-deck-card').nth(n).click();
   if(lang==='ar')await page.getByRole('button',{name:'العربية',exact:true}).click();
   await choose(page,'runs');
   const buttons=page.locator('.dko-journey-steps button');const count=await buttons.count();
   check(count>=3,`${width}-${key}-${lang}: approved delivery sequence present`);
   const original=await buttons.allTextContents();
   for(let i=0;i<count;i++) {
    await buttons.nth(i).click();
    check(await buttons.nth(i).getAttribute('aria-current')==='step',`${width}-${key}-${lang}-${i}: selected step`);
    check(await page.locator('.dko-journey-steps [aria-current=step]').count()===1,`${width}-${key}-${lang}-${i}: one current step`);
    check(await page.locator('.dko-journey-track [data-reached=true]').count()===i+1,`${width}-${key}-${lang}-${i}: progress follows selection`);
    check(JSON.stringify(original)===JSON.stringify(await buttons.allTextContents()),`${width}-${key}-${lang}-${i}: all approved wording remains visible`);
    const overflow=await page.locator('.dko-slide').evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('.dko-journey *')].filter(x=>{const b=x.getBoundingClientRect();return b.width&&b.height&&(b.left<r.left-2||b.right>r.right+2||b.top<r.top-2||b.bottom>r.bottom-2)}).map(x=>x.className||x.tagName)});
    check(!overflow.length,`${width}-${key}-${lang}-${i}: no overflow ${overflow.join(',')}`);
   }
   check(await page.locator('.dko-journey').evaluate(el=>[...el.querySelectorAll('*')].every(x=>getComputedStyle(x).animationName==='none')),`${width}-${key}-${lang}: reduced motion`);
   await buttons.first().focus();await page.keyboard.press('Enter');
   check(await buttons.first().getAttribute('aria-current')==='step',`${width}-${key}-${lang}: keyboard activates step`);
   await page.keyboard.press('ArrowRight');
   check(await buttons.nth(1).getAttribute('aria-current')==='step',`${width}-${key}-${lang}: next keyboard reveal`);
   if(width===1366) {
    await buttons.nth(1).click();
    await page.screenshot({path:`${out}/${key}-${lang}-journey.png`});
    await choose(page,'matters');await page.screenshot({path:`${out}/${key}-${lang}-opening.png`});
    await choose(page,'next');
    if(key==='website'){check(await page.locator('.dko-quick-close h2').count()===1,`${lang}: one closing question`);check(await page.locator('.dko-quick-close li').count()===0,`${lang}: no repeated delivery list`);}
    await page.screenshot({path:`${out}/${key}-${lang}-close.png`});
   }
   await page.getByRole('button',{name:'Close',exact:true}).first().click();
  }
  const after=await page.evaluate(()=>[...window.offerHarnessCalls]);
  const delta=after.slice(before.length);activity.push({width,lang,before,delta});
  const readOnly=new Set(['cockpit_upsell_catalog_read','cockpit_csm_deck_videos_read','cockpit_upsell_pitch_log']);
  check(delta.every(name=>readOnly.has(name)),`${width}-${lang}: no provider or record writes`);
  console.log(JSON.stringify({width,lang,checks:checks.length,issues,activity:delta}));
  await page.close();
 }
} finally {await browser.close();}
await writeFile(`${out}/report.json`,JSON.stringify({checks:checks.length,issues,activity},null,2));
console.log(JSON.stringify({checks:checks.length,issues,out}));
if(issues.length)process.exitCode=1;
