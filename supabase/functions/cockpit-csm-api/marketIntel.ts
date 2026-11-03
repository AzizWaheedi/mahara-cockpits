import {z} from 'zod';

// Market research (hermes/market-intel, 20261103i; contract 4.23). Three operations, each a verified sign-in and
// then the signed-in seat's own RPC, which is gated in the database: the view for the CEO, admins, creative,
// media buying and a CSM on their own clients (cockpit_csm_client_gate); run again and "Not a competitor" for the
// CEO or an admin. Every write the RPCs make leaves an audit row. Nothing here reaches a provider.
type RpcError={message:string;code?:string};
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:RpcError|null}>};
export const MARKET_INTEL_OPERATIONS=['marketIntel.view','marketIntel.rerun','marketIntel.flag'];
export class MarketIntelError extends Error{constructor(message:string,readonly status:number){super(message);}}
const task=z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const inputs={
 'marketIntel.view':z.object({taskId:task}).strict(),
 'marketIntel.rerun':z.object({taskId:task,reason:z.string().trim().min(10).max(300)}).strict(),
 'marketIntel.flag':z.object({runId:z.string().uuid(),cid:z.string().regex(/^C\d{1,2}$/),reason:z.string().trim().min(3).max(300)}).strict(),
} as const;
const calls={
 'marketIntel.view':(a:any)=>['cockpit_market_intel_view',{p_task_id:a.taskId}] as const,
 'marketIntel.rerun':(a:any)=>['cockpit_market_intel_rerun',{p_task_id:a.taskId,p_reason:a.reason}] as const,
 'marketIntel.flag':(a:any)=>['cockpit_market_intel_flag_competitor',{p_run_id:a.runId,p_cid:a.cid,p_reason:a.reason}] as const,
};
const SAYS:Record<string,string>={
 'marketIntel.view':'Choose a client.',
 'marketIntel.rerun':'Give a reason of 10 to 300 characters.',
 'marketIntel.flag':'Say in 3 to 300 characters why this is not a competitor.',
};
export async function runMarketIntel(client:RpcClient,raw:unknown){
 const input=z.object({operation:z.enum(MARKET_INTEL_OPERATIONS as [string,...string[]]),args:z.unknown()}).passthrough().safeParse(raw);
 if(!input.success)throw new MarketIntelError('Unknown market research operation.',400);
 const op=input.data.operation as keyof typeof inputs;
 const args=inputs[op].safeParse(input.data.args??{});
 if(!args.success)throw new MarketIntelError(SAYS[op],400);
 const [name,params]=calls[op](args.data);
 const {data,error}=await client.rpc(name,params);
 if(error){
  if(error.code==='PGRST202'||/Could not find the function/i.test(error.message))throw new MarketIntelError('Market research opens after the next cockpit update.',503);
  if(error.code==='42501')throw new MarketIntelError(error.message,403);
  if(error.code==='22023'||error.code==='55000')throw new MarketIntelError(error.message,400);
  throw new MarketIntelError('Market research could not be read. Try again.',400);
 }
 return data;
}
