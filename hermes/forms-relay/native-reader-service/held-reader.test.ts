import {describe,expect,test} from 'bun:test';
import {heldNativeReader} from './held-reader.ts';
import {nodePostgresOwnedPool} from './pg-driver.ts';
import {candidateHandler} from './handler.ts';

type Config=NonNullable<Parameters<typeof candidateHandler>[0]>;
type Ports=NonNullable<Parameters<typeof candidateHandler>[1]>;
const config={enabled:true} as unknown as Config;
let called=0;
const ports={githubKeys:async()=>{called++;return [];},comment:async()=>{called++;return null;},permit:async()=>{called++;return true;}} as Pick<Ports,'githubKeys'|'comment'|'permit'>;
const req=()=>new Request('https://fictional.invalid',{method:'POST'});
describe('native reader assembly stays held',()=>{
 test('refuses missing or forged pool without contacting a provider',async()=>{
  called=0; expect((await heldNativeReader(config,ports,null)(req())).status).toBe(404);
  expect((await heldNativeReader(config,ports,{acquire:async()=>{called++;}})(req())).status).toBe(404);expect(called).toBe(0);
 });
 test('even a constructed narrow pool cannot activate the handler',async()=>{
  called=0;
  const pool=nodePostgresOwnedPool({on:()=>{},connect:async()=>{called++;throw Error('must remain held');}},'synthetic_reader_login','db.example.invalid');
  expect((await heldNativeReader(config,ports,pool)(req())).status).toBe(404);expect(called).toBe(0);
 });
});
