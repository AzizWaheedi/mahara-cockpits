import {afterEach,beforeEach,expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
const UID='40000000-0000-4000-8000-000000000001';
const image='https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-ad-stills/'+'a'.repeat(64);
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
beforeEach(async()=>{
 db=await nativeFeedDb();await db.exec(migration('20261005c_cockpit_ad_previews.sql'));
 await member(db,UID,'still-reader@tests.invalid',['media_buyer']);
 await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],UID]);
 await db.exec(`INSERT INTO cockpit_campaigns(client_name,meta_account_id,meta_campaign_id,raw_data) VALUES('Alpha','act_222222','111111','{"campaignName":"Alpha campaign","clientName":"Alpha"}');INSERT INTO cockpit_ads(campaign_name,ad_name,meta_ad_id,raw_data) VALUES('Alpha campaign','Original ad','333333','{"campaignName":"Alpha campaign","metaAdId":"333333","creativeId":"444444"}')`);
 await db.query('INSERT INTO cockpit_native_stills(key,data) VALUES($1,$2)',['c:444444',{key:'c:444444',adId:'333333',creativeId:'444444',status:'saved',url:image}]);
 if(existsSync(new URL('../supabase/migrations/20261006a_cockpit_native_still_reads.sql',import.meta.url)))await db.exec(migration('20261006a_cockpit_native_still_reads.sql'));
});
afterEach(async()=>{await db.close();});
async function read(keys:string[]){await actor(db,UID);try{return (await db.query<{value:{ok:boolean;stills:Array<{key:string;url:string|null;tinyUrl:string|null;missing:boolean;error:string|null}>}}>('SELECT cockpit_native_stills_read($1) value',[keys])).rows[0].value;}catch(error){return {ok:false,stills:[],error:error instanceof Error?error.message:'The native contract is missing'};}}
test('authorized current creative returns its original native image',async()=>{
 const result=await read(['c:444444']);expect(result.stills[0]?.url).toBe(image);
});
test('changing the assigned client removes access to the saved image',async()=>{
 await owner(db);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Beta'],UID]);
 const result=await read(['c:444444']);expect(result.stills[0]?.url).toBeNull();expect(result.stills[0]?.error).not.toBeNull();
});
test('revoked and unconfirmed identities cannot read cached stills',async()=>{
 await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[UID]);
 expect((await read(['c:444444'])).ok).toBe(false);
 await owner(db);await db.query('UPDATE cockpit_members SET active=true WHERE auth_user_id=$1',[UID]);await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[UID]);
 expect((await read(['c:444444'])).ok).toBe(false);
});
test('a stale creative identity cannot borrow authorization from another ad',async()=>{
 await owner(db);await db.exec("UPDATE cockpit_ads SET raw_data=raw_data||'{\"creativeId\":\"555555\"}' WHERE meta_ad_id='333333'");
 const result=await read(['c:444444']);expect(result.stills[0]?.url).toBeNull();expect(result.stills[0]?.error).not.toBeNull();
});
test('captured, failed and gone rows never become saved images',async()=>{
 for(const status of ['captured','failed','gone']){
  await owner(db);await db.query("UPDATE cockpit_native_stills SET data=data||jsonb_build_object('status',$1::text) WHERE key='c:444444'",[status]);
  const result=await read(['c:444444']);expect(result.stills[0]?.url).toBeNull();
 }
});
test('external CDN and bearer-token URLs are not native saved files',async()=>{
 for(const url of ['https://scontent.fbcdn.net/old-image.jpg',image+'?token=private','https://other-project.supabase.co/storage/v1/object/public/cockpit-ad-stills/'+'a'.repeat(64)]){
  await owner(db);await db.query("UPDATE cockpit_native_stills SET data=data||jsonb_build_object('url',$1::text) WHERE key='c:444444'",[url]);
  const result=await read(['c:444444']);expect(result.stills[0]?.url).toBeNull();expect(result.stills[0]?.error).not.toBeNull();
 }
});
test('unknown source readiness is not a verified missing image',async()=>{
 const result=await read(['a:999999']);expect(result.stills[0]?.missing).toBe(false);expect(result.stills[0]?.error).not.toBeNull();
});
test('duplicate requested keys return one image and oversized requests are rejected',async()=>{
 expect((await read(['c:444444','c:444444'])).stills.map(item=>item.url)).toEqual([image]);
 expect((await read(Array.from({length:201},(_,i)=>'a:'+String(100000+i)))).ok).toBe(false);
});
