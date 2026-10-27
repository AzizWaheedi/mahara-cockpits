import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { render, stateView, embedUrl, pictureUrl, whatsappUrl, codeFromPath, stateFromQuery, money } from "./core.js";
import { STRINGS } from "./strings.js";
import { fixture } from "./fixtures.ts";
describe("public proposal rendering",()=>{
  for(const lang of ["en","ar"]) test(`complete ${lang} proposal and localised money`,()=>{
    const html=render(fixture(lang),STRINGS[lang]);
    expect(html).toContain(`dir="${lang==="ar"?"rtl":"ltr"}"`);
    expect(html).toContain(STRINGS[lang].investment);
    expect(html).toContain(STRINGS[lang].oneTime);
    expect(html).toContain(money(2000,lang));
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/upsell|list.price|discount|guarantee|CPL/);
  });
  test("untrusted text is escaped in every field and attributes",()=>{
    const bad='"><img src=x onerror=alert(1)>';
    const p=fixture();p.title=bad;p.clientName=bad;p.why=bad;p.get=[bad];p.steps=bad;p.button.text=bad;
    const html=render(p,STRINGS.en);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain("&lt;img src=x");
  });
  test("private storage paths and arbitrary images never reach the page",()=>{
    const p=fixture();p.logo={bucket:"secret",path:"private/key",alt:"logo"};p.found=[{url:"https://evil.example/a.png",caption:"bad"}];
    const html=render(p,STRINGS.en);
    expect(html).not.toContain("private/key");expect(html).not.toContain("evil.example");
  });
  test("preview contains no links or playable controls and no art URL request",()=>{
    const p=fixture();p.work=[{label:"Example",url:"https://example.com"}];
    const html=render(p,STRINGS.en,{preview:true});
    expect(html).not.toMatch(/href=|<iframe|src="\/art/);expect(html).toContain("disabled");
  });
  test("preview accepts only the trusted inline WebP fallback, with an Example label",()=>{
    const art="data:image/webp;base64,UklGRabc=";
    expect(render(fixture(),STRINGS.en,{preview:true,posterFallback:art})).toContain(`src="${art}"`);
    expect(render(fixture(),STRINGS.en,{preview:true,posterFallback:"https://evil.test/tracker"})).not.toContain("evil.test");
    expect(render(fixture(),STRINGS.en,{preview:true,posterFallback:"data:image/svg+xml,<svg onload=alert(1)>"})).not.toContain("<svg onload");
  });
  test("split and print use public values only",()=>{
    const p=fixture();p.investment.split=[1000,1000];
    const html=render(p,STRINGS.en,{proposalUrl:"https://offer.maharamedia.com/abcdefghjkmn"});
    expect(html).toContain(STRINGS.en.split);expect(html).toContain("of-print-link");expect(html).toContain("https://offer.maharamedia.com/abcdefghjkmn");
  });
  for(const state of Object.keys(STRINGS.en.states)) test(`state ${state}`,()=>{
    expect(stateView(state,STRINGS.en,{whatsapp:"12345678901"})).toContain(STRINGS.en.states[state].replace(/'/g,"&#39;"));
    expect(stateView(state,STRINGS.ar,{whatsapp:"javascript:alert(1)"})).not.toContain("href=");
  });
});
describe("URL boundaries and closed states",()=>{
  test("only known embeds, image hosts and real WhatsApp URL shapes",()=>{
    for(const bad of ["javascript:alert(1)","https://www.youtube-nocookie.com.evil.com/embed/abc","https://a@www.youtube-nocookie.com/embed/abc","https://www.youtube-nocookie.com:444/embed/abc","https://www.youtube-nocookie.com/watch?v=abc"]) expect(embedUrl(bad)).toBeNull();
    expect(embedUrl("https://www.youtube-nocookie.com/embed/abcdefghijk")).toBeTruthy();
    expect(pictureUrl("https://evil.test/logo.png")).toBeNull();
    expect(whatsappUrl("https://wa.me.evil.test/12345678901")).toBeNull();
    expect(whatsappUrl("https://wa.me/12345678901?text=Yes")).toBeTruthy();
  });
  test("invalid codes and video redirect flags never become open proposals",()=>{
    expect(codeFromPath("/abcdefghjkmn")).toBe("abcdefghjkmn");
    for(const bad of ["/short","/abcdefghjkmn/anything","/%XX","/abcdefghijkl"])expect(codeFromPath(bad)).toBeNull();
    expect(stateFromQuery("?gone=1")).toBe("videoGone");expect(stateFromQuery("?busy=1")).toBe("busy");expect(stateFromQuery("?error=1")).toBe("error");
  });
  test("CSP is explicit, metadata generic and printing keeps the link",()=>{
    const config=JSON.parse(readFileSync(new URL("./vercel.json",import.meta.url),"utf8"));
    const headers=config.headers[0].headers;
    expect(headers.find(h=>h.key==="Content-Security-Policy").value).toContain("frame-ancestors 'none'");
    expect(headers.find(h=>h.key==="Referrer-Policy").value).toBe("no-referrer");
    const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
    expect(html).not.toMatch(/clientName|amountUsd|upsell/i);
    expect(readFileSync(new URL("./offer.css",import.meta.url),"utf8")).toContain("@media print");
  });
});
