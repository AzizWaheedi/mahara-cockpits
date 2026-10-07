import {providerTools} from './tools.ts';
export interface WhatsappRpcClient {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid WhatsApp response.');return value as Record<string,unknown>;};
const text=(value:unknown,field:string):string=>{if(typeof value!=='string'||!value.trim())throw new Error(`The ${field} is missing.`);return value;};
async function rpc(client:WhatsappRpcClient,name:string,args:Record<string,unknown>){
 const {data,error}=await client.rpc(name,args);
 if(error){const details=object(error);throw new Error(typeof details.message==='string'?details.message:'The native WhatsApp operation was rejected.');}
 return data;
}
export async function executeWhatsappReply(user:WhatsappRpcClient,admin:WhatsappRpcClient,input:unknown,env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 const args=object(input),app=text(args.app,'cockpit app'),thread=text(args.chatId,'conversation ID'),body=text(args.text,'reply');
 if(!['media-buyer','client-success','creative'].includes(app)||body.length>4000)throw new Error('Choose a supported cockpit and a reply of at most 4000 characters.');
 const apply=args.apply===true;
 const requestId=apply?text(args.requestId,'original reply ID'):typeof args.requestId==='string'?args.requestId:crypto.randomUUID();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))throw new Error('A stable UUID reply ID is required.');
 const contextKey=apply?text(args.contextKey,'reviewed conversation context'):typeof args.contextKey==='string'?args.contextKey:'';
 const begun=object(await rpc(user,'cockpit_wa_reply_begin',{p_app:app,p_thread:thread,p_body:body,p_context_key:contextKey,p_request_id:requestId,p_apply:apply}));
 if(!apply){if(begun.dryRun!==true||begun.ok!==false)throw new Error('The native WhatsApp dry-run result is invalid.');return {ok:false,dryRun:true};}
 if(begun.id!==requestId)throw new Error('The reply intent did not return its original ID.');
 if(begun.state==='accepted'||begun.state==='delivered'){
  const receipt=object(begun.receipt);return {ok:true,id:requestId,state:begun.state,providerMessageId:text(receipt.messageId,'provider receipt'),deliveryConfirmed:begun.state==='delivered'};
 }
 if(begun.state!=='new')throw new Error('The original reply has no confirmed outcome. Reconcile it before retrying. Nothing was resent.');
 const token=text(begun.claimToken,'reply claim'),context=object(begun.context);
 let providerCalled=false;
 try{
  if(!env('GHL_MAHARA_PIT'))throw new Error('Configure GHL_MAHARA_PIT before submitting a WhatsApp reply.');
  const location=env('GHL_MAHARA_LOCATION');if(!location||location!==context.locationId)throw new Error('Verify GHL_MAHARA_LOCATION against the recorded WhatsApp conversation before submitting.');
  await rpc(admin,'cockpit_wa_reply_guard',{p_id:requestId,p_token:token});
  const provider=providerTools(env,receipt=>rpc(admin,'cockpit_wa_health',{p_id:requestId,p_token:token,p_receipt:receipt}).then(()=>undefined),async(input,init)=>{
   await rpc(admin,'cockpit_wa_reply_guard',{p_id:requestId,p_token:token});providerCalled=true;return request(input,init);
  });
  const response=await provider.call('ghl','POST','conversations/messages',{type:'Custom',contactId:text(context.contactId,'verified contact'),conversationProviderId:text(context.providerId,'verified custom provider'),message:body,status:'pending'});
  const receipt={conversationId:text(response.conversationId,'provider conversation'),messageId:text(response.messageId,'provider message')};
  const recorded=object(await rpc(admin,'cockpit_wa_reply_accepted',{p_id:requestId,p_token:token,p_receipt:receipt}));
  if(recorded.state!=='accepted')throw new Error('GHL accepted the reply, but the conversation or access changed. Reconcile the private receipt.');
  return {ok:true,id:requestId,state:'accepted',providerMessageId:receipt.messageId,deliveryConfirmed:false};
 }catch(error){
  try{await rpc(admin,'cockpit_wa_reply_failed',{p_id:requestId,p_token:token,p_unknown:providerCalled});}catch{}
  if(!providerCalled)throw error;
  throw new Error('The WhatsApp provider outcome needs reconciliation. Retain the original reply ID. Nothing will be sent again automatically.');
 }
}
