/** Fictional-data interaction acceptance; no production or provider mutations. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base=process.env.OFFER_HARNESS_URL??"http://127.0.0.1:5315/client-success/offer-harness.html";
if(process.platform!=="linux"||!process.cwd().startsWith("/home/hermes/upsell-build/")||new URL(base).hostname!=="127.0.0.1")throw Error("Isolated VPS loopback harness only");
const out="/home/hermes/upsell-build/media/shots/visual-story-interactions";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const checks=[],issues=[];
function check(ok,name){checks.push(name);if(!ok)issues.push(name);}
async function choose(page,id){const name=await page.locator(`.dkq-chapters option[value="${id}"]`).textContent();await page.locator('.dkq-chapters [role="combobox"]').click();await page.getByRole('option',{name,exact:true}).click();}
try{
 for(const lang of ['en','ar']){
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>issues.push(e.message));
  await page.goto(`${base}?view=offers`,{waitUntil:'networkidle'});
  const before=await page.evaluate(()=>[...window.offerHarnessCalls]);
  const keys=['website','second_campaign','seo_geo','smm','cameraman','ugc','closer'];
  for(let n=0;n<keys.length;n++){
   const key=keys[n];await page.locator('.dkq-deck-card').nth(n).click();
   if(lang==='ar')await page.getByRole('button',{name:'العربية',exact:true}).click();
   await choose(page,'get');
   if(key==='website'){
    await page.getByRole('button',{name:'9:16',exact:true}).click();
    check(await page.locator('.dko-sketch').getAttribute('data-mobile')==='true',`${lang}: sketch becomes mobile`);
    await page.getByRole('button',{name:'16:9',exact:true}).click();
    check(await page.locator('.dko-sketch').getAttribute('data-mobile')==='false',`${lang}: sketch returns to desktop`);
    await choose(page,'examples');
    check(await page.locator('.dsv-example-footer a').getAttribute('href')==='https://joeandsera.com/',`${lang}: exact user-selected source link`);
    check(await page.locator('.dsv-real-example img').count()===2,`${lang}: desktop and mobile captures`);
    await page.getByRole('button',{name:'390 × 844',exact:true}).click();
    check(await page.locator('.dsv-real-example').getAttribute('data-device')==='mobile',`${lang}: focus actual mobile reference`);
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.dsv-real-example img')].map(i=>i.decode()));});
    await page.screenshot({path:`${out}/joe-and-sera-${lang}.png`});
   }else if(key==='ugc'){
    check(await page.locator('.dks-casting figure').count()===3,`${lang}: three supplied presenter examples`);
    check(await page.locator('.dks-casting iframe').count()===0,`${lang}: presenter media never auto-opens`);
   }else{
    const buttons=page.locator('.dsv-scene button');const count=await buttons.count();
    check(count>2,`${key}-${lang}: selectable visual sequence`);
    for(let i=0;i<count;i++){
     const label=await buttons.nth(i).getAttribute('aria-label');
     await buttons.nth(i).click();
     check(await page.locator('.dks-scope aside h2').textContent()===label,`${key}-${lang}-${i}: visual and approved explanation agree`);
     check(await page.locator('.dsv-scene button[aria-pressed=true]').count()===1,`${key}-${lang}-${i}: one selected visual`);
    }
    check(await page.locator('.dsv-scene').evaluate(el=>[...el.querySelectorAll('*')].every(x=>getComputedStyle(x).animationName==='none')),`${key}-${lang}: reduced motion is still`);
    await page.screenshot({path:`${out}/${key}-${lang}.png`});
   }
   await page.getByRole('button',{name:'Close',exact:true}).first().click();
  }
  check(JSON.stringify(before)===JSON.stringify(await page.evaluate(()=>window.offerHarnessCalls)),`${lang}: visuals make no record or provider writes`);
  await page.close();
 }
}finally{await browser.close();}
await writeFile(`${out}/report.json`,JSON.stringify({checks:checks.length,issues},null,2));
console.log(JSON.stringify({checks:checks.length,issues,out}));
if(issues.length)process.exitCode=1;
