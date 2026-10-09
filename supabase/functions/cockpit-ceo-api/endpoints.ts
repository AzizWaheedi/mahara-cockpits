/**
 * Wiring for the CEO endpoints that used to live on Convex: the extension
 * field on ClickUp and the posting desk. Pitch times are a plain founder RPC
 * (cockpit_ceo_webinar_pitch_set) and never pass through here.
 *
 * Every provider call goes through a tools.ts helper, so it lands in
 * cockpit_ceo_provider_health. Every row change goes through a service-only
 * RPC in supabase/migrations/20261009d_ceo_endpoints_native.sql, which checks
 * the founder again and writes the audit row in the same transaction.
 */
import { clickupRequest, metaGraph, metaGraphPost, typeformRead } from './tools.ts';
import { applyExtensions, type ApplyResult, type Card, CLIENTS_LIST, EXT_PATH, EXTENSION_FIELD_ENV, type ExtensionDeps, fieldIdFrom, kuwaitDay } from './extensions.ts';
import { POSTING_BUCKET, postingOperation, type PostingStore } from './posting.ts';

type Row = Record<string, unknown>;
type Env = (name: string) => string | undefined;
type Health = (row: Row) => Promise<void>;
// deno-lint-ignore no-explicit-any
type Admin = any;

const CLICKUP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);

async function rpc(admin: Admin, name: string, args: Row): Promise<unknown> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw Error(typeof error.message === 'string' && error.message ? error.message : 'The server did not confirm this action.');
  return data;
}

/** The extension pass's reads and writes. `actorId` null is the automatic pass. */
export function extensionDeps(admin: Admin, env: Env, health: Health, actorId: string | null, request: typeof fetch = fetch): ExtensionDeps {
  return {
    async fieldId() {
      const override = env(EXTENSION_FIELD_ENV);
      if (override?.trim()) return fieldIdFrom(override, null);
      return fieldIdFrom(undefined, await clickupRequest(env, health, request, 'GET', `list/${CLIENTS_LIST}/field`));
    },
    async readForm() {
      const body = await typeformRead(env, health, request, EXT_PATH);
      if (!Array.isArray(body.items)) throw Error('the form read came back without responses');
      return body.items;
    },
    async cards() {
      const data = await rpc(admin, 'cockpit_ceo_extension_cards', {});
      if (!Array.isArray(data)) throw Error('the billing snapshot was not confirmed');
      return data.filter(isRow).map((r): Card => ({ taskId: String(r.taskId), name: String(r.name ?? ''), stage: r.stage === null ? null : String(r.stage ?? '') }));
    },
    async lastWritten(fieldId) {
      const { data, error } = await admin.from('cockpit_ceo_extension_field_writes').select('clickup_task_id,weeks').eq('field_id', fieldId);
      if (error || !Array.isArray(data)) throw Error('the write memory is unavailable');
      return Object.fromEntries(data.filter(isRow).map((r: Row) => [String(r.clickup_task_id), Number(r.weeks)]));
    },
    async write(taskId, fieldId, weeks) {
      if (!CLICKUP_ID.test(taskId) || !CLICKUP_ID.test(fieldId)) throw Error('the card or field ID is invalid');
      await clickupRequest(env, health, request, 'POST', `task/${taskId}/field/${fieldId}`, { value: weeks }, 'task/field');
    },
    async record(write, fieldId, what) {
      const saved = await rpc(admin, 'cockpit_ceo_extension_write_record', {
        p_actor_id: actorId,
        p_write: { taskId: write.taskId, client: write.client, weeks: write.weeks, until: write.until, grantedDay: write.grantedDay, fieldId, what },
      });
      if (!isRow(saved) || saved.ok !== true) throw Error('the audit row was not confirmed');
    },
    today: () => kuwaitDay(),
  };
}

