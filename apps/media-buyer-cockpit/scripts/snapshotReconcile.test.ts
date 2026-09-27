import {test,expect} from 'bun:test';
import {cockpitTestDb,migration} from './lib/cockpitTestDb';
const SHA='a'.repeat(64);
test('snapshot SQL is service-only, exact CAS, audited, identity stable and preserves human work',async()=>{
 const db=await cockpitTestDb();
 try {
  await db.exec('CREATE TABLE public.clients(id uuid PRIMARY KEY);');
  const domain=migration('20260923o_cockpit_domain_tables.sql');
  for(const table of ['cockpit_campaigns','cockpit_ads']){
   const ddl=domain.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!ddl)throw new Error('Canonical table missing');await db.exec(ddl);
  }
  await db.exec('ALTER TABLE public.cockpit_campaigns ADD COLUMN human_notes text;');
  await db.exec(migration('20260927k_cockpit_snapshot_reconcile.sql'));
  const source={_id:'first',syncedAt:1790000000000,campaignName:'Campaign A',clientName:'Client A',accountName:'Account A',metaCampaignId:'123456',metaAccountId:'654321',spend7d:10};
  const after=async(s:any)=>({...((await db.query<any>(`SELECT public.cockpit_snapshot_projection('cockpit_campaigns',$1,'dep') AS r`,[s])).rows[0].r),raw_data:s,synced_at:new Date(s.syncedAt).toISOString(),source_deleted:false,source_deleted_at:null});
  let proposed=await after(source);
  const call=(expected:any,next:any,src:any,apply=false)=>db.query<any>(`SELECT public.cockpit_reconcile_snapshot('cockpit_campaigns',$1,$2,$3,$4,$5) AS result`,[expected,next,src,SHA,apply]);
  await db.exec('SET ROLE authenticated');await expect(call(null,proposed,source)).rejects.toThrow('permission');await db.exec('RESET ROLE; SET ROLE service_role');
  expect((await call(null,proposed,source)).rows[0].result.dry_run).toBe(true);
  let inserted=(await call(null,proposed,source,true)).rows[0].result.row;
  await expect(call(inserted,{...proposed,source_id:'stale-next',raw_data:{...source,_id:'stale-next'}},{...source,_id:'stale-next'},true)).rejects.toThrow('newer');
  await db.exec('RESET ROLE');expect((await db.query<any>('SELECT count(*)::int AS n FROM public.cockpit_audit_log')).rows[0].n).toBe(1);
  await db.query(`UPDATE public.cockpit_campaigns SET human_notes='Do not overwrite',updated_at='2026-01-01' WHERE id=$1`,[inserted.id]);
  let expected=(await db.query<any>('SELECT to_jsonb(t) AS r FROM public.cockpit_campaigns t')).rows[0].r;
  const newer={...source,_id:'new-id',syncedAt:1790100000000,spend7d:20};proposed=await after(newer);
  await db.exec('SET ROLE service_role');let updated=(await call(expected,proposed,newer,true)).rows[0].result.row;
  expect(updated.id).toBe(inserted.id);expect(updated.human_notes).toBe('Do not overwrite');expect(updated.spend_7d).toBe(20);
  await expect(call(expected,proposed,newer,true)).rejects.toThrow('Concurrent change');
  const snapshot={complete:true,archive_sha256:SHA,exported_at:new Date(Date.now()+1000).toISOString(),deployment:'dep',source_count:1,records:[{...newer,_id:'other',campaignName:'Other campaign',metaCampaignId:'999999'}]};
  const retire=(row:any,proof:any,apply=false)=>db.query<any>(`SELECT public.cockpit_retire_snapshot('cockpit_campaigns',$1,$2,$3,$4) AS r`,[row,proof,SHA,apply]);
  await expect(retire(updated,{...snapshot,source_count:0,records:[]})).rejects.toThrow('nonempty');
  await expect(retire(updated,{...snapshot,records:[newer]})).rejects.toThrow('still appears');
  expect((await retire(updated,snapshot)).rows[0].r.dry_run).toBe(true);
  const retired=(await retire(updated,snapshot,true)).rows[0].r.row;expect(retired.source_deleted).toBe(true);expect(retired.raw_data).toEqual(updated.raw_data);expect(retired.human_notes).toBe('Do not overwrite');
  await db.exec('RESET ROLE');const reappear={...newer,_id:'reappeared',syncedAt:Date.now()+60000};proposed=await after(reappear);
  await db.exec('SET ROLE service_role');const restored=(await call(retired,proposed,reappear,true)).rows[0].result.row;expect(restored.id).toBe(inserted.id);expect(restored.source_deleted).toBe(false);expect(restored.source_deleted_at).toBeNull();
  await db.exec('RESET ROLE');await db.exec(`UPDATE public.cockpit_campaigns SET reason='Human review',updated_at='2026-01-01'`);
  expected=(await db.query<any>('SELECT to_jsonb(t) AS r FROM public.cockpit_campaigns t')).rows[0].r;
  await db.exec('SET ROLE service_role');await expect(call(expected,proposed,reappear,true)).rejects.toThrow('Human or untracked');
  await expect(call(expected,{...proposed,id:99},reappear,true)).rejects.toThrow('Non-source');
  await db.exec('RESET ROLE');expect((await db.query<any>('SELECT count(*)::int AS n FROM public.cockpit_audit_log')).rows[0].n).toBe(4);
  await db.exec(`INSERT INTO public.cockpit_campaigns(client_name,meta_campaign_id,source_system,source_deployment,source_id,raw_data) VALUES('Client A','123456','convex','dep','duplicate','{"_id":"duplicate","metaCampaignId":"123456"}');`);
  await db.exec('SET ROLE service_role');await expect(call(expected,proposed,reappear,true)).rejects.toThrow('Ambiguous');
  await db.exec('RESET ROLE; SET ROLE authenticated');await expect(retire(expected,snapshot)).rejects.toThrow('permission');
 } finally {await db.close();}
},20000);
