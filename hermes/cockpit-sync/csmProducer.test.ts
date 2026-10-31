import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapshot, CF} from './csmCadence';
import {reconcileRoster, parseClientData, parseKpi, mergeDailyStats, attachNotesParity} from './csmProducer';
import {appointmentRows, summarise, adLeadsByClient} from './csmProfileCalculations';
import {prepareTables} from './capture';
import {sheetPerformance, fathomCalls} from './csmProviders';
import {type Reads, withNativeContext} from './runtime';

test('roster reconciliation compares yesterday and preserves human events',()=>{
 const prior={_id:'y',day:'2026-10-03',clients:[{key:'a',name:'Alpha',status:'Active',paying:true}]};
 const human={_id:'h',day:'2026-10-04',key:'a',kind:'extension'};
 const first=reconcileRoster([{taskId:'a',name:'Alpha',stage:'Paused'}],[prior],[human],'2026-10-04',100);
 assert.equal(first.churnEvents.find(x=>x.kind==='paused')?.key,'a');
 const next=reconcileRoster([{taskId:'a',name:'Alpha',stage:'Active'}],first.rosterDays,first.churnEvents,'2026-10-04',200);
 assert.deepEqual(next.churnEvents,[human]);
});

test('cadence keeps inactive clients and excludes lost sales leads',()=>{
 const task=(id:string,status:string)=>({id,name:id,url:'https://app.clickup.com/t/'+id,custom_fields:[{id:CF.status,value:0,type_config:{options:[{orderindex:0,name:status}]}}]});
 const result=buildSnapshot({today:'2026-10-04',now:1,exts:[],notes:[],clientTasks:[task('inactive','Stopped'),task('lost','SALES TEAM TO CONTACT')],csTasks:[],liveWatch:[],campaigns:[],changeLog:[]});
 assert.equal(result.clients.length,1); assert.equal(result.clients[0].bucket,'inactive'); assert.equal(result.clients[0].level,'blue');
});

test('every client past the first win gets the review ask, happy or not; the referral stays with happy clients',()=>{
 const pick=(id:string,name:string)=>({id,value:0,type_config:{options:[{orderindex:0,name}]}});
 const task=(id:string,happiness?:string)=>({id,name:id,url:'https://app.clickup.com/t/'+id,custom_fields:[pick(CF.status,'Active'),{id:CF.launchDate,value:String(Date.parse('2026-09-01T00:00:00Z'))},...happiness?[pick(CF.happiness,happiness)]:[]]});
 const result=buildSnapshot({today:'2026-10-29',now:1,exts:[],notes:[],clientTasks:[task('happy','Happy'),task('atrisk','At Risk'),task('unrated')],csTasks:[],liveWatch:[],campaigns:[],changeLog:[]});
 const kinds=(id:string)=>result.clients.find(c=>c.taskId===id||c.name===id)?.hot.map((h:{kind:string})=>h.kind);
 assert.deepEqual(kinds('happy'),['Upsell','Referral','Google review']);
 assert.deepEqual(kinds('atrisk'),['Google review']);
 assert.deepEqual(kinds('unrated'),['Google review']);
 const text=JSON.stringify(result.clients.map(c=>c.hot));
 assert.ok(!/1,000 payout|testimonial-ready/.test(text));
 assert.match(text,/\$500 for the first firm/);
});

test('sheet outcomes keep blank distinct from no and ignore future appointments for chase',()=>{
 const rows=appointmentRows([['Alpha','10/1/2026','10/8/2026'],['Beta','10/1/2026','10/2/2026','','','','','','','No']],{y:2026,m:10,d:4});
 const sums=summarise(rows); assert.equal(sums.upcoming,1); assert.equal(sums.noshows,1); assert.equal(sums.unknownOutcome,0);
});

test('Meta daily history replaces matching grain instead of adding twice',()=>{
 const old={campaignName:'C',adName:'A',adSetName:'S',date:'2026-10-01',leads:3,spend:10};
 const rows=mergeDailyStats([old],[{...old,leads:5}]);
 const result=adLeadsByClient([{campaignName:'C',clientName:'Alpha'}],rows,Date.parse('2026-10-04T00:00:00Z'));
 assert.equal(result[0].month,5); assert.equal(result[0].allTime,5);
});

