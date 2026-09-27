import {structuredJson,type ModelEnv,type ModelHealth} from './model.ts';
export type Kind='lead_gen'|'retargeting';
export function copyPrompt(
  kind: Kind,
  brief: string,
  language: "ar" | "en",
  winners: { name: string; body: string }[],
  count: number,
): string {
  const arabic = language === "ar";
  return [
    "Write Meta ad copy for Mahara Media, a Kuwait agency that runs done-for-you client acquisition for construction, design, fit-out and interior businesses across the Gulf: Meta ads, automated lead filtration and a trained sales team that books the meetings. The offer is the Premium Projects Program: six to thirteen high-value projects in ninety days or the work continues free.",
    kind === "lead_gen"
      ? "This is a LEAD GENERATION campaign to a cold audience of business owners who have not heard of Mahara. The ad sends them to the funnel page to watch a short video and book a call. Earn attention in the first line, name who it is for, make the promise concrete, and end with the one next step."
      : "This is a RETARGETING campaign to a warm audience: people who watched our videos, visited the funnel or engaged in the last ninety days. Do not introduce Mahara from scratch; they know the name. Move them to book the call now: answer the objection they are sitting on, show proof, make the next step feel small.",
    `Language: ${arabic ? "Arabic (Gulf, natural spoken register — not formal MSA, not translated-sounding)" : "English"}.`,
    `What the CEO asked for: ${brief}.`,
    winners.length
      ? `The current ${kind === "lead_gen" ? "lead-gen" : "retargeting"} winners on the account, with their primary text — stay in this territory and vary the hook, do not invent a new offer:\n${winners.map(w => `— ${w.name}:\n${w.body.slice(0, 500)}`).join("\n\n")}`
      : "",
    "",
    "Hard rules:",
    "- Never call the audience 'contractors' and never imply one-man teams. They are construction and design businesses, firms or companies.",
    "- Any money figure is in USD. Never dinar, riyal or dirham.",
    "- No emoji walls, no 'unlock', no 'revolutionise', no exclamation stacking.",
    "- Write like one person talking to another. Short sentences. Concrete, not aspirational.",
    "- Headline: under 40 characters. Primary text: 2 to 4 short lines.",
    "",
    `Give ${count} distinct angles — not ${count} rewrites of the same sentence. Vary the hook: outcome, objection, proof, question, direct offer. Each one also gets a two-or-three word label naming its angle.`,
  ]
    .filter(Boolean)
    .join("\n");
}


export async function writeCopy(kind:Kind,brief:string,language:'ar'|'en',winners:{name:string;body:string}[],count:number,env:ModelEnv,health:ModelHealth){
 const want=Math.max(3,Math.min(Math.round(count)||5,5));
 const result=await structuredJson(copyPrompt(kind,brief,language,winners,want),{type:'object',properties:{variants:{type:'array',items:{type:'object',properties:{angle:{type:'string'},headline:{type:'string'},primaryText:{type:'string'}},required:['angle','headline','primaryText']}}},required:['variants']},env,health);
 if(!Array.isArray(result.variants))throw new Error('Model returned no variants');
 const variants=result.variants.filter((x:any)=>typeof x.headline==='string'&&typeof x.primaryText==='string'&&x.headline.trim()&&x.primaryText.trim()).slice(0,want).map((x:any)=>({headline:x.headline.trim(),primaryText:x.primaryText.trim(),angle:typeof x.angle==='string'?x.angle.trim():''}));
 if(variants.length<3)throw new Error('Model returned fewer than three usable copy ideas');return variants;
}
