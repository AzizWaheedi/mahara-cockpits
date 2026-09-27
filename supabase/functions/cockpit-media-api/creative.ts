import {CREATIVE_FIELDS,copyableSpec,setCopy,flattenNote,destinationLink} from './metaCreative.ts';
import {assertObjectScope,type Row,type Provider,type Plan,type MultiPlan} from './core.ts';
export const CREATIVE_OPERATIONS=['edit.newAdsFromExisting','edit.addCreativeToCampaign','ceo.b2bManage.createAds'];
const id=(x:unknown)=>{if(!/^\d{5,}$/.test(String(x??'')))throw new Error('Invalid Meta id');return String(x);};
export async function prepareCreative(operation:string,a:Row,s:Row,p:Provider):Promise<MultiPlan> {
 const steps:Plan[]=[],ids:string[]=[];const act=`act_${s.account}`;
 const sourceId=a.sourceAdId??a.mediaFromAdId;
 let source:Row|undefined,note:string|undefined;
 if(sourceId) {source=await p.call('meta','GET',`${id(sourceId)}?fields=id,name,account_id,campaign_id,adset_id,${CREATIVE_FIELDS}`);assertObjectScope(source,s,id(sourceId));}
 const target=id(a.adsetId??source?.adset_id),targetObject=await p.call('meta','GET',`${target}?fields=id,account_id,campaign_id`);assertObjectScope(targetObject,s,target);
 const addAd=(name:string,creativeId:string)=>{
  const n=steps.length;steps.push({provider:'meta',method:'POST',path:`${act}/ads`,body:{name,adset_id:target,creative:JSON.stringify({creative_id:creativeId}),status:'PAUSED'},verifyPath:'$id?fields=id,status,adset_id',expected:{status:'PAUSED',adset_id:target}});ids.push(`$step${n}.id`);
 };
 const clones=a.cloneAdIds??[];
 if(!Array.isArray(clones)||clones.length>10)throw new Error('Choose at most 10 ads to clone');
 for(const cloneId of clones){const clone=await p.call('meta','GET',`${id(cloneId)}?fields=id,name,account_id,campaign_id,creative{id}`);assertObjectScope(clone,s,id(cloneId));addAd(String(clone.name??clone.id),id(clone.creative?.id));}
 let variants=a.variants??[];
 if(operation==='edit.addCreativeToCampaign')variants=[{message:a.message,headline:a.headline}];
 if(!Array.isArray(variants)||variants.length>5)throw new Error('Approve at most five copy variants');
 if(variants.length){
  if(!source)throw new Error('Choose a source ad for the creative');const copy=copyableSpec(source.creative);if(!copy.ok)throw new Error(copy.why);note=flattenNote(copy.flattened)??undefined;
  for(const [i,variant] of variants.entries()){
   const spec=structuredClone(copy.spec);
   if(operation==='edit.addCreativeToCampaign') {
    if([a.videoUrl,a.imageUrl,a.videoId,a.imageHash].filter(Boolean).length!==1)throw new Error('Choose exactly one video or image source');
    let videoId=a.videoId,imageHash=a.imageHash;
    if(a.videoUrl||a.imageUrl){let url:URL;try{url=new URL(a.videoUrl??a.imageUrl);}catch{throw new Error('Use a public HTTPS media URL');}if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use a public HTTPS media URL');if(/(^|\.)drive\.google\.com$/.test(url.hostname))throw new Error('Fetch the Drive link through the media ingestion worker, then use its uploaded asset id');const upload=steps.length;
     if(a.videoUrl){steps.push({provider:'meta',method:'POST',path:`${act}/advideos`,body:{file_url:url.href},verifyPath:'$id?fields=id',expected:{}});videoId=`$step${upload}.id`;}
     else{steps.push({provider:'meta',method:'POST',path:`${act}/adimages`,body:{url:url.href},verifyPath:`${act}/adimages?hashes=["$id"]&fields=hash`,expected:{},imageUpload:true});imageHash=`$step${upload}.id`;}
    }
    const link=destinationLink(source.creative),cta=spec.video_data?.call_to_action??spec.link_data?.call_to_action??{type:'LEARN_MORE',value:{link}};
    if(videoId){spec.video_data={...(spec.video_data??{}),video_id:a.videoId?id(a.videoId):videoId,call_to_action:cta};delete spec.link_data;}
    else {if(a.imageHash&&!/^[a-zA-Z0-9]+$/.test(a.imageHash))throw new Error('Invalid image hash');spec.link_data={...(spec.link_data??{}),image_hash:imageHash,link,call_to_action:cta};delete spec.video_data;}
   } else if(typeof (variant.message??variant.primaryText)!=='string'||typeof variant.headline!=='string'||!variant.headline.trim()||!(variant.message??variant.primaryText).trim())throw new Error('Each variant needs approved headline and primary text');
   setCopy(spec,{message:variant.message??variant.primaryText,headline:variant.headline});
   if(!destinationLink({object_story_spec:spec}))throw new Error('The new creative has no destination');
   const n=steps.length;
   steps.push({provider:'meta',method:'POST',path:`${act}/adcreatives`,body:{name:`${String(variant.headline??source.name).slice(0,80)} cockpit`,object_story_spec:JSON.stringify(spec)},verifyPath:'$id?fields=id',expected:{}});
   addAd(a.adName??`${source.name} · v${i+2}`,`$step${n}.id`);
  }
 }
 if(!steps.length)throw new Error('Select an ad to clone or approve copy first');
 return {steps,result:operation==='ceo.b2bManage.createAds'?{made:ids.length,ids,problems:[]}:operation==='edit.addCreativeToCampaign'?{adId:ids[0],note}:{made:ids,note}};
}
