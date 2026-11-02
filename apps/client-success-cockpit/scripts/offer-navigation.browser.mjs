#!/usr/bin/env node
// Fictional route recovery and full-resolution actor proof. No client/provider writes.
import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
if(process.platform!=="linux"||!process.cwd().startsWith("/home/hermes/upsell-build/"))throw Error("Run only in the VPS build checkout.");
const base=process.env.OFFER_HARNESS_URL??"http://127.0.0.1:5312/client-success/offer-harness.html";
if(!["127.0.0.1","localhost"].includes(new URL(base).hostname))throw Error("Use the fictional loopback harness.");
const out="/home/hermes/upsell-build/media/shots/all-offers";await mkdir(out,{recursive:true});
const b=await chromium.launch();
try{
 for(const key of ["website","second_campaign","seo_geo","smm","cameraman","ugc","closer"]){
  const p=await b.newPage({viewport:{width:1920,height:1080},reducedMotion:"reduce"});
  await p.route("**/*",r=>["127.0.0.1","localhost","fonts.googleapis.com","fonts.gstatic.com","embed-ssl.wistia.com"].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await p.goto(`${base}?offer=${key}&lang=en&fixture=full&view=present&still=1#get`,{waitUntil:"networkidle"});
  await p.locator('.dk-slide[data-slide="get"]').waitFor();
  if(key==="ugc")for(const lang of ["en","ar"]){
   if(lang==="ar"){await p.keyboard.press("l");await p.locator('.dko-slide[dir="rtl"]').waitFor();}
   await p.waitForFunction(()=>[...document.querySelectorAll(".dks-actor-poster")].length===3&&[...document.querySelectorAll(".dks-actor-poster")].every(im=>im.complete&&im.naturalWidth>=1080&&im.naturalHeight>=1920));
   await p.evaluate(()=>Promise.all([...document.querySelectorAll(".dks-actor-poster")].map(im=>im.decode())));
   await p.screenshot({path:`${out}/ugc-${lang}-1920-get-0.png`});
  }
  await p.close();
 }
 const p=await b.newPage();await p.goto(`${base}?offer=closer&fixture=sparse&view=present`,{waitUntil:"networkidle"});await p.getByRole("link",{name:"Open private prep",exact:true}).click();await p.getByLabel("Named recruiter").waitFor();
 console.log("7 fresh hash links, full-resolution UGC EN/AR posters and Closer prep recovery passed.");
}finally{await b.close();}