/** Rows and short links for the posting desk, through the service key. */
export function postingStore(admin: Admin): PostingStore {
  return {
    async list(limit) {
      const { data, error } = await admin.from('cockpit_posts').select('*').neq('status', 'discarded').order('created_at', { ascending: false }).limit(limit);
      if (error || !Array.isArray(data)) throw Error('The posts could not be read. Apply supabase/migrations/20261009d_ceo_endpoints_native.sql.');
      return data;
    },
    async one(id) {
      const { data, error } = await admin.from('cockpit_posts').select('*').eq('id', id).maybeSingle();
      if (error) throw Error('The post could not be read.');
      return isRow(data) ? data : null;
    },
    async channels() {
      const { data, error } = await admin.from('cockpit_channels').select('*').order('platform', { ascending: true });
      if (error || !Array.isArray(data)) throw Error('The publishing channels could not be read.');
      return data;
    },
    rpc: (name, args) => rpc(admin, name, args),
    async sign(paths, expiresIn) {
      const out = new Map<string, string>();
      if (!paths.length) return out;
      const { data, error } = await admin.storage.from(POSTING_BUCKET).createSignedUrls(paths, expiresIn);
      if (error || !Array.isArray(data)) return out;
      for (const item of data) if (isRow(item) && !item.error && typeof item.path === 'string' && typeof item.signedUrl === 'string') out.set(item.path, item.signedUrl);
      return out;
    },
    async uploadUrl(path) {
      const { data, error } = await admin.storage.from(POSTING_BUCKET).createSignedUploadUrl(path);
      if (error || !isRow(data) || typeof data.signedUrl !== 'string') throw Error('Supabase gave no upload link. Try again in a minute.');
      return data.signedUrl;
    },
  };
}

/**
 * The CEO endpoints this module owns, or undefined when the operation is not
 * one of them. The caller has already checked the founder session.
 */
export async function ceoEndpoint(
  operation: string,
  args: Row,
  ctx: { admin: Admin; env: Env; health: Health; actorId: string; apply: boolean; request?: typeof fetch },
): Promise<unknown | undefined> {
  const request = ctx.request ?? fetch;
  if (operation === 'ceo.extensions.applyToClickUp') {
    // The button sends every value; without apply it only reports the plan.
    return applyExtensions(extensionDeps(ctx.admin, ctx.env, ctx.health, ctx.actorId, request), { force: true, apply: ctx.apply });
  }
  if (operation.startsWith('ceo.posting.')) {
    return postingOperation(operation.slice('ceo.posting.'.length), args, {
      store: postingStore(ctx.admin),
      graph: {
        get: (path, params, label) => metaGraph(ctx.env, ctx.health, request, path, params, label),
        post: (path, params, label) => metaGraphPost(ctx.env, ctx.health, request, path, params, label),
      },
      actorId: ctx.actorId,
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      pollBudgetMs: 75_000,
    }, ctx.apply);
  }
  return undefined;
}

/**
 * The automatic extension pass, from the cron door. It sends only the values
 * that changed since the last confirmed write, and it is a dry run unless
 * CEO_EXTENSIONS_APPLY is 'true'. Its last run lands in cockpit_sync_state.
 */
export async function extensionsAuto(admin: Admin, env: Env, health: Health, request: typeof fetch = fetch): Promise<ApplyResult> {
  const apply = env('CEO_EXTENSIONS_APPLY') === 'true';
  const result = await applyExtensions(extensionDeps(admin, env, health, null, request), { force: false, apply });
  const at = new Date().toISOString();
  const state: Row = { key: 'ceo-extensions-auto', last_run_at: at, ok: result.ok, note: result.note.slice(0, 500), rows_seen: result.written + result.cleared, updated_at: at };
  if (result.ok) state.last_ok_at = at;
  const { error } = await admin.from('cockpit_sync_state').upsert(state, { onConflict: 'key' });
  if (error) throw Error('The automatic extension pass ran, but its run state was not saved.');
  return result;
}
