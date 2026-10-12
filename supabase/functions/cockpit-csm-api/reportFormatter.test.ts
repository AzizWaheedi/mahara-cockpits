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
const attended=(shows:number,noshows:number,closes=shows)=>({clientName:'Beta',performance:{monthLabel:'September 2026',appointments:[...Array(shows).fill('y'),...Array(noshows).fill('n')].map((show,i)=>({added:`2026-09-${String(1+(i%14)).padStart(2,'0')}`,booked:true,show,closed:show==='y'&&i<closes?'y':'n'}))},adLeads:{daily:[{date:'2026-09-02',leads:40,spend:400}]}});
const dataOf=(prompt:string)=>JSON.parse(prompt.slice(prompt.indexOf('The data:\n')+10));
const constraintsOf=(prompt:string)=>dataOf(prompt).constraints as string[];
const range={from:'2026-09-01',to:'2026-09-14',language:'en',extras:[]};
const SHOW_WATCH='show rate 50%, under our 60% line: book same or next day and confirm twice, once at booking and once the morning of';
test('a show rate at or above the 60% line puts no show rate line in the report',()=>{
 expect(SHOW_RATE_GOOD).toBe(60);
 for(const [shows,noshows] of [[13,7],[6,4]]){
  const p=attended(shows,noshows),data=dataOf(narrativePrompt(profileForReport(p,range),'en'));
  expect(data.constraints.join(' ')).not.toContain('show rate');expect(data.watch).toBe('');
  expect(prepareReport(p,range).expected.join(' ')).not.toMatch(/show rate/i);
 }
});
test('under the line the show rate is a watch, never a constraint, and never a 70% or 75% target',()=>{
 const p=attended(5,5),prompt=narrativePrompt(profileForReport(p,range),'en'),data=dataOf(prompt);
 expect(data.constraints.join(' ')).not.toContain('show rate');
 expect(data.watch).toBe(SHOW_WATCH);
 expect(prompt).toContain('A "watch" line is something to keep an eye on, never a constraint, never the leak');
 const text=[prompt,...prepareReport(p,range).expected,...prepareReport(p,{...range,language:'ar'}).expected].join(' ');
 expect(text).toContain('under our 60% line');
 expect(text).not.toContain('target 7');expect(text).not.toMatch(/7[05]%/);
});
test('the show rate is never the main constraint: it goes after the real ones',()=>{
 // 50% show rate and 0% close rate: the close rate is the constraint.
 const p=attended(5,5,0),selected=profileForReport(p,range),cons=constraintsOf(narrativePrompt(selected,'en'));
 expect(cons[0]).toBe('close rate 0% of attended (target 20 to 30%), review two call recordings before blaming lead quality');
 expect(cons.join(' ')).not.toContain('show rate');
 const text=prepareReport(p,range).expected.join(' ');
 expect(text).toContain('The main constraint right now: close rate 0% of attended');
 expect(text).not.toContain('The main constraint right now: show rate');
 expect(text.indexOf('Close rate 0% of attended')).toBeLessThan(text.indexOf('Show rate 50%, under our 60% line'));
 // Only the show rate under the line: every gated stage is met, and the show rate is the watch.
 const only=attended(5,5),onlyCons=constraintsOf(narrativePrompt(profileForReport(only,range),'en'));
 expect(onlyCons).toEqual(['every measurable stage is at or above target, the constraint is budget and capacity, not the funnel']);
 const onlyText=prepareReport(only,range).expected.join(' ');
 expect(onlyText).toContain('The main constraint right now: every measurable stage is at or above target');
 expect(onlyText).not.toContain('The main constraint right now: show rate');
});
