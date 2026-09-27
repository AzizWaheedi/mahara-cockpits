import {computeFinance} from './finance/compute.ts';
import {financeContext} from './finance/context.ts';
import {financeSources} from './finance/tools.ts';
export async function runFinanceRefresh(admin:any,id:string,env:(name:string)=>string|undefined){
 try{
  const {data:source,error}=await admin.rpc('cockpit_finance_refresh_input',{p_id:id});if(error)throw Error(error.message);
  const read=financeSources(env('SUPABASE_MANAGEMENT_TOKEN')??'',async row=>{const {error}=await admin.from('cockpit_ceo_provider_health').insert({...row,refresh_id:id});if(error)throw Error('Finance source health receipt could not be saved');});
  const runtime={read,context:financeContext(source),payments:[],failures:[]};
  const output=await computeFinance(runtime);
  const {data:result,error:commitError}=await admin.rpc('cockpit_finish_finance_refresh',{p_id:id,p_output:output});
  if(commitError)throw Error(commitError.message);
  return result;
 }catch(error){
  const message=error instanceof Error?error.message:'Finance refresh failed';
  const {error:recordError}=await admin.rpc('cockpit_finish_finance_refresh',{p_id:id,p_error:message});
  if(recordError)throw Error('Finance refresh could not save its failure receipt');
  return {ok:false,error:message};
 }
}
