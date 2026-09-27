import type {Plan,Row,Provider} from './core.ts';
export function prepareSlack(a:Row,scope:Row,email:string,env:(name:string)=>string|undefined):Plan{
 const request=typeof a.request==='string'?a.request.trim():'';if(request.length<5||request.length>5000)throw new Error('Write a request of 5 to 5000 characters');
 const channel=env('ALERT_SLACK_TO')??'U09305KE2KS';if(!/^[CDGU][A-Z0-9]+$/.test(channel))throw new Error('ALERT_SLACK_TO must identify the approved Slack recipient');
 const where=scope.campaignName?` (campaign: ${scope.campaignName})`:` (client: ${scope.client})`;
 const text=`Request from ${email} in the cockpit${where}: ${request}`;
 return {provider:'slack',method:'POST',path:'chat.postMessage',body:{channel,text},verifyPath:'conversations.history',expected:{text},slackMessage:true};
}
export async function prepareDetail(a:Row,scope:Row,email:string,p:Provider):Promise<Plan>{
 if(String(a.taskId)!==String(scope.task)||!/^[a-zA-Z0-9_-]+$/.test(String(scope.task)))throw new Error('Task does not match the authorized campaign');
 const question=typeof a.question==='string'?a.question.trim():'';if(question.length<5||question.length>5000)throw new Error('Write a clear question of 5 to 5000 characters');
 const task=await p.call('clickup','GET',`task/${scope.task}`);
 const body:Row={comment_text:`${email} needs more detail to move this forward:\n\n${question}\n\nReply here so the answer stays on the task.`,notify_all:true};
 if(a.assignee!==undefined){if(!Number.isInteger(a.assignee))throw new Error('Choose a valid assignee');let eligible=(task.assignees??[]).some((x:Row)=>Number(x.id)===a.assignee);if(!eligible){if(!/^\d+$/.test(String(task.list?.id??'')))throw new Error('Task workspace membership could not be verified');const members=await p.call('clickup','GET',`list/${task.list.id}/member`);eligible=(members.members??[]).some((x:Row)=>Number(x.id)===a.assignee);}if(!eligible)throw new Error('Choose a member of this task list');body.assignee=a.assignee;}
 return {provider:'clickup',method:'POST',path:`task/${scope.task}/comment`,body,verifyPath:`task/${scope.task}/comment`,expected:{comment_text:body.comment_text},clickupComment:true};
}
