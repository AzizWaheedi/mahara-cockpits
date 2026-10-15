import {afterAll,beforeAll,expect,test} from 'bun:test';
import {cockpitTestDb} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import {readFileSync,readdirSync} from 'node:fs';
// Pins the live public.cockpit_native_grain_key (20260927x, verified on production 2026-10-12).
// 20261008c indexes cockpit_media_booking_events on this function, so a new definition
// must rebuild that index in the same migration or its stored keys go stale.
const migrations=new URL('../supabase/migrations/',import.meta.url);
let db:Awaited<ReturnType<typeof cockpitTestDb>>;
beforeAll(async()=>{
 db=await cockpitTestDb();
 const base=readFileSync(new URL('20260927x_cockpit_native_media_sync.sql',migrations),'utf8');
 const start=base.indexOf('CREATE OR REPLACE FUNCTION public.cockpit_native_grain_key(');
 const end=base.indexOf('CREATE OR REPLACE FUNCTION',start+1);
 await db.exec(base.slice(start,end));
});
afterAll(()=>db.close());
async function key(row:Record<string,unknown>,kind='bookingEvents'){
 return (await db.query<{value:unknown}>('SELECT cockpit_native_grain_key($1,$2) value',[kind,row])).rows[0].value;
}
test('real provider identity keys on campaign, location, event and start',async()=>{
 expect(await key({campaignName:'Campaign',locationId:'location-one',eventId:'event-one',startTime:'2026-10-01T09:00:00Z',_id:'original'})).toEqual(['Campaign','location-one','event-one','2026-10-01T09:00:00Z']);
 expect(await key({campaignName:'Campaign',date:'2026-10-01',metaAdId:'ad-one',adSetName:'Set'},'dailyStats')).toEqual(['Campaign','2026-10-01','ad-one','Set']);
});
test('rows with no provider id get no per-row identity, so Convex copies collide',async()=>{
 const row={campaignName:'Campaign',date:'2026-10-01',_id:'first-original'};
 expect(await key(row)).toEqual(['Campaign','',null,'2026-10-01']);
 expect(await key({...row,_id:'second-original'})).toEqual(await key(row));
});
test('only the native media sync migration defines the grain key',()=>{
 const definers=readdirSync(migrations).filter(name=>name.endsWith('.sql')
  &&readFileSync(new URL(name,migrations),'utf8').includes('FUNCTION public.cockpit_native_grain_key('));
 expect(definers).toEqual(['20260927x_cockpit_native_media_sync.sql']);
});
