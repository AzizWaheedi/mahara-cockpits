import { cockpitTestDb, migration, member, owner, actor } from '../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
export { owner, actor };
export const previewActors = {
  media: '00000000-0000-4000-8000-000000000011', creative: '00000000-0000-4000-8000-000000000012',
  csm: '00000000-0000-4000-8000-000000000013', founder: '00000000-0000-4000-8000-000000000014',
  spoof: '00000000-0000-4000-8000-000000000015', unconfirmed: '00000000-0000-4000-8000-000000000016',
};
export async function nativePreviewDb() {
  const db = await cockpitTestDb();
  try {
    // Only the unrelated clients FK target is a fixture; permissions and preview contracts are canonical.
    await db.exec('CREATE TABLE public.clients(id uuid PRIMARY KEY)');
    await db.exec(migration('20260923o_cockpit_domain_tables.sql'));
    await db.exec(migration('20260927k_cockpit_snapshot_reconcile.sql'));
    await db.exec(migration('20260927g_cockpit_media_actions.sql'));
    const sources = migration('20260927s_creative_read_models.sql');
    const sourcePrefix = sources.indexOf('CREATE OR REPLACE FUNCTION public.cockpit_creative_source_current');
    if (sourcePrefix < 0) throw new Error('Canonical creative source definitions missing');
    await db.exec(sources.slice(0, sourcePrefix) + 'COMMIT;');
    await db.exec(migration('20261005c_cockpit_ad_previews.sql'));
    const identity = migration('20261004a_cockpit_staff_identity_adoption.sql');
    const adoptionStart = identity.indexOf('CREATE OR REPLACE FUNCTION public.cockpit_adopt_member()');
    const identityEnd = identity.indexOf('-- 4. Existing editor RLS policies');
    if (adoptionStart < 0 || identityEnd <= adoptionStart) throw new Error('Canonical native auth access definitions missing');
    await db.exec(identity.slice(adoptionStart, identityEnd));
    await member(db, previewActors.media, 'preview-media@example.test', ['media_buyer']);
    await member(db, previewActors.creative, 'preview-creative@example.test', ['creative']);
    await member(db, previewActors.csm, 'preview-csm@example.test', ['csm']);
    await member(db, previewActors.founder, 'aziz@maharamedia.com', []);
    await member(db, previewActors.spoof, 'preview-spoof@example.test', []);
    await member(db, previewActors.unconfirmed, 'preview-unconfirmed@example.test', ['media_buyer'], true, false);
    await owner(db);
    await db.query("UPDATE cockpit_members SET clients=ARRAY['Alpha'] WHERE auth_user_id IN($1,$2)", [previewActors.media, previewActors.csm]);
    await db.query("UPDATE cockpit_members SET clients=ARRAY['Beta'] WHERE auth_user_id=$1", [previewActors.creative]);
    await db.exec(`INSERT INTO cockpit_campaigns(client_name,meta_account_id,meta_campaign_id,raw_data)
      VALUES('Alpha','act_222222','111111','{"campaignName":"Alpha campaign","clientName":"Alpha"}');
      INSERT INTO cockpit_ads(campaign_name,ad_name,meta_ad_id,raw_data)
      VALUES('Alpha campaign','Original ad','333333','{"campaignName":"Alpha campaign","metaAdId":"333333"}');`);
    return db;
  } catch (error) { await db.close(); throw error; }
}
export async function previewService(db: Awaited<ReturnType<typeof nativePreviewDb>>) {
  await owner(db);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })]);
  await db.exec('SET ROLE service_role');
}
