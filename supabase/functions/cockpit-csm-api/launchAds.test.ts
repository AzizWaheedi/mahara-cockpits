import {describe, expect, test} from 'bun:test';
import {LAUNCH_BUCKET, LAUNCH_MAX_BYTES, LaunchAdsError, READ_SECONDS, runLaunchAds} from './launchAds.ts';

// The launch deck's upload flow against mocked RPCs and a mocked Storage.
// The SQL side (gate, ownership, metadata check, audit rows, read policy) is
// pinned in apps/media-buyer-cockpit/scripts/csm-decks-supabase.test.ts.

const TASK = 'taskA1';
const AD = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const REQUEST = '28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73';
const ad = (extra: Record<string, unknown> = {}) => ({
  id: AD, taskId: TASK, kind: 'custom', status: 'uploading', path: `${TASK}/${AD}.mp4`, mime: 'video/mp4', bytes: 5000,
  posterPath: `${TASK}/${AD}-poster.jpg`, posterMime: 'image/jpeg', posterBytes: 300, fileName: 'reel.mp4', hidden: false,
  primaryText: null, headline: null, cta: null, language: null, placement: null, createdBy: 'csm@maharamedia.com', ...extra,
});
const picture = (extra: Record<string, unknown> = {}) => ad({path: `${TASK}/${AD}.png`, mime: 'image/png', bytes: 20, posterPath: null, posterMime: null, posterBytes: null, ...extra});

type Rpc = (args: Record<string, unknown>) => {data: unknown; error: {message: string; code?: string} | null};
function fixture(options: {
  rpc?: Record<string, Rpc>;
  objects?: Record<string, {size: number; contentType: string}>;
  signUpload?: (path: string) => {data: unknown; error: unknown};
  signRead?: (paths: string[]) => {data: unknown; error: unknown};
  removeError?: unknown;
  healthError?: boolean;
} = {}) {
  const calls: {name: string; args: Record<string, unknown>}[] = [];
  const receipts: Record<string, unknown>[] = [];
  const storage: string[] = [];
  const objects = options.objects ?? {};
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({name, args});
      const handler = options.rpc?.[name];
      if (!handler) throw new Error(`unexpected rpc ${name}`);
      return handler(args);
    },
    storage: {
      from(bucket: string) {
        expect(bucket).toBe(LAUNCH_BUCKET);
        return {
          async createSignedUrls(paths: string[], expiresIn: number) {
            storage.push(`user:sign-read:${paths.join(',')}:${expiresIn}`);
            return options.signRead?.(paths) ?? {data: paths.map(path => ({path, signedUrl: `https://storage.test/sign/${path}?token=read-secret`, error: null})), error: null};
          },
        };
      },
    },
  };
  const admin = {
    from(table: string) {
      expect(table).toBe('cockpit_csm_provider_health');
      return {async insert(row: Record<string, unknown>) {receipts.push(row); return {error: options.healthError ? {message: 'ledger down'} : null};}};
    },
    storage: {
      from(bucket: string) {
        expect(bucket).toBe(LAUNCH_BUCKET);
        return {
          async createSignedUploadUrl(path: string, opts?: {upsert: boolean}) {
            storage.push(`admin:sign-upload:${path}:${opts?.upsert}`);
            return options.signUpload?.(path) ?? {data: {signedUrl: `https://storage.test/upload/${path}?token=upload-secret`, token: 'upload-secret', path}, error: null};
          },
          async info(path: string) {
            storage.push(`admin:info:${path}`);
            const found = objects[path];
            return found ? {data: {name: path, ...found}, error: null} : {data: null, error: {statusCode: '404', message: 'Object not found'}};
          },
          async remove(paths: string[]) {
            storage.push(`admin:remove:${paths.join(',')}`);
            return options.removeError ? {data: null, error: options.removeError} : {data: paths.map(name => ({name})), error: null};
          },
        };
      },
    },
  };
  return {client, admin, calls, receipts, storage};
}
async function refusal(promise: Promise<unknown>): Promise<LaunchAdsError> {
  try {await promise;} catch (error) {
    expect(error).toBeInstanceOf(LaunchAdsError);
    return error as LaunchAdsError;
  }
  throw new Error('Expected a refusal');
}
const reserveInput = (args: Record<string, unknown> = {}) => ({
  operation: 'launchAds.reserve', requestId: REQUEST,
  args: {taskId: TASK, kind: 'custom', mime: 'video/mp4', bytes: 5000, width: 1080, height: 1920, seconds: 12.5, fileName: 'reel.mp4', poster: {mime: 'image/jpeg', bytes: 300}, ...args},
});

