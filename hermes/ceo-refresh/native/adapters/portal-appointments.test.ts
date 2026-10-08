import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRuntime } from '../../runtime.ts';
import { portal } from './portal.js';

test('appointment mirror reads the current business capture, not the retired B2B document', async () => {
  const queries: { project: string; query: string }[] = [];
  const now = Date.now();
  const result = await withRuntime({
    read: async (project: string, query: string) => {
      queries.push({ project, query });
      if (query.includes('appointment_rows')) return [{ found: 1, header_present: true, appointment_rows: 796, sheet_outcomes: 14, synced_at: new Date(now - 60_000).toISOString(), updated_ms: now - 50_000 }];
      if (query.includes('last_seen_ms')) return [];
      return [{ found: '__state__,directory.json,client-access.json', directory_total: 1, clients_current: 1, clients_cancelled: 0, bad_state: '', bad_access: false, state_updated_ms: now, outcomes_submitted: 14 }];
    },
  } as any, () => portal.compute());
  const sheet = queries.find(({ query }) => query.includes('appointment_rows'));
  assert.ok(sheet);
  assert.equal(sheet.project, 'bldgtotkfmhoxmlzowdx');
  assert.match(sheet.query, /portal_migration\.business_documents/);
  assert.match(sheet.query, /source_updated_at/);
  assert.doesNotMatch(sheet.query, /public\.mahara_portal_documents/);
  assert.equal(result.payload.appointmentRows, 796);
  assert.equal(result.sources.find((s: any) => s.name === 'Portal appointments mirror')?.ok, true);
});

test('a recently published capture without a source sync time is not confirmed fresh', async () => {
  const now = Date.now();
  const result = await withRuntime({
    read: async (_project: string, query: string) => {
      if (query.includes('appointment_rows')) return [{ found: 1, header_present: true, appointment_rows: 2, sheet_outcomes: 0, synced_at: null, updated_ms: now }];
      if (query.includes('last_seen_ms')) return [];
      return [{ found: '__state__,directory.json,client-access.json', directory_total: 1, clients_current: 1, bad_state: '', bad_access: false, state_updated_ms: now }];
    },
  } as any, () => portal.compute());
  assert.equal(result.sources.find((s: any) => s.name === 'Portal appointments mirror')?.ok, false);
});

test('missing appointment outcome header cannot confirm a mirror or report zero outcomes', async () => {
  const now = Date.now();
  const result = await withRuntime({
    read: async (_project: string, query: string) => {
      if (query.includes('appointment_rows')) return [{ found: 1, header_present: false, appointment_rows: 2, sheet_outcomes: 0, synced_at: new Date(now).toISOString() }];
      if (query.includes('last_seen_ms')) return [];
      return [{ found: '__state__,directory.json,client-access.json', directory_total: 1, clients_current: 1, bad_state: '', bad_access: false, state_updated_ms: now }];
    },
  } as any, () => portal.compute());
  assert.equal(result.sources.find((s: any) => s.name === 'Portal appointments mirror')?.ok, false);
  assert.match(result.sources.find((s: any) => s.name === 'Portal appointments mirror')?.note ?? '', /header/i);
});
