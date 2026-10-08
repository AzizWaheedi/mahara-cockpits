import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withNativeContext} from './runtime';
import {daysAgo, metaRowsForMissingAccounts} from './calculator';

// Ardon, 2026-10-08: the sheet labels the account "<id>, SAR" while Meta calls
// it "Ardon", so the account looked missing and Meta's rows for days the sheet
// already had were added on top of the sheet's. Spend and leads doubled.
test('Meta fallback never re-adds an ad-day the sheet already has', async () => {
 const day=daysAgo(3),gap=daysAgo(1);
 const sheet=new Array(25).fill('');
 sheet[0]=day;sheet[1]='718146936708597, SAR';sheet[2]='Ardon_mahar-22\\9';sheet[3]='Leads';sheet[4]='45.8';sheet[5]='2';sheet[16]='120253286399830526';sheet[17]='Ad- 2';
 const insight=(date:string)=>({date_start:date,campaign_name:'Ardon_mahar-22\\9',adset_name:'Leads',ad_name:'Ad- 2',ad_id:'120253286399830526',spend:'45.8',impressions:'8257',inline_link_clicks:'43',actions:[{action_type:'lead',value:'2'}]});
 const graph=async(path:string)=>path.endsWith('_ad_accounts')
  ?{data:path.includes('owned')?[{id:'act_718146936708597',name:'Ardon',currency:'SAR',insights:{data:[{spend:'900'}]}}]:[]}
  :{data:[insight(day),insight(gap)]};
 const reads={graph,tool:async()=>null,fetch:async()=>new Response(''),log:()=>{}};
 const result=await withNativeContext(reads as any,{} as any,()=>metaRowsForMissingAccounts([sheet],daysAgo(30)));
 assert.deepEqual(result.rows.map(r=>r[0]),[gap]);
});
