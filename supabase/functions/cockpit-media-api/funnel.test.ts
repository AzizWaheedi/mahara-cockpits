import {test,expect} from 'bun:test';
import {destinationOf,formIdOf,preparePublish,prepareSwitch,readFunnel,withForm} from './funnel';
import {executePlan} from './execute';
type Row=Record<string,any>;
const scope={account:'123456',campaign:'222222',campaignName:'Villa | Leads'};
const PAGE='777777',PAGE_TOKEN='PAGE-SECRET';

// A Meta that answers by route and remembers every call, with the token it was sent with.
function meta(routes:[RegExp,(method:string,path:string,body?:Row)=>Row][]){
 const calls:{method:string;path:string;body?:Row;token?:string}[]=[];
 return {calls,async call(_provider:string,method:string,path:string,body?:Row,as?:{token:string}){
  calls.push({method,path,body,token:as?.token});
  const route=routes.find(([re])=>re.test(`${method} ${path}`));
  if(!route)throw new Error(`Unexpected ${method} ${path}`);
  return route[1](method,path,body);
 }};
}
const story=(formId:string)=>({id:'900001',name:'Villa video',object_story_spec:{page_id:PAGE,video_data:{video_id:'555',image_hash:'h1',image_url:'https://cdn/x.jpg',message:'Build your villa',call_to_action:{type:'SIGN_UP',value:{link:'http://fb.me/',lead_gen_form_id:formId}}}},url_tags:'utm_source=meta',degrees_of_freedom_spec:{creative_features_spec:{standard_enhancements:{enroll_status:'OPT_OUT'}}}});
const ad=(id:string,formId='111111',status='ACTIVE')=>({id,name:`Ad ${id}`,account_id:'123456',campaign_id:'222222',effective_status:status,creative:story(formId)});
const FORM={id:'111111',name:'Villa form',status:'ACTIVE',leads_count:106,questions:[{key:'type',label:'ما نوع مشروعك؟',type:'CUSTOM',options:[{key:'a',value:'سكني'},{key:'b',value:'تجاري'}]},{key:'full_name',type:'FULL_NAME'},{key:'phone_number',type:'PHONE'}],legal_content:{privacy_policy:{url:'https://villa.example/privacy'}},is_optimized_for_quality:false};
const spec={name:'Villa form',intro:{title:'Free design call',style:'LIST_STYLE' as const,content:['Plans in 48 hours']},questions:FORM.questions.map(({key,label,type,options})=>({key,type,...(label?{label}:{}),...(options?{options}:{})})),higherIntent:true,smsVerify:true,privacy:{url:'https://villa.example/privacy'},thankYou:{title:'Thanks',buttonType:'NONE' as const}};

test('destinations read from either creative shape, and a form wins over its placeholder link',()=>{
 expect(destinationOf(ad('1'))).toEqual({kind:'form',formId:'111111'});
 expect(formIdOf({object_story_spec:{page_id:PAGE},asset_feed_spec:{call_to_actions:[{type:'SIGN_UP',value:{lead_gen_form_id:'333333'}}]}})).toBe('333333');
 expect(destinationOf({creative:{object_story_spec:{link_data:{link:'https://villa.example/offer?utm=1',call_to_action:{type:'LEARN_MORE',value:{link:'https://villa.example/offer?utm=1'}}}}}})).toEqual({kind:'website',url:'https://villa.example/offer?utm=1'});
 expect(destinationOf({adset:{destination_type:'WHATSAPP'},creative:{object_story_spec:{link_data:{link:'https://api.whatsapp.com/send',call_to_action:{type:'WHATSAPP_MESSAGE'}}}}}).kind).toBe('whatsapp');
});

test('a creative copy keeps everything but the form, and drops the thumbnail url Meta refuses',()=>{
 const made=withForm(story('111111'),'999999','Villa video · form v2');
 if(!made.ok)throw new Error(made.why);
 const v=made.body.object_story_spec.video_data;
 expect(v.call_to_action.value).toEqual({link:'http://fb.me/',lead_gen_form_id:'999999'});
 expect(v.image_hash).toBe('h1');expect(v.image_url).toBeUndefined();
 expect(made.body.url_tags).toBe('utm_source=meta');
 expect(made.body.degrees_of_freedom_spec).toEqual(story('1').degrees_of_freedom_spec);
 expect(withForm({object_story_spec:{link_data:{link:'https://x.example'}}},'1','x')).toEqual({ok:false,why:'That ad does not send people to an instant form.'});
});

