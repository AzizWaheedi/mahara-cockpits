import {googleTools} from './google.ts';
import {prepareReport,profileForReport,writeReportDocument,narrativePrompt,NARRATIVE_SCHEMA,storyFromResult} from './reportFormatter.ts';
import {structuredJson} from '../cockpit-media-api/model.ts';
type Row=Record<string,any>;
async function permissionsFor(google:(url:string,init?:RequestInit)=>Promise<Row>,file:string):Promise<Row[]>{
 const rows:Row[]=[];const seen=new Set<string>();let token='';
 for(let page=0;page<100;page++){
  const data=await google('https://www.googleapis.com/drive/v3/files/'+file+'/permissions?supportsAllDrives=true&pageSize=100&fields=nextPageToken,permissions(id,type,emailAddress,role,deleted)'+(token?'&pageToken='+encodeURIComponent(token):''));
  if(!Array.isArray(data.permissions))throw Error('Report permissions are unavailable');rows.push(...data.permissions);
  if(data.nextPageToken===undefined)return rows;
  if(typeof data.nextPageToken!=='string'||!data.nextPageToken||seen.has(data.nextPageToken))throw Error('Report permission pagination is incomplete');
  token=data.nextPageToken;seen.add(token);
 }
 throw Error('Report permission pagination exceeded its review limit');
}
export function verifyReportAudience(permissions:Row[],approved:Set<string>){
 const active=permissions.filter(p=>p.deleted!==true);
 if(!active.length||active.some(p=>p.type!=='user'||typeof p.emailAddress!=='string'||!approved.has(p.emailAddress.trim().toLowerCase())||!['owner','organizer','fileOrganizer','writer','commenter','reader'].includes(p.role)))throw Error('The reports folder or document has unapproved recipients. Use a folder shared only with the confirmed report staff.');
}
export async function runReport(admin:any,id:string,context:Row,args:Row,env:(name:string)=>string|undefined,scopeCheck:()=>Promise<void>,request:typeof fetch=fetch){
 let attemptedCreate=false;let docId:string|undefined;
 const health=async(row:Row)=>{if(row.phase==='intent')await scopeCheck();const {error}=await admin.from('cockpit_csm_provider_health').insert({...row,action_id:id});if(error)throw Error('Report provider receipt could not be saved');};
 const checkpoint=async(data:Row)=>{const {error}=await admin.from('cockpit_csm_actions').update({result:data}).eq('id',id).eq('state','sending');if(error)throw Error('Report checkpoint could not be saved');};
 try{
  await scopeCheck();const profile=profileForReport(context.profile,args);
  const folder=env('CSM_REPORTS_FOLDER_ID');if(!folder||!/^[-_A-Za-z0-9]{10,}$/.test(folder))throw Error('CSM_REPORTS_FOLDER_ID must name the verified internal reports folder');
  let serviceEmail:string;try{const sa=JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON')??'');if(typeof sa.client_email!=='string'||!/^\S+@\S+\.\S+$/.test(sa.client_email))throw Error();serviceEmail=sa.client_email.trim().toLowerCase();}catch{throw Error('The report service-account identity is unavailable');}
  const writers=[...new Set(['aziz@maharamedia.com','abdulelah@maharamedia.com',context.email])];
  if(writers.some(email=>typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)))throw Error('The confirmed report staff identity is unavailable');
  const approved=new Set([...writers.map(email=>email.trim().toLowerCase()),serviceEmail]);
  const google=await googleTools(env,health,request);
  const folderMeta=await google('https://www.googleapis.com/drive/v3/files/'+folder+'?supportsAllDrives=true&fields=id,mimeType,capabilities(canAddChildren)');if(folderMeta.mimeType!=='application/vnd.google-apps.folder'||folderMeta.capabilities?.canAddChildren!==true)throw Error('The service account cannot write the internal reports folder');
  const folderAccess=await permissionsFor(google,folder);verifyReportAudience(folderAccess,approved);
  let story:{means:string;next:string[]}|undefined;
  const hasModel=['ANTHROPIC_API_KEY','OPENAI_API_KEY','GOOGLE_AI_API_KEY','DEEPSEEK_API_KEY'].some(key=>env(key));
  if(hasModel){const raw=await structuredJson(narrativePrompt(profile,args.language==='ar'?'ar':'en',args.note),NARRATIVE_SCHEMA,env,health,request);story=storyFromResult(raw)??undefined;if(!story)throw Error('Report narrative was not usable');}
  else if(args.language==='ar')throw Error('An approved model key is required for the Arabic report narrative');
  const plan=prepareReport(profile,args,story);await scopeCheck();
  await checkpoint({phase:'prepared',title:plan.title,period:plan.period});
  attemptedCreate=true;
  const file=await google('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name',{method:'POST',body:JSON.stringify({name:plan.title,mimeType:'application/vnd.google-apps.document',parents:[folder],appProperties:{cockpitRequestId:id,cockpitClient:context.clientName}})});
  if(typeof file.id!=='string'||!/^[-_A-Za-z0-9]{10,}$/.test(file.id))throw Error('Google did not confirm the created document identity');const confirmedDocId:string=file.id;docId=confirmedDocId;
  const docUrl='https://docs.google.com/document/d/'+docId+'/edit';await checkpoint({phase:'created',docId,docUrl,title:plan.title,period:plan.period});
  const content=await writeReportDocument(google,confirmedDocId,plan);await checkpoint({phase:'written',docId,docUrl,title:plan.title,period:plan.period,characters:content.characters});await scopeCheck();
  for(const email of writers)await google('https://www.googleapis.com/drive/v3/files/'+docId+'/permissions?sendNotificationEmail=false&supportsAllDrives=true',{method:'POST',body:JSON.stringify({role:'writer',type:'user',emailAddress:email})});
  const access=await permissionsFor(google,confirmedDocId);verifyReportAudience(access,approved);
  if(!writers.every(email=>access.some((p:Row)=>p.type==='user'&&String(p.emailAddress).toLowerCase()===email.toLowerCase()&&['writer','owner','organizer'].includes(p.role))))throw Error('Report writer permissions were not confirmed');
  const result={ok:true,docId,docUrl,title:plan.title,period:plan.period,contentReadbackVerified:true,sharingVerified:true};
  const {data:receipt,error}=await admin.rpc('cockpit_csm_report_finish',{p_id:id,p_result:result});if(error)throw Error('Report exists, but its local confirmation failed');return receipt;
 }catch(error){const message=error instanceof Error?error.message:'Report generation failed';const state=attemptedCreate?'reconcile':'failed';const {error:save}=await admin.from('cockpit_csm_actions').update({state,error:message.slice(0,1500),finished_at:new Date().toISOString()}).eq('id',id).eq('state','sending');if(save)throw Error('Report failure receipt could not be saved');return {ok:false,error:message,docId,state,retrySafe:!attemptedCreate};}
}
