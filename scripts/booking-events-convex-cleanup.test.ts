import {afterAll,beforeAll,expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {nativeFeedDb} from './lib/nativeFeedDb';
// The one-off Convex booking cleanup (supabase/maintenance/20261012_booking_events_convex_cleanup.sql),
// run against canonical tables, triggers and feed state with a small fixture.
const file=readFileSync(new URL('../supabase/maintenance/20261012_booking_events_convex_cleanup.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const section=(name:string)=>{
 const start=file.indexOf(`-- >>> ${name}`),end=file.indexOf(`-- <<< ${name}`);
 if(start<0||end<start)throw new Error(`Section ${name} missing`);
 return file.slice(start,end);
};
const plans=[...file.matchAll(/-- plan:start\n([\s\S]*?)-- plan:end/g)].map(m=>m[1]);
const apply=(expected:Record<string,number>)=>section('APPLY').replace(/expected constant jsonb := '[^']*'/,`expected constant jsonb := '${JSON.stringify(expected)}'`);
const CONVEX='adorable-seahorse-418';
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
type Booking=[string,string,string,string,Record<string,unknown>];
const convex=(id:string,campaign:string,day:string,status:string,appointment:string,sync:number,ad='')=>
 [CONVEX,id,campaign,day,{_id:id,_creationTime:sync,campaignName:campaign,date:day,status,appointmentDate:appointment,client:'client',syncedAt:sync,...(ad?{adId:ad}:{})}] as Booking;
const native=(id:string,campaign:string,day:string,start:string)=>
 ['native:media',id,campaign,day,{_id:id,campaignName:campaign,date:day,eventId:id,contactId:`c-${id}`,locationId:'loc',startTime:start,appointmentDate:start.slice(0,10),status:'confirmed',client:'client',syncedAt:5000}] as Booking;
const rows:Booking[]=[
 // Safad placeholders: two days, three syncs each. All six go.
 ...[1000,2000,3000].flatMap(s=>[convex(`p1-${s}`,'Safad | MAHARA | 16-8','2026-01-15','confirmed','2026-08-14',s),convex(`p2-${s}`,'Safad | MAHARA | 16-8','2026-01-15','confirmed','2026-08-15',s)]),
 // Repeats: the sync with the most rows stays (two real bookings), then the latest.
 convex('g1-a','B','2026-08-05','confirmed','2026-08-06',1000,'ad1'),convex('g1-b','B','2026-08-05','confirmed','2026-08-06',2000,'ad1'),
 convex('g1-c','B','2026-08-05','confirmed','2026-08-06',3000,'ad1'),convex('g1-d','B','2026-08-05','confirmed','2026-08-06',3000,'ad1'),
 convex('g2-a','B','2026-08-05','showed','2026-08-07',1000,'ad1'),convex('g2-b','B','2026-08-05','showed','2026-08-07',2000,'ad1'),
 // Twins: two Convex and two native on the same campaign, day and appointment day.
 convex('t1','A','2026-09-10','confirmed','2026-09-12',3000),convex('t2','A','2026-09-10','confirmed','2026-09-12',3000),
 native('e1','A','2026-09-10','2026-09-12T10:00:00+03:00'),native('e2','A','2026-09-10','2026-09-12T12:00:00+03:00'),
 // Unmatched Convex bookings stay.
 convex('u1','A','2026-09-10','confirmed','2026-09-13',3000),convex('u2','A','2026-09-11','confirmed','2026-09-12',3000),
 native('e3','A','2026-09-20','2026-09-21T10:00:00+03:00'),
];
const kept=['g1-c','g1-d','g2-b','u1','u2','e1','e2','e3'];
const count=async(sql:string)=>Number((await db.query<{n:number}>(sql)).rows[0].n);
const remaining=async()=>(await db.query<{source_id:string}>('SELECT source_id FROM public.cockpit_media_booking_events ORDER BY 1')).rows.map(r=>r.source_id);
beforeAll(async()=>{
 db=await nativeFeedDb();
 for(const r of rows)await db.query('INSERT INTO public.cockpit_media_booking_events(source_deployment,source_id,campaign_name,day,data) VALUES($1,$2,$3,$4,$5)',r);
 await db.exec(`UPDATE public.cockpit_media_feed_state SET ready=true,source_rows=${rows.length},source_snapshot_at=now() WHERE feed='bookingEvents'`);
});
afterAll(()=>db.close());

test('the dry run and the apply share one plan',()=>{
 expect(plans.length).toBe(2);
 expect(plans[0]).toBe(plans[1]);
});
test('the dry run counts each reason and changes nothing',async()=>{
 const report=(await db.query<Record<string,unknown>>(section('DRY RUN'))).rows;
 const total=report.find(r=>r.campaign==='TOTAL');
 expect(total).toMatchObject({rows_now:19,native_rows:3,placeholder:6,repeat:3,twin:2,after_cleanup:8,convex_after:5});
 expect((await remaining()).length).toBe(19);
});
test('apply refuses counts that differ from the approved dry run',async()=>{
 await expect(db.exec(section('APPLY'))).rejects.toThrow('differ from the approved dry run');
 await expect(db.exec(apply({placeholder:6,repeat:3,twin:1,convex_after:6}))).rejects.toThrow('differ from the approved dry run');
 expect((await remaining()).length).toBe(19);
});
test('apply refuses a feed state that already disagrees with the table',async()=>{
 await db.exec("UPDATE public.cockpit_media_feed_state SET source_rows=18 WHERE feed='bookingEvents'");
 await expect(db.exec(apply({placeholder:6,repeat:3,twin:2,convex_after:5}))).rejects.toThrow('Booking feed state says 18 rows');
 expect((await remaining()).length).toBe(19);
 await db.exec(`UPDATE public.cockpit_media_feed_state SET source_rows=19 WHERE feed='bookingEvents'`);
});
test('apply removes only the planned Convex rows, keeps the feed count true and audits every row',async()=>{
 await db.exec(apply({placeholder:6,repeat:3,twin:2,convex_after:5}));
 expect(await remaining()).toEqual([...kept].sort());
 expect(await count("SELECT source_rows n FROM public.cockpit_media_feed_state WHERE feed='bookingEvents'")).toBe(8);
 expect(await count("SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type='cockpit_media_booking_events' AND action='delete'")).toBe(11);
 expect(await count("SELECT count(*) n FROM public.cockpit_audit_log WHERE entity_type='cockpit_media_booking_events' AND action='delete' AND before->>'source_id'='p1-1000' AND before->'data'->>'campaignName'='Safad | MAHARA | 16-8'")).toBe(1);
 const summary=(await db.query<{before:unknown;after:unknown;metadata:Record<string,unknown>}>("SELECT before,after,metadata FROM public.cockpit_audit_log WHERE action='booking_convex_cleanup'")).rows;
 expect(summary.length).toBe(1);
 expect(summary[0].before).toEqual({rows:19,feed_source_rows:19});
 expect(summary[0].after).toEqual({rows:8,feed_source_rows:8});
 expect(summary[0].metadata.removed).toEqual({placeholder:6,repeat:3,twin:2});
});
test('a second apply finds nothing to remove and refuses',async()=>{
 await expect(db.exec(apply({placeholder:6,repeat:3,twin:2,convex_after:5}))).rejects.toThrow('differ from the approved dry run');
 const total=(await db.query<Record<string,unknown>>(section('DRY RUN'))).rows.find(r=>r.campaign==='TOTAL');
 expect(total).toMatchObject({rows_now:8,placeholder:0,repeat:0,twin:0,after_cleanup:8});
});
