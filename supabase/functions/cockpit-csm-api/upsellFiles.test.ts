import {describe, expect, test} from 'bun:test';
import {runUpsell, UpsellError} from './upsell.ts';
import {CAPTURE_READ_SECONDS, UPSELL_BUCKET} from './upsellFiles.ts';

// The capture upload chain against mocked RPCs and a stand-in bucket. The
// SQL side (the gate, idempotency, Storage's metadata check, the read
// policy, the purge record) is pinned in
// apps/media-buyer-cockpit/scripts/upsell-decks-supabase.test.ts.

const TASK = 'taskA1';
const FILE = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const OTHER = '11111111-2222-4333-8444-555555555555';
const REQUEST = '28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73';
const row = (extra: Record<string, unknown> = {}) => ({
  id: FILE, kind: 'capture', status: 'uploading', mime: 'image/png', bytes: 2048, width: 1280, height: 800, fileName: 'google.png',
  searchedAs: 'Kuwait City', capturedOn: '2026-10-26', caption: null, createdAt: '2026-10-26T09:00:00Z', createdBy: 'csm@maharamedia.com', path: `${TASK}/${FILE}.png`, ...extra,
});
type Rpc = (args: Record<string, unknown>) => {data: unknown; error: {message: string; code?: string} | null};

function bucket(options: {rpc?: Record<string, Rpc>; admin?: Record<string, Rpc>; objects?: Set<string>; signUpload?: 'fail'; remove?: 'fail'; signRead?: 'fail'} = {}) {
  const calls: {name: string; args: Record<string, unknown>}[] = [];
  const adminCalls: {name: string; args: Record<string, unknown>}[] = [];
  const receipts: Record<string, unknown>[] = [];
  const storage: string[] = [];
  const objects = options.objects ?? new Set<string>();
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({name, args});
      const h = options.rpc?.[name];
      if (!h) throw new Error(`unexpected rpc ${name}`);
      return h(args);
    },
    storage: {from(b: string) {
      expect(b).toBe(UPSELL_BUCKET);
      return {async createSignedUrls(paths: string[], expiresIn: number) {
        storage.push(`user:sign-read:${paths.join(',')}:${expiresIn}`);
        if (options.signRead === 'fail') return {data: null, error: {statusCode: '500'}};
        return {data: paths.map(path => ({path, signedUrl: `https://storage.test/sign/${path}?token=read-secret`, error: null})), error: null};
      }};
    }},
  };
  const admin = {
    from(table: string) {
      expect(table).toBe('cockpit_csm_provider_health');
      return {async insert(r: Record<string, unknown>) {
        receipts.push(r);
        return {error: null};
      }};
    },
    async rpc(name: string, args: Record<string, unknown>) {
      adminCalls.push({name, args});
      const h = options.admin?.[name];
      if (!h) throw new Error(`unexpected admin rpc ${name}`);
      return h(args);
    },
    storage: {from(b: string) {
      expect(b).toBe(UPSELL_BUCKET);
      return {
        async createSignedUploadUrl(path: string, opts?: {upsert: boolean}) {
          storage.push(`admin:sign-upload:${path}:${opts?.upsert}`);
          if (options.signUpload === 'fail') return {data: null, error: {statusCode: '400', message: 'The resource already exists'}};
          return {data: {signedUrl: `https://storage.test/upload/${path}?token=upload-secret`, token: 'upload-secret', path}, error: null};
        },
        async uploadToSignedUrl() {
          throw new Error('the browser uploads captures, not the function');
        },
        async info(path: string) {
          storage.push(`admin:info:${path}`);
          return objects.has(path) ? {data: {name: path, size: 2048, contentType: 'image/png'}, error: null} : {data: null, error: {statusCode: '404'}};
        },
        async remove(paths: string[]) {
          storage.push(`admin:remove:${paths.join(',')}`);
          return options.remove === 'fail' ? {data: null, error: {statusCode: '503'}} : {data: paths.map(name => ({name})), error: null};
        },
      };
    }},
  };
  const run = (input: unknown) => runUpsell(client, admin, input, () => undefined, {now: () => Date.parse('2026-10-26T10:00:00Z')});
  return {run, calls, adminCalls, receipts, storage};
}
async function refusal(p: Promise<unknown>): Promise<UpsellError> {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(UpsellError);
    return error as UpsellError;
  }
  throw new Error('Expected a refusal');
}
const reserveInput = (args: Record<string, unknown> = {}) => ({
  operation: 'upsellFiles.reserve', requestId: REQUEST,
  args: {taskId: TASK, kind: 'capture', mime: 'image/png', bytes: 2048, width: 1280, height: 800, fileName: 'google.png', capturedOn: '2026-10-26', searchedAs: 'Kuwait City', ...args},
});