test('Client Data rejects renamed headers and preserves named service mode',()=>{
 assert.throws(()=>parseClientData([['Client Name'],['Alpha']]),/header/);
 const parsed=parseClientData([['Client Name','Clickup ID','Service Mode'],['Alpha','abc','DWY']]);
 assert.equal(parsed.rows[0].serviceMode,'DWY'); assert.ok(parsed.omissions.includes('GHL API'));
});

test('blank churn numerator never publishes zero',()=>{
 const result=parseKpi([['October','10','','','0.00%']],'2026-10-04',1);
 assert.equal(result.some(r=>r.key==='churn'),false); assert.equal(result.find(r=>r.key==='churn_missing')?.value,'unfilled');
});

test('churn cross-check publishes the rate, not the lost-client numerator, and preserves real zero',()=>{
 const result=parseKpi([['September','40','4','','10%'],['October','10','2','','20.00%']],'2026-10-04',1);
 assert.equal(result.find(r=>r.key==='churn')?.numeric,20);
 assert.equal(result.find(r=>r.key==='clients_lost')?.numeric,2);
 assert.equal(result.find(r=>r.key==='churn')?.month,'2026-10');
 const zero=parseKpi([['October','10','0','','0.00%']],'2026-10-04',1);
 assert.equal(zero.find(r=>r.key==='churn')?.numeric,0);
 assert.equal(zero.find(r=>r.key==='clients_lost')?.numeric,0);
});

test('mention IDs stay stable across the archive cutover and do not collide on one task',()=>{
 const prior={_id:'legacy',taskId:'task',kind:'mention',at:1,author:'Person'};
 const rows=[{...prior,_id:undefined,commentId:'comment-1'},{taskId:'task',kind:'mention',at:2,author:'Person',commentId:'comment-2'}];
 const next=prepareTables({inbox:rows},{inbox:[prior]}).inbox;
 assert.equal(next[0]._id,'legacy');assert.notEqual(next[1]._id,next[0]._id);
 const refreshed=prepareTables({inbox:[{...rows[0],at:100}]},{inbox:next}).inbox;
 assert.equal(refreshed[0]._id,'legacy');
 assert.throws(()=>prepareTables({inbox:[rows[0],{...rows[0],at:100}]}),/Duplicate/);
});

test('creative monthly outcomes reuse the CSM sheet batch and exclude future shows',async()=>{
 const past=Array<string>(16).fill(''),future=Array<string>(16).fill('');
 Object.assign(past,{0:'Alpha lead',1:'10/1/2026',2:'10/2/2026',9:'Yes',10:'Yes'});
 Object.assign(future,{0:'Beta lead',1:'10/1/2026',2:'10/8/2026',9:'No'});
 let requests=0;
 const reads:Reads={
  async tool(){requests++;return {valueRanges:[{range:'Appointments!A1:P600',values:[past,future]},{range:'Oct 26!A1:P600',values:[[],[],past,future]},{range:'Sep 26!A1:P600',values:[]}]};},
  async graph(){throw new Error('No Meta read expected');},
  async fetch(){throw new Error('No raw HTTP read expected');},
  log(){},
 };
 const result=await withNativeContext(reads,{receipts:[]},()=>sheetPerformance('https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaa/edit',{y:2026,m:10,d:4}));
 assert.equal(requests,1);
 assert.deepEqual(result?.creativeStats,{tab:'Oct 26',booked:2,due:1,shows:1,quotes:1,closes:0});
});

