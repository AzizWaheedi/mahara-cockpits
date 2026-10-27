/** All records are fictional; this suite runs in isolated PGlite without provider calls. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import { migration } from './lib/cockpitTestDb';
import { SEATS, TASKS, UPSELL_FILES, upsellHelpers, upsellTestDb, uuid, type Row } from './lib/upsellTestDb';

let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;
const PREP = 'SELECT public.cockpit_csm_deck_prep_save($1,$2,$3::jsonb) r';
const STATUS = 'SELECT public.cockpit_csm_offer_status($1) r';
const SOURCE = 'SELECT public.cockpit_csm_offer_sources($1,$2) r';
const CREATE = 'SELECT public.cockpit_upsell_proposal_create($1,$2,$3,$4::uuid) r';
const SAVE = 'SELECT public.cockpit_upsell_proposal_save($1::uuid,$2::jsonb,$3) r';
const SEND = 'SELECT public.cockpit_upsell_proposal_send($1::uuid,$2,\'copy\',$3::text[]) r';
const PITCH = 'SELECT public.cockpit_upsell_pitch_save($1,$2,$3::uuid,$4::jsonb,$5) r';
const prep = (offer: string, patch: Row, seat: string = SEATS.CSM_A, task: string = TASKS.A) => h.one(seat, PREP, [task, `offer_${offer}`, JSON.stringify(patch)]);
const byKey = (s: Row, key: string): Row => s.offers.find((o: Row) => o.key === key);
const patch = migration(UPSELL_FILES.y);

beforeAll(async () => { db = await upsellTestDb(); h = upsellHelpers(db); }, 60000);
afterAll(async () => { await db?.close(); });

async function pricedDraft(offer: string, id: number, seat: string = SEATS.CSM_A, task: string = TASKS.A) {
  const bundle = await h.one(seat, CREATE, [task, offer, 'en', uuid(id)]);
  const row = bundle.proposal;
  const parts = Object.fromEntries(Object.keys(row.listPrice).map(k => [k, k === 'management' ? 750 : 4000]));
  const content = { ...row.content, video: { kind: 'custom', url: 'https://fast.wistia.net/embed/iframe/abcdefghij', posterUrl: null, title: 'An example', checkedAt: new Date().toISOString() } };
  return { row: await h.one(seat, SAVE, [row.id, JSON.stringify({ content, price: {parts, split:false} }), row.revision]), warnings: bundle.warnings.map((w: Row) => w.key) };
}

describe('offer-specific readiness without invented fit', () => {
  test('only website and search need captures; existing gates, holds and locked blank prices stay honest', async () => {
    const s = await h.one(SEATS.CSM_A, STATUS, [TASKS.A]);
    expect(s.gate).toEqual({ok:true,reasons:[]});
    for (const o of s.offers) {
      expect(o.ready.missing.includes('no_capture')).toBe(['website','seo_geo'].includes(o.key));
      expect(o.ready.missing).toContain('no_price');
      expect(o.ready.missing).toContain('no_payment_link');
      if (o.key !== 'website') expect(o.fit.ok).toBeNull();
    }
    expect(byKey(s,'closer').ready.missing).toContain('no_recruiter');
    expect(byKey(s,'seo_geo').waitsOn).toBe('Needs a delivery owner, a fulfilment list and proof.');
    expect(byKey(s,'smm').waitsOn).toBe('Needs a delivery owner, a fulfilment list and proof.');
    expect(byKey(s,'cameraman').waitsOn).toBe("Needs a cameraman listed for the client's city.");
    expect(byKey(s,'ugc').waitsOn).toBeNull();
    expect(byKey(s,'second_campaign').waitsOn).toBeNull();
    expect(s.thisMonth).toBeNull();
    const catalog = await h.one(SEATS.CSM_A,'SELECT public.cockpit_upsell_catalog_read() r');
    expect(catalog.rows.find((r:Row)=>r.offerKey==='seo_geo').locked).toBe(true);
    expect(catalog.rows.flatMap((r:Row)=>r.parts).every((p:Row)=>p.amount===null)).toBe(true);
  });

  test('freshness is shared by source and picker, and readiness does not change client eligibility', async () => {
    await h.capture(SEATS.CSM_A, TASKS.A, uuid(8001), 8);
    let s = await h.one(SEATS.CSM_A, STATUS, [TASKS.A]);
    for (const key of ['website','seo_geo']) expect(byKey(s,key).ready.missing).toContain('capture_old');
    for (const key of ['second_campaign','smm','cameraman','ugc','closer']) expect(byKey(s,key).ready.missing).not.toContain('capture_old');
    await h.capture(SEATS.CSM_A, TASKS.A, uuid(8002), 7);
    await prep('ugc', {opening_price:{package:3500}, payment_link:'https://whop.com/checkout/plan_fixture/'});
    s = await h.one(SEATS.CSM_A, STATUS, [TASKS.A]);
    const source = await h.one(SEATS.CSM_A, SOURCE, [TASKS.A,'ugc']);
    expect(source.ready).toEqual(byKey(s,'ugc').ready);
    expect(source.ready).toEqual({ok:true,missing:[]});
    expect(byKey(s,'ugc').fit.ok).toBeNull();
    const refused = await h.one(SEATS.CSM_B, SOURCE, [TASKS.B,'ugc']);
    expect(refused.mode).toBe('refused');
    expect(refused.gate.ok).toBe(false);
    expect(refused.catalog).toBeNull();
    expect((await h.failure(SEATS.CSM_B,SOURCE,[TASKS.A,'ugc'])).code).toBe('42501');
  });
});

describe('a real named recruiter before a Closer presentation', () => {
  test('scoped trimmed input, merged presentation stamping, effective hold and audit', async () => {
    expect((await h.failure(SEATS.CSM_A,PREP,[TASKS.A,'offer_website',JSON.stringify({recruiter_name:'Example Recruiter'})])).message).toContain('Closer placement');
    for (const value of ['ab','x'.repeat(121),true,{name:'Example'}]) {
      expect((await h.failure(SEATS.CSM_A,PREP,[TASKS.A,'offer_closer',JSON.stringify({recruiter_name:value})])).code).toBe('22023');
    }
    expect((await h.failure(SEATS.CSM_A,PREP,[TASKS.A,'offer_closer','{"presented_at":true}'])).message).toContain('Name the recruiter');
    const saved = await prep('closer',{recruiter_name:'  Example Recruiter  ',presented_at:true});
    expect(saved.overrides.recruiter_name).toBe('Example Recruiter');
    expect(saved.overrides.presented_at).toBeTruthy();
    const s = await h.one(SEATS.CSM_A,SOURCE,[TASKS.A,'closer']);
    expect(s.ready.missing).not.toContain('no_recruiter');
    expect(s.waitsOn).toBeNull();
    const audits = (await h.audits('cockpit_csm_deck_prep')).filter(a => a.entity_id === `${TASKS.A}:offer_closer` && a.action === 'deckPrep.save');
    expect(audits.some(a => a.metadata.changed.includes('recruiter_name'))).toBe(true);
    // Clearing a later draft does not erase the historical first-presented stamp.
    await prep('closer',{recruiter_name:null});
    expect((await h.one(SEATS.CSM_A,SOURCE,[TASKS.A,'closer'])).ready.missing).toContain('no_recruiter');
    expect((await h.failure(SEATS.CSM_A,PITCH,[TASKS.A,'closer',uuid(8010),'{}',0])).message).toContain('Name the recruiter');
  });

  test('client-asked and warning acknowledgments cannot bypass send; named owner stays private', async () => {
    const today = (await h.owner("SELECT to_char(public.cockpit_upsell_today(),'YYYY-MM-DD') today"))[0].today;
    await prep('closer',{client_asked:{words:'Please help us find a salesperson.',on:today}},SEATS.CSM_B,TASKS.B);
    expect((await h.one(SEATS.CSM_B,SOURCE,[TASKS.B,'closer'])).mode).toBe('client_asked');
    const d = await pricedDraft('closer',8020,SEATS.CSM_B,TASKS.B);
    expect((await h.failure(SEATS.CSM_B,SEND,[d.row.id,d.row.revision,[...d.warnings,'no_recruiter']])).message).toContain('Name the recruiter');
    await prep('closer',{recruiter_name:'Example Recruiting Owner'},SEATS.CSM_B,TASKS.B);
    const sent = await h.one(SEATS.CSM_B,SEND,[d.row.id,d.row.revision,d.warnings]);
    expect(sent.code).toBeTruthy();
    const pub = await h.one(SEATS.CSM_B,'SELECT public.cockpit_upsell_proposal_public($1::uuid,NULL,NULL) r',[d.row.id]);
    expect(JSON.stringify(pub)).not.toContain('Example Recruiting Owner');
    expect(JSON.stringify(pub)).not.toContain('recruiter_name');
    const pitch = await h.one(SEATS.CSM_B,PITCH,[TASKS.B,'closer',uuid(8021),'{}',0]);
    // Existing records remain correctable if someone later clears preparation.
    await prep('closer',{recruiter_name:null},SEATS.CSM_B,TASKS.B);
    const edited = await h.one(SEATS.CSM_B,PITCH,[TASKS.B,'closer',uuid(8021),'{"held_full":true}',pitch.revision]);
    expect(edited.heldFull).toBe(true);
  });
});

describe('approved work examples and migration protections', () => {
  test('three distinct examples, same order in both languages, no invented list prices', async () => {
    const rows = await h.owner('SELECT copy,parts,revision FROM public.cockpit_upsell_catalog WHERE offer_key=\'ugc\'');
    const c = rows[0];
    expect(c.copy.en.work.map((x:Row)=>x.key)).toEqual(['khalda','castello','alkhalil']);
    expect(c.copy.en.work.map((x:Row)=>x.url)).toEqual(c.copy.ar.work.map((x:Row)=>x.url));
    expect(c.copy.en.work).toHaveLength(3);
    expect(c.parts[0].amount).toBeNull();
    const before = (await h.owner('SELECT count(*)::int n FROM public.cockpit_audit_log'))[0].n;
    await db.exec(patch);
    expect((await h.owner('SELECT count(*)::int n FROM public.cockpit_audit_log'))[0].n).toBe(before);
    expect((await h.owner('SELECT revision FROM public.cockpit_upsell_catalog WHERE offer_key=\'ugc\''))[0].revision).toBe(c.revision);
  });

  test('sent work examples freeze; changing catalog samples only changes new previews', async () => {
    const d = await pricedDraft('ugc',8030);
    const warnings = (await h.one(SEATS.CSM_A,'SELECT public.cockpit_upsell_proposal_get($1::uuid) r',[d.row.id])).warnings.map((w:Row)=>w.key);
    const sent = await h.one(SEATS.CSM_A,SEND,[d.row.id,d.row.revision,warnings]);
    const row = (await h.owner('SELECT copy FROM public.cockpit_upsell_catalog WHERE offer_key=\'ugc\''))[0];
    try {
      await h.owner("UPDATE public.cockpit_upsell_catalog SET copy=jsonb_set(jsonb_set(copy,'{en,work}','[]'),'{ar,work}','[]') WHERE offer_key='ugc'");
      const opened = await h.svc('SELECT public.cockpit_upsell_door_open($1,$2,$3,$4,$5) r',[sent.code,'fictional-device-8030','a'.repeat(64),'desktop',null]);
      expect(opened.state).toBe('open');
      expect(opened.proposal.work).toHaveLength(3);
      expect(opened.proposal.work.map((x:Row)=>x.url)).toEqual(row.copy.en.work.map((x:Row)=>x.url));
      const newer = (await h.one(SEATS.CSM_A,CREATE,[TASKS.A,'ugc','en',uuid(8031)])).proposal;
      const preview = await h.one(SEATS.CSM_A,'SELECT public.cockpit_upsell_proposal_public($1::uuid,NULL,NULL) r',[newer.id]);
      expect(preview.work).toEqual([]);
    } finally { await h.owner("UPDATE public.cockpit_upsell_catalog SET copy=$1::jsonb WHERE offer_key='ugc'",[JSON.stringify(row.copy)]); }
  });

  test('custom CEO holds survive and changed sample lists stop migration replay atomically', async () => {
    const original = (await h.owner("SELECT copy,waits_on,revision FROM public.cockpit_upsell_catalog WHERE offer_key='ugc'"))[0];
    const closer = (await h.owner("SELECT waits_on FROM public.cockpit_upsell_catalog WHERE offer_key='closer'"))[0];
    const second = (await h.owner("SELECT waits_on FROM public.cockpit_upsell_catalog WHERE offer_key='second_campaign'"))[0];
    try {
      await h.owner("UPDATE public.cockpit_upsell_catalog SET waits_on='Confirm the agreed scope first.' WHERE offer_key IN ('closer','second_campaign')");
      await prep('closer',{recruiter_name:'Example Recruiter'});
      expect((await h.one(SEATS.CSM_A,SOURCE,[TASKS.A,'closer'])).waitsOn).toBe('Confirm the agreed scope first.');
      await db.exec(patch);
      expect((await h.owner("SELECT waits_on FROM public.cockpit_upsell_catalog WHERE offer_key='second_campaign'"))[0].waits_on).toBe('Confirm the agreed scope first.');
      const changed = structuredClone(original.copy);
      changed.en.work[0].label = 'Another approved example';
      await h.owner("UPDATE public.cockpit_upsell_catalog SET copy=$1::jsonb WHERE offer_key='ugc'",[JSON.stringify(changed)]);
      await expect(db.exec(patch)).rejects.toThrow('Presenter examples changed');
      await db.exec('ROLLBACK');
      expect((await h.owner("SELECT copy FROM public.cockpit_upsell_catalog WHERE offer_key='ugc'"))[0].copy).toEqual(changed);
    } finally {
      await db.exec('ROLLBACK');
      await h.owner("UPDATE public.cockpit_upsell_catalog SET copy=$1::jsonb,waits_on=$2 WHERE offer_key='ugc'",[JSON.stringify(original.copy),original.waits_on]);
      await h.owner("UPDATE public.cockpit_upsell_catalog SET waits_on=$1 WHERE offer_key='closer'",[closer.waits_on]);
      await h.owner("UPDATE public.cockpit_upsell_catalog SET waits_on=$1 WHERE offer_key='second_campaign'",[second.waits_on]);
    }
  });

  test('private helper stays private and missing/off-seat actors cannot use the public wrappers', async () => {
    for (const who of [null,SEATS.CSM_A,'service'] as const) {
      expect((await h.failure(who,"SELECT public.cockpit_upsell_offer_readiness($1,'closer')",[TASKS.A])).code).toBe('42501');
    }
    expect((await h.failure(null,STATUS,[TASKS.A])).code).toBe('42501');
    expect((await h.failure(SEATS.BUYER,STATUS,[TASKS.A])).code).toBe('42501');
    expect((await h.failure(SEATS.CSM_B,STATUS,[TASKS.A])).code).toBe('42501');
  });

  test('definition and privilege drift stop the patch without replacing an unknown function', async () => {
    await h.owner('GRANT EXECUTE ON FUNCTION public.cockpit_upsell_offer_readiness(text,text) TO anon');
    try { await expect(db.exec(patch)).rejects.toThrow('Offer readiness helper changed'); }
    finally { await db.exec('ROLLBACK'); await h.owner('REVOKE ALL ON FUNCTION public.cockpit_upsell_offer_readiness(text,text) FROM anon'); }
    const original = (await h.owner("SELECT pg_get_functiondef('public.cockpit_csm_offer_status(text)'::regprocedure) definition"))[0].definition;
    await h.owner("CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_status(p_task_id text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$");
    try { await expect(db.exec(patch)).rejects.toThrow('Offer presentation dependency cockpit_csm_offer_status(text) changed'); }
    finally { await db.exec('ROLLBACK'); await h.owner(original); }
  });
});
