/* Server-only team calendar doctor and explicitly enabled cron sender. */
import {createTeamCalendarWorker, type TeamCalendarRuntime} from '../src/lib/teamCalendarWorker.js';
import {serviceConfig} from './tools.js';

const TARGET = 'https://bldgtotkfmhoxmlzowdx.supabase.co';
const GOOGLE = 'https://www.googleapis.com/calendar/v3/';
const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control':'no-store'}});

function dependency(): string | null {
  if (!process.env.CRON_SECRET) return 'CRON_SECRET is missing';
  if (!serviceConfig()) return 'Creative Triage SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required';
  const missing = names.filter(k => !process.env[k]);
  if (missing.length) return `Missing Google credentials: ${missing.join(', ')}`;
  if (process.env.TEAM_CALENDAR_WRITES_ENABLED !== 'true') return 'TEAM_CALENDAR_WRITES_ENABLED is not true; review the queue and Google Calendar OAuth scope before enabling';
  return null;
}

async function remote(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, {...init, redirect:'error', signal:AbortSignal.timeout(15000)});
  if (!response.ok && response.status !== 204) throw new Error(`Upstream HTTP ${response.status}`);
  return response;
}

export function createRuntime(): TeamCalendarRuntime {
  const config = serviceConfig();
  if (!config) throw new Error('Creative Triage service configuration is unavailable');
  const {url: serviceUrl, key: serviceKey} = config;
  async function database(path: string, init: {method?: string;body?:unknown;prefer?:string} = {}) {
    if (!/^(team_[a-z_]+|cockpit_team_calendar_worker)(\?|$)/.test(path) || path.includes('..')) throw new Error('Unapproved team table');
    const response = await remote(`${serviceUrl}/rest/v1/${path}`, {method:init.method ?? 'GET', headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',...(init.prefer ? {Prefer:init.prefer}:{})},...(init.body === undefined ? {}:{body:JSON.stringify(init.body)})});
    return response.status === 204 ? [] : response.json();
  }
  async function rpc(name: string, args: Record<string,unknown>) {
    if (!['cockpit_team_calendar_report','cockpit_team_calendar_claim','cockpit_team_calendar_renew','cockpit_team_calendar_finish'].includes(name)) throw new Error('Unapproved team RPC');
    const response = await remote(`${serviceUrl}/rest/v1/rpc/${name}`, {method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
    return response.status === 204 ? null : response.json();
  }
  let token: string | null = null;
  let expires = 0;
  async function accessToken() {
    if (token && Date.now() < expires) return token;
    const response = await remote('https://oauth2.googleapis.com/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID ?? '',client_secret:process.env.GOOGLE_CLIENT_SECRET ?? '',refresh_token:process.env.GOOGLE_REFRESH_TOKEN ?? '',grant_type:'refresh_token'})});
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('access_token' in result) || typeof result.access_token !== 'string') throw new Error('Google OAuth did not return an access token');
    token = result.access_token;
    expires = Date.now() + Math.max(0, Number('expires_in' in result ? result.expires_in : 3600) - 90) * 1000;
    return token;
  }
  return {
    db: database, rpc, ready: () => dependency() === null,
    meetingLink: id => `https://cockpit.maharamedia.com/team/${encodeURIComponent(id)}`,
    async calendar(method,path,options) {
      if (!['GET','POST','PATCH','DELETE'].includes(method) || !/^calendars\/[^/?#]+\/events(?:\/[^/?#]+(?:\/instances)?)?$/.test(path)) throw new Error('Unapproved Google Calendar request');
      const url = new URL(path,GOOGLE);
      for (const [k,v] of Object.entries(options.query ?? {})) url.searchParams.set(k,v);
      const response = await fetch(url, {method,headers:{Authorization:`Bearer ${await accessToken()}`,...(options.body === undefined ? {}:{'Content-Type':'application/json'}),...(options.etag ? {'If-Match':options.etag}:{})},...(options.body === undefined ? {}:{body:JSON.stringify(options.body)}),redirect:'error',signal:AbortSignal.timeout(15000)});
      return {status:response.status,json:response.status === 204 ? null : await response.json()};
    },
  };
}

function authorized(header: string | null) {
  const expected = process.env.CRON_SECRET;
  if (!expected || !header) return false;
  const wanted = `Bearer ${expected}`;
  let different = header.length ^ wanted.length;
  for (let i=0;i<Math.max(header.length,wanted.length);i++) different |= (header.charCodeAt(i) || 0) ^ (wanted.charCodeAt(i) || 0);
  return different === 0;
}

export async function handler(request: Request): Promise<Response> {
  if (!authorized(request.headers.get('authorization'))) return json({error:'Unauthorized'},401);
  if (request.method !== 'GET') return json({error:'Method not allowed'},405);
  const mode = new URL(request.url).searchParams.get('mode') ?? 'cron';
  if (!['doctor','cron'].includes(mode)) return json({error:'Unknown mode'},400);
  const reason = dependency();
  const config = serviceConfig();
  if (!config) return json({ready:false,reason},503);
  try {
    const runtime = createRuntime();
    await runtime.rpc('cockpit_team_calendar_report',{p_ready: !reason,p_error:reason});
    if (mode === 'doctor') return json({ready:!reason,reason});
    if (reason) return json({ready:false,reason},503);
    // Queue is read before any claim. Enable only after a human has reviewed live operations.
    const queue = await runtime.db('team_calendar_ops?select=status&status=in.(pending,running,failed)&limit=1000') as {status:string}[];
    const failures = queue.filter(row => row.status === 'failed').length;
    const results = await createTeamCalendarWorker(runtime).drain(1);
    return json({ready:true,waiting:queue.filter(row => row.status === 'pending' || row.status === 'running').length,failed:failures,processed:results.length,succeeded:results.filter(row => row.done).length});
  } catch (error) {
    console.error('team calendar worker: request failed', error instanceof Error ? error.name : 'UnknownError');
    return json({ready:false,error:'Team Calendar worker could not complete; check server logs and service configuration'},503);
  }
}
export default handler;
