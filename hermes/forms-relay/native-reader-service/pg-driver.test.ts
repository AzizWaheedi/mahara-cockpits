import {describe,expect,test} from 'bun:test';
import {nodePostgresOwnedPool} from './pg-driver.ts';

const baseline={login:'synthetic_reader_login',active:'synthetic_reader_login',rolcanlogin:true,rolinherit:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolbypassrls:false,membership_count:1,reader_member:true,reader_role_safe:true,direct_schema_create:false,helpers_pinned:true,direct_table_access:false,direct_sequence_access:false,protected_table_count:9,callable_definer:false,log_statement:'ddl',log_min_duration:'-1',log_error_parameters:'0'};
function setup(options:{identity?:Record<string,unknown>; tls?:Record<string,unknown>; status?:string; stall?:boolean}={}) {
 const queries:Array<{text:string;values?:unknown[];query_timeout?:number}>=[]; const releases:unknown[]=[];
 const client={connection:{stream:{encrypted:true,authorized:true,servername:'db.example.invalid',...options.tls}},
  getTransactionStatus:()=>options.status??'I',release:(destroy?:boolean)=>{releases.push(destroy);},
  query:async(q:{text:string;values?:unknown[];query_timeout?:number})=>{queries.push(q);if(options.stall) return await new Promise<never>(()=>{});
   return {rows:q.text.startsWith('select session_user')?[{...baseline,...options.identity}]:[],command:q.text};},
 };
 const pool={on:()=>{},connect:async()=>client};
 return {pool,client,queries,releases,owned:nodePostgresOwnedPool(pool,'synthetic_reader_login','db.example.invalid')};
}
describe('node-postgres adapter, synthetic pool',()=>{
 test('checks scope and TLS, assumes only the reader role, then resets it',async()=>{
  const {owned,queries,releases}=setup(); const lease=await owned.acquire(new AbortController().signal);
  expect(lease.idle).toBe(true); expect(queries[0].query_timeout).toBe(5000); expect(queries[1].text).toBe('SET ROLE cockpit_native_research_reader');
  await lease.release({discard:false}); expect(queries.at(-1)?.text).toBe('RESET ROLE'); expect(releases).toEqual([undefined]);
 });
 for(const identity of [{rolsuper:true},{rolinherit:true},{membership_count:2},{reader_member:false},{direct_table_access:true},
   {reader_role_safe:false},{direct_schema_create:true},{helpers_pinned:false},{direct_sequence_access:true},{protected_table_count:8},{callable_definer:true},{log_statement:'all'},{log_min_duration:'0'},{log_error_parameters:'-1'},{login:'other'}]) {
  test(`denies unsafe connection identity ${Object.keys(identity)[0]}`,async()=>{
   const {owned,releases}=setup({identity}); await expect(owned.acquire(new AbortController().signal)).rejects.toThrow('Reader unavailable');
   expect(releases).toEqual([true]);
  });
 }
 for(const tls of [{encrypted:false},{authorized:false},{servername:'wrong.example.invalid'}]) {
  test(`denies unsafe TLS ${Object.keys(tls)[0]}`,async()=>{
   const {owned,releases,queries}=setup({tls}); await expect(owned.acquire(new AbortController().signal)).rejects.toThrow('Reader unavailable');
   expect(queries).toHaveLength(0); expect(releases).toEqual([true]);
  });
 }
 test('denies a connection in a transaction and destroys it',async()=>{
  const {owned,releases}=setup({status:'T'}); await expect(owned.acquire(new AbortController().signal)).rejects.toThrow('Reader unavailable');
  expect(releases).toEqual([true]);
 });
 test('aborting a running query destroys the connection without exposing the error',async()=>{
  const {owned,releases,queries}=setup({stall:true});const ctl=new AbortController();const pending=owned.acquire(ctl.signal);
  for(let n=0;n<10 && queries.length===0;n++) await Promise.resolve();
  expect(queries).toHaveLength(1);
  ctl.abort(); await expect(pending).rejects.toThrow('Reader unavailable');expect(releases).toEqual([true]);
 });
 test('an aborted acquisition destroys a client that arrives late',async()=>{
  let resolve!:(x:ReturnType<typeof setup>['client'])=>void; const base=setup();
  const slow={on:()=>{},connect:()=>new Promise<ReturnType<typeof setup>['client']>(r=>{resolve=r;})};
  const owned=nodePostgresOwnedPool(slow,'synthetic_reader_login','db.example.invalid');const ctl=new AbortController();
  const pending=owned.acquire(ctl.signal);ctl.abort();await expect(pending).rejects.toThrow('Reader unavailable');
  resolve(base.client);await new Promise(r=>setTimeout(r,0));expect(base.releases).toEqual([true]);
 });
});
