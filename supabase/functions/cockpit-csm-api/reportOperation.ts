import {runReport} from './report.ts';
type Row=Record<string,any>;
export class ReportAccessError extends Error {}
const canonical=(v:any):string=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,JSON.parse(canonical(v[k]))]))):v);

export async function runReportOperation(client:any,admin:any,input:Row,env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 const {data:user,error:authError}=await client.auth.getUser();
 if(authError||!user?.user)throw new ReportAccessError('Sign in first');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId??''))throw Error('A report request id is required');
 const {data:begin,error}=await client.rpc('cockpit_csm_report_begin',{p_args:input.args??{},p_request_id:input.requestId,p_apply:input.apply===true});
 if(error){if(error.code==='42501')throw new ReportAccessError(error.message);throw Error(error.message);}
 if(!begin||typeof begin.state!=='string')throw Error('Report intent could not be verified');
 if(begin.state==='dry_run')return {dryRun:true,willCreateDocument:true,liveWrites:0};
 if(begin.state==='confirmed'){
  if(begin.result?.ok!==true||typeof begin.result?.docUrl!=='string')throw Error('The saved report receipt is incomplete');
  return {...begin.result,id:begin.id,status:'ready'};
 }
 if(begin.state!=='new')return {ok:false,state:begin.state,retrySafe:begin.state==='failed',error:begin.state==='failed'?'The report failed before document creation. Review its provider receipt.':'This report may already exist. Reconcile the original request before creating another copy.'};
 if(begin.context?.actorId!==user.user.id)throw new ReportAccessError('Report actor does not match this sign-in');
 const scopeCheck=async()=>{
  const {data:fresh,error:scopeError}=await client.rpc('cockpit_csm_report_context',{p_args:input.args??{}});
  if(scopeError||canonical(fresh)!==canonical(begin.context))throw new ReportAccessError('Report access or source changed. Reconcile the original request.');
 };
 const result=await runReport(admin,begin.id,begin.context,input.args??{},env,scopeCheck,request);
 return {...result,id:begin.id,status:result.ok===true?'ready':'unavailable'};
}
