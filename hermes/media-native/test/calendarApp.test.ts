import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { actor, BUYER, call, claim, database, owner, type Database } from './database';
import { row } from '../tools';
let db:Database;
beforeEach(async()=>{db=await database();});afterEach(async()=>{await db.close();});
const write=(app:string,id=crypto.randomUUID(),revision=0)=>call(db,'cockpit_media_native_write',{p_operation:'personalCalendars.link',p_args:{app,calendarId:'buyer@example.com',bindingRevision:revision},p_request_id:id,p_apply:true});
const mine=(app:string)=>call(db,'cockpit_media_calendar_mine',{p_app:app});
describe('existing calendar receipts across cockpit roles',()=>{
 test('confirmed CSM-only seat can link its own calendar without a Media Buyer role',async()=>{
  await owner(db);await db.query('UPDATE cockpit_members SET roles=$1 WHERE auth_user_id=$2',[['csm'],BUYER]);await actor(db,BUYER);
  expect(row(await write('client-success')).bindingRevision).toBe(1);
  expect(row(row(await mine('client-success')).link).calendarId).toBe('buyer@example.com');
  await expect(mine('media-buyer')).rejects.toThrow();
 });
 test('same actor retains independent bindings and revisions for all three cockpits',async()=>{
  await owner(db);await db.query('UPDATE cockpit_members SET roles=$1 WHERE auth_user_id=$2',[['media_buyer','csm','creative'],BUYER]);await actor(db,BUYER);
  for(const app of ['media-buyer','client-success','creative'])expect(row(await write(app)).bindingRevision).toBe(1);
  const id=crypto.randomUUID();const original=await write('client-success',id,1);
  for(const app of ['media-buyer','creative'])expect(row(await mine(app)).bindingRevision).toBe(1);
  expect(row(await mine('client-success')).bindingRevision).toBe(2);
  await call(db,'cockpit_media_native_write',{p_operation:'personalCalendars.unlink',p_args:{app:'media-buyer',bindingRevision:1},p_request_id:crypto.randomUUID(),p_apply:true});
  expect(row(await mine('media-buyer')).link).toBeNull();expect(row(await mine('creative')).link).not.toBeNull();
  expect(await write('client-success',id,1)).toEqual(original);
  await expect(write('creative',id,1)).rejects.toThrow('different inputs');
 });
 test('changing the requesting role after a claim rejects calendar provider work',async()=>{
  await owner(db);await db.query('UPDATE cockpit_members SET roles=$1 WHERE auth_user_id=$2',[['csm'],BUYER]);await actor(db,BUYER);await write('client-success');
  const {job}=await claim(db);await call(db,'cockpit_media_native_guard',{p_job_id:job.id,p_token:job.claim_token});
  await owner(db);await db.query('UPDATE cockpit_members SET roles=$1 WHERE auth_user_id=$2',[['media_buyer'],BUYER]);await db.exec('SET ROLE service_role');
  await expect(call(db,'cockpit_media_native_guard',{p_job_id:job.id,p_token:job.claim_token})).rejects.toThrow('access');
 });
});
