import { expect, test } from 'bun:test';
import { createArgs, IG_USER, postingOperation, type PostingDeps, type PostingStore, savePatch, uploadPath, withUrls } from './posting.ts';

type Row = Record<string, unknown>;
const ACTOR = '00000000-0000-4000-8000-000000000001';

function post(overrides: Row = {}): Row {
  return {
    id: 7, kind: 'reel', title_working: 'Hook', images: [], brief: null, source_kind: 'upload', source_ref: 'uploads/x-a.mp4',
    video_path: 'videos/7.mp4', duration_sec: '42.5', width: 1080, height: 1920, language: 'ar', status: 'approved',
    targets: ['instagram', 'youtube'], transcript: null, chapters: [], yt_title: 'Title', yt_title_options: ['A'],
    yt_description: 'D', yt_tags: ['t'], ig_caption: 'Caption', ig_hashtags: ['#one', '#two'], thumb_text: 'Line',
    thumb_text_options: [], thumb_frame_ms: 1200, thumb_path: 'thumbs/7.jpg', cover_path: 'covers/7.jpg',
    frames: [{ ms: 1200, path: 'frames/7-1200.jpg' }], method: { speech: 'scribe:v1' }, scheduled_at: null,
    approved_by: 'aziz@maharamedia.com', approved_at: '2026-10-09T08:00:00Z', published: {}, error: null,
    created_by: 'aziz@maharamedia.com', created_at: '2026-10-09T07:00:00Z', updated_at: '2026-10-09T08:00:00Z', ...overrides,
  };
}

function harness(opts: { row?: Row; statuses?: string[]; budgetMs?: number; rpc?: (name: string, args: Row) => unknown } = {}) {
  let row = opts.row ?? post();
  const rpcs: { name: string; args: Row }[] = [];
  const signs: { paths: string[]; expiresIn: number }[] = [];
  const graphCalls: { method: string; path: string; params: Record<string, string | number>; label: string }[] = [];
  const statuses = [...(opts.statuses ?? ['FINISHED'])];
  let clock = 0;
  let created = 0;
  const store: PostingStore = {
    list: async () => [row],
    one: async id => (id === Number(row.id) ? row : null),
    channels: async () => [{ platform: 'youtube', handle: 'maharamedia', connected: false, auth_url: 'https://accounts.google.com/x', note: 'Needs one consent' }],
    async rpc(name, args) {
      rpcs.push({ name, args });
      if (opts.rpc) {
        const out = opts.rpc(name, args);
        if (out !== undefined) return out;
      }
      if (name === 'cockpit_ceo_posting_instagram') {
        const value = args.p_value as Row;
        const published = { ...(row.published as Row) };
        if (args.p_stage === 'container') published.instagram = { container: value.container };
        if (args.p_stage === 'published') published.instagram = { id: value.id, permalink: value.permalink, container: value.container };
        if (args.p_stage === 'release' && value.dropContainer) delete published.instagram;
        row = { ...row, published, status: args.p_stage === 'published' ? 'publishing' : row.status, error: typeof value.error === 'string' ? value.error : row.error };
        return row;
      }
      if (name === 'cockpit_ceo_posting_queue') return { jobId: 11 };
      return row;
    },
    async sign(paths, expiresIn) {
      signs.push({ paths, expiresIn });
      return new Map(paths.map(p => [p, `https://signed.test/${p}?e=${expiresIn}`]));
    },
    uploadUrl: async path => `https://upload.test/${path}?token=t`,
  };
  const deps: PostingDeps = {
    store,
    graph: {
      async get(path, params, label) {
        graphCalls.push({ method: 'GET', path, params, label });
        if (params.fields === 'permalink') return { permalink: 'https://www.instagram.com/reel/abc/' };
        return { status_code: statuses.shift() ?? 'IN_PROGRESS', status: 'Processing' };
      },
      async post(path, params, label) {
        graphCalls.push({ method: 'POST', path, params, label });
        if (path.endsWith('/media_publish')) return { id: '9001' };
        created += 1;
        return { id: String(100 + created) };
      },
    },
    actorId: ACTOR,
    now: () => clock,
    sleep: async ms => { clock += ms; },
    pollBudgetMs: opts.budgetMs ?? 60_000,
  };
  return { deps, rpcs, signs, graphCalls, current: () => row };
}

