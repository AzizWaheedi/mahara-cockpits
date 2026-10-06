import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { MediaNativeWorker } from '../worker';
import { actor, BUYER, call, database, enqueue, owner, sdk, type Database } from './database';
let db: Database;
let opened = false;
let environmentCaptured = false;
const names = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'META_SYSTEM_TOKEN', 'ANTHROPIC_API_KEY', 'SLACK_BOT_TOKEN'] as const;
const previous: Record<string, string | undefined> = {};
beforeEach(async () => {
  opened = false;
  environmentCaptured = false;
  db = await database();
  opened = true;
  for (const name of names) previous[name] = process.env[name];
  environmentCaptured = true;
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'claude@studied-handler-508106-m5.iam.gserviceaccount.com', private_key: key });
  process.env.META_SYSTEM_TOKEN = 'offline-meta'; process.env.ANTHROPIC_API_KEY = 'offline-model'; process.env.SLACK_BOT_TOKEN = 'offline-slack';
});
afterEach(async () => {
  try { if (opened) { opened = false; await db.close(); } }
  finally {
    if (environmentCaptured) for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    environmentCaptured = false;
  }
});
async function result(id: string) {
  await owner(db);
  return (await db.query<{ state: string; data: Record<string, unknown> }>('SELECT j.state,r.data FROM public.cockpit_media_native_jobs j JOIN public.cockpit_media_native_records r ON r.id=j.record_id WHERE j.id=$1', [id])).rows[0];
}
describe('worker with canonical SQL and provider transport fixtures only', () => {
  test('creative folder pagination imports actual image and chunked video receipts without creating ads', async () => {
    const id = await enqueue(db, 'assist.enqueue', { kind: 'creative', campaignName: 'Alpha-Campaign', client: 'Alpha', driveLinks: ['https://drive.google.com/drive/folders/folder1'] });
    const requests: string[] = [];
    await new MediaNativeWorker({ apply: true, once: true, supabaseClient: sdk(db), fetchImpl: async (input, init) => {
      const url = new URL(String(input)); requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.hostname === 'oauth2.googleapis.com') {
        const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
        const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
        expect(claims.scope).toBe('https://www.googleapis.com/auth/drive.readonly');
        return Response.json({ access_token: 'offline-google', token_type: 'Bearer' });
      }
      if (url.pathname === '/drive/v3/files/folder1') return Response.json({ id: 'folder1', name: 'Assets', mimeType: 'application/vnd.google-apps.folder' });
      if (url.pathname === '/drive/v3/files') return Response.json(url.searchParams.has('pageToken') ? { files: [{ id: 'video1', name: 'Video.mp4', mimeType: 'video/mp4', size: '6' }] } : { files: [{ id: 'image1', name: 'Image.png', mimeType: 'image/png', size: '3' }], nextPageToken: 'next' });
      if (url.pathname === '/drive/v3/files/image1') return new Response(new Uint8Array([1, 2, 3]));
      if (url.pathname === '/drive/v3/files/video1') {
        const range = new Headers(init?.headers).get('Range'); expect(['bytes=0-2', 'bytes=3-5']).toContain(range);
        return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
      }
      if (url.pathname === '/v21.0/act_123/adimages') {
        expect(init?.body instanceof FormData).toBe(true);
        return Response.json({ images: { 'Image.png': { hash: 'actual-image-hash', url: 'https://images.invalid/thumb' } } });
      }
      if (url.pathname === '/v21.0/act_123/advideos') {
        const body = init?.body as FormData; const phase = body.get('upload_phase');
        if (phase === 'start') return Response.json({ upload_session_id: 'session1', video_id: '456', start_offset: '0', end_offset: '3' });
        if (phase === 'transfer') return Response.json(body.get('start_offset') === '0' ? { start_offset: '3', end_offset: '6' } : { start_offset: '6', end_offset: '6' });
        if (phase === 'finish') return Response.json({ success: true });
      }
      throw new Error(`Unexpected provider operation ${url.pathname}`);
    } }).run();
    const saved = await result(id); expect(saved.state).toBe('ready');
    expect(saved.data.media).toEqual([
      { name: 'Image.png', link: 'https://drive.google.com/drive/folders/folder1', kind: 'image', imageHash: 'actual-image-hash', thumbUrl: 'https://images.invalid/thumb' },
      { name: 'Video.mp4', link: 'https://drive.google.com/drive/folders/folder1', kind: 'video', videoId: '456', percent: 100 },
    ]);
    expect(requests.some(request => /\/(ads|adsets|campaigns)$/.test(request))).toBe(false);
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM public.cockpit_media_native_receipts WHERE stage='receipt' AND provider='meta'")).rows[0].count).toBe(5);
  });
  test('copy fixture flows through real model parsing and SQL completion', async () => {
    await db.exec("UPDATE public.cockpit_creative_source_state SET ready=true,row_count=0,source_snapshot_at='2026-10-04T00:00:00Z' WHERE table_name='winnersArchive'");
    const id = await enqueue(db, 'assist.enqueue', { kind: 'copy', campaignName: 'Alpha-Campaign', client: 'Alpha', language: 'English', brief: 'Office renovations' });
    const variants = ['Outcome', 'Objection', 'Proof', 'Question', 'Offer'].map(angle => ({ headline: `${angle} for offices`, message: 'Plan your next office.\nTalk with our team.', description: '', angle }));
    await new MediaNativeWorker({ apply: true, once: true, supabaseClient: sdk(db), fetchImpl: async (input, init) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      expect(JSON.parse(String(init?.body)).messages[0].content).toContain('Office renovations');
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ variants, note: 'Draft options.' }) }] });
    } }).run();
    const saved = await result(id); expect(saved.state).toBe('ready'); expect(saved.data.variants).toEqual(variants);
  });
  test("complete Google window reaches SQL receipts and today's view preserves overnight and multi-day meetings", async () => {
    const id = await enqueue(db, 'personalCalendars.link', { calendarId: 'buyer@example.com', bindingRevision: 0 });
    await db.exec('BEGIN');
    const day = (await db.query<{ filing_day: string }>("SELECT to_char(now() AT TIME ZONE 'Asia/Kuwait','YYYY-MM-DD') AS filing_day")).rows[0].filing_day;
    const midnight = Date.parse(`${day}T00:00:00+03:00`);
    const date = (offset: number) => new Date(midnight + offset * 86400000 + 10800000).toISOString().slice(0, 10);
    const timed = (eventId: string, start: number, end: number) => ({ id: eventId, summary: 'Alpha client call', start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() } });
    const items = [
      timed('prior', midnight - 2 * 86400000, midnight - 2 * 86400000 + 3600000),
      { id: 'multi', summary: 'Conference', start: { date: date(-1) }, end: { date: date(2) } },
      timed('overnight', midnight - 3600000, midnight + 3600000),
      timed('future', midnight + 8 * 86400000, midnight + 8 * 86400000 + 3600000),
      timed('tomorrow', midnight + 86400000, midnight + 86400000 + 3600000),
    ];
    let pages = 0;
    const summary = await new MediaNativeWorker({ apply: true, once: true, supabaseClient: sdk(db), fetchImpl: async input => {
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'offline-google', token_type: 'Bearer' });
      pages++;
      return Response.json({ accessRole: 'reader', items: pages === 1 ? items.slice(0, 3) : items.slice(3), ...(pages === 1 ? { nextPageToken: 'next' } : {}) });
    } }).run();
    expect(summary.errors).toEqual([]); expect(summary.processed).toBe(1); expect(pages).toBe(2);
    const saved = await result(id); expect(saved.state).toBe('ready');
    expect(saved.data.events).toBe(5); expect(Number(saved.data.windowEnd) - Number(saved.data.windowStart)).toBe(28 * 86400000);
    await actor(db, BUYER);
    const overview = await call(db, 'cockpit_media_calendar_mine', { p_app: 'media-buyer' });
    expect(overview).toMatchObject({ today: [{ eventId: 'multi', start: date(-1), end: date(2) }, { eventId: 'overnight' }], bindingRevision: 1 });
    await owner(db);
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM cockpit_media_native_health WHERE provider IN('google_auth','google') AND ok")).rows[0].count).toBe(3);
    await db.exec('ROLLBACK');
  });
  test('calendar sharing failure never becomes an ok empty day', async () => {
    const id = await enqueue(db, 'personalCalendars.link', { calendarId: 'buyer@example.com', bindingRevision: 0 });
    await new MediaNativeWorker({ apply: true, once: true, supabaseClient: sdk(db), fetchImpl: async input => String(input).startsWith('https://oauth2.googleapis.com/') ? Response.json({ access_token: 'offline-google', token_type: 'Bearer' }) : Response.json({ error: { code: 403 } }, { status: 403 }) }).run();
    const saved = await result(id);
    expect(saved.state).not.toBe('ready'); expect(saved.data.status).toBe('error');
    expect(String(saved.data.error)).toContain('share');
  });
  test('later applied runs ingest human replies with stable IDs, even without new jobs', async () => {
    const id = await enqueue(db);
    const fetchImpl: typeof fetch = async input => String(input).includes('chat.postMessage') ? Response.json({ ok: true, channel: 'D123', ts: '1728000000.000001' }) : Response.json({ ok: true, messages: [{ ts: '1728000000.000001', text: 'Question', bot_id: 'B1' }, { ts: '1728000001.000001', user: 'U123', text: 'Human reviewed it.' }] });
    const worker = new MediaNativeWorker({ apply: true, once: true, supabaseClient: sdk(db), fetchImpl });
    await worker.run(); await owner(db); await db.exec("UPDATE public.cockpit_media_native_threads SET checked_at=now()-interval '2 minutes'"); await db.exec('SET ROLE service_role');
    await worker.run(); await owner(db);
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM public.cockpit_media_native_records WHERE data->>'kind'='reply'")).rows[0].count).toBe(1);
    expect((await result(id)).data.pending).toBe(false);
  });
});
