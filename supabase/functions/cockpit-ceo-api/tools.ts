// This credential is read-only. The host and resources are fixed; no mutation API exists.
export async function payerSources(env:(name:string)=>string|undefined,health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch){
 const key=env('B2B_READ_ONLY_KEY');if(!key)throw Error('B2B_READ_ONLY_KEY is not configured');
 const token:string=key;
 async function rows(resource:string,query:string){
  const out:any[]=[];let total:number|null=null;
  for(let offset=0;offset<100000;offset+=1000){
   const receipt={provider:'b2b',method:'GET',resource};await health({...receipt,phase:'intent'});
   let response:Response;
   try{response=await request(`https://flwboeijllbtrufxkhts.supabase.co/rest/v1/${resource}?${query}&offset=${offset}&limit=1000`,{method:'GET',headers:{apikey:token,Authorization:`Bearer ${token}`,Prefer:'count=exact'},signal:AbortSignal.timeout(25000)});}catch{await health({...receipt,phase:'failed'});throw Error('B2B payer source could not be reached');}
   await health({...receipt,phase:'response',http_status:response.status});
   if(!response.ok)throw Error(`B2B payer source returned ${response.status}`);
   const countText=response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
   const count=countText===undefined?NaN:Number(countText);
   if(!Number.isSafeInteger(count)||count<0)throw Error('B2B payer source did not confirm its row count');
   if(total!==null&&count!==total)throw Error('B2B payer source changed during the read; refresh again');total=count;
   const batch=await response.json();if(!Array.isArray(batch))throw Error('Invalid B2B payer source response');out.push(...batch);
   if(out.length===total){const ids=out.map(r=>String(resource==='whop_payments'?r.payment_id:r.record_id));if(new Set(ids).size!==ids.length||ids.includes('undefined'))throw Error('B2B payer rows changed during pagination');return out;}
   if(batch.length!==1000||out.length>total)throw Error('B2B payer source was incomplete');
  }
  throw Error('B2B payer source exceeds the safe read limit');
 }
 const payments=await rows('whop_payments','select=payment_id,billing_name,user_email,net_amount,paid_on,deal_response_id&status=eq.paid&order=payment_id');
 const voids=await rows('record_voids','select=record_id&entity=eq.closed_deal&order=record_id');
 return {payments,voids};
}