test('writes are refused without apply and change nothing', async () => {
  const h = harness();
  expect(await postingOperation('approve', { id: 7 }, h.deps, false)).toMatchObject({ dryRun: true });
  expect(h.rpcs).toEqual([]);
  await expect(postingOperation('publishEverywhere', {}, h.deps, true)).rejects.toThrow('Unknown posting operation');
});

test('the list signs only thumbnails in one batch; one post signs every file', async () => {
  const h = harness();
  const [listed] = (await postingOperation('list', { limit: 500 }, h.deps, false)) as Row[];
  expect(h.signs).toEqual([{ paths: ['thumbs/7.jpg'], expiresIn: 3600 }]);
  expect(listed).toMatchObject({ id: 7, durationSec: 42.5, kind: 'reel', urls: { thumb: 'https://signed.test/thumbs/7.jpg?e=3600' } });
  const one = (await postingOperation('get', { id: 7 }, h.deps, false)) as Row;
  expect((one.urls as Row).video).toBe('https://signed.test/videos/7.mp4?e=7200');
  expect((one.urls as Row).frames).toEqual({ 1200: 'https://signed.test/frames/7-1200.jpg?e=3600' });
  await expect(postingOperation('get', { id: 8 }, h.deps, false)).rejects.toThrow('That post is gone.');
});

test('channels say which doors are live', async () => {
  const [youtube] = (await postingOperation('channels', {}, harness().deps, false)) as Row[];
  expect(youtube).toMatchObject({ platform: 'youtube', connected: false, authUrl: 'https://accounts.google.com/x', live: true });
});

test('uploads land under uploads/ with a safe name', async () => {
  // No slash survives, so a name cannot leave uploads/.
  expect(uploadPath('../../my clip (final).mp4', 36 ** 3)).toBe('uploads/1000-_.._my_clip_final_.mp4');
  expect(uploadPath('...', 1)).toBe('uploads/1-file');
  const out = (await postingOperation('uploadUrl', { filename: 'a.mp4' }, harness().deps, true)) as Row;
  expect(String(out.path)).toMatch(/^uploads\/0-a\.mp4$/);
  expect(out.url).toBe('https://upload.test/uploads/0-a.mp4?token=t');
});

test('create and save arguments are trimmed the way the Convex desk did', () => {
  expect(createArgs({ kind: 'post', sourceKind: 'image', sourceRef: ' uploads/1-a.png ', images: [' uploads/1-a.png ', ''], brief: ' About ' }))
    .toEqual({ kind: 'post', sourceKind: 'image', sourceRef: 'uploads/1-a.png', images: ['uploads/1-a.png'], brief: 'About', titleWorking: null, targets: ['instagram'] });
  expect(createArgs({ kind: 'reel', sourceKind: 'url', sourceRef: 'https://x.test/v', targets: ['youtube', 'myspace'] }).targets).toEqual(['youtube']);
  expect(() => createArgs({ kind: 'story', sourceKind: 'url', sourceRef: 'x' })).toThrow('Choose a reel');
  const patch = savePatch({ ytTitle: '  New  ', ytTags: ['#one', ' two ', ''], igHashtags: ['hello!', '#مرحبا', '#'], thumbText: '', scheduledAt: null });
  expect(patch).toEqual({ yt_title: 'New', yt_tags: ['one', 'two'], ig_hashtags: ['#hello', '#مرحبا'], thumb_text: null, scheduled_at: null });
  expect(() => savePatch({ targets: ['myspace'] })).toThrow('Pick at least one place');
  expect(() => savePatch({ scheduledAt: 'soon' })).toThrow('valid time');
});

test('queue operations return the job ID and send the worker its parameters', async () => {
  const h = harness();
  expect(await postingOperation('rerender', { id: 7, thumbText: ' New line ', frameMs: 1200.4 }, h.deps, true)).toEqual({ jobId: 11 });
  expect(h.rpcs.at(-1)).toEqual({ name: 'cockpit_ceo_posting_queue', args: { p_actor_id: ACTOR, p_id: 7, p_kind: 'render', p_params: { thumb_text: 'New line', frame_ms: 1200 } } });
  await expect(postingOperation('youtubeConnect', { redirectUrl: 'https://example.test/' }, h.deps, true)).rejects.toThrow('code=');
  await postingOperation('youtubeConnect', { redirectUrl: ' http://localhost/?code=4/abc ' }, h.deps, true);
  expect(h.rpcs.at(-1)?.args).toMatchObject({ p_id: null, p_kind: 'youtube_auth', p_params: { redirect_url: 'http://localhost/?code=4/abc' } });
});

