import type {Provider} from './tools.ts';
type Row=Record<string,any>;
const FIELDS={lastPoc:'e183f2ce-8b7a-491a-b160-2287a247758b',lastCall:'032203ad-e327-4d76-a0ce-c07496da6486',nextPoc:'c48c1323-ca6a-465f-84cb-8c24f0f62df3',status:'9368ca9e-3549-4320-84ff-9abd0a2901cb',happiness:'4e3924e3-4898-4e98-aca1-cc1ac3015b73',service:'fccfc09c-650e-4aed-b4cd-3f50beba05a3'};
const DEPARTMENTS:Record<string,string>={creative:'901818016338',tech:'901816723190',client_success:'901816723211',call_center:'901816723206',media_buyer:'901816723196'};
const REQUEST_FIELD='e9fd8024-8abe-4094-ac08-e6c0e736ad7e';
const REQUEST_TYPES: Record<string, string> = {
  "Switch this campaign to a landing page": "Create Landing Page📊",
  "Add qualification questions to the lead form":
    "Add Custom Qualification Questions🙋",
  "Tracking / page is broken": "Missing Leads ❌",
  "Pause this client": "Client Pause Request ⏸️",
  "Relaunch this client": "Client Relaunch Request ⏯️",
  "Offboard this client": "Client Offboarding Request 🔴",
  "Client success management request": "Client Success Management Request 🙋‍♂️",
};
const day=(d:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d)throw Error('Choose a valid date');return Date.parse(d+'T09:00:00+03:00');};
const nextDay=(d:string)=>new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const id=(x:unknown)=>{const v=String(x??'');if(!/^[A-Za-z0-9_-]+$/.test(v))throw Error('Invalid task or field identity');return v;};
function option(field:Row,label:string){const opt=(field?.type_config?.options??[]).find((o:Row)=>o.name===label||o.label===label);if(!opt)throw Error(`ClickUp does not offer the value "${label}"`);return opt.id;}
export async function prepareCsm(operation:string,args:Row,context:Row,provider:Provider){
 const patch:Row={},updates:{field:string;value:unknown}[]=[];let ticket:Row|null=null;
 if(operation==='plan')return {operation,context,args,patch,updates,ticket,tasks:args.items.map((it:Row)=>({name:it.text,description:[it.clientName?'Client: '+it.clientName:'',it.reason??'Planned by Client Success.'].filter(Boolean).join('\n'),due_date:day(it.dueDate||nextDay(context.day))}))};
 if(operation!=='act')throw Error('Unknown client-success operation');
 id(context.taskId);
 if(args.kind==='touchpoint'||args.kind==='call'){
  updates.push({field:FIELDS.lastPoc,value:day(context.day)});Object.assign(patch,{lastPoc:context.day,silentDays:0,todo:'Contact logged today',level:'green',rank:50});
  if(args.kind==='call'){updates.push({field:FIELDS.lastCall,value:day(context.day)});Object.assign(patch,{lastCall:context.day,callDays:0,todo:'Call logged today'});}
 }else if(args.kind==='booked'){updates.push({field:FIELDS.nextPoc,value:day(args.value)});Object.assign(patch,{nextPoc:args.value,todo:'Booked '+args.value,level:'blue',rank:40});
 }else if(['stage','service','happiness','report'].includes(args.kind)){
  const defs=await provider.call('GET','list/901816559981/field');let field:Row|undefined;
  if(args.kind==='report'){field=(defs.fields??[]).find((f:Row)=>String(f.name).trim().toLowerCase()==='last report sent');if(!field)throw Error('The Last report sent field is missing from ClickUp');updates.push({field:id(field.id),value:day(context.day)});Object.assign(patch,{lastReport:context.day,reportDays:0,reportTracked:true,reportDue:false});}
  else{const fid=args.kind==='stage'?FIELDS.status:args.kind==='service'?FIELDS.service:FIELDS.happiness;field=(defs.fields??[]).find((f:Row)=>f.id===fid);updates.push({field:fid,value:option(field??{},args.value)});patch[args.kind==='stage'?'stage':args.kind]=args.value;if(args.kind==='service')patch.dwy=/dwy/i.test(args.value);}
 }else if(args.kind==='left'){Object.assign(patch,{level:'blue',rank:45,todo:'Left: '+(args.reason??args.note??'reason logged')});}
 if(args.department||args.kind==='ticket'){
  const list=DEPARTMENTS[args.department];if(!list)throw Error('Choose a supported department');
  ticket={list,name:context.clientName+' - '+args.action,description:['Requested by Client Success.','Client: '+context.clientName,'Why: '+context.evidence,(args.note??args.reason)?'Note: '+(args.note??args.reason):'','Client task: https://app.clickup.com/t/'+context.taskId].filter(Boolean).join('\n'),due_date:args.due??day(nextDay(nextDay(context.day)))};
  const label=REQUEST_TYPES[args.action];if(label){const defs=await provider.call('GET','list/'+list+'/field');const f=(defs.fields??[]).find((f:Row)=>f.id===REQUEST_FIELD);ticket.fieldValue=option(f??{},label);}
 }
 return {operation,context,args,patch,updates,ticket,tasks:[]};
}
function fieldMatches(task:Row,field:string,expected:unknown){const f=(task.custom_fields??[]).find((f:Row)=>f.id===field);if(!f)return false;if(String(f.value)===String(expected))return true;const o=(f.type_config?.options??[]).find((o:Row)=>String(o.id)===String(expected));return o&&o.orderindex!==undefined&&String(o.orderindex)===String(f.value);}
async function createTask(provider:Provider,list:string,body:Row){const created=await provider.call('POST','list/'+list+'/task',body);const taskId=id(created.id),actual=await provider.call('GET','task/'+taskId);if(String(actual.id)!==taskId||String(actual.list?.id)!==list||actual.name!==body.name||(body.due_date!==undefined&&(!actual.due_date||new Date(Number(actual.due_date)+10800000).toISOString().slice(0,10)!==new Date(Number(body.due_date)+10800000).toISOString().slice(0,10))))throw Error('Created task read-back did not match. Reconcile before retrying.');return {id:taskId,url:actual.url||'https://app.clickup.com/t/'+taskId};}
export async function executeCsm(plan:Awaited<ReturnType<typeof prepareCsm>>,provider:Provider){
 if(plan.operation==='plan'){const tasks=[];for(const body of plan.tasks)tasks.push(await createTask(provider,'901816723211',body));return {result:{ok:true,tasks},patch:{}};}
 const taskId=id(plan.context.taskId);for(const update of plan.updates)await provider.call('POST',`task/${taskId}/field/${update.field}`,{value:update.value});
 if(plan.updates.length){const actual=await provider.call('GET','task/'+taskId);if(!plan.updates.every(u=>fieldMatches(actual,u.field,u.value)))throw Error('Client field read-back did not match. Reconcile before retrying.');}
 let ticket:Row|null=null;if(plan.ticket){const {list,fieldValue,...body}=plan.ticket;ticket=await createTask(provider,list,body);if(fieldValue!==undefined){await provider.call('POST',`task/${ticket.id}/field/${REQUEST_FIELD}`,{value:fieldValue});if(!fieldMatches(await provider.call('GET','task/'+ticket.id),REQUEST_FIELD,fieldValue))throw Error('Ticket request type was not confirmed. Reconcile before retrying.');}}
 const text=[plan.args.kind==='call'?'Call logged':plan.args.kind==='touchpoint'?'Touchpoint logged':plan.args.action,'Client: '+plan.context.clientName,'Why: '+plan.context.evidence,(plan.args.note??plan.args.reason)?'Note: '+(plan.args.note??plan.args.reason):'',plan.args.snooze?'Check again: '+plan.args.snooze:'',ticket?'Task created: '+ticket.url:''].filter(Boolean).join('\n');
 const comment=await provider.call('POST','task/'+taskId+'/comment',{comment_text:text,notify_all:false});const commentId=String(comment.id??comment.comment?.id??'');if(!commentId)throw Error('Comment identity was not confirmed');
 const comments=await provider.call('GET','task/'+taskId+'/comment');if(!(comments.comments??[]).some((c:Row)=>String(c.id)===commentId&&(c.comment_text??(c.comment??[]).map((x:Row)=>x.text??'').join(''))===text))throw Error('Comment read-back was not confirmed. Reconcile before retrying.');
 return {result:{ok:true,commentId,...(ticket?{ticketId:ticket.id,ticketUrl:ticket.url}:{})},patch:plan.patch};
}
