import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handler, createRuntime} from '../api/team-calendar.js';

const env = process.env;
const originalFetch = globalThis.fetch;
afterEach(() => { process.env = env; globalThis.fetch = originalFetch; });
const request = (path: string, token = 'cron-test') => new Request(`https://example.test/api/team-calendar${path}`, {headers: {authorization: `Bearer ${token}`}});
const config = () => { process.env = {...env, CRON_SECRET: 'cron-test', SUPABASE_URL: 'https://bldgtotkfmhoxmlzowdx.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'service-test'}; };

test('refuses unauthenticated calls before any network or worker execution', async () => {
  config(); let calls = 0;
  globalThis.fetch = async () => {calls++; throw Error('network forbidden');};
  const response = await handler(request('?mode=cron', 'wrong'));
  assert.equal(response.status, 401); assert.equal(calls, 0);
});

test('doctor reports disabled, never claims or calls Google, and gives explicit dependency', async () => {
  config(); delete process.env.TEAM_CALENDAR_WRITES_ENABLED;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {const url = String(input); calls.push(url); assert.match(url, /cockpit_team_calendar_report$/); assert.equal(init?.method, 'POST'); return new Response(null, {status:204});};
  const response = await handler(request('?mode=doctor'));
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.ready, false);
  assert.match(body.reason, /TEAM_CALENDAR_WRITES_ENABLED/);
  assert.equal(calls.length, 1);
});

test('cron remains inert without explicit reviewed enablement', async () => {
  config(); process.env.GOOGLE_CLIENT_ID='id'; process.env.GOOGLE_CLIENT_SECRET='secret'; process.env.GOOGLE_REFRESH_TOKEN='refresh';
  delete process.env.TEAM_CALENDAR_WRITES_ENABLED;
  let calls = 0;
  globalThis.fetch = async () => {calls++; return new Response(null, {status:204});};
  const response = await handler(request('?mode=cron'));
  assert.equal(response.status, 503); assert.equal(calls, 1);
});

test('no Vercel sender cron is activated before its production secrets are configured', () => {
  const config=JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url),'utf8'));
  assert.ok(!config.crons.some((c: {path:string}) => c.path.startsWith('/api/team-calendar')));
});

test('runtime permits recurrence read-back instances', async () => {
  config(); process.env.GOOGLE_CLIENT_ID='id'; process.env.GOOGLE_CLIENT_SECRET='secret'; process.env.GOOGLE_REFRESH_TOKEN='refresh';
  globalThis.fetch = async (input) => String(input).includes('oauth2.googleapis.com') ? Response.json({access_token:'access'}) : Response.json({items:[]});
  assert.equal((await createRuntime().calendar('GET','calendars/primary/events/a/instances',{})).status,200);
});

test('calendar meeting links target the authenticated meeting route', () => {
  config();
  assert.equal(createRuntime().meetingLink('m 1'),'https://cockpit.maharamedia.com/team/m%201');
});

test('runtime uses service-only DB and fenced Google requests with bounded token exchange', async () => {
  config(); process.env.GOOGLE_CLIENT_ID='id'; process.env.GOOGLE_CLIENT_SECRET='secret'; process.env.GOOGLE_REFRESH_TOKEN='refresh'; process.env.TEAM_CALENDAR_WRITES_ENABLED='true';
  const calls: {url:string; method:string; auth:string|null}[] = [];
  globalThis.fetch = async (input, init) => {
    const url=String(input); const headers=new Headers(init?.headers);
    calls.push({url,method:init?.method ?? 'GET',auth:headers.get('authorization')});
    if(url.includes('oauth2.googleapis.com')) return Response.json({access_token:'access',expires_in:3600});
    if(url.includes('googleapis.com')) return Response.json({id:'event'}, {status:200});
    return Response.json([], {status:200});
  };
  const runtime=createRuntime(); assert.equal(runtime.ready(), true);
  assert.deepEqual(await runtime.db('team_calendar_ops?select=status'), []);
  assert.deepEqual(await runtime.rpc('cockpit_team_calendar_claim', {}), []);
  assert.equal((await runtime.calendar('GET','calendars/primary/events', {})).status,200);
  assert.equal(calls.length,4);
  assert.equal(calls[0].auth,'Bearer service-test');
  assert.equal(calls[1].auth,'Bearer service-test');
  assert.equal(calls[3].auth,'Bearer access');
});
