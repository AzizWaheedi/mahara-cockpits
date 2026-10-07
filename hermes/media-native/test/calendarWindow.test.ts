import { describe, expect, test } from 'bun:test';
import { fetchCalendarEvents } from '../tools';
const now=Date.parse('2026-10-03T22:00:00Z');
const window={timeMin:now-7*86400000,timeMax:now+21*86400000};
const event=(id:string,start:string,end:string)=>({id,summary:'Team sync',start:{dateTime:start},end:{dateTime:end}});
const page=(items:unknown[],nextPageToken?:string)=>Response.json({accessRole:'reader',items,...(nextPageToken?{nextPageToken}:{})});

describe('complete original calendar window',()=>{
 test('retains prior and future calls, original all-day dates, and every page',async()=>{
  const urls:URL[]=[];
  const rows=await fetchCalendarEvents('buyer@example.com','fixture',{...window,fetchImpl:async input=>{
   const url=new URL(String(input));urls.push(url);
   return urls.length===1?page([event('prior','2026-10-01T10:00:00+03:00','2026-10-01T11:00:00+03:00'),{id:'all',summary:'Conference',start:{date:'2026-10-03'},end:{date:'2026-10-06'}}],'next'):page([event('future','2026-10-10T10:00:00+03:00','2026-10-10T11:00:00+03:00'),{id:'cancelled',status:'cancelled'},event('boundary',new Date(window.timeMax).toISOString(),new Date(window.timeMax+3600000).toISOString())]);
  }});
  expect(rows.map(row=>row.eventId)).toEqual(['prior','all','future']);
  expect(rows[1].start).toBe('2026-10-03');expect(rows[1].end).toBe('2026-10-06');
  expect(urls.map(url=>url.searchParams.get('pageToken'))).toEqual([null,'next']);
  expect(urls[0].searchParams.get('timeMin')).toBe(new Date(window.timeMin).toISOString());
  expect(urls[0].searchParams.get('timeMax')).toBe(new Date(window.timeMax).toISOString());
 });
 test('missing pages, denied sharing and repeated cursors never become successful empty feeds',async()=>{
  for(const response of [Response.json({accessRole:'reader'}),Response.json({accessRole:'freeBusyReader',items:[]}),Response.json({error:'unavailable'},{status:503})])await expect(fetchCalendarEvents('buyer@example.com','fixture',{...window,fetchImpl:async()=>response})).rejects.toThrow();
  await expect(fetchCalendarEvents('buyer@example.com','fixture',{...window,fetchImpl:async()=>page([],'same')})).rejects.toThrow('pagination');
  expect(await fetchCalendarEvents('buyer@example.com','fixture',{...window,fetchImpl:async()=>page([])})).toEqual([]);
 });
 test('malformed event boundaries cannot fabricate an end or a valid date',async()=>{
  const invalid=[event('no-zone','2026-10-10T10:00:00+03:00','2026-10-10T11:00:00'),event('reversed','2026-10-10T11:00:00+03:00','2026-10-10T10:00:00+03:00'),{id:'missing',start:{dateTime:'2026-10-10T10:00:00+03:00'}},{id:'invalid-day',start:{date:'2026-02-30'},end:{date:'2026-03-03'}}];
  for(const item of invalid)await expect(fetchCalendarEvents('buyer@example.com','fixture',{...window,fetchImpl:async()=>page([item])})).rejects.toThrow();
 });
 test('conflicting event identities across pages block publication',async()=>{
  let calls=0;await expect(fetchCalendarEvents('buyer@example.com','fixture',{...window,fetchImpl:async()=>++calls===1?page([event('same','2026-10-10T10:00:00+03:00','2026-10-10T11:00:00+03:00')],'next'):page([event('same','2026-10-11T10:00:00+03:00','2026-10-11T11:00:00+03:00')])})).rejects.toThrow('identity');
 });
});