test('the funnel groups ads by where they lead and reads each form, with the Page token when Meta refuses the system token',async()=>{
 const p=meta([
  [/^GET 222222\/ads/,()=>({data:[ad('300301'),ad('300302'),ad('300303','111111','ARCHIVED'),{...ad('300304'),creative:{object_story_spec:{page_id:PAGE,link_data:{link:'https://villa.example',call_to_action:{type:'LEARN_MORE',value:{link:'https://villa.example'}}}}}}]})],
  [/^GET 777777\?fields=id,name,access_token/,()=>({id:PAGE,name:'Villa Builders',access_token:PAGE_TOKEN})],
  [/^GET 111111\?fields=/,(_m,_p)=>{throw new Error('meta rejected the request (400 code 100/33): Unsupported get request');}],
  [/^GET 777777\/leadgen_forms/,()=>({data:[{id:'111111',name:'Villa form',status:'ACTIVE'},{id:'121212',name:'Villa form · v2 · 2026-10-01 09:00',status:'ACTIVE'},{id:'131313',name:'Other form',status:'ACTIVE'}]})],
 ]);
 // The system-token read is refused; the Page-token read answers.
 const formCalls:number[]=[];
 const real=p.call.bind(p);
 p.call=async(provider:string,method:string,path:string,body?:Row,as?:{token:string})=>{if(/^111111\?fields=/.test(path)){formCalls.push(1);if(as?.token===PAGE_TOKEN)return FORM;}return real(provider,method,path,body,as);};
 const read=await readFunnel(scope,p as any);
 expect(read.destinations.map((d:Row)=>[d.kind,d.ads.length])).toEqual([['form',2],['website',1]]);
 const form=read.destinations[0];
 expect(form.pageName).toBe('Villa Builders');
 expect(form.form.spec.questions).toHaveLength(3);
 expect(form.form.full).toBe(true);
 expect(form.versions.map((v:Row)=>v.id)).toEqual(['121212','111111']);
 expect(JSON.stringify(read)).not.toContain(PAGE_TOKEN);
 expect(p.calls.filter(c=>c.path.startsWith('777777?fields')).length).toBe(1);
});

