import { render, stateView, codeFromPath, stateFromQuery, embedUrl, whatsappUrl, workVideo } from "./core.js";
import { STRINGS } from "./strings.js";

export function deviceId(win) {
  let stored;
  try { stored=win.localStorage.getItem("mm-offer-device"); } catch { /* Storage may be disabled. */ }
  if (/^[a-zA-Z0-9-]{8,64}$/.test(stored || "")) return stored;
  const id=win.crypto.randomUUID();
  try { win.localStorage.setItem("mm-offer-device",id); } catch { /* In-memory id works for this visit. */ }
  return id;
}
export function eventBody(kind, device, previewToken) {
  return {kind,d:device,...(previewToken ? {pv:previewToken} : {})};
}
export function startOffer(win=window, doc=document) {
  const app=doc.getElementById("app");
  if (!app) return;
  let proposal=null;
  let lang=String(win.navigator.language || "en").startsWith("ar") ? "ar" : "en";
  const language=(value)=>{ lang=value==="ar" ? "ar" : "en"; doc.documentElement.lang=lang; doc.documentElement.dir=lang==="ar"?"rtl":"ltr"; };
  const paint=(p,preview=false,strings=null)=>{
    proposal=p; language(p?.lang); app.innerHTML=render(p,strings || STRINGS[lang],{preview,brand:preview ? win.__OFFER_BRAND__ : null,posterFallback:preview ? win.__OFFER_ART__ : null,proposalUrl:preview ? null : `${win.location.origin}${win.location.pathname}`});
  };
  // Install the listener before telling the parent it can send data. No storage, fetch or links.
  if (win.__OFFER_PREVIEW__ === true) {
    const receive=(event)=>{
      if(event.source!==win.parent || win.parent===win || event.data?.type!=="offer:preview") return;
      const p=event.data.proposal;
      if(!p || !["en","ar"].includes(p.lang)) return;
      paint(p,true,event.data.strings || null);
    };
    win.addEventListener("message",receive);
    win.parent.postMessage({type:"offer:ready"},"*");
    return ()=>win.removeEventListener("message",receive);
  }
  language(lang);
  const show=(state,contact=null)=>{proposal=null;app.innerHTML=stateView(state,STRINGS[lang],contact);};
  const queryState=stateFromQuery(win.location.search);
  if(queryState){show(queryState);return;}
  const code=codeFromPath(win.location.pathname);
  if(!code){show("unknown");return;}
  const door=doc.querySelector('meta[name="mm-door"]')?.content;
  const validDoor=door && (door==="https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/offer-door" || (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/__door\/[a-z]+$/.test(door) && ["127.0.0.1","localhost"].includes(win.location.hostname)));
  if(!validDoor){show("error");return;}
  const d=deviceId(win);
  const rawPv=new URLSearchParams(win.location.search).get("pv") || "";
  const pv=/^[a-hj-km-np-z2-9]{24}$/.test(rawPv) ? rawPv : null;
  const post=(kind)=>win.fetch(`${door}/p/${code}/event`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(eventBody(kind,d,pv)),credentials:"omit",keepalive:true}).catch(()=>{});
  let ctaPending=false;
  const resume=()=>{
    ctaPending=false;
    app.querySelector('[data-action="cta"]')?.removeAttribute("aria-disabled");
  };
  win.addEventListener("pageshow",resume);
  const click=(event)=>{
    const action=event.target?.closest?.("[data-action]");
    if(!action || !app.contains(action) || !proposal) return;
    if(action.dataset.action==="play"){
      const src=embedUrl(proposal.video?.embedUrl);
      if(!src) return;
      const box=action.closest("[data-video]");
      if(!box || box.querySelector("iframe")) return;
      const frame=doc.createElement("iframe");
      frame.src=src; frame.title=proposal.video.title || STRINGS[lang].play;
      frame.allow="autoplay; fullscreen; picture-in-picture"; frame.allowFullscreen=true;
      frame.referrerPolicy="no-referrer";
      box.replaceChildren(frame);
      frame.focus();
      void post("play");
    } else if(action.dataset.action==="play-work"){
      const index=Number(action.dataset.workIndex);
      if(!Number.isInteger(index) || index<0 || index>=6) return;
      const item=Array.isArray(proposal.work) ? proposal.work[index] : null;
      const media=workVideo(item?.url);
      if(!media) return;
      const box=action.closest("[data-work-video]");
      if(!box || box.querySelector("iframe")) return;
      const frame=doc.createElement("iframe");
      frame.src=media.embedUrl; frame.title=item.label || STRINGS[lang].play;
      frame.allow="autoplay; fullscreen; picture-in-picture"; frame.allowFullscreen=true;
      frame.referrerPolicy="no-referrer";
      box.replaceChildren(frame); frame.focus();
      // Actor examples do not inflate the main demo-play count.
    } else if(action.dataset.action==="cta"){
      event.preventDefault();
      const href=whatsappUrl(proposal.button?.whatsapp);
      if(!href || ctaPending) return;
      ctaPending=true;
      action.setAttribute("aria-disabled","true");
      // The event starts before navigation; a network stall never blocks the client's action.
      Promise.race([post("cta"),new Promise(resolve=>win.setTimeout(resolve,800))]).finally(()=>win.location.assign(href));
    }
  };
  app.addEventListener("click",click);
  show("loading");
  const controller=new AbortController();
  const timer=win.setTimeout(()=>controller.abort(),12000);
  const url=new URL(`${door}/p/${code}`);
  url.searchParams.set("d",d);
  if(pv) url.searchParams.set("pv",pv);
  win.fetch(url.href,{credentials:"omit",cache:"no-store",signal:controller.signal}).then(async response=>{
    if(response.status===429){show("busy");return;}
    if(!response.ok) throw new Error("Door unavailable");
    const answer=await response.json();
    if(answer.state==="open" && answer.proposal){paint(answer.proposal);return;}
    show(["expired","archived","unknown"].includes(answer.state)?answer.state:"error",answer.contact);
  }).catch(()=>show("error")).finally(()=>win.clearTimeout(timer));
  return ()=>{controller.abort();app.removeEventListener("click",click);win.removeEventListener("pageshow",resume);};
}
if(typeof window!=="undefined" && typeof document!=="undefined") startOffer();
