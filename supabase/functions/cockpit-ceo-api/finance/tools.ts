// The browser cannot supply SQL. Only the bundled finance adapters call this helper.
export function financeSources(token:string,health:(row:Record<string,unknown>)=>Promise<void>,request:typeof fetch=fetch){
 if(!token)throw Error('COCKPIT_MANAGEMENT_TOKEN is not configured');
 return async(project:string,query:string)=>{
  if(!['flwboeijllbtrufxkhts','bldgtotkfmhoxmlzowdx'].includes(project)||!/^\s*(select|with)\b/i.test(query)||query.includes(';'))throw Error('Finance source query is not allowed');
  const receipt={provider:'supabase-read-only',method:'POST',resource:'database/query/'+project};
  await health({...receipt,phase:'intent'});
  let response:Response;
  try{response=await request(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:`SELECT coalesce(jsonb_agg(row_to_json(finance_row)), '[]'::jsonb) AS rows, count(*) AS row_count FROM (${query}) finance_row`,read_only:true}),signal:AbortSignal.timeout(30000)});}catch{await health({...receipt,phase:'failed'});throw Error('Finance source request failed');}
  await health({...receipt,phase:'response',http_status:response.status});
  if(!response.ok)throw Error(`Read-only finance source returned ${response.status}`);
  const data=await response.json(),row=Array.isArray(data)?data[0]:null;
  if(!row||!Array.isArray(row.rows)||Number(row.row_count)!==row.rows.length)throw Error('Finance source row count was not confirmed');
  return row.rows;
 };
}
