import {z} from 'zod';
import {CLIENT_ACCOUNT} from '../../../apps/client-success-cockpit/src/lib/checkInCore.ts';
import {ghlTools} from './tools.ts';

// The CEO's read-only check that the WhatsApp bridge runs on the number the client
// success lead uses now: the newest conversation's last five messages, reduced to
// their type, direction, provider prefix and the last 4 digits of each number.
// No message text, name, contact or conversation ID leaves this function.
type RpcClient={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>};
type Admin={from:(table:string)=>any};
export class WhatsappProbeAccessError extends Error {}
const object=z.record(z.string(),z.unknown());
const last4=(value:unknown)=>{const digits=typeof value==='string'?value.replace(/\D/g,''):'';return digits.length>=4?digits.slice(-4):null;};
const word=(value:unknown)=>typeof value==='string'&&value?value.slice(0,40):null;
export async function runWhatsappProbe(client:RpcClient,admin:Admin,env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 const ceo=await client.rpc('cockpit_is_ceo',{});
 if(ceo.error||ceo.data!==true)throw new WhatsappProbeAccessError('Only the CEO can run the WhatsApp probe.');
 const location=env('GHL_MAHARA_LOCATION');
 if(location!==CLIENT_ACCOUNT)throw Error('The Mahara Media client account is not configured for WhatsApp.');
 const health=async(row:Record<string,unknown>)=>{const saved=await admin.from('cockpit_csm_provider_health').insert({...row,action_id:null});if(saved.error)throw Error('Provider health could not be saved. The probe stopped.');};
 const ghl=ghlTools(env('GHL_MAHARA_PIT')??'',health,request);
 const search=object.parse(await ghl.call('GET',`conversations/search?locationId=${encodeURIComponent(location)}&limit=1&sort=desc&sortBy=last_message_date`));
 const newest=z.array(z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)}).passthrough()).max(1).parse(search.conversations??[])[0];
 const checkedAt=new Date().toISOString();
 if(!newest)return {ok:true,checkedAt,messages:[],note:'GoHighLevel has no conversation in the client account.'};
 const page=object.parse(await ghl.call('GET',`conversations/${newest.id}/messages?limit=5`));
 const raw=page.messages,list=Array.isArray(raw)?raw:raw&&typeof raw==='object'&&Array.isArray((raw as Record<string,unknown>).messages)?(raw as Record<string,unknown>).messages as unknown[]:null;
 if(!list)throw Error('GoHighLevel returned no message page. Nothing was changed.');
 const messages=list.slice(0,5).map(item=>{const m=object.parse(item);return {messageType:word(m.messageType),direction:m.direction==='inbound'||m.direction==='outbound'?m.direction:null,providerPrefix:typeof m.conversationProviderId==='string'&&m.conversationProviderId?m.conversationProviderId.slice(0,6):null,fromLast4:last4(m.from),toLast4:last4(m.to)};});
 return {ok:true,checkedAt,messages,note:messages.length?null:'The newest conversation has no messages.'};
}
