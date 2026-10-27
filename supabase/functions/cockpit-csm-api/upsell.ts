import {z} from 'zod';
import {storageTools, WebValidationError, type WebGet, type WebResolver, webTools} from './tools.ts';
import {runUpsellFiles} from './upsellFiles.ts';
import {runLogoFind, runLogoPick} from './upsellLogo.ts';
import {checkSite, logoCandidates, siteAddress, type SiteResult} from './upsellSite.ts';
import {checkVideo, parseVideoLink} from './upsellVideo.ts';

/**
 * The upsell studio's on-demand checks and uploads (docs/upsell-studio/EDGE.md).
 *
 * index.ts verifies the sign-in, then hands the request here. Every RPC runs
 * as the signed-in seat, so the per-client gate (cockpit_csm_client_gate) or
 * the client success seat rule (cockpit_csm_actor, through the price list's
 * read) decides. The service key is used only for Storage (signing uploads,
 * deleting bytes, the purge record) and for receipts in
 * cockpit_csm_provider_health. Every
 * outside read goes through tools.ts webTools. Nothing here writes to
 * ClickUp, GoHighLevel, Meta, Slack or cockpit_client_logos.
 */
export const UPSELL_OPERATIONS = [
  'upsell.siteCheck', 'upsell.videoCheck', 'upsell.logoFind', 'upsell.logoPick',
  'upsellFiles.reserve', 'upsellFiles.ready', 'upsellFiles.list', 'upsellFiles.remove',
];

export class UpsellError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type RpcError = {message: string; code?: string; details?: string | null};
type RpcResult = {data: unknown; error: RpcError | null};
type Signed = {path: string | null; signedUrl: string | null; error: string | null};
export type UpsellClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: {from: (bucket: string) => {createSignedUrls: (paths: string[], expiresIn: number) => Promise<{data: Signed[] | null; error: unknown}>}};
};
export type UpsellAdmin = {
  from: (table: string) => {insert: (row: Record<string, unknown>) => PromiseLike<{error: unknown}>};
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: {
    from: (bucket: string) => {
      createSignedUploadUrl: (path: string, options?: {upsert: boolean}) => Promise<{data: {signedUrl: string; token: string; path?: string} | null; error: unknown}>;
      uploadToSignedUrl: (path: string, token: string, body: Uint8Array, options?: {contentType?: string; upsert?: boolean}) => Promise<{data: unknown; error: unknown}>;
      info: (path: string) => Promise<{data: unknown; error: unknown}>;
      remove: (paths: string[]) => Promise<{data: unknown; error: unknown}>;
    };
  };
};
export type UpsellCtx = {
  client: UpsellClient;
  admin: UpsellAdmin;
  web: {get: WebGet};
  store: ReturnType<typeof storageTools>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  env: (name: string) => string | undefined;
  now: () => number;
};
export type UpsellDeps = {request?: typeof fetch; resolve?: WebResolver; now?: () => number};

/** Deno.resolveDns where the runtime has it: a host's A and AAAA addresses, [] when the name does not exist. */
export function denoResolver(): WebResolver | undefined {
  const d = (globalThis as {Deno?: {resolveDns?: (host: string, type: 'A' | 'AAAA') => Promise<string[]>}}).Deno;
  const lookup = d?.resolveDns;
  if (typeof lookup !== 'function') return undefined;
  return async host => {
    const out: string[] = [];
    for (const type of ['A', 'AAAA'] as const) {
      try {
        out.push(...(await lookup.call(d, host, type)));
      } catch (error) {
        // No record of this type is an answer; anything else means "could not look it up here".
        if ((error as {name?: string})?.name !== 'NotFound') return null;
      }
    }
    return out;
  };
}

const taskId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const id = z.string().uuid();
const meta = {requestId: z.string().uuid().optional(), apply: z.boolean().optional()};
const captureMimes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const inputSchema = z.discriminatedUnion('operation', [
  z.object({operation: z.literal('upsell.siteCheck'), ...meta, args: z.object({taskId, url: z.string().max(300).nullish()}).strict()}).strict(),
  // 2000, not the parser's 500: a longer paste reaches parseVideoLink, which says the link is too long.
  z.object({operation: z.literal('upsell.videoCheck'), ...meta, args: z.object({url: z.string().min(1).max(2000)}).strict()}).strict(),
  z.object({operation: z.literal('upsell.logoFind'), ...meta, args: z.object({taskId}).strict()}).strict(),
  // A write to the launch tray: the request id makes a retry return the saved row, never a second one.
  z.object({operation: z.literal('upsell.logoPick'), requestId: z.string().uuid(), apply: z.boolean().optional(), args: z.object({taskId, url: z.string().min(1).max(2000)}).strict()}).strict(),
  z.object({
    operation: z.literal('upsellFiles.reserve'), requestId: z.string().uuid(), apply: z.boolean().optional(),
    args: z.object({
      taskId, kind: z.literal('capture'), mime: z.enum(captureMimes), bytes: z.number().int().min(1).max(10_485_760),
      width: z.number().int().min(1).max(20000).nullish(), height: z.number().int().min(1).max(20000).nullish(),
      fileName: z.string().max(400).nullish(), capturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), searchedAs: z.string().max(200).nullish(),
    }).strict(),
  }).strict(),
  z.object({operation: z.literal('upsellFiles.ready'), ...meta, args: z.object({taskId, id}).strict()}).strict(),
  z.object({operation: z.literal('upsellFiles.list'), ...meta, args: z.object({taskId}).strict()}).strict(),
  z.object({operation: z.literal('upsellFiles.remove'), ...meta, args: z.object({taskId, id}).strict()}).strict(),
]);
export type UpsellInput = z.infer<typeof inputSchema>;

