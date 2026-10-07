import {afterAll,beforeAll,expect,test} from 'bun:test';
import {cockpitTestDb} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import {readFileSync,existsSync} from 'node:fs';
let db:Awaited<ReturnType<typeof cockpitTestDb>>;
beforeAll(async()=>{
 db=await cockpitTestDb();
 const base=readFileSync(new URL('../supabase/migrations/20260927x_cockpit_native_media_sync.sql',import.meta.url),'utf8');
 const start=base.indexOf('CREATE OR REPLACE FUNCTION public.cockpit_native_grain_key(');
 const end=base.indexOf('CREATE OR REPLACE FUNCTION',start+1);
 await db.exec(base.slice(start,end));
 const fix=new URL('../supabase/migrations/20261007c_native_booking_identity.sql',import.meta.url);
 if(existsSync(fix))await db.exec(readFileSync(fix,'utf8'));
});
afterAll(()=>db.close());
async function key(row:Record<string,unknown>,kind='bookingEvents'){
 return (await db.query<{value:unknown}>('SELECT cockpit_native_grain_key($1,$2) value',[kind,row])).rows[0].value;
}
test('original booking identities never collapse when provider identity is absent',async()=>{
 const row={campaignName:'Campaign',date:'2026-10-01',_id:'first-original'};
 expect(await key(row)).toEqual(['legacy-source-row','first-original']);
 expect(await key({...row,_id:'second-original'})).not.toEqual(await key(row));
});
test('real provider identity retains its existing native grain',async()=>{
 expect(await key({campaignName:'Campaign',locationId:'location-one',eventId:'event-one',startTime:'2026-10-01T09:00:00Z',_id:'original'})).toEqual(['Campaign','location-one','event-one','2026-10-01T09:00:00Z']);
 expect(await key({campaignName:'Campaign',date:'2026-10-01',metaAdId:'ad-one',adSetName:'Set'},'dailyStats')).toEqual(['Campaign','2026-10-01','ad-one','Set']);
});
test('missing original and provider identity stays unavailable',async()=>{
 await expect(key({campaignName:'Campaign',date:'2026-10-01'})).rejects.toThrow('identity');
});
