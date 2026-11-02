import {ADS_LIST,STATUS_FIELD,CITIES_FIELD,assertObjectScope,type Plan,type MultiPlan,type Provider,type Row} from './core.ts';
import {budgetToUsd} from './currency.ts';
// The answers of the ClickUp form "Launch New Campaign" (view 2kzmr1ky-3878), by their Ads Managment field ids.
// The cockpit writes them on the card itself, so a cockpit launch never needs the form (decided 26 Oct 2026).
export const CARD_FIELDS={platform:'42ad9ad1-3dd1-47e4-be18-78aa2529ff97',serviceType:'94ad466d-7a45-427f-83da-9cd93002ff97',priority:'4f884743-a582-4bfe-9588-db8f70f68afe',funnelType:'d9714549-c02f-4b62-a52d-1ed587bb38c4',landingUrl:'78fcdcf8-be60-467e-9a84-69c88c0eaf90',dailyAdSpend:'932aad28-0f2a-4905-be48-5b6dc1a8b2c3',crmUrl:'d07a6228-e669-4fb8-b4ad-e9393546ba04',dos:'0f06a523-64f9-4f20-90a1-f76cb6f85318',launchDate:'2e744484-f581-4c37-962a-023c4de23729',metaAccount:'8f9032d4-017c-4634-85d9-7ab046cc142f'};
const CHOICES={serviceType:'service type',priority:'priority',funnelType:'funnel type'} as const;
// Blueprint part 1 service keys (creative-director-cockpit lib/blueprint.ts SERVICES) to the card's Service Type options.
const SERVICE_FROM_BRIEF:Row={'design-build':'Design & Build',interior:'Interior Design',architecture:'Architectural Design',fitout:'Renovation/Fit Out',construction:'Construction'};
const DAY=86_400_000;
type Fields=(id:string,optional?:boolean)=>Row;
const metaId=(v:unknown)=>{if(!/^[0-9]{5,25}$/.test(String(v??'')))throw Error('Choose a valid Meta campaign');return String(v);};
const optionName=(o:Row)=>String(o.name??o.label);
const options=(f:Row|undefined):Row[]=>Array.isArray(f?.type_config?.options)?f!.type_config.options:[];
const aliases=(o:Row)=>[o.id,...(o.orderindex!==undefined?[o.orderindex]:[])];
export const kuwaitDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuwait'}).format(now);
// The form stores a date-only answer as 04:00 Kuwait (01:00 UTC). Make 9356423 anchors billing on that day.
export function launchDateValue(day:unknown){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day??''));if(!m)throw Error('Choose the launch date.');return Date.UTC(+m[1],+m[2]-1,+m[3],1);}
export function checkLaunchDay(day:unknown,now=new Date()){const t=launchDateValue(day),today=launchDateValue(kuwaitDay(now));if(t>today)throw Error('The launch date cannot be in the future.');if(today-t>14*DAY)throw Error('Choose a launch date in the last 14 days.');return String(day);}
export function checkSpend(v:unknown){const n=Number(v);if(v===''||v==null||!Number.isFinite(n)||n<1||n>100000)throw Error('Enter the daily ad spend in dollars.');return Math.round(n*100)/100;}
// The billing guard reads the act= number from this link (hermes/ad-billing-guard/core.ts accountId).
export const metaAccountUrl=(account:string,campaign?:string|null)=>`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account}&business_id=767701513092162${campaign?`&selected_campaign_ids=${campaign}`:''}`;
export const crmUrl=(location:unknown)=>/^[A-Za-z0-9]{10,40}$/.test(String(location??''))?`https://app.maharamedia.com/v2/location/${location}/dashboard`:null;
export async function boardFields(p:Provider):Promise<Fields>{
 const fields=(await p.call('clickup','GET',`list/${ADS_LIST}/field`)).fields;if(!Array.isArray(fields))throw Error('ClickUp did not return board fields');
 return (id,optional=false)=>{const f=fields.find((x:Row)=>x.id===id);if(!f&&!optional)throw Error('A launch card field is missing on the Ads Management board. Nothing was changed.');return f;};
}
const stamp=(c:Row)=>Number(c.updatedAt)||Date.parse(String(c.updatedAt??''))||0;
export const latestCard=(client:Row):Row|null=>[...(client.cards??[])].filter((c:Row)=>c.taskId).sort((a,b)=>stamp(b)-stamp(a))[0]??null;
// The tag the client's earlier cards carry, so Make counts this campaign as a repeat and not a first launch.
export const cardTag=(client:Row,s:Row)=>String(latestCard(client)?.tag??s.client).trim().toLowerCase();
export const cardNamed=(client:Row,name:string)=>(client.cards??[]).find((c:Row)=>(c.name??c.taskName)===name)??null;
// The mirror can lag a card made minutes ago, so the client's cards are also read live before a new one is made.
export async function liveCard(client:Row,s:Row,name:string,p:Provider):Promise<string|null>{
 const tag=encodeURIComponent(cardTag(client,s));
 for(let page=0;;page++){const r=await p.call('clickup','GET',`list/${ADS_LIST}/task?include_closed=true&page=${page}&tags[]=${tag}`);if(!Array.isArray(r.tasks))throw Error('ClickUp did not return the client cards.');const hit=r.tasks.find((t:Row)=>String(t.name).trim()===name);if(hit)return String(hit.id);if(r.last_page!==false)return null;if(page>=9)throw Error('This client has too many cards to check. Ask the CEO.');}
}
function cities(card:Row|null,field:Row|undefined){const opts=options(field);return opts.filter(o=>(card?.advertisingCities??[]).includes(o.label)||(card?.advertisingCities??[]).includes(o.id));}
function answer(task:Row|null,field:Row|undefined):string|null{
 const raw=task?.custom_fields?.find((f:Row)=>f.id===field?.id)?.value;if(raw==null||raw==='')return null;
 const opts=options(field);if(!opts.length)return String(raw);const o=opts.find(x=>String(x.id)===String(raw)||String(x.orderindex)===String(raw));return o?optionName(o):null;
}
async function campaignFacts(s:Row,campaignId:string,p:Provider){
 const c=await p.call('meta','GET',`${campaignId}?fields=id,name,account_id,status,daily_budget,lifetime_budget`);assertObjectScope(c,{account:s.account,campaign:campaignId},campaignId);
 const sets=(await p.call('meta','GET',`${campaignId}/adsets?fields=id,account_id,campaign_id,destination_type,daily_budget&limit=100`)).data??[];
 for(const x of sets)assertObjectScope(x,{account:s.account,campaign:campaignId},String(x.id));
 const kinds=new Set(sets.map((x:Row)=>x.destination_type));
 let budgetUsd:number|null=null;try{const cur=String((await p.call('meta','GET',`act_${s.account}?fields=currency`)).currency??'');const minor=Number(c.daily_budget)>0?Number(c.daily_budget):sets.reduce((n:number,x:Row)=>n+(Number(x.daily_budget)||0),0);budgetUsd=minor>0?budgetToUsd(minor,cur)??null:null;}catch{/* An unknown currency leaves the spend for the media buyer to type. */}
 return {id:String(c.id),name:String(c.name??''),status:c.status,budgetUsd,funnel:kinds.has('WEBSITE')?'Landing Page':kinds.size&&[...kinds].every(k=>k==='ON_AD')?'Lead Form':null};
}
// launch.readiness with cardDetails: the answers the cockpit can fill in, for the media buyer to check.
export async function cardDefaults(s:Row,client:Row,a:Row,p:Provider){
 if(!s.account)throw Error('Choose an ad account');
 const field=await boardFields(p);const card=latestCard(client);
 // An unreadable last card only loses its suggestions; the media buyer still chooses every answer.
 const task=card?await p.call('clickup','GET',`task/${card.taskId}`).then((t:Row)=>String(t.list?.id)===ADS_LIST?t:null,()=>null):null;
 const campaignId=a.campaignId?metaId(a.campaignId):s.launch?.meta_campaign_id??null;
 const facts=campaignId?await campaignFacts(s,campaignId,p):null;
 const brief=client.brief?.answers??{};const named=(key:keyof typeof CHOICES,v:string|null)=>v&&options(field(CARD_FIELDS[key])).some(o=>optionName(o)===v)?v:null;
 const fromCard=(key:keyof typeof CHOICES)=>named(key,answer(task,field(CARD_FIELDS[key])));
 const serviceType=fromCard('serviceType')??named('serviceType',SERVICE_FROM_BRIEF[brief.service]??null);
 const briefFunnel=brief.destination==='landing_page'?'Landing Page':brief.destination==='lead_form'?'Lead Form':null;
 const funnelType=named('funnelType',facts?.funnel??null)??fromCard('funnelType')??named('funnelType',briefFunnel);
 const raw=answer(task,field(CARD_FIELDS.landingUrl)),landing=funnelType==='Landing Page'&&/^https:\/\//.test(raw??'')?raw:null;const spend=Number(s.launch?.budget_usd)>0?Number(s.launch.budget_usd):facts?.budgetUsd??null;
 return {ok:true,
  options:Object.fromEntries(Object.keys(CHOICES).map(k=>[k,options(field(CARD_FIELDS[k as keyof typeof CHOICES])).map(optionName)])),
  defaults:{serviceType,priority:fromCard('priority'),funnelType,landingUrl:landing,dailyAdSpendUsd:spend,launchDay:kuwaitDay(),dos:''},
  sources:{serviceType:fromCard('serviceType')?'Last ads card':serviceType?'Blueprint part 1':null,priority:fromCard('priority')?'Last ads card':null,landingUrl:landing?'Last ads card':null,funnelType:facts?.funnel?'Campaign':fromCard('funnelType')?'Last ads card':funnelType?'Blueprint part 1':null,dailyAdSpendUsd:Number(s.launch?.budget_usd)>0?'Paused build':facts?.budgetUsd?'Campaign budget':null},
  fixed:{tag:cardTag(client,s),platform:'Meta',metaAccountUrl:metaAccountUrl(s.account,campaignId),crmUrl:crmUrl(s.locationId),cities:cities(card,field(CITIES_FIELD,true)).map(o=>o.label)},
  campaign:facts?{id:facts.id,name:facts.name,status:facts.status}:null};
}
export function checkDetails(d:unknown,field:Fields):Row{
 if(!d||typeof d!=='object')throw Error('Fill in the launch details for the ClickUp card first.');const x=d as Row,out:Row={};
 for(const [key,label] of Object.entries(CHOICES)){const o=options(field(CARD_FIELDS[key as keyof typeof CHOICES])).find(o=>optionName(o)===x[key]);if(!o)throw Error(`Choose the ${label} for the ClickUp card.`);out[key]=o;}
 const landing=String(x.landingUrl??'').trim();if(landing&&(!/^https:\/\/\S+$/.test(landing)||landing.length>500))throw Error('The landing page must be an https link.');
 if(optionName(out.funnelType)==='Landing Page'&&!landing)throw Error('Add the landing page link.');
 const dos=String(x.dos??'').trim();if(dos.length>2000)throw Error("Keep the do's and don'ts under 2,000 characters.");
 return {...out,landingUrl:landing||null,dos:dos||null};
}
// The full card, Ad Status Live. Make 9356423 starts on this create: the launch message, and for a first launch billing and the onboarding map.
export async function launchCardStep(o:{name:string,s:Row,client:Row,details:unknown,spendUsd:number,day:string,campaignId:string|null},p:Provider):Promise<Plan>{
 const field=await boardFields(p);const d=checkDetails(o.details,field);
 const live=options(field(STATUS_FIELD)).find(x=>x.name==='Live');if(!live)throw Error('ClickUp Live status is unavailable');
 const meta=options(field(CARD_FIELDS.platform)).find(x=>optionName(x)==='Meta');if(!meta)throw Error('ClickUp did not return the Meta platform option');
 const tag=cardTag(o.client,o.s),link=metaAccountUrl(o.s.account,o.campaignId),crm=crmUrl(o.s.locationId),date=launchDateValue(o.day),places=cities(latestCard(o.client),field(CITIES_FIELD,true)).map(x=>x.id);
 const F=CARD_FIELDS,custom:Row[]=[{id:STATUS_FIELD,value:live.id},...(places.length?[{id:CITIES_FIELD,value:places}]:[]),{id:F.platform,value:[meta.id]},{id:F.serviceType,value:d.serviceType.id},{id:F.priority,value:d.priority.id},{id:F.funnelType,value:d.funnelType.id},...(d.landingUrl?[{id:F.landingUrl,value:d.landingUrl}]:[]),{id:F.dailyAdSpend,value:o.spendUsd},...(crm?[{id:F.crmUrl,value:crm}]:[]),...(d.dos?[{id:F.dos,value:d.dos}]:[]),{id:F.launchDate,value:date,value_options:{time:false}},{id:F.metaAccount,value:link}];
 return {provider:'clickup',method:'POST',path:`list/${ADS_LIST}/task`,body:{name:o.name,tags:[tag],custom_fields:custom},verifyPath:'task/$id',
  expected:{name:o.name,list:{id:ADS_LIST},fields:[{field:STATUS_FIELD,value:live.id,aliases:aliases(live)},{field:F.platform,value:[meta.id]},...(['serviceType','priority','funnelType'] as const).map(k=>({field:F[k],value:d[k].id,aliases:aliases(d[k])})),{field:F.dailyAdSpend,value:o.spendUsd,numeric:true},{field:F.launchDate,value:date,numeric:true,tolerance:DAY/2},{field:F.metaAccount,value:link}]},
  has:[{path:'tags',key:'name',value:tag}]};
}
// launch.logCampaign: a campaign switched on in Ads Manager gets the same card, in place of the ClickUp form.
export async function prepareLog(a:Row,s:Row,client:Row,p:Provider):Promise<MultiPlan>{
 const campaignId=metaId(a.campaignId);
 const c=await p.call('meta','GET',`${campaignId}?fields=id,name,account_id,status`);assertObjectScope(c,{account:s.account,campaign:campaignId},campaignId);
 if(c.status!=='ACTIVE')throw Error('Switch the campaign on in Ads Manager first, then log it.');
 const name=String(c.name??'').trim();if(!name)throw Error('Meta returned no campaign name.');
 if(cardNamed(client,name)||await liveCard(client,s,name,p))throw Error('This campaign already has a card on the Ads Management board.');
 const step=await launchCardStep({name,s,client,details:a.details,spendUsd:checkSpend(a.details?.dailyAdSpendUsd),day:checkLaunchDay(a.details?.launchDay),campaignId},p);
 return {steps:[step],result:{clickupId:s.clickupId,clientName:s.client,accountId:s.account,campaignName:name,metaCampaignId:campaignId,cardTaskId:'$step0.id',did:'Logged the launch. Its card is on the Ads Management board.'}};
}