/** The words a CSM reads when a request is not valid. */
function inputProblem(raw: unknown, issues: z.ZodIssue[]): string {
  const operation = typeof raw === 'object' && raw !== null ? String((raw as Record<string, unknown>).operation ?? '') : '';
  const at = (key: string) => issues.some(issue => issue.path.includes(key));
  if (operation === 'upsellFiles.reserve') {
    if (at('requestId')) return 'An upload request id is required.';
    if (at('mime')) return 'Add a picture (JPG, PNG or WebP).';
    if (at('bytes')) return 'The picture is empty or over 10 MB. Export a smaller copy.';
    if (at('width') || at('height')) {
      const tooBig = issues.some(issue => (issue.path.includes('width') || issue.path.includes('height')) && issue.code === 'too_big');
      return tooBig
        ? 'The picture is over 20,000 pixels on a side. Crop it to the part that shows the gap, then add it again.'
        : 'The picture\'s size could not be read. Add it again.';
    }
    if (at('fileName')) return 'The file name is too long. Rename the file, then add it again.';
    if (at('capturedOn')) return 'Give the day the screenshot was taken.';
    if (at('searchedAs')) return 'Keep "searched as" short: a city or a few words.';
  }
  if (operation === 'upsell.videoCheck') {
    if (issues.some(issue => issue.path.includes('url') && issue.code === 'too_big')) return 'That link is too long. Copy the video\'s share link.';
    return 'Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.';
  }
  if (operation === 'upsell.siteCheck' && at('url')) return 'The address is over 300 characters. Fix it, then check again.';
  if (operation === 'upsell.logoPick' && at('requestId')) return 'A request id is required to save a logo.';
  if (operation === 'upsell.logoPick' && at('url')) return 'Pick one of the pictures found on the client\'s site.';
  if (operation.startsWith('upsellFiles.')) return 'Choose a client and one of its captures.';
  return UPSELL_OPERATIONS.includes(operation) ? 'Open this from the client\'s page and try again.' : 'Unknown upsell operation.';
}

/** A database refusal as the seat should read it: the gate's 42501 is a 403, a stale revision a 409. */
function rpcProblem(error: RpcError): UpsellError {
  if (error.code === '42501') return new UpsellError(error.message || 'This client is outside your cockpit.', 403);
  if (error.code === '40001') return new UpsellError(error.message || 'Someone else saved this. Read it again.', 409);
  if (/^PGRST2/.test(error.code ?? '') || error.code === '42883')
    return new UpsellError('Offers are not set up on the server yet. Tell the CEO.', 503);
  return new UpsellError(error.message || 'The server did not confirm this. Try again.', 400);
}

type SiteCheckRow = SiteResult & {url: string; source: 'card' | 'onboarding' | 'prep'; recorded: boolean};
const sourcesSchema = z.object({site: z.object({
  urls: z.array(z.object({url: z.string(), from: z.enum(['card', 'onboarding', 'prep'])}).passthrough()),
  // The latest checks (the verdict keeps ten), so the hourly cap is known before anything is read.
  checks: z.array(z.object({checkedAt: z.string()}).passthrough()).optional(),
}).passthrough()}).passthrough();
/** cockpit_client_site_check_record's own limit: 6 checks per client per hour. */
export const SITE_CHECKS_PER_HOUR = 6;
const CAP_SENTENCE = 'Checked 6 times this hour. Try again later.';
const urlKey = (u: string) => u.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