describe('launchAds.reserve', () => {
  test('files outside the rules are refused before any RPC or storage call', async () => {
    for (const [args, words] of [
      [{mime: 'application/pdf'}, 'Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM).'],
      [{bytes: LAUNCH_MAX_BYTES + 1}, 'over 150 MB'],
      [{bytes: 0}, 'empty'],
      [{poster: {mime: 'image/gif', bytes: 10}}, 'poster is a JPG, PNG or WebP'],
      [{mime: 'image/png', poster: {mime: 'image/jpeg', bytes: 10}}, 'Only a video has a poster.'],
      [{taskId: '../other'}, 'Choose a client and one of its files.'],
      [{extra: 1}, 'Choose a client and one of its files.'],
    ] as [Record<string, unknown>, string][]) {
      const f = fixture();
      expect((await refusal(runLaunchAds(f.client, f.admin, reserveInput(args)))).message).toContain(words);
      expect(f.calls).toEqual([]);
      expect(f.storage).toEqual([]);
      expect(f.receipts).toEqual([]);
    }
    const f = fixture();
    expect((await refusal(runLaunchAds(f.client, f.admin, {...reserveInput(), requestId: 'nope'}))).message).toBe('An upload request id is required.');
  });

  test('the gate refuses another client with a 403 and nothing is signed', async () => {
    const f = fixture({rpc: {cockpit_csm_launch_ad_reserve: () => ({data: null, error: {message: 'That client is not on your access list', code: '42501'}})}});
    const error = await refusal(runLaunchAds(f.client, f.admin, reserveInput()));
    expect([error.status, error.message]).toEqual([403, 'That client is not on your access list']);
    expect(f.storage).toEqual([]);
  });

  test('a reservation gets non-upserting upload links for the file and its poster, with label-only receipts', async () => {
    const f = fixture({rpc: {cockpit_csm_launch_ad_reserve: () => ({data: ad(), error: null})}});
    const out = await runLaunchAds(f.client, f.admin, reserveInput()) as Record<string, any>;
    expect(f.calls).toEqual([{name: 'cockpit_csm_launch_ad_reserve', args: {
      p_request_id: REQUEST, p_task_id: TASK, p_kind: 'custom', p_mime: 'video/mp4', p_bytes: 5000, p_width: 1080, p_height: 1920,
      p_seconds: 12.5, p_file_name: 'reel.mp4', p_poster_mime: 'image/jpeg', p_poster_bytes: 300}}]);
    expect(out.upload).toEqual({path: `${TASK}/${AD}.mp4`, url: `https://storage.test/upload/${TASK}/${AD}.mp4?token=upload-secret`, token: 'upload-secret'});
    expect(out.posterUpload.path).toBe(`${TASK}/${AD}-poster.jpg`);
    expect(out.ad.id).toBe(AD);
    expect(f.storage).toEqual([`admin:sign-upload:${TASK}/${AD}.mp4:false`, `admin:sign-upload:${TASK}/${AD}-poster.jpg:false`]);
    expect(f.receipts).toEqual([
      {provider: 'supabase-storage', method: 'POST', resource: 'cockpit-launch-ads/sign-upload', object_id: AD, phase: 'intent'},
      {provider: 'supabase-storage', method: 'POST', resource: 'cockpit-launch-ads/sign-upload', object_id: AD, phase: 'response', http_status: 200},
      {provider: 'supabase-storage', method: 'POST', resource: 'cockpit-launch-ads/sign-poster-upload', object_id: AD, phase: 'intent'},
      {provider: 'supabase-storage', method: 'POST', resource: 'cockpit-launch-ads/sign-poster-upload', object_id: AD, phase: 'response', http_status: 200},
    ]);
    expect(JSON.stringify(f.receipts)).not.toContain('secret');
  });

  test('a saved file needs no new link; a removed one asks to add it again', async () => {
    let f = fixture({rpc: {cockpit_csm_launch_ad_reserve: () => ({data: ad({status: 'ready'}), error: null})}});
    expect(await runLaunchAds(f.client, f.admin, reserveInput())).toMatchObject({upload: null, posterUpload: null});
    expect(f.storage).toEqual([]);
    f = fixture({rpc: {cockpit_csm_launch_ad_reserve: () => ({data: ad({status: 'removed'}), error: null})}});
    expect((await refusal(runLaunchAds(f.client, f.admin, reserveInput()))).status).toBe(409);
  });

  test('a retry after a lost answer finds the object already there instead of overwriting it', async () => {
    const f = fixture({
      rpc: {cockpit_csm_launch_ad_reserve: () => ({data: picture(), error: null})},
      signUpload: () => ({data: null, error: {statusCode: '409', message: 'The resource already exists'}}),
      objects: {[`${TASK}/${AD}.png`]: {size: 20, contentType: 'image/png'}},
    });
    const out = await runLaunchAds(f.client, f.admin, reserveInput({mime: 'image/png', bytes: 20, poster: null})) as Record<string, any>;
    expect(out.upload).toEqual({path: `${TASK}/${AD}.png`, url: null, token: null, uploaded: true});
    // Storage's own answers are recorded: the refused signing (409), then the object found (200).
    expect(f.receipts.filter(r => r.phase !== 'intent').map(r => [r.resource, r.phase, r.http_status])).toEqual([
      ['cockpit-launch-ads/sign-upload', 'response', 409], ['cockpit-launch-ads/sign-upload-check', 'response', 200],
    ]);
    const g = fixture({rpc: {cockpit_csm_launch_ad_reserve: () => ({data: picture(), error: null})}, signUpload: () => ({data: null, error: {message: 'down'}})});
    expect((await refusal(runLaunchAds(g.client, g.admin, reserveInput({mime: 'image/png', bytes: 20, poster: null})))).message).toContain('upload link was not created');
  });

  test('a path outside the client folder from the server is refused', async () => {
    for (const bad of [{path: `other/${AD}.mp4`}, {path: `${TASK}/${AD}.mov`}, {posterPath: `${TASK}/x-poster.jpg`}, {taskId: 'taskB1'}]) {
      const f = fixture({rpc: {cockpit_csm_launch_ad_reserve: () => ({data: ad(bad), error: null})}});
      expect((await refusal(runLaunchAds(f.client, f.admin, reserveInput()))).status).toBe(502);
      expect(f.storage).toEqual([]);
    }
  });

  test('when the health ledger cannot be written, no link is signed', async () => {
    const f = fixture({rpc: {cockpit_csm_launch_ad_reserve: () => ({data: ad(), error: null})}, healthError: true});
    expect((await refusal(runLaunchAds(f.client, f.admin, reserveInput()))).status).toBe(503);
    expect(f.storage).toEqual([]);
  });
});

