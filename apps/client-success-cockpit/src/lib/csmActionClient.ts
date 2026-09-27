import type {SupabaseClient} from '@supabase/supabase-js';
const pending=new Map<string,string>();
export async function executeCsmAction(client:SupabaseClient|null,operation:'act'|'plan',args:Record<string,unknown>){
 if(!client)throw Error('Client-success sign-in is required');
 const {data:auth}=await client.auth.getSession();const actor=auth.session?.user.id;if(!actor)throw Error('Client-success sign-in is required');
 const key=actor+':'+operation+':'+JSON.stringify(args);const requestId=pending.get(key)??crypto.randomUUID();pending.set(key,requestId);
 const {data,error}=await client.functions.invoke('cockpit-csm-api',{body:{operation,args,requestId,apply:true}});
 if(error||data?.error){let detail=data?.error;if(!detail&&typeof (error as any)?.context?.json==='function')try{detail=(await (error as any).context.json())?.error;}catch{}throw Error(detail??error?.message??'Client-success action failed');}
 if(data?.ok!==true||typeof data.receiptId!=='string')throw Error('ClickUp did not confirm this action');pending.delete(key);return data;
}