test('approving a reel publishes Instagram from signed links, records each step, and returns the post', async () => {
  const h = harness({ row: post({ status: 'ready' }), statuses: ['IN_PROGRESS', 'FINISHED'] });
  const out = (await postingOperation('approve', { id: 7 }, h.deps, true)) as Row;
  expect(h.rpcs.map(r => r.name === 'cockpit_ceo_posting_instagram' ? `ig:${r.args.p_stage}` : r.name))
    .toEqual(['cockpit_ceo_posting_approve', 'ig:claim', 'ig:container', 'ig:published']);
  const create = h.graphCalls[0];
  expect(create).toMatchObject({ method: 'POST', path: `${IG_USER}/media`, label: 'instagram/media' });
  expect(create.params).toMatchObject({ media_type: 'REELS', share_to_feed: 'true', caption: 'Caption\n\n#one #two', video_url: 'https://signed.test/videos/7.mp4?e=172800', cover_url: 'https://signed.test/covers/7.jpg?e=172800' });
  expect(h.graphCalls.filter(c => c.label === 'instagram/container').every(c => c.path === '101')).toBe(true);
  expect(h.rpcs.at(-1)?.args.p_value).toEqual({ id: '9001', permalink: 'https://www.instagram.com/reel/abc/', container: '101' });
  expect((out.published as Row).instagram).toMatchObject({ id: '9001' });
});

test('an image post with several images becomes a carousel', async () => {
  const h = harness({ row: post({ kind: 'post', status: 'ready', targets: ['instagram'], images: ['uploads/1-a.png', 'uploads/1-b.png'] }) });
  await postingOperation('approve', { id: 7 }, h.deps, true);
  const posts = h.graphCalls.filter(c => c.method === 'POST');
  expect(posts.map(c => c.params.media_type ?? c.params.is_carousel_item ?? c.params.creation_id)).toEqual(['true', 'true', 'CAROUSEL', '103']);
  expect(posts[2].params.children).toBe('101,102');
});

test('a slow container is kept for Check Instagram; a failed one is dropped with the reason', async () => {
  const slow = harness({ statuses: [], budgetMs: 12_000 });
  await postingOperation('checkInstagram', { id: 7 }, slow.deps, true);
  expect(slow.rpcs.map(r => r.args.p_stage)).toEqual(['claim', 'container', 'release']);
  expect(slow.rpcs.at(-1)?.args.p_value).toEqual({});
  expect(slow.graphCalls.some(c => c.path.endsWith('/media_publish'))).toBe(false);
  expect(slow.current().published).toEqual({ instagram: { container: '101' } });

  const broken = harness({ statuses: ['ERROR'] });
  const out = (await postingOperation('checkInstagram', { id: 7 }, broken.deps, true)) as Row;
  expect(broken.rpcs.at(-1)?.args.p_value).toEqual({ error: 'Meta could not take the reel: Processing', dropContainer: true });
  expect(out.error).toBe('Meta could not take the reel: Processing');
});

test('an already published Instagram post is never sent again', async () => {
  const h = harness({ row: post({ published: { instagram: { id: '9001' } } }) });
  await postingOperation('checkInstagram', { id: 7 }, h.deps, true);
  expect(h.graphCalls).toEqual([]);
  expect(h.rpcs.map(r => r.args.p_stage)).toEqual(['claim']);
});

test('a refused claim (another tab publishing) reaches the screen and Meta is not called', async () => {
  const h = harness({ rpc: (name, args) => { if (name === 'cockpit_ceo_posting_instagram' && args.p_stage === 'claim') throw Error('Instagram is already being published for this post. Check again in a minute.'); } });
  await expect(postingOperation('checkInstagram', { id: 7 }, h.deps, true)).rejects.toThrow('already being published');
  expect(h.graphCalls).toEqual([]);
});

test('withUrls leaves a link out when storage cannot sign it', async () => {
  const store = { sign: async () => new Map<string, string>() } as unknown as PostingStore;
  const [p] = await withUrls([post()], true, store);
  expect(p.urls).toEqual({ thumb: undefined, video: undefined, cover: undefined, images: [], frames: {} });
});
