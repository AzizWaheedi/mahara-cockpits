import {afterEach,beforeEach,expect,test} from 'bun:test';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {migration} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';

// The publish ends by writing each table's row_count; the floor refuses that
// write when the client list collapses, which rolls back the whole publish.
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
beforeEach(async()=>{
 db=await nativeFeedDb();
 await db.exec(migration('20261012b_csm_client_list_floor.sql'));
 await db.exec("INSERT INTO cockpit_csm_source_state(table_name,ready,row_count) VALUES('clients',true,53),('clientProfiles',true,53),('appointments',true,40) ON CONFLICT(table_name) DO UPDATE SET ready=true,row_count=excluded.row_count");
});
afterEach(async()=>{await db.close();});
const publish=(table:string,n:number)=>db.query('UPDATE cockpit_csm_source_state SET ready=true,row_count=$2 WHERE table_name=$1',[table,n]);
const count=async(table:string)=>(await db.query<{row_count:number}>('SELECT row_count FROM cockpit_csm_source_state WHERE table_name=$1',[table])).rows[0].row_count;

test('an empty client list is refused and the old count stays',async()=>{
 await expect(publish('clients',0)).rejects.toThrow('Refusing to publish csm.clients: 53 rows would drop to 0');
 expect(await count('clients')).toBe(53);
 await expect(publish('clientProfiles',20)).rejects.toThrow('csm.clientProfiles');
});
test('ordinary changes and other tables publish as before',async()=>{
 await publish('clients',40);expect(await count('clients')).toBe(40);
 await publish('clients',60);expect(await count('clients')).toBe(60);
 await publish('appointments',0);expect(await count('appointments')).toBe(0);
});
test('a small list is not checked',async()=>{
 await db.exec("DELETE FROM cockpit_csm_source_state WHERE table_name='clients';INSERT INTO cockpit_csm_source_state(table_name,ready,row_count) VALUES('clients',true,9)");
 await publish('clients',0);expect(await count('clients')).toBe(0);
});
test('a real cleanup is allowed once, with a reason, and both steps are audited',async()=>{
 await expect(db.query("SELECT cockpit_native_allow_shrink('clients','x')")).rejects.toThrow('Say why');
 await db.query("SELECT cockpit_native_allow_shrink('clients','Stopped clients archived on the board')");
 await publish('clients',26);expect(await count('clients')).toBe(26);
 await db.query("UPDATE cockpit_csm_source_state SET row_count=53 WHERE table_name='clients'");
 await expect(publish('clients',26)).rejects.toThrow('Refusing');
 const audit=(await db.query<{action:string}>("SELECT action FROM cockpit_audit_log WHERE entity_type='cockpit_csm_source_state' AND action IN('ALLOW_SHRINK','SHRINK_ALLOWED') ORDER BY created_at")).rows.map(r=>r.action);
 expect(audit).toEqual(['ALLOW_SHRINK','SHRINK_ALLOWED']);
});
test('an expired allowance does not count',async()=>{
 await db.query("SELECT cockpit_native_allow_shrink('clients','Stopped clients archived on the board')");
 await db.exec("UPDATE cockpit_native_shrink_allowances SET allow_until=now()-interval '1 minute'");
 await expect(publish('clients',10)).rejects.toThrow('Refusing');
});
