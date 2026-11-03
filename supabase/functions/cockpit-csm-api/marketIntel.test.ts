import {describe,expect,test} from 'bun:test';
import {runMarketIntel,MarketIntelError,MARKET_INTEL_OPERATIONS} from './marketIntel.ts';

// Market research actions (20261103i): input checked here, every gate in the database; each operation calls
// exactly one RPC as the signed-in seat, and the RPC's refusal reaches the cockpit as its own sentence.
function fake(reply:(name:string,args:Record<string,unknown>)=>{data:unknown;error:{message:string;code?:string}|null}){
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 return {calls,client:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return reply(name,args);}}};
}
const RUN='11111111-2222-4333-8444-555555555555';
describe('market research actions',()=>{
 test('three operations, one RPC each, with the seat\'s own client',async()=>{
  expect(MARKET_INTEL_OPERATIONS).toEqual(['marketIntel.view','marketIntel.rerun','marketIntel.flag']);
  const f=fake(()=>({data:{state:'none'},error:null}));
  expect(await runMarketIntel(f.client,{operation:'marketIntel.view',args:{taskId:'taskMiCedar1'}})).toEqual({state:'none'});
  await runMarketIntel(f.client,{operation:'marketIntel.rerun',args:{taskId:'taskMiCedar1',reason:'  The client moved city  '}});
  await runMarketIntel(f.client,{operation:'marketIntel.flag',args:{runId:RUN,cid:'C3',reason:'A supplier'}});
  expect(f.calls).toEqual([
   {name:'cockpit_market_intel_view',args:{p_task_id:'taskMiCedar1'}},
   {name:'cockpit_market_intel_rerun',args:{p_task_id:'taskMiCedar1',p_reason:'The client moved city'}},
   {name:'cockpit_market_intel_flag_competitor',args:{p_run_id:RUN,p_cid:'C3',p_reason:'A supplier'}},
  ]);
 });
 test('bad input is refused before any RPC, with a sentence',async()=>{
  const f=fake(()=>({data:null,error:null}));
  for(const [input,said] of [
   [{operation:'marketIntel.view',args:{taskId:'bad id!'}},'Choose a client.'],
   [{operation:'marketIntel.rerun',args:{taskId:'t1',reason:'short'}},'Give a reason of 10 to 300 characters.'],
   [{operation:'marketIntel.flag',args:{runId:'nope',cid:'C1',reason:'Supplier'}},'Say in 3 to 300 characters why this is not a competitor.'],
   [{operation:'marketIntel.flag',args:{runId:RUN,cid:'K1',reason:'Supplier'}},'Say in 3 to 300 characters why this is not a competitor.'],
   [{operation:'marketIntel.view',args:{taskId:'t1',extra:true}},'Choose a client.'],
   [{operation:'marketIntel.delete',args:{}},'Unknown market research operation.'],
  ] as const){
   const e=await runMarketIntel(f.client,input).catch(x=>x);
   expect(e).toBeInstanceOf(MarketIntelError);expect(e.message).toBe(said);expect(e.status).toBe(400);
  }
  expect(f.calls).toEqual([]);
 });
 test('the database\'s refusal is the cockpit\'s sentence and status',async()=>{
  const cases:[{message:string;code?:string},number,string][]=[
   [{message:'Only the CEO or an admin can run research again.',code:'42501'},403,'Only the CEO or an admin can run research again.'],
   [{message:'Research is already running for this client. Wait for it to finish.',code:'55000'},400,'Research is already running for this client. Wait for it to finish.'],
   [{message:'Could not find the function public.cockpit_market_intel_view(p_task_id)',code:'PGRST202'},503,'Market research opens after the next cockpit update.'],
   [{message:'connection reset'},400,'Market research could not be read. Try again.'],
  ];
  for(const [error,status,said] of cases){
   const e=await runMarketIntel(fake(()=>({data:null,error})).client,{operation:'marketIntel.view',args:{taskId:'t1'}}).catch(x=>x);
   expect([e.status,e.message]).toEqual([status,said]);
  }
 });
});
