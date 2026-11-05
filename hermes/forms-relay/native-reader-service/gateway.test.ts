import { describe, expect, test } from 'bun:test';
import { committedGateway, type GatewayConnection } from './gateway.ts';
import { committedSourcePort, READ_SOURCE_SQL } from './source-port.ts';

const binding = { taskId:'fictional',responseId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',schemaVersion:3,commentId:'fictional',commentSha256:'a'.repeat(64) };
const identity = {runId:'123',attempt:'1'};
const secret = 'fictional-secret';
const reservation = 'select native_research_private.reserve_source($1,$2,$3,$4,$5,$6,$7,$8) as admission';
const snapshot = {taskId:'fictional'};
function setup(options:{fail?:string; role?:string; deny?:boolean; onRead?:()=>void; commitSource?:()=>Promise<void>; releaseFails?:boolean; idle?:boolean; wrongCommitTag?:boolean}={}) {
 const calls:string[]=[]; let releaseDiscard:boolean|undefined; let commits=0;
 const conn:GatewayConnection={
  idle: options.idle ?? true,
  execute:async(sql)=>{
   calls.push(sql);
   if(options.fail===sql || (options.fail==='source-commit' && sql==='COMMIT' && commits===1)) throw new Error('fictional-private-secret');
   if(sql==='select current_user as role') return {rows:[{role:options.role ?? 'cockpit_native_research_reader'}]};
   if(sql===reservation) return {rows:[{admission:options.deny?null:{admitted:true,reservation:1}}]};
   if(sql===READ_SOURCE_SQL) { options.onRead?.(); return {rows:[{snapshot}]}; }
   if(sql==='COMMIT') {commits++; if(commits===2 && options.commitSource) await options.commitSource();}
   return {rows:[],command:sql==='COMMIT' && options.wrongCommitTag ? 'ROLLBACK' : sql};
  },
  release:async({discard})=>{releaseDiscard=discard;if(options.releaseFails) throw Error('synthetic release failure');},
 };
 const gateway=committedGateway({acquire:async()=>conn});
 return {port:committedSourcePort(gateway),calls,getDiscard:()=>releaseDiscard};
}

describe('transaction-owned gateway, synthetic driver',()=>{
 test('does not release the answer before both commits finish',async()=>{
  let unblock!:()=>void; const held=new Promise<void>(r=>{unblock=r;});
  const {port,calls,getDiscard}=setup({commitSource:()=>held}); let resolved=false;
  const pending=port(binding,secret,identity,new AbortController().signal).then(v=>{resolved=true;return v;});
  for(let i=0;i<20 && calls.filter(c=>c==='COMMIT').length<2;i++) await new Promise(r=>setTimeout(r,0));
  expect(calls.filter(c=>c==='COMMIT')).toHaveLength(2); expect(resolved).toBe(false);
  unblock(); expect(await pending).toEqual(snapshot); expect(getDiscard()).toBe(false);
 });
 test('denied admission never reads answers',async()=>{
  const {port,calls,getDiscard}=setup({deny:true});
  expect(await port(binding,secret,identity,new AbortController().signal)).toBeNull();
  expect(calls).not.toContain(READ_SOURCE_SQL); expect(calls).toContain('ROLLBACK'); expect(getDiscard()).toBe(true);
 });
 test('uncertain reservation commit never starts a source read or retries',async()=>{
  const {port,calls,getDiscard}=setup({fail:'COMMIT'});
  expect(await port(binding,secret,identity,new AbortController().signal)).toBeNull();
  expect(calls.filter(c=>c===reservation)).toHaveLength(1); expect(calls).not.toContain(READ_SOURCE_SQL); expect(getDiscard()).toBe(true);
 });
 test('uncertain source commit never releases an answer or retries',async()=>{
  const {port,calls,getDiscard}=setup({fail:'source-commit'});
  expect(await port(binding,secret,identity,new AbortController().signal)).toBeNull();
  expect(calls.filter(c=>c===READ_SOURCE_SQL)).toHaveLength(1); expect(getDiscard()).toBe(true);
 });
 test('a rollback command tag is never treated as a successful commit',async()=>{
  const {port,calls,getDiscard}=setup({wrongCommitTag:true});
  expect(await port(binding,secret,identity,new AbortController().signal)).toBeNull();
  expect(calls).not.toContain(READ_SOURCE_SQL); expect(getDiscard()).toBe(true);
 });
 test('aborting after the source read rolls it back and releases no data',async()=>{
  const ctl=new AbortController(); const {port,calls,getDiscard}=setup({onRead:()=>ctl.abort()});
  expect(await port(binding,secret,identity,ctl.signal)).toBeNull();
  expect(calls.filter(c=>c==='COMMIT')).toHaveLength(1); expect(calls).toContain('ROLLBACK'); expect(getDiscard()).toBe(true);
 });
 test('a connection-release failure does not expose an answer',async()=>{
  const {port}=setup({releaseFails:true});
  expect(await port(binding,secret,identity,new AbortController().signal)).toBeNull();
 });
 test('requires the dedicated database role and rejects arbitrary SQL',async()=>{
  const {port,calls}=setup({role:'service_role'});
  expect(await port(binding,secret,identity,new AbortController().signal)).toBeNull();
  expect(calls).not.toContain('BEGIN');
  let acquired=false; const gateway=committedGateway({acquire:async()=>{acquired=true;throw Error('unused');}});
  await expect(gateway('select private_answers',[],new AbortController().signal)).rejects.toThrow('Reader unavailable');
  expect(acquired).toBe(false);
 });
 test('rejects a connection that is already in a transaction',async()=>{
  const {port,calls,getDiscard}=setup({idle:false});
  expect(await port(binding,secret,identity,new AbortController().signal)).toBeNull();
  expect(calls).toHaveLength(0); expect(getDiscard()).toBe(true);
 });
});
