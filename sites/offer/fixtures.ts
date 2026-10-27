/** Fictional harness data. Client copy comes directly from the catalog seed. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(import.meta.dir,"../../supabase/migrations/20261026x_upsell_catalog_copy.sql"),"utf8");
const catalog=JSON.parse(sql.split("$json$")[1]);
export function fixture(lang: "en"|"ar"="en") {
  const c=catalog.website[lang];
  return {
    lang,offer:"website",title:c.deckTitle,
    clientName:lang==="ar" ? "حوش للتصميم والبناء، مثال" : "Hosh Design & Build, Example",
    logo:null,csmFirstName:lang==="ar" ? "سارة" : "Sara",date:"2026-10-26",validUntil:"2026-11-09",
    video:{provider:"youtube",embedUrl:"https://www.youtube-nocookie.com/embed/example0001",posterUrl:null,title:c.deckTitle},
    found:[],why:c.why[0].text,get:c.get.map((g:{text:string})=>g.text),platforms:null,work:[],
    steps:c.steps.map((s:{text:string})=>s.text).join("\n"),timing:c.timing,
    investment:{parts:[{label:c.parts.build,amountUsd:2000,cadence:"one_time"},{label:c.parts.care,amountUsd:200,cadence:"monthly"}],terms:c.terms,split:null},
    button:{text:c.button,whatsapp:"https://wa.me/00000000000?text=Example"},
  };
}
