import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { startOffer, eventBody } from "./offer.js";
import { fixture } from "./fixtures.ts";
const require=createRequire(new URL("../../apps/client-success-cockpit/package.json",import.meta.url));
const {Window}=require("happy-dom");
function setup(){
  const win=new Window({url:"http://127.0.0.1:5322/abcdefghjkmn"});
  win.document.body.innerHTML='<meta name="mm-door" content="http://127.0.0.1:5322/__door/open"><main id="app"></main>';
  return win;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test("preview only hears its parent and never touches the door, storage or embeds",()=>{
  const win=setup();win.__OFFER_PREVIEW__=true;
  const messages=[];const parent={postMessage:m=>messages.push(m)};
  Object.defineProperty(win,"parent",{value:parent});
  win.fetch=()=>{throw new Error("preview fetched")};
  Object.defineProperty(win,"localStorage",{get(){throw new Error("preview touched storage")}});
  const stop=startOffer(win,win.document);
  expect(messages).toEqual([{type:"offer:ready"}]);
  win.dispatchEvent(new win.MessageEvent("message",{source:win,data:{type:"offer:preview",proposal:fixture()}}));
  expect(win.document.querySelector(".of-proposal")).toBeNull();
  win.dispatchEvent(new win.MessageEvent("message",{source:parent,data:{type:"offer:preview",proposal:fixture()}}));
  expect(win.document.querySelector(".of-proposal")).not.toBeNull();
  expect(win.document.querySelectorAll("iframe,a[href]").length).toBe(0);
  expect(win.document.querySelector('[data-action="play"]').disabled).toBe(true);
  stop();win.happyDOM.abort();
});
test("live fetch carries preview token; provider and play event wait for a click",async()=>{
  const win=setup();win.location.search="?pv=abcdefghjkmnabcdefghjkmn";
  const calls=[];
  win.fetch=async(url,opts={})=>{calls.push({url:String(url),opts});return new Response(JSON.stringify({state:"open",proposal:fixture()}),{status:200});};
  const stop=startOffer(win,win.document);
  await tick();
  expect(calls).toHaveLength(1);expect(calls[0].url).toContain("pv=abcdefghjkmnabcdefghjkmn");
  expect(win.document.querySelector("iframe")).toBeNull();
  win.document.querySelector('[data-action="play"]').click();
  expect(win.document.querySelector("iframe").src).toContain("youtube-nocookie.com/embed/");
  expect(JSON.parse(calls[1].opts.body)).toMatchObject({kind:"play",pv:"abcdefghjkmnabcdefghjkmn"});
  expect(eventBody("cta","test-device","token")).toEqual({kind:"cta",d:"test-device",pv:"token"});
  stop();await win.happyDOM.abort();
});
test("redirect flags render without fetching or storing an id",()=>{
  const win=setup();win.location.search="?gone=1";
  win.fetch=()=>{throw new Error("closed link fetched")};
  startOffer(win,win.document);
  expect(win.document.getElementById("app").textContent).toContain("This video link has ended");
  expect(win.localStorage.length).toBe(0);
  win.happyDOM.abort();
});
test("bad JSON closes the page without exposing server output",async()=>{
  const win=setup();win.fetch=async()=>new Response("private stack trace",{status:200});
  const stop=startOffer(win,win.document);await tick();
  expect(win.document.getElementById("app").textContent).toContain("This page didn't load");
  expect(win.document.body.textContent).not.toContain("private stack trace");
  stop();await win.happyDOM.abort();
});
