export type SourceSets=Record<string,Record<string,any>[]>;
type Row=Record<string,any>;
const norm=(value:unknown)=>typeof value==='string'?value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim():'';
export class CreativeScopeError extends Error {
 constructor(readonly table:string,readonly sourceId:string,readonly reason:'missing'|'ambiguous'){super(`${table}/${sourceId}: ${reason} client assignment`);}
}
/** Exact name/alias matches only. Never turn a shared industry word into an assignment. */
export function sourceClientNames(table:string,row:Row,sets:SourceSets):string[]{
 const id=String(row._id??'missing-id');const roster=sets.clients;
 if(!Array.isArray(roster))throw new Error('The complete client roster is required');
 const resolve=(references:unknown[],allowMany=false):string[]=>{
  const resolved=new Set<string>();
  for(const ref of references){
   const key=norm(ref);if(!key)continue;
   const names=[...new Set(roster.filter(c=>[c.name,...(Array.isArray(c.aliases)?c.aliases:[])].some(n=>norm(n)===key)).map(c=>c.name))];
   if(names.length>1)throw new CreativeScopeError(table,id,'ambiguous');
   if(names.length===1)resolved.add(names[0]);
  }
  if(resolved.size===0)throw new CreativeScopeError(table,id,'missing');
  if(!allowMany&&resolved.size!==1)throw new CreativeScopeError(table,id,'ambiguous');
  return [...resolved].sort();
 };
 if(table==='clients')return resolve([row.name]);
 // These are explicitly cross-client creative examples in the existing product.
 if(table==='winnersArchive'||table==='marketPlays')return [];
 if(['creativeTasks','videoJobs','contentPosts','touchLog','blueprints'].includes(table)){
  const refs=[...(Array.isArray(row.clients)?row.clients:[]),row.client].filter(x=>typeof x==='string'&&x.trim());
  if(!refs.length)return []; // Source explicitly unassigned: unrestricted staff only.
  // Every tagged client must resolve; dropping an unknown tag could widen a shared task's scope.
  const names=refs.flatMap(ref=>resolve([ref],true));
  return [...new Set(names)].sort();
 }
 if(table==='campaigns')return resolve([row.clientName,row.accountName,row.clientTag]);
 if(table==='ads'||table==='metaTree'){
  const campaigns=(sets.campaigns??[]).filter(c=>typeof row.campaignName==='string'&&c.campaignName===row.campaignName);
  const names=[...new Set(campaigns.flatMap(c=>sourceClientNames('campaigns',c,sets)))];
  if(names.length!==1)throw new CreativeScopeError(table,id,names.length?'ambiguous':'missing');return names;
 }
 if(table==='funnels'){
  const account=norm(row.account);
  const campaigns=(sets.campaigns??[]).filter(c=>account&&[c.accountName,c.metaAccountId].some(v=>norm(v)===account));
  if(campaigns.length){const names=[...new Set(campaigns.flatMap(c=>sourceClientNames('campaigns',c,sets)))];if(names.length!==1)throw new CreativeScopeError(table,id,'ambiguous');return names;}
  return resolve([row.account]);
 }
 throw new Error(`Unsupported creative source: ${table}`);
}
