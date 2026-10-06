import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapshot, CF} from './csmCadence';
import {reconcileRoster, parseClientData, parseKpi, mergeDailyStats} from './csmProducer';
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
