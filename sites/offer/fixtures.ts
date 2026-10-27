/** Fictional harness data. Client copy comes directly from the catalog seed. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(import.meta.dir,"../../supabase/migrations/20261026x_upsell_catalog_copy.sql"),"utf8");
const catalog=JSON.parse(sql.split("$json$")[1]);
export function fixture(lang: "en"|"ar"="en", offer="website") {
  const c=(catalog[offer] || catalog.website)[lang];
  return {
    lang,offer,title:c.deckTitle,
    clientName:lang==="ar" ? "حوش للتصميم والبناء، مثال" : "Hosh Design & Build, Example",
    logo:null,csmFirstName:lang==="ar" ? "سارة" : "Sara",date:"2026-10-26",validUntil:"2026-11-09",
    video:offer === "website" ? {provider:"youtube",embedUrl:"https://www.youtube-nocookie.com/embed/example0001",posterUrl:null,title:c.deckTitle} : null,
    found:[],why:c.why[0].text,get:c.get.map((g:{text:string})=>g.text),platforms:null,work:offer==="ugc" ? [
      {label:"Khalda",url:"https://maharamedia.wistia.com/medias/qlwysqfu2g"},
      {label:"Castello",url:"https://maharamedia.wistia.com/medias/btp2dokvjr"},
      {label:"Al Khalil",url:"https://maharamedia.wistia.com/medias/nix1oq0h3a"}
    ] : [],
    steps:c.steps.map((s:{text:string})=>s.text).join("\n"),timing:c.timing,
    investment:{parts:offer==="website" ? [{label:c.parts.build,amountUsd:2000,cadence:"one_time"},{label:c.parts.care,amountUsd:200,cadence:"monthly"}] : Object.entries(c.parts).map(([key,label])=>({label,amountUsd:1000,cadence:"one_time"})),terms:c.terms,split:null},
    button:{text:c.button,whatsapp:"https://wa.me/00000000000?text=Example"},
  };
}
