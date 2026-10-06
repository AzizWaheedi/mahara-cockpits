import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const instant=z.number().finite().nonnegative().nullable();
const text=z.string().nullable().optional();
const source=z.object({source:z.string(),label:z.string(),ok:z.boolean(),lastError:text,at:instant,maxAgeMin:z.number().int().positive().nullable(),fix:z.string()});
const action=z.object({at:instant,ok:z.boolean(),note:z.string()});
const member=z.object({id:z.string().uuid(),auth_user_id:z.string().uuid().nullable(),email:z.string(),name:text,note:text,
 roles:z.array(z.string()),clients:z.array(z.string()),active:z.boolean(),auth_confirmed:z.boolean(),sales_role:z.enum(['setter','closer','both','manager']).nullish(),
 last_seen_at:z.string().datetime({offset:true}).nullish(),last_cockpit:text}).passthrough().transform(row=>({
  ...row,salesRole:row.sales_role??undefined,lastSeenAt:row.last_seen_at?Date.parse(row.last_seen_at):undefined,lastCockpit:row.last_cockpit??undefined,
 }));
export const adminOverviewSchema=z.object({
 health:z.array(z.object({app:z.string(),ok:z.boolean(),at:instant,failing:z.array(z.string())})),
 sources:z.array(source),scheduled:z.array(z.object({job:z.string(),key:z.string(),at:instant,maxAgeMin:z.number().int().positive().nullable(),ms:instant,ok:z.boolean(),error:text})),
 counts:z.object({members:z.number().int().nonnegative(),admins:z.number().int().nonnegative(),clients:instant,campaigns:instant,liveCampaigns:instant}),
 lastSync:z.object({at:instant,ok:z.boolean(),problems:z.array(z.string())}).nullable(),
 hermes:z.object({queued:z.number().int().nonnegative(),claimed:z.number().int().nonnegative(),doneToday:z.number().int().nonnegative(),lastDone:instant,actions:z.array(action)}).nullable(),
 hermesWaiting:z.object({queued:z.number().int().nonnegative(),claimed:z.number().int().nonnegative()}).nullable(),
 alerts:z.array(z.object({at:instant,text:z.string()})),activity:z.array(z.object({id:z.string().uuid(),action:z.string(),entity:z.string(),actor:text,at:instant})),
 members:z.array(member),clientNames:z.array(z.string()).nullable(),clientError:text,checkedAt:z.number().finite().nonnegative(),scheduleNote:z.string(),
});
export type AdminOverview=z.infer<typeof adminOverviewSchema>;

export async function fetchAdminOverview(client:SupabaseClient,expectedActor:string):Promise<AdminOverview>{
 let changed=false;
 const subscription=client.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==expectedActor)changed=true;}).data.subscription;
 try{
  const {data:actor,error:authError}=await client.auth.getUser();
  if(changed||authError||actor.user?.id!==expectedActor||!actor.user.email_confirmed_at)throw new Error('A current confirmed admin sign-in is required. Reload the portal.');
  const {data,error}=await client.rpc('cockpit_admin_overview');
  const {data:current,error:sessionError}=await client.auth.getSession();
  if(changed||sessionError||current.session?.user.id!==expectedActor)throw new Error('The account changed. The prior admin response was discarded.');
  if(error)throw new Error(error.message);
  return adminOverviewSchema.parse(data);
 }finally{subscription.unsubscribe();}
}
type ReadState={actor:string|null;data:AdminOverview|null;loading:boolean;error:string|null};
export function useNativeAdminData(client:SupabaseClient|null,actorId:string|null|undefined){
 const [state,setState]=useState<ReadState>({actor:null,data:null,loading:false,error:null});
 const actor=actorId??null;
 const current=useRef(actor);current.current=actor;
 const generation=useRef(0);
 const refetch=useCallback(async()=>{
  if(!client||!actor)return;
  const request=++generation.current;
  setState(prior=>({actor,data:prior.actor===actor?prior.data:null,loading:true,error:null}));
  try{
   const data=await fetchAdminOverview(client,actor);
   if(current.current===actor&&generation.current===request)setState({actor,data,loading:false,error:null});
  }catch(error){
   if(current.current===actor&&generation.current===request)setState({actor,data:null,loading:false,error:error instanceof Error?error.message:'The native admin read failed.'});
  }
 },[client,actor]);
 useEffect(()=>{void refetch();return()=>{generation.current++;};},[refetch]);
 const visible=state.actor===actor?state:null;
 const overview=visible?.data??null;
 const loading=Boolean(client&&actor)&&(!visible||visible.loading);
 const error=visible?.error??null;
 return {overview,overviewLoading:loading,overviewError:error,members:overview?.members??null,membersLoading:loading,membersError:error,
  clients:overview?.clientNames??null,clientsError:error??overview?.clientError??null,refetch};
}