async function siteCheck(ctx: UpsellCtx, task: string, given: string | null | undefined) {
  // The gate first (as the seat), and the addresses on file: card, onboarding form, prep.
  const sources = sourcesSchema.safeParse(await ctx.rpc('cockpit_csm_offer_sources', {p_task_id: task, p_offer: 'website'}));
  if (!sources.success) throw new UpsellError('The server did not return this client\'s site. Try again.', 502);
  const onFile = sources.data.site.urls;
  const list: {raw: string; source: SiteCheckRow['source']}[] = [];
  const add = (raw: string, source: SiteCheckRow['source']) => {
    if (raw.trim() && !list.some(x => urlKey(x.raw) === urlKey(raw))) list.push({raw: raw.trim(), source});
  };
  if (given?.trim()) add(given, onFile.find(u => urlKey(u.url) === urlKey(given))?.from ?? 'prep');
  for (const u of onFile) add(u.url, u.from);
  if (!list.length) {
    return {checks: [], verdict: sources.data.site, logoCandidates: [], note: 'No website on file: not on the card, the onboarding form or prep. Type one in prep to check it.'};
  }

  // The cap before any outside read: a capped click reads nothing and writes no receipts. The record
  // function still counts on its side (a check of an address not on file is not in this list).
  const hourAgo = ctx.now() - 3_600_000;
  const recent = (sources.data.site.checks ?? []).filter(c => {
    const at = Date.parse(c.checkedAt);
    return Number.isFinite(at) && at > hourAgo;
  }).length;
  if (recent >= SITE_CHECKS_PER_HOUR) return {checks: [], verdict: sources.data.site, logoCandidates: [], note: CAP_SENTENCE};

  const checks: SiteCheckRow[] = [];
  let verdict: unknown = sources.data.site;
  let logos: ReturnType<typeof logoCandidates> = [];
  let note: string | null = null;
  for (const {raw, source} of list.slice(0, Math.min(3, SITE_CHECKS_PER_HOUR - recent))) {
    const address = siteAddress(raw);
    if (!address.url) {
      // Not a web address at all: nothing to check or record. The CSM fixes it where it came from.
      checks.push({url: raw, source, status: 'refused', httpStatus: null, finalUrl: null, title: null, note: address.problem ?? 'Not a web address.', recorded: false});
      continue;
    }
    const {result, html, finalUrl} = await checkSite(ctx.web, address.url);
    if (html && finalUrl && !logos.length) logos = logoCandidates(html, finalUrl);
    const {data, error} = await ctx.client.rpc('cockpit_client_site_check_record', {
      p_task_id: task, p_url: address.url, p_source: source,
      p_result: {status: result.status, httpStatus: result.httpStatus, finalUrl: result.finalUrl, title: result.title},
    });
    if (error) {
      // The hourly cap: what was checked so far still comes back, unrecorded, with the sentence.
      if (error.code === '22023' && checks.some(c => c.recorded)) {
        checks.push({...result, url: address.url, source, recorded: false});
        note = error.message;
        break;
      }
      throw rpcProblem(error);
    }
    const recorded = z.object({verdict: z.unknown()}).passthrough().safeParse(data);
    if (recorded.success) verdict = recorded.data.verdict;
    checks.push({...result, url: address.url, source, recorded: true});
  }
  return {checks, verdict, logoCandidates: logos, note};
}

async function videoCheck(ctx: UpsellCtx, url: string) {
  // Client success seats and the CEO only, so nobody else can make this function read outside: the price
  // list's own read checks the seat (cockpit_csm_actor, 42501 otherwise) before anything is parsed or read.
  await ctx.rpc('cockpit_upsell_catalog_read', {});
  // The decks' own link rule (cockpit_csm_deck_video_parse, ported in upsellVideo.ts and compared in PGlite).
  const parsed = parseVideoLink(url);
  if (!parsed.ok) return {ok: false, provider: null, url: null, embedUrl: null, title: null, durationSeconds: null, posterUrl: null, refusal: parsed.refusal};
  return checkVideo(ctx.web, parsed.video);
}

export async function runUpsell(client: UpsellClient, admin: UpsellAdmin, raw: unknown, env: (name: string) => string | undefined, deps: UpsellDeps = {}) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new UpsellError(inputProblem(raw, parsed.error.issues));
  const input = parsed.data;
  const health = async (row: Record<string, unknown>) => {
    const {error} = await admin.from('cockpit_csm_provider_health').insert(row);
    if (error) throw new UpsellError('The cockpit could not log this check, so nothing was read or changed. Try again in a minute. If it keeps happening, tell the CEO.', 503);
  };
  const reads = webTools(health, deps.request ?? fetch, deps.resolve ?? denoResolver());
  const ctx: UpsellCtx = {
    client, admin, env,
    web: {get: async (url, options) => {
      try { return await reads.get(url, options); }
      catch (error) {
        // A runtime lookup failure must not be recorded as a failing client site.
        if (error instanceof WebValidationError) throw new UpsellError(error.message, 503);
        throw error;
      }
    }},
    store: storageTools(health),
    rpc: async (name, args) => {
      const {data, error} = await client.rpc(name, args);
      if (error) throw rpcProblem(error);
      return data;
    },
    now: deps.now ?? Date.now,
  };
  switch (input.operation) {
    case 'upsell.siteCheck':
      return siteCheck(ctx, input.args.taskId, input.args.url);
    case 'upsell.videoCheck':
      return videoCheck(ctx, input.args.url);
    case 'upsell.logoFind':
      return runLogoFind(ctx, input.args.taskId);
    case 'upsell.logoPick':
      return runLogoPick(ctx, input.args.taskId, input.args.url, input.requestId);
    default:
      return runUpsellFiles(ctx, input.operation, input.args as Record<string, unknown>, input.requestId);
  }
}