test('the sheet copy keeps quotation N apart from a blank, and says so',async()=>{
 const yes=Array<string>(16).fill(''),no=Array<string>(16).fill(''),blank=Array<string>(16).fill('');
 Object.assign(yes,{0:'Alpha lead',1:'10/1/2026',2:'10/2/2026',9:'Yes',10:'Yes'});
 Object.assign(no,{0:'Beta lead',1:'10/1/2026',2:'10/3/2026',9:'Yes',10:'No'});
 Object.assign(blank,{0:'Gamma lead',1:'10/1/2026',2:'10/3/2026',9:'No'});
 const reads:Reads={
  async tool(){return {valueRanges:[{range:'Appointments!A1:P600',values:[yes,no,blank]},{range:'Oct 26!A1:P600',values:[]},{range:'Sep 26!A1:P600',values:[]}]};},
  async graph(){throw new Error('No Meta read expected');},
  async fetch(){throw new Error('No raw HTTP read expected');},
  log(){},
 };
 const result=await withNativeContext(reads,{receipts:[]},()=>sheetPerformance('https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaa/edit',{y:2026,m:10,d:4}));
 assert.equal(result?.quoteKeepsN,true);
 assert.deepEqual(result?.appointments.map(a=>a.quote),['y','n','']);
});

test('native client call history retains a real call sixty days old',async()=>{
 const at=new Date(Date.now()-60*86400000).toISOString();
 const meeting={title:'Alpha client review',scheduled_start_time:at,recorded_by:{name:'Team'},
  calendar_invitees:[{is_external:true,name:'Alpha'}],share_url:'https://fathom.video/share/fixture',
  default_summary:{markdown_formatted:'Original call summary'}};
 const reads:Reads={
  async tool(name,args){
   if(name!=='native_fathom_get')throw new Error('Unexpected provider');
   const requested=new URL(args.url).searchParams.get('created_after');
   if(!requested)throw new Error('Fathom range missing');
   return {items:Date.parse(at)>=Date.parse(requested)?[meeting]:[]};
  },
  async graph(){throw new Error('No Meta read expected');},
  async fetch(){throw new Error('No raw HTTP read expected');},
  log(){},
 };
 const result=await withNativeContext(reads,{receipts:[]},()=>fathomCalls());
 assert.deepEqual(result,[{title:'Alpha client review',at,host:'Team',external:['Alpha'],
  url:'https://fathom.video/share/fixture',summary:'Original call summary'}]);
});

// Release N4 (docs/forms/STAGE2B-CONTRACT.md 3.10, 4.4): every client row says where its 1-1 notes came from and how
// the store compared with Typeform; cleanSince is the time since which no client read differs.
test('every client row gets notesFrom and notesParity',()=>{
 const now=Date.parse('2026-10-29T12:00:00Z'),at='2026-10-29T12:00:00.000Z';
 const clients=[{taskId:'a',name:'Alpha'},{taskId:'b',name:'Beta'},{taskId:'c',name:'Gamma'}];
 attachNotesParity(clients,{native:false,byTask:{a:{state:'same'},b:{state:'explained',why:'fresh'}}},[],now);
 assert.deepEqual(clients.map(c=>(c as Record<string,unknown>).notesFrom),['store','store','store']);
 assert.deepEqual(clients.map(c=>(c as Record<string,unknown>).notesParity),[
  {state:'same',at,cleanSince:at},
  {state:'explained',why:'fresh',at,cleanSince:at},
  {state:'none',at,cleanSince:at},
 ]);
 const native=[{taskId:'a'}];
 attachNotesParity(native,{native:true,byTask:{a:{state:'same'}}},[],now);
 assert.equal((native[0] as Record<string,any>).notesParity.state,'off');
});

