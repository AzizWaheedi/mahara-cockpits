import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {prepareLtv,LTV_FIELD,LTV_RETIRED} from './ltv';
import {OPERATIONS,type Row} from './core';

// One LTV writer (docs/forms/WAVE56-CONTRACT.md E10, 4.4.3, C8): the morning run writes the card's LTV
// through billing kind ltv; the CEO's old Apply is refused with a sentence and reaches no provider.
function provider(){const calls:unknown[]=[];return {calls,async call(...args:unknown[]){calls.push(args);throw new Error('No provider call is allowed');}};}
const preview={rows:[{clickupTaskId:'client1',client:'Client A',baseline:100,baselineDay:'2026-09-01',logged:50,loggedCount:1,current:100,target:150,delta:50}]};

test('prepareLtv throws the retirement sentence and calls no provider, whatever it is given',async()=>{
 expect(LTV_RETIRED).toBe('Lifetime value is written by the cockpit every morning now. See the list on the Billing tab.');
 for(const args of [{},{taskIds:['client1']},{target:999999}] as Row[]){
  const p=provider();
  await expect(prepareLtv(args,preview,p)).rejects.toThrow(LTV_RETIRED);
  expect(p.calls).toHaveLength(0);
 }
 expect(LTV_FIELD).toBe('11d70e58-20e7-4ff0-85c6-51de42f044d2');
});

test('the operation stays allowed, so an old bundle gets the sentence and not "Unsupported provider operation"',()=>{
 expect(OPERATIONS.has('ceo.ltv.apply')).toBe(true);
});

test('index.ts refuses ceo.ltv.apply before any scope, preview or provider call, and reads no LTV preview',()=>{
 const src=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
 const refusal=src.indexOf("if(operation==='ceo.ltv.apply') return json({ok:false,error:LTV_RETIRED},409);");
 expect(refusal).toBeGreaterThan(src.indexOf('if(!OPERATIONS.has(operation))'));
 expect(refusal).toBeLessThan(src.indexOf('const scopeCall='));
 expect(refusal).toBeLessThan(src.indexOf('providerTools(env,health'));
 expect(src).not.toContain("p_action:'ltv.preview'");
});
