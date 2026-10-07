import {afterEach,beforeEach,expect,test} from 'bun:test';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {actor,member,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
const UID='60000000-0000-4000-8000-000000000001';let db:Awaited<ReturnType<typeof nativeFeedDb>>;
const fragments=[{at:1791200000000,fromMe:false,text:'Original captured paragraph\nSecond line',who:'Original speaker'}];
beforeEach(async()=>{
 db=await nativeFeedDb();await member(db,UID,'history-reader@tests.invalid',['csm','media_buyer']);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],UID]);
 await db.query("INSERT INTO cockpit_wa_thread_captures(source_app,chat_id,channel,name,client_name,contact_id,source,is_group,unread,last_from_us,recent,last_at,creation_time,source_deployment,source_id,source_record) VALUES('client-success','original-chat','sms','Original group','Alpha','original-contact','ghl',true,NULL,false,$1,now(),now(),'original-deployment','original-source',$2)",[fragments,{_id:'original-source',recent:fragments}]);
 await db.query("INSERT INTO cockpit_wa_draft_history(source_app,chat_id,status,draft,at,creation_time,source_deployment,source_id,source_record) VALUES('media-buyer','original-chat','done',$1,now(),now(),'original-media','draft-original',$2)",['Original generated draft',{_id:'draft-original',draft:'Original generated draft'}]);
});
afterEach(async()=>{await db.close();});
async function history(app:string,kind='captures'){await actor(db,UID);return(await db.query<{value:{rows:Array<Record<string,unknown>>;replayAllowed:boolean}}>('SELECT cockpit_wa_history($1,$2) value',[app,kind])).rows[0].value;}
test('original captured paragraphs, order and missing unread survive the native reader',async()=>{
 const result=await history('client-success');expect(result.rows[0]).toMatchObject({name:'Original group',recent:fragments,unread:null,author:null,deliveryConfirmed:false});expect(result.replayAllowed).toBe(false);
});
test('generated completion never becomes sent or delivered history',async()=>{
 const result=await history('media-buyer','drafts');expect(result.rows[0]).toMatchObject({draft:'Original generated draft',generationStatus:'done',clientName:'Alpha',author:null,deliveryConfirmed:false});
});
test('client-scoped seats cannot read unmapped, ambiguous or another client history',async()=>{
 await owner(db);await db.exec("UPDATE cockpit_wa_thread_captures SET client_name='Beta' WHERE chat_id='original-chat'");expect((await history('client-success')).rows).toEqual([]);expect((await history('media-buyer','drafts')).rows).toEqual([]);
 await owner(db);await db.exec("UPDATE cockpit_wa_thread_captures SET client_name=NULL WHERE chat_id='original-chat'");expect((await history('media-buyer','drafts')).rows).toEqual([]);
});
test('revoked, anonymous and another app callers cannot reuse historical access',async()=>{
 await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[UID]);await expect(history('client-success')).rejects.toThrow();
 await owner(db);await db.exec('SET ROLE anon');await expect(db.query("SELECT cockpit_wa_history('client-success')")).rejects.toMatchObject({code:'42501'});
});
