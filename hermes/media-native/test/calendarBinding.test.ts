import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { actor, BUYER, OTHER, call, claim, database, owner, type Database } from './database';
import { row } from '../tools';
import { NativeCalendarNotAppliedError, calendarMine, calendarWrite } from '../../../apps/media-buyer-cockpit/src/lib/nativeCalendarClient';
import { browserDatabase } from './browserDatabase';
let db: Database;
let opened = false;
beforeEach(async () => {
  opened = false;
  db = await database();
  opened = true;
  await db.query("INSERT INTO public.cockpit_media_calendar_owners(actor_id,calendar_id,verified_by) VALUES($1,'second@example.com','reviewed-admin')", [BUYER]);
  await actor(db, BUYER);
});
afterEach(async () => { if (opened) { opened = false; await db.close(); } });
async function write(operation: string, id: string, args: Record<string, unknown>) {
  return row(await call(db, 'cockpit_media_native_write', { p_operation: operation, p_request_id: id, p_args: { ...args, app: 'media-buyer' }, p_apply: true }));
}
describe('canonical calendar request receipts and binding CAS', () => {
  test('lost link receipt after replacement returns history without restoring old calendar', async () => {
    const oldId = crypto.randomUUID(); const oldArgs = { calendarId: 'buyer@example.com', bindingRevision: 0 };
    const first = await write('personalCalendars.link', oldId, oldArgs);
    await write('personalCalendars.link', crypto.randomUUID(), { calendarId: 'second@example.com', bindingRevision: 1 });
    expect(await write('personalCalendars.link', oldId, oldArgs)).toEqual(first);
    const current = row(await call(db, 'cockpit_media_calendar_mine', { p_app: 'media-buyer' }));
    expect(current.bindingRevision).toBe(2); expect(row(current.link).calendarId).toBe('second@example.com');
  });
  test('old never-arrived link and unlink fail rather than rebasing to newer binding', async () => {
    await write('personalCalendars.link', crypto.randomUUID(), { calendarId: 'second@example.com', bindingRevision: 0 });
    expect(await write('personalCalendars.link', crypto.randomUUID(), { calendarId: 'buyer@example.com', bindingRevision: 0 })).toMatchObject({ ok: false, applied: false, code: 'CALENDAR_CAS_NOT_APPLIED', expectedRevision: 0, currentRevision: 1 });
    expect(await write('personalCalendars.unlink', crypto.randomUUID(), { bindingRevision: 0 })).toMatchObject({ ok: false, applied: false, code: 'CALENDAR_CAS_NOT_APPLIED', expectedRevision: 0, currentRevision: 1 });
    expect(row(row(await call(db, 'cockpit_media_calendar_mine', { p_app: 'media-buyer' })).link).calendarId).toBe('second@example.com');
  });
  test('unlink tombstone and receipt survive a new link and cannot delete it on retry', async () => {
    await write('personalCalendars.link', crypto.randomUUID(), { calendarId: 'buyer@example.com', bindingRevision: 0 });
    const unlinkId = crypto.randomUUID(); const args = { bindingRevision: 1 };
    const unlinked = await write('personalCalendars.unlink', unlinkId, args);
    let current = row(await call(db, 'cockpit_media_calendar_mine', { p_app: 'media-buyer' }));
    expect(current.link).toBeNull(); expect(current.bindingRevision).toBe(2);
    await write('personalCalendars.link', crypto.randomUUID(), { calendarId: 'second@example.com', bindingRevision: 2 });
    expect(await write('personalCalendars.unlink', unlinkId, args)).toEqual(unlinked);
    current = row(await call(db, 'cockpit_media_calendar_mine', { p_app: 'media-buyer' }));
    expect(current.bindingRevision).toBe(3); expect(row(current.link).calendarId).toBe('second@example.com');
    await owner(db);
    expect((await db.query<{ count: number }>('SELECT count(*)::int count FROM public.cockpit_media_calendar_requests')).rows[0].count).toBe(3);
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM public.cockpit_audit_log WHERE entity_type='cockpit_media_calendar_requests'")).rows[0].count).toBe(3);
  });
  test('same calendar request ID conflicts across args, operation and actor', async () => {
    const id = crypto.randomUUID(); const args = { calendarId: 'buyer@example.com', bindingRevision: 0 };
    await write('personalCalendars.link', id, args);
    await expect(write('personalCalendars.link', id, { ...args, calendarId: 'second@example.com' })).rejects.toThrow('different inputs');
    await expect(write('personalCalendars.unlink', id, { bindingRevision: 1 })).rejects.toThrow('different inputs');
    await actor(db, OTHER);
    await expect(write('personalCalendars.link', id, args)).rejects.toThrow('different inputs');
  });
  test('only an authoritative not-applied receipt retires a rejected intent and permits a later deliberate action', async () => {
    await write('personalCalendars.link', crypto.randomUUID(), { calendarId: 'buyer@example.com', bindingRevision: 0 });
    let loseRejection = true;
    const client = await browserDatabase(db, { afterRpc: async (name, _args, result) => {
      if (name === 'cockpit_media_native_write' && row(result).code === 'CALENDAR_CAS_NOT_APPLIED' && loseRejection) {
        loseRejection = false; throw new Error('Lost definitive rejection receipt');
      }
    } });
    const oldId = crypto.randomUUID();
    await expect(calendarWrite(client, 'media-buyer', 'personalCalendars.unlink', {}, { apply: true, requestId: oldId, bindingRevision: 0 })).rejects.toThrow();
    await expect(calendarWrite(client, 'media-buyer', 'personalCalendars.unlink', {}, { apply: true, requestId: crypto.randomUUID(), bindingRevision: 1 })).rejects.toThrow('uncertain request');
    await expect(calendarWrite(client, 'media-buyer', 'personalCalendars.unlink', {}, { apply: true, requestId: oldId, bindingRevision: 0 })).rejects.toBeInstanceOf(NativeCalendarNotAppliedError);
    await actor(db, BUYER);
    expect(await write('personalCalendars.unlink', oldId, { bindingRevision: 0 })).toMatchObject({ code: 'CALENDAR_CAS_NOT_APPLIED', applied: false });
    await expect(write('personalCalendars.unlink', oldId, { bindingRevision: 1 })).rejects.toThrow('different inputs');
    const reloaded = await browserDatabase(db);
    const current = await calendarMine(reloaded, 'media-buyer');
    expect(current.bindingRevision).toBe(1);
    await calendarWrite(reloaded, 'media-buyer', 'personalCalendars.unlink', {}, { apply: true, requestId: crypto.randomUUID(), bindingRevision: current.bindingRevision });
    expect((await calendarMine(reloaded, 'media-buyer')).bindingRevision).toBe(2);
  });
  test('periodic refresh claims only the current revision and never revives an unlinked calendar', async () => {
    const linkedId = crypto.randomUUID();
    await write('personalCalendars.link', linkedId, { calendarId: 'buyer@example.com', bindingRevision: 0 });
    const initial = await claim(db);
    expect(initial.job.calendar_revision).toBe(1);
    await call(db, 'cockpit_media_native_finish', { p_id: initial.job.id, p_token: initial.job.claim_token, p_result: { error: 'Read unavailable' }, p_state: 'failed' });
    await owner(db);
    await db.query("UPDATE public.cockpit_media_native_records SET updated_at=now()-interval '6 minutes' WHERE id=$1", [linkedId]);
    const periodic = await claim(db);
    expect(periodic.job.id).not.toBe(initial.job.id);
    expect(periodic.job.record_id).toBe(linkedId);
    expect(periodic.job.calendar_revision).toBe(1);
    await call(db, 'cockpit_media_native_guard', { p_job_id: periodic.job.id, p_token: periodic.job.claim_token });
    await actor(db, BUYER);
    await write('personalCalendars.unlink', crypto.randomUUID(), { bindingRevision: 1 });
    expect(row(await call(db, 'cockpit_media_calendar_mine', { p_app: 'media-buyer' })).bindingRevision).toBe(2);
    await db.exec('RESET ROLE; SET ROLE service_role');
    await expect(call(db, 'cockpit_media_native_guard', { p_job_id: periodic.job.id, p_token: periodic.job.claim_token })).rejects.toThrow();
    expect(await call(db, 'cockpit_media_native_claim', { p_apply: true })).toBeNull();
  });
  test('browser retains original calendar revision after a lost receipt and rejects superseded success', async () => {
    let lost = true;
    const client = await browserDatabase(db, { afterRpc: async name => { if (name === 'cockpit_media_native_write' && lost) { lost = false; throw new Error('receipt lost'); } } });
    const id = crypto.randomUUID();
    await expect(calendarWrite(client, 'media-buyer', 'personalCalendars.link', { calendarId: 'buyer@example.com' }, { apply: true, requestId: id, bindingRevision: 0 })).rejects.toThrow();
    await actor(db, BUYER); await write('personalCalendars.link', crypto.randomUUID(), { calendarId: 'second@example.com', bindingRevision: 1 });
    // Supplying a new revision cannot overwrite the saved original intent.
    await expect(calendarWrite(client, 'media-buyer', 'personalCalendars.link', { calendarId: 'buyer@example.com' }, { apply: true, requestId: id, bindingRevision: 2 })).rejects.toThrow('completed earlier');
    const current = await calendarMine(client, 'media-buyer');
    expect(current.bindingRevision).toBe(2); expect(current.link?.calendarId).toBe('second@example.com');
  });
});
