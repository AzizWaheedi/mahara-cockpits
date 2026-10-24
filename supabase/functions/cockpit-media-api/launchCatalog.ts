import type {Provider,Row} from './core.ts';
import {pages} from './funnel.ts';
const id=(v:unknown)=>{if(!/^[0-9]{5,25}$/.test(String(v??'')))throw Error('Choose a valid Meta object');return String(v);};
async function rows(p:Provider,path:string,as?:{token:string}){const r=await p.call('meta','GET',path,undefined,as);if(!Array.isArray(r.data))throw Error('Meta did not return the requested choices');return {items:r.data as Row[],more:!!r.paging?.next};}
/** Account libraries are read only on request; no expensive background polling. */
export async function launchCatalog(s:Row,a:Row,p:Provider){
 const act=`act_${id(s.account)}`;
 if(a.geoQuery!==undefined){const query=String(a.geoQuery).trim();const country=String(a.country??'');if(query.length<2||query.length>80||!/^[A-Z]{2}$/.test(country))throw Error('Choose a country and enter a city name.');const result=await rows(p,`search?type=adgeolocation&location_types=${encodeURIComponent('["city"]')}&country_code=${country}&q=${encodeURIComponent(query)}&limit=30`);return {ok:true,cities:result.items.map(x=>({key:x.key,name:x.name,region:x.region,country_code:x.country_code})),more:result.more};}
 if(a.pageId){const page=id(a.pageId);const permitted=await rows(p,`${act}/promote_pages?fields=id,name&limit=200`);if(!permitted.items.some(x=>x.id===page))throw Error('This Page is not available to the selected ad account.');const token=(await pages(p)(page)).token;const forms=await rows(p,`${page}/leadgen_forms?fields=id,name,status&limit=100`,{token});return {ok:true,forms:forms.items.filter(x=>x.status==='ACTIVE').map(x=>({id:x.id,name:x.name})),more:forms.more};}
 const [pageRows,images,videos,pixels]=await Promise.all([rows(p,`${act}/promote_pages?fields=id,name&limit=200`),rows(p,`${act}/adimages?fields=hash,name,url_128&limit=100`),rows(p,`${act}/advideos?fields=id,title,picture,status&limit=100`),rows(p,`${act}/adspixels?fields=id,name&limit=100`)]);
 return {ok:true,pixels:pixels.items.map(x=>({id:x.id,name:x.name})),pages:pageRows.items.map(x=>({id:x.id,name:x.name})),media:[...images.items.map(x=>({key:x.hash,name:x.name??'Client image',imageHash:x.hash,preview:x.url_128})),...videos.items.filter(x=>x.status?.video_status==='ready').map(x=>({key:x.id,name:x.title??'Client video',videoId:x.id,preview:x.picture}))],more:pageRows.more||images.more||videos.more};
}
