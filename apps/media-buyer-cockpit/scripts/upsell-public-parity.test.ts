/** SQL public response -> browser allowlist parity, using fictional clients only. */
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import type {PGlite} from '@electric-sql/pglite';
import {publicProposal} from '../../client-success-cockpit/src/pages/money/offers/proposal/publicProposal';
import {SEATS, TASKS, type Row, upsellHelpers, upsellTestDb, uuid} from './lib/upsellTestDb';

let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;
const examples = [
  {key:'full', seat:SEATS.CSM_A, task:TASKS.A, lang:'en', price:{build:2000,care:200}, capture:true, logo:true},
  {key:'sparse', seat:SEATS.CSM_A, task:TASKS.A, lang:'en', price:{build:2000,care:200}, capture:false, logo:false},
  {key:'dwy', seat:SEATS.CSM_B, task:TASKS.B, lang:'en', price:{build:2000,care:200}, capture:false, logo:false},
  {key:'noprice', seat:SEATS.CSM_A, task:TASKS.A, lang:'en', price:{}, capture:false, logo:false},
  {key:'saudi', seat:SEATS.CSM_B, task:TASKS.B, lang:'ar', price:{build:2000,care:200}, capture:true, logo:false},
] as const;
const keys = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(keys) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k,x]) => [k,...keys(x)]) : [];
const internalKeys = ['reason','list','listPrice','email','taskId','warnings','views','revision','sentContent','createdBy'];

beforeAll(async () => {
  db = await upsellTestDb();
  h = upsellHelpers(db);
  await h.one(SEATS.CEO, "SELECT public.cockpit_upsell_setting_set('whatsapp_number','96550000000') r");
}, 60000);
afterAll(async () => { await db?.close(); });

describe('PublicProposal parity on the five proposal fixtures', () => {
  for (const [index, fixture] of examples.entries()) {
    test(fixture.key, async () => {
      let row = (await h.one(fixture.seat, 'SELECT public.cockpit_upsell_proposal_create($1,$2,$3,$4::uuid) r',
        [fixture.task,'website',fixture.lang,uuid(2000+index)])).proposal;
      const content = structuredClone(row.content);
      content.logo = {on:fixture.logo,adId:null};
      content.showCsm = fixture.key !== 'sparse';
      if (fixture.key === 'sparse') {
        content.why.text = ''; content.steps.text = '';
        content.get[0].hidden = true;
      }
      if (fixture.key !== 'noprice') content.video = {kind:'custom',url:'https://www.youtube.com/watch?v=ABCDEFGHIJK',posterUrl:null,title:'Example website',checkedAt:new Date().toISOString()};
      if (fixture.capture) {
        const capture = await h.capture(fixture.seat, fixture.task, uuid(2100+index));
        if (fixture.key === 'full') await h.one(fixture.seat, 'SELECT public.cockpit_upsell_file_update($1,$2::uuid,$3::jsonb) r',
          [fixture.task,capture.id,JSON.stringify({caption:'The current website'})]);
        // A blank typed caption falls back to the file's caption in both views.
        content.found = [{fileId:capture.id,caption:''}];
      }
      row = await h.one(fixture.seat,'SELECT public.cockpit_upsell_proposal_save($1::uuid,$2::jsonb,$3) r',
        [row.id,JSON.stringify({content,price:{parts:fixture.price,split:false}}),row.revision]);
      const server: Row = await h.one(fixture.seat, 'SELECT public.cockpit_upsell_proposal_public($1::uuid,NULL,NULL) r', [row.id]);
      // Equality proves SQL field names, nullability and nesting survive the real browser boundary.
      expect(publicProposal(server)).toEqual(server);
      expect(server.lang).toBe(fixture.lang);
      expect(server.found.length).toBe(fixture.capture ? 1 : 0);
      expect(server.logo !== null).toBe(fixture.logo);
      if (fixture.key === 'saudi') expect(server.found[0].caption).toBe('');
      expect(server.investment.parts.length).toBe(fixture.key === 'noprice' ? 0 : 2);
      if (fixture.key === 'sparse') expect([server.why,server.steps,server.csmFirstName]).toEqual([null,null,null]);
      if (fixture.key === 'dwy') expect(JSON.stringify(server)).not.toMatch(/appointments?|turn.?up|call.?centre/i);
      expect(server.button.whatsapp).toMatch(/^https:\/\/wa\.me\/96550000000/);
      for (const key of internalKeys) expect(keys(server)).not.toContain(key);

      // Unknown fields cannot leak if a future SQL change adds internal detail.
      const contaminated = structuredClone(server);
      contaminated.taskId = fixture.task; contaminated.warnings = ['internal'];
      contaminated.investment.listPrice = {build:999};
      contaminated.button.email = 'staff@tests.invalid';
      contaminated.found = contaminated.found.map((x: Row) => ({...x,reason:'internal'}));
      expect(publicProposal(contaminated)).toEqual(server);
    });
  }
});