describe('upsellFiles.reserve', () => {
  test('pictures outside the rules are refused before any call', async () => {
    for (const [args, words] of [
      [{mime: 'image/gif'}, 'Add a picture (JPG, PNG or WebP).'], [{mime: 'video/mp4'}, 'Add a picture (JPG, PNG or WebP).'],
      [{bytes: 10_485_761}, 'over 10 MB'], [{bytes: 0}, 'empty'], [{kind: 'logo'}, 'Choose a client and one of its captures.'],
      [{capturedOn: '26 Oct'}, 'Give the day the screenshot was taken.'], [{taskId: '../x'}, 'Choose a client and one of its captures.'],
      [{searchedAs: 'x'.repeat(201)}, 'Keep "searched as" short'], [{extra: true}, 'Choose a client and one of its captures.'],
    ] as [Record<string, unknown>, string][]) {
      const b = bucket();
      expect((await refusal(b.run(reserveInput(args)))).message).toContain(words);
      expect([b.calls, b.storage, b.receipts]).toEqual([[], [], []]);
    }
  });

  test('a reservation gets a non-upserting upload link, with label-only receipts', async () => {
    const b = bucket({rpc: {cockpit_upsell_file_reserve: () => ({data: {id: FILE, path: `${TASK}/${FILE}.png`, kind: 'capture', mime: 'image/png', bytes: 2048, status: 'uploading'}, error: null})}});
    const out = await b.run(reserveInput());
    expect(b.calls).toEqual([{name: 'cockpit_upsell_file_reserve', args: {
      p_request_id: REQUEST, p_task_id: TASK, p_kind: 'capture', p_mime: 'image/png', p_bytes: 2048, p_width: 1280, p_height: 800,
      p_file_name: 'google.png', p_captured_on: '2026-10-26', p_searched_as: 'Kuwait City'}}]);
    expect(out).toEqual({id: FILE, path: `${TASK}/${FILE}.png`, status: 'uploading', uploadUrl: `https://storage.test/upload/${TASK}/${FILE}.png?token=upload-secret`, token: 'upload-secret'});
    expect(b.storage).toEqual([`admin:sign-upload:${TASK}/${FILE}.png:false`]);
    expect(b.receipts).toEqual([
      {provider: 'supabase-storage', method: 'POST', resource: 'cockpit-upsell-files/sign-upload', object_id: FILE, phase: 'intent'},
      {provider: 'supabase-storage', method: 'POST', resource: 'cockpit-upsell-files/sign-upload', object_id: FILE, phase: 'response', http_status: 200},
    ]);
    expect(JSON.stringify(b.receipts)).not.toContain('secret');
  });

  test('a saved picture needs no new link; a removed one asks to add it again; a lost answer after the PUT is found', async () => {
    const reserved = (status: string) => () => ({data: {id: FILE, path: `${TASK}/${FILE}.png`, kind: 'capture', mime: 'image/png', bytes: 2048, status}, error: null});
    let b = bucket({rpc: {cockpit_upsell_file_reserve: reserved('ready')}});
    expect(await b.run(reserveInput())).toEqual({id: FILE, path: `${TASK}/${FILE}.png`, status: 'ready', uploadUrl: null, token: null});
    expect(b.storage).toEqual([]);
    b = bucket({rpc: {cockpit_upsell_file_reserve: reserved('removed')}});
    expect((await refusal(b.run(reserveInput()))).status).toBe(409);
    b = bucket({rpc: {cockpit_upsell_file_reserve: reserved('uploading')}, signUpload: 'fail', objects: new Set([`${TASK}/${FILE}.png`])});
    expect(await b.run(reserveInput())).toMatchObject({uploadUrl: null, uploaded: true});
    b = bucket({rpc: {cockpit_upsell_file_reserve: reserved('uploading')}, signUpload: 'fail'});
    expect((await refusal(b.run(reserveInput()))).message).toBe('The upload link was not created. Try the same picture again.');
  });

  test('the gate, the copy check and a path outside the client\'s folder', async () => {
    let b = bucket({rpc: {cockpit_upsell_file_reserve: () => ({data: null, error: {message: 'That client is not on your access list', code: '42501'}})}});
    expect([(await refusal(b.run(reserveInput()))).status, b.storage]).toEqual([403, []]);
    b = bucket({rpc: {cockpit_upsell_file_reserve: () => ({data: null, error: {message: 'Searched as: Says lead. Say enquiry or client. ("leads")', code: '22023'}})}});
    expect(await refusal(b.run(reserveInput({searchedAs: 'leads in Kuwait'})))).toMatchObject({status: 400, message: 'Searched as: Says lead. Say enquiry or client. ("leads")'});
    b = bucket({rpc: {cockpit_upsell_file_reserve: () => ({data: {id: FILE, path: `otherTask/${FILE}.png`, kind: 'capture', mime: 'image/png', bytes: 2048, status: 'uploading'}, error: null})}});
    expect(await refusal(b.run(reserveInput()))).toMatchObject({status: 502, message: 'The server returned a file path outside this client\'s folder.'});
    expect(b.storage).toEqual([]);
  });
});

