import {googleTools} from './google.ts';
import {prepareReport,writeReportDocument,narrativePrompt,NARRATIVE_SCHEMA,storyFromResult} from './reportFormatter.ts';
import {structuredJson} from '../cockpit-media-api/model.ts';
type Row=Record<string,any>;
export async function runReport(admin:any,id:string,context:Row,args:Row,env:(name:string)=>string|undefined,scopeCheck:()=>Promise<void>,request:typeof fetch=fetch){
 let attemptedCreate=false;let docId:string|undefined;
 const health=async(row:Row)=>{const {error}=await admin.from('cockpit_csm_provider_health').insert({...row,action_id:id});if(error)throw Error('Report provider receipt could not be saved');};
 const checkpoint=async(data:Row)=>{const {error}=await admin.from('cockpit_csm_actions').update({result:data}).eq('id',id).eq('state','sending');if(error)throw Error('Report checkpoint could not be saved');};
 try{
  const folder=env('CSM_REPORTS_FOLDER_ID');if(!folder||!/^[-_A-Za-z0-9]{10,}$/.test(folder))throw Error('CSM_REPORTS_FOLDER_ID must name the verified internal reports folder');
  const google=await googleTools(env,health,request);
  const folderMeta=await google('https://www.googleapis.com/drive/v3/files/'+folder+'?supportsAllDrives=true&fields=id,mimeType,capabilities(canAddChildren)');if(folderMeta.mimeType!=='application/vnd.google-apps.folder'||folderMeta.capabilities?.canAddChildren!==true)throw Error('The service account cannot write the internal reports folder');
  const folderAccess=await google('https://www.googleapis.com/drive/v3/files/'+folder+'/permissions?supportsAllDrives=true&fields=permissions(type,domain)');
  if((folderAccess.permissions??[]).some((p:Row)=>p.type==='anyone'||(p.type==='domain'&&p.domain!=='maharamedia.com')))throw Error('The reports folder is public or shared outside the agency');
  let story:{means:string;next:string[]}|undefined;
  const hasModel=['ANTHROPIC_API_KEY','OPENAI_API_KEY','GOOGLE_AI_API_KEY','DEEPSEEK_API_KEY'].some(key=>env(key));
  if(hasModel){const raw=await structuredJson(narrativePrompt(context.profile,args.language==='ar'?'ar':'en',args.note),NARRATIVE_SCHEMA,env,health,request);story=storyFromResult(raw)??undefined;if(!story)throw Error('Report narrative was not usable');}
  else if(args.language==='ar')throw Error('An approved model key is required for the Arabic report narrative');
  const plan=prepareReport(context.profile,args,story);await scopeCheck();
  await checkpoint({phase:'prepared',title:plan.title,period:plan.period});
  attemptedCreate=true;
  const file=await google('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name',{method:'POST',body:JSON.stringify({name:plan.title,mimeType:'application/vnd.google-apps.document',parents:[folder],appProperties:{cockpitRequestId:id,cockpitClient:context.clientName}})});
  if(typeof file.id!=='string'||!/^[-_A-Za-z0-9]{10,}$/.test(file.id))throw Error('Google did not confirm the created document identity');docId=file.id;
  const docUrl='https://docs.google.com/document/d/'+docId+'/edit';await checkpoint({phase:'created',docId,docUrl,title:plan.title,period:plan.period});
  const content=await writeReportDocument(google,docId,plan);await checkpoint({phase:'written',docId,docUrl,title:plan.title,period:plan.period,characters:content.characters});await scopeCheck();
  const writers=[...new Set(['aziz@maharamedia.com','abdulelah@maharamedia.com',context.email])];
  for(const email of writers)await google('https://www.googleapis.com/drive/v3/files/'+docId+'/permissions?sendNotificationEmail=false&supportsAllDrives=true',{method:'POST',body:JSON.stringify({role:'writer',type:'user',emailAddress:email})});
  const access=await google('https://www.googleapis.com/drive/v3/files/'+docId+'/permissions?supportsAllDrives=true&fields=permissions(type,emailAddress,role)');
  if(!writers.every(email=>(access.permissions??[]).some((p:Row)=>p.type==='user'&&String(p.emailAddress).toLowerCase()===email.toLowerCase()&&['writer','owner','organizer'].includes(p.role))))throw Error('Report writer permissions were not confirmed');
  if((access.permissions??[]).some((p:Row)=>p.type==='anyone'))throw Error('Report unexpectedly has public access');
  const result={ok:true,docId,docUrl,title:plan.title,period:plan.period,renderVerified:true,sharingVerified:true};
  const {error}=await admin.rpc('cockpit_finish_csm_action',{p_id:id,p_result:result,p_patch:{}});if(error)throw Error('Report exists, but its local confirmation failed');return result;
 }catch(error){const message=error instanceof Error?error.message:'Report generation failed';const {error:save}=await admin.from('cockpit_csm_actions').update({state:attemptedCreate?'reconcile':'failed',error:message.slice(0,1500),finished_at:new Date().toISOString()}).eq('id',id).eq('state','sending');if(save)throw Error('Report failure receipt could not be saved');return {ok:false,error:message,docId};}
}
