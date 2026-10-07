import { test, expect } from 'bun:test';
import { cockpitIdentityTestDb } from './lib/cockpitIdentityTestDb';
import { actor, member, migration, owner } from './lib/cockpitTestDb';
const USER='77777777-7777-4777-8777-777777777777';
async function fixture(){
 const db=await cockpitIdentityTestDb();
 const sales=migration('20260924a_sales_cockpit.sql');
 const section=sales.slice(sales.indexOf('create table if not exists public.cockpit_sales_people'),sales.indexOf('-- Settings and links'));
 if(!section.includes('create or replace function public.cockpit_sales_manager'))throw new Error('Canonical sales gate section missing');
 await db.exec(section);
 await db.exec(migration('20261004a_cockpit_staff_identity_adoption.sql'));
 return db;
}
test('stale legacy sales manager cannot bypass revoked or removed native directory access',async()=>{
 const db=await fixture();try{
  await member(db,USER,'sales-gate@example.test',['sales']);
  await db.query("INSERT INTO public.cockpit_sales_people(email,name,role,via_portal,active) VALUES('sales-gate@example.test','Legacy manager','manager',true,true)");
  await actor(db,USER);
  expect((await db.query<{seat:boolean;manager:boolean}>('SELECT public.cockpit_sales_seat() seat,public.cockpit_sales_manager() manager')).rows[0]).toEqual({seat:true,manager:true});
  await owner(db);await db.query('UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1',[USER]);await actor(db,USER);
  expect((await db.query<{seat:boolean;manager:boolean}>('SELECT public.cockpit_sales_seat() seat,public.cockpit_sales_manager() manager')).rows[0]).toEqual({seat:false,manager:false});
  await owner(db);await db.query("UPDATE public.cockpit_members SET active=true,roles=ARRAY['editor'] WHERE auth_user_id=$1",[USER]);await actor(db,USER);
  expect((await db.query<{seat:boolean;manager:boolean}>('SELECT public.cockpit_sales_seat() seat,public.cockpit_sales_manager() manager')).rows[0]).toEqual({seat:false,manager:false});
 }finally{await db.close();}
});
test('verified roleless founder retains sales management and unconfirmed founder is denied',async()=>{
 const db=await fixture();try{
  await member(db,USER,'aziz@maharamedia.com',[]);await actor(db,USER);
  expect((await db.query<{seat:boolean;manager:boolean}>('SELECT public.cockpit_sales_seat() seat,public.cockpit_sales_manager() manager')).rows[0]).toEqual({seat:true,manager:true});
  await owner(db);await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[USER]);await actor(db,USER);
  expect((await db.query<{seat:boolean;manager:boolean}>('SELECT public.cockpit_sales_seat() seat,public.cockpit_sales_manager() manager')).rows[0]).toEqual({seat:false,manager:false});
 }finally{await db.close();}
});
