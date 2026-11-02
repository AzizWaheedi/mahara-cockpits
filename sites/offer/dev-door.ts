/** VPS-only review harness. No real clients, credentials, events or provider embeds. */
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fixture } from "./fixtures";
const root=import.meta.dir, port=Number(process.argv[2] || 5421);
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});
const types:Record<string,string>={".js":"text/javascript",".css":"text/css",".html":"text/html",".png":"image/png",".webp":"image/webp",".svg":"image/svg+xml",".json":"application/json"};
const offers:Record<string,string>={website:"website",campaign:"second_campaign",seo:"seo_geo",smm:"smm",ugc:"ugc",closer:"closer",cameraman:"cameraman"};
const presentations=Object.fromEntries(Object.entries(offers).flatMap(([mode,offer])=>[["en","ar"].map(lang=>[mode+lang,{offer,lang}])].flat()));
const modes=new Set(["open","arabic","expired","archived","unknown","busy","error","garbage"]);
Bun.serve({hostname:"127.0.0.1",port,async fetch(request){
  const url=new URL(request.url);
  if(url.pathname.startsWith("/__door/")){
    if(request.method==="POST") return new Response(null,{status:204});
    const mode=url.pathname.split("/")[2];
    if(presentations[mode]) { const x=presentations[mode]; return json({state:"open",proposal:fixture(x.lang as "en"|"ar",x.offer),contact:null}); }
    if(mode==="garbage") return new Response("not json");
    if(mode==="busy") return json({state:"busy"},429);
    if(mode==="error") return json({state:"error"},503);
    return json({state:mode==="arabic"?"open":mode,proposal:["open","arabic"].includes(mode)?fixture(mode==="arabic"?"ar":"en"):null,contact:null});
  }
  if(url.pathname==="/" || /^\/[a-hj-km-np-z2-9]{12}$/.test(url.pathname)){
    const mode=(modes.has(url.searchParams.get("mode") || "") || Object.hasOwn(presentations,url.searchParams.get("mode") || ""))?url.searchParams.get("mode"):"open";
    let page=await readFile(resolve(root,"index.html"),"utf8");
    page=page.replace(/<meta name="mm-door" content="[^"]+">/,`<meta name="mm-door" content="http://127.0.0.1:${port}/__door/${mode}">`);
    return new Response(page,{headers:{"content-type":"text/html","content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://embed-ssl.wistia.com; frame-src 'none'; connect-src 'self'; base-uri 'none'; form-action 'none'"}});
  }
  const path=resolve(root,`.${url.pathname}`);
  if(!path.startsWith(`${root}${sep}`) || !types[extname(path)] || /\.(test|ts)(\.|$)/.test(path)) return new Response("Not found",{status:404});
  try {return new Response(await readFile(path),{headers:{"content-type":types[extname(path)]}});}catch{return new Response("Not found",{status:404});}
}});
console.log(`Fictional offer harness: http://127.0.0.1:${port}/abcdefghjkmn?mode=open`);