describe('launchAds.ready', () => {
  const ready = {operation: 'launchAds.ready', requestId: REQUEST, args: {taskId: TASK, id: AD}};
  const objects = {[`${TASK}/${AD}.mp4`]: {size: 5000, contentType: 'video/mp4'}, [`${TASK}/${AD}-poster.jpg`]: {size: 300, contentType: 'image/jpeg'}};

  test('the object and its poster are checked, then accepted, then signed through the seat\'s own client', async () => {
    const f = fixture({objects, rpc: {
      cockpit_csm_launch_ad_get: () => ({data: {...ad(), mine: true}, error: null}),
      cockpit_csm_launch_ad_accept: () => ({data: ad({status: 'ready', readyAt: '2026-10-19T10:00:00Z'}), error: null}),
    }});
    const out = await runLaunchAds(f.client, f.admin, ready) as Record<string, any>;
    expect(f.calls.map(c => c.name)).toEqual(['cockpit_csm_launch_ad_get', 'cockpit_csm_launch_ad_accept']);
    expect(f.calls[1].args).toEqual({p_task_id: TASK, p_id: AD});
    expect(f.storage).toEqual([
      `admin:info:${TASK}/${AD}.mp4`, `admin:info:${TASK}/${AD}-poster.jpg`,
      `user:sign-read:${TASK}/${AD}.mp4,${TASK}/${AD}-poster.jpg:${READ_SECONDS}`,
    ]);
    expect(out.expiresIn).toBe(3600);
    expect(out.ad).toMatchObject({status: 'ready', url: `https://storage.test/sign/${TASK}/${AD}.mp4?token=read-secret`,
      posterUrl: `https://storage.test/sign/${TASK}/${AD}-poster.jpg?token=read-secret`});
    expect(f.receipts.map(r => [r.resource, r.phase, r.http_status])).toEqual([
      ['cockpit-launch-ads/verify-object', 'intent', undefined], ['cockpit-launch-ads/verify-object', 'response', 200],
      ['cockpit-launch-ads/verify-poster', 'intent', undefined], ['cockpit-launch-ads/verify-poster', 'response', 200],
      ['cockpit-launch-ads/sign-read', 'intent', undefined], ['cockpit-launch-ads/sign-read', 'response', 200],
    ]);
    expect(JSON.stringify(f.receipts)).not.toContain('secret');
  });

  test('a missing, short or retyped object is never accepted', async () => {
    for (const [stored, words] of [
      [{}, 'The file did not arrive. Add it again.'],
      [{[`${TASK}/${AD}.mp4`]: {size: 4999, contentType: 'video/mp4'}}, 'does not match'],
      [{[`${TASK}/${AD}.mp4`]: {size: 5000, contentType: 'text/html'}}, 'does not match'],
      [{[`${TASK}/${AD}.mp4`]: {size: 5000, contentType: 'video/mp4'}}, 'poster did not arrive'],
    ] as [Record<string, {size: number; contentType: string}>, string][]) {
      const f = fixture({objects: stored, rpc: {cockpit_csm_launch_ad_get: () => ({data: {...ad(), mine: true}, error: null})}});
      const error = await refusal(runLaunchAds(f.client, f.admin, ready));
      expect(error.message).toContain(words);
      expect(error.status).toBe(409);
      expect(f.calls.map(c => c.name)).toEqual(['cockpit_csm_launch_ad_get']);
    }
  });

  test('a missing object is a 404 answer; Storage failing is a failed receipt and a 502, never "did not arrive"', async () => {
    let f = fixture({rpc: {cockpit_csm_launch_ad_get: () => ({data: {...ad(), mine: true}, error: null})}});
    await refusal(runLaunchAds(f.client, f.admin, ready));
    expect(f.receipts.filter(r => r.phase !== 'intent').map(r => [r.phase, r.http_status])).toEqual([['response', 404]]);
    f = fixture({rpc: {cockpit_csm_launch_ad_get: () => ({data: {...ad(), mine: true}, error: null})}});
    f.admin.storage.from = () => ({
      createSignedUploadUrl: async () => ({data: null, error: null}),
      info: async () => ({data: null, error: {name: 'StorageUnknownError', message: 'fetch failed'}}),
    }) as never;
    const error = await refusal(runLaunchAds(f.client, f.admin, ready));
    expect([error.status, error.message]).toEqual([502, 'Storage could not be checked just now. Try again.']);
    expect(f.receipts.filter(r => r.phase !== 'intent').map(r => [r.phase, r.http_status])).toEqual([['failed', undefined]]);
  });

  test('another seat\'s reservation is refused before Storage is read; a saved file is only signed', async () => {
    let f = fixture({objects, rpc: {cockpit_csm_launch_ad_get: () => ({data: {...ad(), mine: false}, error: null})}});
    expect((await refusal(runLaunchAds(f.client, f.admin, ready))).status).toBe(403);
    expect(f.storage).toEqual([]);
    f = fixture({rpc: {cockpit_csm_launch_ad_get: () => ({data: {...ad({status: 'ready'}), mine: false}, error: null})}});
    const out = await runLaunchAds(f.client, f.admin, ready) as Record<string, any>;
    expect(out.ad.url).toContain('sign/');
    expect(f.storage.every(s => s.startsWith('user:sign-read'))).toBe(true);
    f = fixture({rpc: {cockpit_csm_launch_ad_get: () => ({data: {...ad({status: 'removed'}), mine: true}, error: null})}});
    expect((await refusal(runLaunchAds(f.client, f.admin, ready))).message).toContain('removed');
  });

  test('the accept function\'s own refusal comes through in its words', async () => {
    const f = fixture({objects, rpc: {
      cockpit_csm_launch_ad_get: () => ({data: {...ad(), mine: true}, error: null}),
      cockpit_csm_launch_ad_accept: () => ({data: null, error: {message: 'The uploaded file does not match what was reserved. Add it again'}}),
    }});
    expect((await refusal(runLaunchAds(f.client, f.admin, ready))).message).toBe('The uploaded file does not match what was reserved. Add it again');
  });
});