test('publishing rehearses every copy and swap with Meta, then plans the form, the copies and the swaps',async()=>{
 const p=meta([
  [/^GET 222222\/ads/,()=>({data:[ad('300301'),ad('300302'),ad('300305','161616')]})],
  [/^GET 777777\?fields=id,name,access_token/,()=>({id:PAGE,name:'Villa Builders',access_token:PAGE_TOKEN})],
  [/^GET 777777\/leadgen_forms/,()=>({data:[{id:'111111',name:'Villa form'},{id:'121212',name:'Villa form · v2 · 2026-10-01 09:00'}]})],
  [/^POST act_123456\/adcreatives/,(_m,_p,body)=>{expect(body?.execution_options).toBe('["validate_only"]');return {success:true};}],
  [/^POST 30030[12]$/,(_m,_p,body)=>{expect(body?.execution_options).toBe('["validate_only"]');return {success:true};}],
 ]);
 const plan=await preparePublish({campaignName:scope.campaignName,fromFormId:'111111',spec},scope,p as any);
 expect(plan.check?.ready).toBe(true);
 expect(plan.check?.version).toBe(3);
 expect(plan.steps.map(s=>`${s.method} ${s.path}`)).toEqual(['POST 777777/leadgen_forms','POST act_123456/adcreatives','POST 300301','POST act_123456/adcreatives','POST 300302']);
 expect(plan.steps[0].asPage).toBe(PAGE);
 expect(plan.steps[0].body?.is_optimized_for_quality).toBe('true');
 expect(plan.steps[0].body?.is_phone_sms_verify_enabled).toBe('true');
 expect(String(plan.steps[0].body?.name)).toMatch(/^Villa form · v3 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
 expect(plan.steps[1].body?.object_story_spec.video_data.call_to_action.value.lead_gen_form_id).toBe('$step0.id');
 expect(plan.steps[2].body).toEqual({creative:{creative_id:'$step1.id'}});
 expect(plan.steps[2].expected).toEqual({creative:{id:'$step1.id'}});
 expect(plan.result.switched).toEqual(['300301','300302']);
 expect(plan.result.did).toContain('a greeting, a review step, SMS verification and a thank-you screen');
 // Nothing but GETs and validate-only posts reached Meta while planning.
 expect(p.calls.filter(c=>c.method==='POST').every(c=>c.body?.execution_options==='["validate_only"]')).toBe(true);
 expect(JSON.stringify(plan)).not.toContain(PAGE_TOKEN);
});

test('a refused rehearsal returns no steps and says which ad and why',async()=>{
 const p=meta([
  [/^GET 222222\/ads/,()=>({data:[ad('300301'),ad('300302')]})],
  [/^GET 777777\?fields=id,name,access_token/,()=>({id:PAGE,name:'Villa Builders',access_token:PAGE_TOKEN})],
  [/^GET 777777\/leadgen_forms/,()=>({data:[]})],
  [/^POST act_123456\/adcreatives/,()=>({success:true})],
  [/^POST 300301$/,()=>({success:true})],
  [/^POST 300302$/,()=>{throw new Error('meta rejected the request (400 code 100/1815199): not linked');}],
 ]);
 const plan=await preparePublish({campaignName:scope.campaignName,fromFormId:'111111',spec},scope,p as any);
 expect(plan.steps).toEqual([]);
 expect(plan.check?.ready).toBe(false);
 expect(plan.check?.ads.map((a:Row)=>[a.adId,a.ok])).toEqual([['300301',true],['300302',false]]);
 expect(plan.check?.ads[1].why).toContain('not linked to the Instagram account');
});

test('publishing refuses a broken draft and a form the ads have left',async()=>{
 const p=meta([[/^GET 222222\/ads/,()=>({data:[ad('300301','999999')]})]]);
 await expect(preparePublish({campaignName:'x',fromFormId:'111111',spec:{...spec,privacy:null}},scope,p as any)).rejects.toThrow('privacy policy');
 await expect(preparePublish({campaignName:'x',fromFormId:'111111',spec},scope,p as any)).rejects.toThrow('No ad in this campaign uses that form');
 await expect(preparePublish({campaignName:'x',fromFormId:'111111',spec,adIds:['300301']},scope,p as any)).rejects.toThrow('no longer uses that form');
});

test('switching back refuses an archived form and skips ads already on it',async()=>{
 const routes:[RegExp,(m:string,p:string,b?:Row)=>Row][]=[
  [/^GET 222222\/ads/,()=>({data:[ad('300301','121212'),ad('300302','111111')]})],
  [/^GET 777777\?fields=id,name,access_token/,()=>({id:PAGE,name:'Villa Builders',access_token:PAGE_TOKEN})],
  [/^POST act_123456\/adcreatives/,()=>({success:true})],
  [/^POST 3003\d\d$/,()=>({success:true})],
 ];
 const archived=meta([...routes,[/^GET 111111\?fields=/,()=>({...FORM,status:'ARCHIVED'})]]);
 await expect(prepareSwitch({campaignName:'x',toFormId:'111111'},scope,archived as any)).rejects.toThrow('archived');
 const p=meta([...routes,[/^GET 111111\?fields=/,()=>FORM]]);
 const plan=await prepareSwitch({campaignName:'x',toFormId:'111111'},scope,p as any);
 expect(plan.steps.map(s=>s.path)).toEqual(['act_123456/adcreatives','300301']);
 expect(plan.result.did).toBe('Switched 1 ad to the lead form "Villa form".');
});

test('a Page step is written and read back with a Page token fetched at run time, never kept',async()=>{
 const p=meta([
  [/^GET 777777\?fields=id,name,access_token/,()=>({id:PAGE,name:'Villa Builders',access_token:PAGE_TOKEN})],
  [/^POST 777777\/leadgen_forms/,()=>({id:'141414'})],
  [/^GET 141414\?fields=id,name/,()=>({id:'141414',name:'Villa form · v3'})],
  [/^POST act_123456\/adcreatives/,()=>({id:'888001'})],
  [/^GET 888001\?fields=id/,()=>({id:'888001'})],
  [/^POST 300301$/,()=>({success:true})],
  [/^GET 300301\?fields=creative/,()=>({id:'300301',creative:{id:'888001'}})],
 ]);
 const plan={steps:[
  {provider:'meta' as const,method:'POST',path:'777777/leadgen_forms',body:{name:'Villa form · v3'},verifyPath:'$id?fields=id,name',expected:{name:'Villa form · v3'},asPage:PAGE},
  {provider:'meta' as const,method:'POST',path:'act_123456/adcreatives',body:{object_story_spec:{video_data:{call_to_action:{value:{lead_gen_form_id:'$step0.id'}}}}},verifyPath:'$id?fields=id',expected:{}},
  {provider:'meta' as const,method:'POST',path:'300301',body:{creative:{creative_id:'$step1.id'}},verifyPath:'300301?fields=creative{id}',expected:{creative:{id:'$step1.id'}}},
 ],result:{formId:'$step0.id'}};
 const done=await executePlan(plan,p as any);
 expect(done.result.formId).toBe('141414');
 const form=p.calls.filter(c=>c.path.includes('leadgen_forms')||c.path.startsWith('141414'));
 expect(form.every(c=>c.token===PAGE_TOKEN)).toBe(true);
 expect(p.calls.filter(c=>c.path==='act_123456/adcreatives'||c.path==='300301').every(c=>c.token===undefined)).toBe(true);
 expect(p.calls.find(c=>c.path==='act_123456/adcreatives')?.body?.object_story_spec.video_data.call_to_action.value.lead_gen_form_id).toBe('141414');
 expect(JSON.stringify(done)).not.toContain(PAGE_TOKEN);
});