describe('upsellFiles.ready, list and remove', () => {
  test('ready: the accept checks Storage in its own transaction, then the seat signs the read', async () => {
    const b = bucket({rpc: {cockpit_upsell_file_accept: () => ({data: row({status: 'ready'}), error: null})}});
    const out = await b.run({operation: 'upsellFiles.ready', args: {taskId: TASK, id: FILE}}) as Record<string, unknown>;
    expect(b.calls).toEqual([{name: 'cockpit_upsell_file_accept', args: {p_task_id: TASK, p_id: FILE}}]);
    expect(out).toMatchObject({id: FILE, status: 'ready', url: `https://storage.test/sign/${TASK}/${FILE}.png?token=read-secret`, expiresIn: CAPTURE_READ_SECONDS});
    expect(b.storage).toEqual([`user:sign-read:${TASK}/${FILE}.png:3600`]);
    const missing = bucket({rpc: {cockpit_upsell_file_accept: () => ({data: null, error: {message: 'The picture did not arrive. Add it again.', code: '22023'}})}});
    expect((await refusal(missing.run({operation: 'upsellFiles.ready', args: {taskId: TASK, id: FILE}}))).message).toBe('The picture did not arrive. Add it again.');
  });

  test('list: every ready capture with a one-hour link, then this client\'s removed and day-old files swept', async () => {
    const stale = [{id: OTHER, path: `${TASK}/${OTHER}.webp`}, {id: FILE, path: `elsewhere/${FILE}.png`}];
    const b = bucket({
      rpc: {
        cockpit_upsell_files_read: () => ({data: {rows: [row({status: 'ready'}), row({id: OTHER, path: `${TASK}/${OTHER}.jpg`, mime: 'image/jpeg', status: 'ready'})]}, error: null}),
        cockpit_upsell_files_stale: () => ({data: stale, error: null}),
      },
      admin: {cockpit_upsell_file_purged: () => ({data: 1, error: null})},
    });
    const out = await b.run({operation: 'upsellFiles.list', args: {taskId: TASK}}) as {rows: Record<string, unknown>[]; expiresIn: number; signedAt: string};
    expect(out.rows.map(r => [r.id, r.url])).toEqual([
      [FILE, `https://storage.test/sign/${TASK}/${FILE}.png?token=read-secret`], [OTHER, `https://storage.test/sign/${TASK}/${OTHER}.jpg?token=read-secret`],
    ]);
    expect([out.expiresIn, out.signedAt]).toEqual([3600, '2026-10-26T10:00:00.000Z']);
    // Only the path inside this client's folder is deleted; the purge is recorded with the service key.
    expect(b.storage).toEqual([`user:sign-read:${TASK}/${FILE}.png,${TASK}/${OTHER}.jpg:3600`, `admin:remove:${TASK}/${OTHER}.webp`]);
    expect(b.adminCalls).toEqual([{name: 'cockpit_upsell_file_purged', args: {p_task_id: TASK, p_ids: [OTHER]}}]);
  });

  test('a sweep that fails never fails the list, and nothing is recorded as purged', async () => {
    const b = bucket({
      rpc: {cockpit_upsell_files_read: () => ({data: {rows: [row({status: 'ready'})]}, error: null}), cockpit_upsell_files_stale: () => ({data: [{id: OTHER, path: `${TASK}/${OTHER}.png`}], error: null})},
      remove: 'fail',
    });
    expect(((await b.run({operation: 'upsellFiles.list', args: {taskId: TASK}})) as {rows: unknown[]}).rows.length).toBe(1);
    expect(b.adminCalls).toEqual([]);
    expect(b.receipts.at(-1)).toEqual({provider: 'supabase-storage', method: 'DELETE', resource: 'cockpit-upsell-files/delete-object', object_id: OTHER, phase: 'response', http_status: 503});
  });

  test('list: links Storage did not sign are an error, never guessed; a row not ready is refused', async () => {
    const b = bucket({rpc: {cockpit_upsell_files_read: () => ({data: {rows: [row({status: 'ready'})]}, error: null})}, signRead: 'fail'});
    expect((await refusal(b.run({operation: 'upsellFiles.list', args: {taskId: TASK}}))).message).toBe('The captures\' read links were not created. Open it again.');
    const c = bucket({rpc: {cockpit_upsell_files_read: () => ({data: {rows: [row({status: 'uploading'})]}, error: null})}});
    expect((await refusal(c.run({operation: 'upsellFiles.list', args: {taskId: TASK}}))).status).toBe(502);
  });

  test('remove: the row stays for the audit, the bytes go now', async () => {
    const b = bucket({
      rpc: {cockpit_upsell_file_remove: () => ({data: row({status: 'removed'}), error: null})},
      admin: {cockpit_upsell_file_purged: () => ({data: 1, error: null})},
    });
    expect(await b.run({operation: 'upsellFiles.remove', args: {taskId: TASK, id: FILE}})).toMatchObject({id: FILE, status: 'removed', deleted: true});
    expect(b.storage).toEqual([`admin:remove:${TASK}/${FILE}.png`]);
    expect(b.adminCalls.map(c => c.name)).toEqual(['cockpit_upsell_file_purged']);
    const other = bucket({rpc: {cockpit_upsell_file_remove: () => ({data: null, error: {message: 'That file is not one of this client\'s captures.', code: '42501'}})}});
    expect((await refusal(other.run({operation: 'upsellFiles.remove', args: {taskId: TASK, id: FILE}}))).status).toBe(403);
    expect(other.storage).toEqual([]);
  });
});
