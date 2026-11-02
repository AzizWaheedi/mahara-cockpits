import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { render, stateView, embedUrl, pictureUrl, whatsappUrl, codeFromPath, stateFromQuery, money, workVideo } from "./core.js";
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
    expect(workVideo("https://maharamedia.wistia.com/medias/btp2dokvjr")?.posterUrl).toBe("https://embed-ssl.wistia.com/deliveries/33e27b2faa619214d4961f7d833a94f98e7a3cdf.jpg");
    expect(workVideo("https://maharamedia.wistia.com/medias/aaaaaaaaaa")?.posterUrl).toBeNull();
    for(const bad of ["javascript:alert(1)","https://www.youtube-nocookie.com.evil.com/embed/abc","https://a@www.youtube-nocookie.com/embed/abc","https://www.youtube-nocookie.com:444/embed/abc","https://www.youtube-nocookie.com/watch?v=abc"]) expect(embedUrl(bad)).toBeNull();
    expect(embedUrl("https://www.youtube-nocookie.com/embed/abcdefghijk")).toBeTruthy();
    expect(pictureUrl("https://evil.test/logo.png")).toBeNull();
    expect(whatsappUrl("https://wa.me.evil.test/12345678901")).toBeNull();
    expect(whatsappUrl("https://wa.me/12345678901?text=Yes")).toBeTruthy();
  });
  test("invalid codes and video redirect flags never become open proposals",()=>{
    expect(codeFromPath("/abcdefghjkmn")).toBe("abcdefghjkmn");
    expect(workVideo("https://maharamedia.wistia.com/medias/btp2dokvjr")?.posterUrl).toBe("https://embed-ssl.wistia.com/deliveries/33e27b2faa619214d4961f7d833a94f98e7a3cdf.jpg");
    expect(workVideo("https://maharamedia.wistia.com/medias/aaaaaaaaaa")?.posterUrl).toBeNull();
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

describe("genuine brand and frozen actor samples",()=>{
  test("all proposal and closed-state branding uses the real image files",()=>{
    for(const lang of ["en","ar"]){
      const html=render(fixture(lang),STRINGS[lang]);
      expect(html.match(/src="\/logo.png"/g)).toHaveLength(2);
      expect(html.match(/src="\/logo-light.png"/g)).toHaveLength(2);
      expect(html).not.toContain("Mahara<span>");
      for(const state of Object.keys(STRINGS[lang].states)){
        expect(stateView(state,STRINGS[lang],null)).toContain('src="/logo.png"');
      }
    }
    const root=new URL("../../apps/client-success-cockpit/src/assets/",import.meta.url);
    expect(readFileSync(new URL("./logo.png",import.meta.url))).toEqual(readFileSync(new URL("mahara-logo-dark.png",root)));
    expect(readFileSync(new URL("./logo-light.png",import.meta.url))).toEqual(readFileSync(new URL("mahara-logo-light.png",root)));
  });
  test("only exact Wistia share and embed URLs can become inline work players",()=>{
    expect(workVideo("https://maharamedia.wistia.com/medias/btp2dokvjr")?.embedUrl).toBe("https://fast.wistia.net/embed/iframe/btp2dokvjr");
    expect(workVideo("https://maharamedia.wistia.com/medias/btp2dokvjr")?.posterUrl).toBe("https://embed-ssl.wistia.com/deliveries/33e27b2faa619214d4961f7d833a94f98e7a3cdf.jpg");
    expect(workVideo("https://maharamedia.wistia.com/medias/aaaaaaaaaa")?.posterUrl).toBeNull();
    for(const bad of [
      "https://maharamedia.wistia.com.evil.test/medias/btp2dokvjr",
      "https://evil.test/medias/btp2dokvjr",
      "https://name@maharamedia.wistia.com/medias/btp2dokvjr",
      "https://maharamedia.wistia.com:444/medias/btp2dokvjr",
      "https://maharamedia.wistia.com/medias/btp2dokvjr?autoplay=true",
      "https://maharamedia.wistia.com/medias/btp2dokvjr#x",
      "https://maharamedia.wistia.com/medias/../../evil",
      "https://fast.wistia.net/anything/btp2dokvjr"
    ]) expect(workVideo(bad)).toBeNull();
  });
  test("frozen samples show independently, remain escaped and never autoplay",()=>{
    const p=fixture();p.offer="ugc";p.work=[
      {label:"Presenter A",url:"https://maharamedia.wistia.com/medias/qlwysqfu2g"},
      {label:'"><script>bad()</script>',url:"https://maharamedia.wistia.com/medias/btp2dokvjr"},
      {label:"Presenter C",url:"https://maharamedia.wistia.com/medias/nix1oq0h3a"}
    ];
    const html=render(p,STRINGS.en);
    expect(html.match(/data-action="play-work"/g)).toHaveLength(3);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script>bad");
    expect(html).not.toContain("autoplay=true");
    expect(html).toContain('data-work-index="2"');
    const inert=render(p,STRINGS.en,{preview:true});
    expect(inert).not.toMatch(/href=|<iframe/);
    expect(inert.match(/data-work-index="\d" disabled/g)).toHaveLength(3);
  });
});
