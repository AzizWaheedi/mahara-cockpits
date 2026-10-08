import {test,expect} from 'bun:test';
import {runRefresh} from './worker';

test('failed finance sends an actionable error without a JSON null output',async()=>{
 let publication:any;
 const fetcher=(async(input:any,init:any)=>{
  const name=String(input).split('/').pop();
  let result:any={};
  if(name==='cockpit_ceo_refresh_claim')result={run_id:'11111111-1111-4111-8111-111111111111',lease_token:'22222222-2222-4222-8222-222222222222',status:'claimed',revision:1};
  else if(name==='cockpit_ceo_worker_begin_finance_refresh')result={id:'33333333-3333-4333-8333-333333333333',revision:1};
  else if(name==='cockpit_finance_refresh_input')result={revision:1};
  else if(name==='cockpit_ceo_refresh_publish'){
   publication=JSON.parse(init.body).p_publication;
   result={status:'partial',revision:2};
  }
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 }) as typeof fetch;
 const report=await runRefresh({apply:true,only:['money','expenses'],fetcher,env:{
  SUPABASE_URL:'https://bldgtotkfmhoxmlzowdx.supabase.co',SUPABASE_ACCESS_TOKEN:'test',SUPABASE_SERVICE_ROLE_KEY:'test',
 }});
 expect(report.status).toBe('partial');
 expect(publication.finance.id).toBe('33333333-3333-4333-8333-333333333333');
 expect(publication.finance.error).toContain('Money and Expenses must publish together');
 expect(Object.hasOwn(publication.finance,'output')).toBe(false);
 expect(publication.failures.map((row:any)=>row.key).sort()).toEqual(['expenses','money']);
 expect(publication.sections).toEqual([]);
});
