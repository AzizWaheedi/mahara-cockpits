import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const win = new Window({url:"https://localhost/"});
Object.assign(globalThis,{window:win,document:win.document,navigator:win.navigator,HTMLElement:win.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
let listener:((event:string,session:any)=>void)|null=null;
let current:string|null=null;
let seen:any;
const pending=new Map<string,(value:any)=>void>();
const client={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:(fn:typeof listener)=>{listener=fn;return {data:{subscription:{unsubscribe(){listener=null;}}}};},signOut:async()=>{current=null;listener?.("SIGNED_OUT",null);}}};
mock.module("../src/auth/supabaseAccess",()=>({
 createCockpitSupabaseClient:()=>client,
 loadSupabaseAccess:async()=>new Promise(resolve=>pending.set(current!,resolve)),
}));
const {SupabaseAuthProvider,useCockpitAuth}=await import("../src/auth/SupabaseAuthProvider");
function Probe(){seen=useCockpitAuth();return createElement("span",null,seen.email);}
const access=(email:string,isCeo=false)=>({email,name:email,roles:isCeo?["admin"]:["csm"],clients:[],cockpits:["csm"],isAdmin:isCeo,isCeo,home:"/"});
async function tick(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});}
async function login(id:string){await act(async()=>{current=id;listener?.("SIGNED_IN",{user:{id,email:id,email_confirmed_at:"2026-09-01"}});});await tick();}

test("an old founder access response cannot overwrite a newer user's session",async()=>{
 const host=win.document.createElement("div");const root=createRoot(host as any);
 try{
  await act(async()=>root.render(createElement(SupabaseAuthProvider,null,createElement(Probe))));await tick();
  await login("founder@tests.invalid");await login("staff@tests.invalid");
  await act(async()=>pending.get("staff@tests.invalid")!(access("staff@tests.invalid")));
  expect(seen.email).toBe("staff@tests.invalid");expect(seen.isCeo).toBe(false);
  await act(async()=>pending.get("founder@tests.invalid")!(access("founder@tests.invalid",true)));
  expect(seen.email).toBe("staff@tests.invalid");expect(seen.isCeo).toBe(false);
 }finally{await act(async()=>root.unmount());pending.clear();}
});
test("sign-out rejects an in-flight successful access response",async()=>{
 const host=win.document.createElement("div");const root=createRoot(host as any);
 try{
  await act(async()=>root.render(createElement(SupabaseAuthProvider,null,createElement(Probe))));await tick();
  await login("founder@tests.invalid");await act(async()=>{await seen.signOut();});await tick();
  await act(async()=>pending.get("founder@tests.invalid")!(access("founder@tests.invalid",true)));
  expect(seen.session).toBeNull();expect(seen.access).toBeNull();expect(seen.isAuthenticated).toBe(false);expect(seen.isCeo).toBe(false);
 }finally{await act(async()=>root.unmount());pending.clear();}
});