const noStale = () => ({data: [], error: null});

describe('launchAds.list, update and remove', () => {
  test('list signs every saved file in one call and leaves an unsigned one null', async () => {
    const second = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const f = fixture({
      rpc: {cockpit_csm_launch_ads_read: () => ({data: [picture({status: 'ready'}), picture({id: second, status: 'ready', path: `${TASK}/${second}.png`})], error: null}),
        cockpit_csm_launch_ad_stale: noStale},
      signRead: paths => ({data: paths.map(path => path.includes(second) ? {path, signedUrl: '', error: 'Object not found'} : {path, signedUrl: `https://storage.test/sign/${path}`, error: null}), error: null}),
    });
    const out = await runLaunchAds(f.client, f.admin, {operation: 'launchAds.list', args: {taskId: TASK, includeHidden: false}}) as Record<string, any>;
    expect(f.calls).toEqual([{name: 'cockpit_csm_launch_ads_read', args: {p_task_id: TASK, p_include_hidden: false}},
      {name: 'cockpit_csm_launch_ad_stale', args: {p_task_id: TASK}}]);
    expect(out.ads.map((a: Record<string, unknown>) => [a.id, a.url, a.posterUrl])).toEqual([
      [AD, `https://storage.test/sign/${TASK}/${AD}.png`, null], [second, null, null],
    ]);
    expect(f.storage).toEqual([`user:sign-read:${TASK}/${AD}.png,${TASK}/${second}.png:3600`]);
  });

  test('an empty tray signs nothing', async () => {
    const f = fixture({rpc: {cockpit_csm_launch_ads_read: () => ({data: [], error: null}), cockpit_csm_launch_ad_stale: noStale}});
    expect(await runLaunchAds(f.client, f.admin, {operation: 'launchAds.list', args: {taskId: TASK}})).toMatchObject({ads: [], expiresIn: 3600});
    expect(f.storage).toEqual([]);
    expect(f.receipts).toEqual([]);
  });

  test('update sends the server\'s own key names and refuses anything else', async () => {
    const f = fixture({rpc: {cockpit_csm_launch_ad_update: () => ({data: picture({status: 'ready', headline: 'Kitchens', hidden: true}), error: null})}});
    const out = await runLaunchAds(f.client, f.admin, {operation: 'launchAds.update', args: {taskId: TASK, id: AD,
      patch: {primaryText: 'Fitted in six weeks', headline: 'Kitchens', cta: 'GET_QUOTE', language: 'en', placement: null, hidden: true}}}) as Record<string, any>;
    expect(f.calls[0].args).toEqual({p_task_id: TASK, p_id: AD, p_patch: {primary_text: 'Fitted in six weeks', headline: 'Kitchens', cta: 'GET_QUOTE', language: 'en', placement: null, hidden: true}});
    expect(out.ad.headline).toBe('Kitchens');
    for (const patch of [{bytes: 1}, {cta: 'BUY_NOW'}, {kind: 'logo'}]) {
      const g = fixture();
      expect((await refusal(runLaunchAds(g.client, g.admin, {operation: 'launchAds.update', args: {taskId: TASK, id: AD, patch}}))).message).toContain('Change only');
      expect(g.calls).toEqual([]);
    }
    const g = fixture();
    expect((await refusal(runLaunchAds(g.client, g.admin, {operation: 'launchAds.update', args: {taskId: TASK, id: AD, patch: {}}}))).message).toBe('Choose something to change.');
  });

  test('remove goes through its gated function, then deletes the bytes and records it; a refusal keeps its status', async () => {
    let f = fixture({rpc: {
      cockpit_csm_launch_ad_remove: () => ({data: ad({status: 'removed', removedAt: '2026-10-19T10:00:00Z'}), error: null}),
      cockpit_csm_launch_ad_purged: () => ({data: 1, error: null}),
    }});
    expect(await runLaunchAds(f.client, f.admin, {operation: 'launchAds.remove', args: {taskId: TASK, id: AD}})).toMatchObject({ad: {status: 'removed'}, deleted: true});
    expect(f.storage).toEqual([`admin:remove:${TASK}/${AD}.mp4,${TASK}/${AD}-poster.jpg`]);
    expect(f.calls.map(c => c.name)).toEqual(['cockpit_csm_launch_ad_remove', 'cockpit_csm_launch_ad_purged']);
    expect(f.calls[1].args).toEqual({p_task_id: TASK, p_ids: [AD]});
    expect(f.receipts.map(r => [r.method, r.resource, r.phase, r.http_status])).toEqual([
      ['DELETE', 'cockpit-launch-ads/delete-object', 'intent', undefined], ['DELETE', 'cockpit-launch-ads/delete-object', 'response', 200],
    ]);
    // Already purged: nothing to delete again.
    f = fixture({rpc: {cockpit_csm_launch_ad_remove: () => ({data: picture({status: 'removed', removedAt: '2026-10-19T10:00:00Z', purgedAt: '2026-10-19T10:00:01Z'}), error: null})}});
    expect(await runLaunchAds(f.client, f.admin, {operation: 'launchAds.remove', args: {taskId: TASK, id: AD}})).toMatchObject({deleted: true});
    expect(f.storage).toEqual([]);
    f = fixture({rpc: {cockpit_csm_launch_ad_remove: () => ({data: null, error: {message: 'Current confirmed client-success access is required', code: '42501'}})}});
    expect((await refusal(runLaunchAds(f.client, f.admin, {operation: 'launchAds.remove', args: {taskId: TASK, id: AD}}))).status).toBe(403);
    expect(f.storage).toEqual([]);
  });

  test('when Storage will not delete, the removal still stands, the receipt fails and the sweep tries again later', async () => {
    const f = fixture({removeError: {statusCode: '503', message: 'down'}, rpc: {
      cockpit_csm_launch_ad_remove: () => ({data: picture({status: 'removed', removedAt: '2026-10-19T10:00:00Z'}), error: null}),
    }});
    expect(await runLaunchAds(f.client, f.admin, {operation: 'launchAds.remove', args: {taskId: TASK, id: AD}})).toMatchObject({ad: {status: 'removed'}, deleted: false});
    expect(f.calls.map(c => c.name)).toEqual(['cockpit_csm_launch_ad_remove']);
    expect(f.receipts.filter(r => r.phase !== 'intent').map(r => [r.phase, r.http_status])).toEqual([['response', 503]]);
  });

  test('listing sweeps this client\'s removed and day-old unfinished files, inside its own folder only', async () => {
    const stale = '7b6a5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
    const f = fixture({rpc: {
      cockpit_csm_launch_ads_read: () => ({data: [], error: null}),
      cockpit_csm_launch_ad_stale: () => ({data: [
        {id: AD, path: `${TASK}/${AD}.mp4`, posterPath: `${TASK}/${AD}-poster.jpg`},
        {id: stale, path: `taskB1/${stale}.png`, posterPath: null},
      ], error: null}),
      cockpit_csm_launch_ad_purged: () => ({data: 1, error: null}),
    }});
    expect(await runLaunchAds(f.client, f.admin, {operation: 'launchAds.list', args: {taskId: TASK}})).toMatchObject({ads: []});
    expect(f.storage).toEqual([`admin:remove:${TASK}/${AD}.mp4,${TASK}/${AD}-poster.jpg`]);
    expect(f.calls.at(-1)).toEqual({name: 'cockpit_csm_launch_ad_purged', args: {p_task_id: TASK, p_ids: [AD]}});
    // A sweep that fails never fails the tray.
    const g = fixture({rpc: {cockpit_csm_launch_ads_read: () => ({data: [], error: null}), cockpit_csm_launch_ad_stale: () => ({data: null, error: {message: 'down'}})}});
    expect(await runLaunchAds(g.client, g.admin, {operation: 'launchAds.list', args: {taskId: TASK}})).toMatchObject({ads: []});
    expect(g.storage).toEqual([]);
  });

  test('an unknown operation is refused', async () => {
    const f = fixture();
    expect((await refusal(runLaunchAds(f.client, f.admin, {operation: 'launchAds.publish', args: {taskId: TASK}}))).message).toBe('Unknown launch ads operation.');
  });
});
