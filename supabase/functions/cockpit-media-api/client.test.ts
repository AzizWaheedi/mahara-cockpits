import {test,expect,mock} from 'bun:test';
const bodies:any[]=[];let fail=true;let actor='buyer1';const store=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)},configurable:true});
mock.module('../../../apps/media-buyer-cockpit/src/lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},functions:{invoke:async(_name:string,{body}:any)=>{bodies.push(body);return {data:fail?{ok:false,error:'Reconcile before retrying',receiptId:body.requestId}:{ok:true},error:null};}}}}));
const {mediaAction}=await import('../../../apps/media-buyer-cockpit/src/lib/mediaActionsClient');
test('browser adapter persists ambiguous UUIDs, canonicalizes optional args, throws failures and isolates users',async()=>{
 await expect(mediaAction('edit.duplicateAdSet',{name:'A',unused:undefined},{apply:true})).rejects.toThrow('Reconcile');
 await expect(mediaAction('edit.duplicateAdSet',{name:'A'},{apply:true})).rejects.toThrow('Reconcile');
 expect(bodies[0].requestId).toBe(bodies[1].requestId);
 actor='buyer2';await expect(mediaAction('edit.duplicateAdSet',{name:'A'},{apply:true})).rejects.toThrow();expect(bodies[2].requestId).not.toBe(bodies[0].requestId);
 actor='buyer1';fail=false;await mediaAction('edit.duplicateAdSet',{name:'A'},{apply:true});expect(bodies[3].requestId).toBe(bodies[0].requestId);
 await mediaAction('edit.duplicateAdSet',{name:'A'},{apply:true});expect(bodies[4].requestId).not.toBe(bodies[0].requestId);
});
