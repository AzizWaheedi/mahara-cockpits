import {expect,test} from 'bun:test';
import {prepareReport,profileForReport,requestedPeriod,narrativePrompt} from './reportFormatter';
import {SHOW_RATE_GOOD} from '../../../apps/client-success-cockpit/src/lib/clientGates.ts';
const profile={clientName:'Alpha',performance:{month:{leads:999,booked:99},lastMonth:{leads:888},monthLabel:'October 2026',appointments:[{added:'2026-09-03',booked:true,show:'y',closed:'n'},{added:'2026-10-02',booked:true,show:'y',closed:'y'}]},adLeads:{daily:[{date:'2026-09-03',leads:7,spend:14},{date:'2026-10-02',leads:50,spend:500}]}};
test('the document honors the selected range rather than the cached current month',()=>{
 const plan=prepareReport(profile,{from:'2026-09-01',to:'2026-09-14',language:'en',extras:[]},{means:'Reviewed facts',next:[]});
 expect(plan.period).toBe('1 Sep to 14 Sep');expect(plan.period).not.toBe('October 2026');expect(plan.expected.join(' ')).not.toContain('999');
});
test('a valid empty selected range never falls back to another month',()=>{
 const plan=prepareReport(profile,{from:'2026-08-01',to:'2026-08-31',language:'en',extras:[]},{means:'No events in this range',next:[]});
 expect(plan.period).toBe('August 2026');expect(plan.expected.join(' ')).not.toContain('888');
});
test('invalid or missing original daily series cannot become a successful zero report',()=>{
 expect(()=>prepareReport({...profile,adLeads:{}},{from:'2026-09-01',to:'2026-09-14',language:'en'})).toThrow();
 expect(()=>prepareReport(profile,{from:'2026-02-30',to:'2026-03-02',language:'en'})).toThrow();
});
test('a custom range beginning on day one retains its equal-length comparison',()=>{
 const selected=profileForReport(profile,{from:'2026-09-01',to:'2026-09-14',label:'1 Sep to 14 Sep',language:'en'});
 expect(selected.performance.monthLabel).toBe('1 Sep to 14 Sep');expect(selected.performance.periodMonthly).toBe(false);
 expect(requestedPeriod({from:'2026-09-01',to:'2026-09-14',label:'1 Sep to 14 Sep'})).toMatchObject({prevFrom:'2026-08-18',prevTo:'2026-08-31'});
});
test('an explicit month-to-date choice keeps the calendar-month comparison',()=>{
 expect(requestedPeriod({from:'2026-10-01',to:'2026-10-07',month:'2026-10',label:'October 2026'})).toMatchObject({month:'2026-10',prevFrom:'2026-09-01',prevTo:'2026-09-30'});
});
test('selected-period backlog replaces the cached current backlog',()=>{
 const selected=profileForReport({...profile,performance:{...profile.performance,staleCount:73}},{from:'2026-09-01',to:'2026-09-14',language:'en'});
 expect(selected.performance.staleCount).toBe(0);
});
test('rendered comparison text and model facts identify the actual previous range',()=>{
 const p={...profile,adLeads:{daily:[...profile.adLeads.daily,{date:'2026-08-20',leads:3,spend:6}]}};
 const request={from:'2026-09-01',to:'2026-09-14',label:'1 Sep to 14 Sep',language:'en',extras:[]};
 const selected=profileForReport(p,request),plan=prepareReport(p,request);
 expect(plan.expected.join(' ')).toContain('2026-08-18 to 2026-08-31');expect(plan.expected.join(' ')).not.toContain('last month');
 const prompt=narrativePrompt(selected,'en');expect(prompt).toContain('"previousPeriod"');expect(prompt).toContain('2026-08-18');expect(prompt).toContain('2026-08-31');
});
// The one client show rate line (Aziz, 2026-10-12: "the show rate metric is 60%, so anything around that is fine, not 70%").
const attended=(shows:number,noshows:number)=>({clientName:'Beta',performance:{monthLabel:'September 2026',appointments:[...Array(shows).fill('y'),...Array(noshows).fill('n')].map((show,i)=>({added:`2026-09-${String(1+(i%14)).padStart(2,'0')}`,booked:true,show,closed:show}))},adLeads:{daily:[{date:'2026-09-02',leads:40,spend:400}]}});
const constraintsOf=(prompt:string)=>JSON.parse(prompt.slice(prompt.indexOf('The data:\n')+10)).constraints as string[];
const range={from:'2026-09-01',to:'2026-09-14',language:'en',extras:[]};
test('a show rate at or above the 60% line puts no show rate line in the report',()=>{
 expect(SHOW_RATE_GOOD).toBe(60);
 for(const [shows,noshows] of [[13,7],[6,4]]){
  const p=attended(shows,noshows);
  expect(constraintsOf(narrativePrompt(profileForReport(p,range),'en')).join(' ')).not.toContain('show rate');
  expect(prepareReport(p,range).expected.join(' ')).not.toMatch(/show rate/i);
 }
});
test('under the line the report names the 60% line, never a 70% or 75% target',()=>{
 const p=attended(5,5),prompt=narrativePrompt(profileForReport(p,range),'en'),lines=constraintsOf(prompt);
 expect(lines).toContain('show rate 50%, under our 60% line: book same or next day and confirm twice, once at booking and once the morning of');
 const text=[prompt,...prepareReport(p,range).expected,...prepareReport(p,{...range,language:'ar'}).expected].join(' ');
 expect(text).toContain('under our 60% line');
 expect(text).not.toContain('target 7');expect(text).not.toMatch(/7[05]%/);
});
