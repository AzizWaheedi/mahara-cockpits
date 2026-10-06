import { expect, test } from 'bun:test';
import { cachedPreview, parsePreviewBody, readAdPreview } from './preview.ts';
import type { Provider, Row } from './core.ts';
const AD='333333',ACCOUNT='222222',CAMPAIGN='111111';
const src='https://www.facebook.com/ads/api/preview_iframe.php?preview_id=fixture';
const body=`<iframe src="${src.replace('&','&amp;')}" width="320" height="560"></iframe>`;
function provider(object:Row={id:AD,account_id:ACCOUNT,campaign_id:CAMPAIGN}, preview:unknown=body) {
 const calls:string[]=[];
 const api:Provider={async call(_provider,_method,path){calls.push(path);return path.includes('/previews?')?{data:[{body:preview}]}:object;}};
 return {api,calls};
}
test('native preview returns the actual verified ad and a bounded live URL, never provider HTML',async()=>{
 const fixture=provider(),now=1791200103000;
 const result=await readAdPreview({adId:AD},{account:ACCOUNT,campaign:CAMPAIGN},fixture.api,()=>now);
 expect(result.result).toEqual({ok:true,adId:AD,src,width:320,height:560,accountId:ACCOUNT,fetchedAt:now,expiresAt:now+20*3600000});
 expect(result.campaignId).toBe(CAMPAIGN);
 expect(result.result).not.toHaveProperty('body');
});
test('a provider ad identity or account mismatch never reaches the preview endpoint',async()=>{
 for(const object of [{id:'999999',account_id:ACCOUNT,campaign_id:CAMPAIGN},{id:AD,account_id:'999999',campaign_id:CAMPAIGN},{id:AD,account_id:ACCOUNT,campaign_id:'999999'}]){
  const fixture=provider(object);
  await expect(readAdPreview({adId:AD},{account:ACCOUNT,campaign:CAMPAIGN},fixture.api)).rejects.toThrow(/different ad|another ad account|another campaign/);
  expect(fixture.calls.some(path=>path.includes('/previews'))).toBe(false);
 }
});
test('hostile iframe hosts, credentials and token-bearing links are never rendered',()=>{
 for(const url of ['https://facebook.com.evil.example/','http://facebook.com/','https://token@facebook.com/','https://facebook.com/?access_token=fixture','https://instagram.com/?TOKEN=fixture','javascript:alert(1)']){
  expect(parsePreviewBody(`<iframe src="${url}" width="320"></iframe>`)).toEqual({});
 }
 expect(parsePreviewBody(`<img src="${src}">`)).toEqual({});
 expect(parsePreviewBody(`<iframe src='${src}&amp;locale=en_US' width='320' height='560'>`)).toEqual({src:`${src}&locale=en_US`,width:320,height:560});
});
test('expired, future or overlong cached URLs are refused at the exact boundary',()=>{
 const now=1791200103000,valid={ok:true,adId:AD,src,accountId:ACCOUNT,fetchedAt:now-1000,expiresAt:now+20*3600000-1000};
 expect(cachedPreview(valid,AD,now)?.src).toBe(src);
 expect(cachedPreview({...valid,expiresAt:now},AD,now)).toBeNull();
 expect(cachedPreview({...valid,fetchedAt:now+60001},AD,now)).toBeNull();
 expect(cachedPreview({...valid,expiresAt:valid.expiresAt+1},AD,now)).toBeNull();
 expect(cachedPreview(valid,'999999',now)).toBeNull();
});
test('only unsupported placement errors use the legacy Instagram fallback',async()=>{
 const formats:string[]=[];
 const api:Provider={async call(_provider,_method,path){
  if(!path.includes('/previews?'))return {id:AD,account_id:ACCOUNT,campaign_id:CAMPAIGN};
  const format=new URL(`https://fixture/${path}`).searchParams.get('ad_format')!;formats.push(format);
  if(format==='MOBILE_FEED_STANDARD')throw new Error('Meta code 100: ad_format is not supported for this placement');
  return {data:[{body}]};
 }};
 expect((await readAdPreview({adId:AD},{account:ACCOUNT,campaign:CAMPAIGN},api)).result.ok).toBe(true);
 expect(formats).toEqual(['MOBILE_FEED_STANDARD','INSTAGRAM_STANDARD']);
 let requests=0;
 const failed:Provider={async call(_provider,_method,path){if(!path.includes('/previews?'))return {id:AD,account_id:ACCOUNT,campaign_id:CAMPAIGN};requests++;throw new Error('Meta 503: provider unavailable');}};
 await expect(readAdPreview({adId:AD},{account:ACCOUNT,campaign:CAMPAIGN},failed)).rejects.toThrow('provider unavailable');
 expect(requests).toBe(1);
});
