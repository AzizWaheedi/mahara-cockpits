import { expect, test } from 'bun:test';
import { actor, nativePreviewDb, owner, previewActors as users, previewService } from './lib/nativePreviewDb';
const scope = async (db:Awaited<ReturnType<typeof nativePreviewDb>>,ad='333333')=>(await db.query<{scope:Record<string,unknown>}>('SELECT cockpit_ad_preview_scope($1) scope',[ad])).rows[0].scope;
test('real preview scope admits assigned cockpit actors and roleless founder, not metadata or unconfirmed users',async()=>{
 const db=await nativePreviewDb();try{
  for(const user of [users.media,users.csm,users.founder]){
   await actor(db,user);expect(await scope(db)).toMatchObject({actor:user,account:'222222',campaign:'111111'});
  }
  await actor(db,users.creative);await expect(scope(db)).rejects.toThrow(/access list/i);
  await actor(db,users.unconfirmed);await expect(scope(db)).rejects.toThrow(/confirmed membership/i);
  await actor(db,users.spoof);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users.spoof,role:'authenticated',email:'aziz@maharamedia.com',app_metadata:{roles:['admin']}})]);
  await expect(scope(db)).rejects.toThrow(/cockpit access/i);
  await actor(db,null);await expect(scope(db)).rejects.toMatchObject({code:'42501'});
 }finally{await db.close();}
},30000);
test('company-wide archived winners retain preview access without trusting caller-provided client names',async()=>{
 const db=await nativePreviewDb();try{
  await actor(db,users.creative);await expect(scope(db)).rejects.toThrow(/access list/i);
  await owner(db);await db.query("INSERT INTO cockpit_creative_sources(table_name,source_id,data,source_snapshot_at) VALUES('winnersArchive','original-winner',$1,now())",[{_id:'original-winner',adId:'333333'}]);
  await actor(db,users.creative);expect(await scope(db)).toMatchObject({winner:true,account:'222222',campaign:'111111'});
  await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[users.creative]);
  await actor(db,users.creative);await expect(scope(db)).rejects.toThrow(/confirmed membership/i);
 }finally{await db.close();}
},30000);
test('protected cache writes enforce current ownership, bounded expiry and URL-free actor audits',async()=>{
 const db=await nativePreviewDb();try{
  const now=Date.now(),payload={ok:true,adId:'333333',accountId:'222222',src:'https://www.facebook.com/ads/api/preview_iframe.php?preview_id=fixture',fetchedAt:now,expiresAt:now+20*3600000};
  const save=async(data:unknown=payload,account='222222')=>db.query<{result:{ok:boolean}}>('SELECT cockpit_ad_preview_cache_save($1,$2,$3,$4,$5,$6) result',[users.media,'333333','MOBILE_FEED_STANDARD',account,'111111',data]);
  await actor(db,users.media);await expect(save()).rejects.toMatchObject({code:'42501'});
  await previewService(db);expect((await save()).rows[0].result.ok).toBe(true);
  await owner(db);
  const audits=(await db.query<{actor_email:string;after:unknown}>("SELECT actor_email,after FROM cockpit_audit_log WHERE action='preview.cached'")).rows;
  expect(audits).toEqual([{actor_email:'preview-media@example.test',after:{adId:'333333',format:'MOBILE_FEED_STANDARD',accountId:'222222',campaignId:'111111',expiresAt:payload.expiresAt}}]);
  await actor(db,users.founder);await expect(db.query('SELECT payload FROM cockpit_ad_preview_cache')).rejects.toMatchObject({code:'42501'});
  await previewService(db);
  await expect(save({...payload,src:'https://facebook.com.evil.example/'})).rejects.toThrow(/Invalid confirmed/i);
  await expect(save({...payload,expiresAt:now+20*3600000+1})).rejects.toThrow(/invalid expiry/i);
  await expect(save({...payload,accountId:'999999'},'999999')).rejects.toThrow(/ownership changed/i);
  await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[users.media]);await previewService(db);
  await expect(save()).rejects.toThrow(/confirmed membership/i);
 }finally{await db.close();}
},30000);
