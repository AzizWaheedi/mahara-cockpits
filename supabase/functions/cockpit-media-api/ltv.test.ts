import {test,expect} from 'bun:test';
import {prepareLtv,LTV_FIELD} from './ltv';
import {executePlan} from './execute';
import {confirmed,type Row} from './core';
function provider(rows:Row[]){const calls:any[]=[];return {calls,async call(...args:any[]){calls.push(args);const row=rows.shift();if(!row)throw new Error('Unexpected provider call');return row;}};}
const preview={rows:[{clickupTaskId:'client1',client:'Client A',baseline:100,baselineDay:'2026-09-01',logged:50,loggedCount:1,current:100,target:150,delta:50}]};
const field=(value:unknown)=>({custom_fields:[{id:LTV_FIELD,value}]});
test('LTV writes only authoritative target, with a pre-write current value guard and receipt',async()=>{
 const p=provider([field(100)]);const plan=await prepareLtv({taskIds:['client1'],target:999999,rows:[{target:999999}]},preview,p);
 expect(plan.steps[0].body).toEqual({value:150});expect(p.calls.every(x=>x[1]==='GET')).toBe(true);
 const live=provider([field('100.00'),{},field('150.00')]);
 expect((await executePlan(plan,live)).result).toEqual({written:1,skipped:0,errors:[]});expect(live.calls[1][2]).toBe(`task/client1/field/${LTV_FIELD}`);
});
test('LTV never overwrites a changed or empty live field, or an ineligible card',async()=>{
 await expect(prepareLtv({},preview,provider([field(125)]))).rejects.toThrow('changed');
 await expect(prepareLtv({},preview,provider([field(null)]))).rejects.toThrow('empty');
 await expect(prepareLtv({taskIds:['not-eligible']},preview,provider([]))).rejects.toThrow('eligible');
 const plan=await prepareLtv({},preview,provider([field(100)])),live=provider([field(120)]);
 await expect(executePlan(plan,live)).rejects.toThrow('human edits');expect(live.calls).toHaveLength(1);
 expect(confirmed({}, {field:LTV_FIELD,value:0,numeric:true})).toBe(false);
});
test('LTV skips an already correct live amount and deltas below one cent',async()=>{
 expect((await prepareLtv({},preview,provider([field(150)]))).result).toEqual({written:0,skipped:1,errors:[]});
 const rows=preview.rows.map(r=>({...r,delta:0.001}));expect((await prepareLtv({},{rows},provider([]))).steps).toHaveLength(0);
});