test('cleanSince is carried from the last published rows and reset when any client differs',()=>{
 const first=Date.parse('2026-10-22T09:00:00Z'),next=Date.parse('2026-10-29T09:00:00Z');
 const previous=[{taskId:'a',notesParity:{state:'same',at:'2026-10-22T09:00:00.000Z',cleanSince:'2026-10-22T09:00:00.000Z'}}];
 // Carried, for an old client and a new one alike; the unchanged reading keeps its own time, so the row is unchanged.
 const carried=[{taskId:'a'},{taskId:'new'}];
 attachNotesParity(carried,{native:false,byTask:{a:{state:'same'},new:{state:'same'}}},previous,next);
 assert.deepEqual(carried.map(c=>(c as Record<string,any>).notesParity),[
  {state:'same',at:'2026-10-22T09:00:00.000Z',cleanSince:'2026-10-22T09:00:00.000Z'},
  {state:'same',at:'2026-10-29T09:00:00.000Z',cleanSince:'2026-10-22T09:00:00.000Z'},
 ]);
 // One client differs: every row's cleanSince is this cycle, and the changed reading gets this cycle's time.
 const reset=[{taskId:'a'},{taskId:'b'}];
 attachNotesParity(reset,{native:false,byTask:{a:{state:'same'},b:{state:'differs',fields:['notes']}}},previous,next);
 assert.deepEqual(reset.map(c=>(c as Record<string,any>).notesParity.cleanSince),['2026-10-29T09:00:00.000Z','2026-10-29T09:00:00.000Z']);
 assert.deepEqual((reset[1] as Record<string,any>).notesParity,{state:'differs',fields:['notes'],at:'2026-10-29T09:00:00.000Z',cleanSince:'2026-10-29T09:00:00.000Z'});
 // The first cycle (no reading before, or one that is unreadable) sets it.
 for(const before of [[],[{taskId:'a'}],[{taskId:'a',notesParity:{state:'same',cleanSince:'soon'}}]]){
  const rows=[{taskId:'a'}];
  attachNotesParity(rows,{native:false,byTask:{a:{state:'same'}}},before,first);
  assert.equal((rows[0] as Record<string,any>).notesParity.cleanSince,'2026-10-22T09:00:00.000Z');
 }
 // A changed reading on the same client takes the new time; cleanSince still carries.
 const moved=[{taskId:'a'}];
 attachNotesParity(moved,{native:false,byTask:{a:{state:'explained',why:'manual'}}},previous,next);
 assert.deepEqual((moved[0] as Record<string,any>).notesParity,{state:'explained',why:'manual',at:'2026-10-29T09:00:00.000Z',cleanSince:'2026-10-22T09:00:00.000Z'});
});

test('cleanSince moves at most twice per differs episode, so a cycle inside it changes no row',()=>{
 // Every cycle copies the rows it publishes into the next cycle's previous, as state.csm.clients does.
 const t=(m:number)=>Date.parse('2026-10-29T09:00:00Z')+m*60_000,iso=(m:number)=>new Date(t(m)).toISOString();
 const cycle=(byTask:Record<string,any>,previous:any[],m:number)=>{
  const rows=['a','b','c'].map(taskId=>({taskId}));
  attachNotesParity(rows,{native:false,byTask},previous,t(m));
  return JSON.parse(JSON.stringify(rows)) as any[];
 };
 const clean={a:{state:'same'},b:{state:'same'},c:{state:'explained',why:'manual'}};
 const differs={...clean,b:{state:'differs',fields:['notes']}};
 const c0=cycle(clean,[],0);
 const c1=cycle(differs,c0,15);                 // b first differs: cleanSince is this cycle on every row
 assert.deepEqual(c1.map(r=>r.notesParity.cleanSince),[iso(15),iso(15),iso(15)]);
 const c2=cycle(differs,c1,30);                 // still differs: nothing moves, so no row (and no audit row) changes
 assert.deepEqual(c2,c1);
 const c3=cycle(differs,c2,45);
 assert.deepEqual(c3,c1);
 const c4=cycle(clean,c3,60);                   // the first clean cycle: the clean run starts now
 assert.deepEqual(c4.map(r=>r.notesParity.cleanSince),[iso(60),iso(60),iso(60)]);
 assert.deepEqual(c4.map(r=>r.notesParity.at),[iso(0),iso(60),iso(0)]);
 const c5=cycle(clean,c4,75);                   // clean again: carried, unchanged
 assert.deepEqual(c5,c4);
 // A client that differed and has left the roster still ends the episode on the next clean cycle.
 const gone=[...c3.slice(0,1),{taskId:'z',notesParity:{state:'differs',fields:['priority'],at:iso(15),cleanSince:iso(15)}}];
 assert.deepEqual(cycle(clean,gone,60).map(r=>r.notesParity.cleanSince),[iso(60),iso(60),iso(60)]);
});
