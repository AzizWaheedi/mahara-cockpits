import {createHash} from 'node:crypto';
import {creativeImageCandidates, stillCaptureDue, stillKeyFor} from './metaMedia';
import type {Row, Reads} from './runtime';
import type {Env} from './transport';

export interface StillAsset {key: string; path: string; contentType: string; bytes: Uint8Array; sha256: string}
export async function captureStills(state: Row, tables: Record<string, Row[]>, reads: Reads) {
  const known = new Map<string, Row>((state.stills ?? []).map((row: Row) => [row.key, row]));
  const wanted = new Map<string, Row>();
  for (const row of [...tables.ads, ...tables.metaTree.filter(row => row.kind === 'ad'), ...tables.winnersArchive]) {
    const adId = row.adId ?? row.metaAdId ?? row.metaId;
    const key = stillKeyFor(row.creativeId, adId);
    if (key && !row.stillUrl && stillCaptureDue(known.get(key), Date.now())) wanted.set(key, {...row, adId});
  }
  const assets: StillAsset[] = [], outcomes: Row[] = [], items = [...wanted.values()];
  let cursor = 0;
  async function download(urlText: string) {
    const url = new URL(urlText);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)(fbcdn\.net|fbsbx\.com|facebook\.com)$/.test(url.hostname)) throw new Error('Meta image host is not approved');
    const response = await reads.fetch(url.href, {redirect:'error',signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error(`Image download failed (${response.status})`);
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) throw new Error('Provider returned no supported image');
      if (Number(response.headers.get('content-length') ?? 0) > 5 * 1024 * 1024) throw new Error('Image exceeds storage limit');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Image has no response body');
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) { const result = await reader.read(); if (result.done) break; length += result.value.byteLength; if (length > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('Image exceeds storage limit'); } chunks.push(result.value); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const signature = Buffer.from(bytes.subarray(0, 12));
      const valid = contentType === 'image/jpeg' ? signature[0] === 255 && signature[1] === 216 : contentType === 'image/png' ? signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : contentType === 'image/gif' ? /^GIF8[79]a/.test(signature.toString('ascii')) : signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw new Error('Image bytes do not match content type');
      return {bytes, contentType};
  }
  async function consume() {
    while (cursor < items.length) {
      const item = items[cursor++];
      let key = stillKeyFor(item.creativeId, item.adId)!;
      try {
        let creativeId = item.creativeId;
        if (!creativeId) { const ad = await reads.graph(item.adId, {fields: 'account_id,creative{id}'}); creativeId = ad.creative?.id; }
        if (!creativeId) throw new Error('Meta ad has no creative ID');
        key = stillKeyFor(creativeId, item.adId)!;
        for(const table of [tables.ads,tables.metaTree,tables.winnersArchive])for(const row of table){
          if(String(row.adId??row.metaAdId??row.metaId)===String(item.adId)&&(!row.creativeId||row.creativeId===creativeId))Object.assign(row,{creativeId,stillKey:key});
        }
        const cached = known.get(key);
        if (cached?.status === 'saved' && cached.url) { outcomes.push(cached); continue; }
        const creative = await reads.graph(creativeId, {fields: 'thumbnail_url,image_url,object_story_spec{video_data{image_url},link_data{picture}}', thumbnail_width: 320, thumbnail_height: 320});
        const candidates = [creative.thumbnail_url, ...creativeImageCandidates(creative).map(row => row.url)].filter((url): url is string => typeof url === 'string');
        if (!candidates.length) throw new Error('Meta creative has no still image');
        const full = await download(candidates[0]), sha256 = createHash('sha256').update(full.bytes).digest('hex');
        const path = `${createHash('sha256').update(key).digest('hex')}/${sha256}`;
        assets.push({key, path, ...full, sha256});
        outcomes.push({key, adId: item.adId, creativeId, campaignName: item.campaignName, accountId: item.accountId, status: 'captured', storagePath: path, sha256, bytes: full.bytes.length, contentType: full.contentType});
      } catch (error) {
        const old = known.get(key), attempts = Number(old?.attempts ?? 0) + 1;
        outcomes.push({key, adId: item.adId, status: 'failed', attempts, lastAttemptAt: Date.now(), nextAttemptAt: Date.now() + (attempts >= 3 ? 7 * 86400000 : 3600000), error: 'Still image unavailable; inspect sanitized provider receipt'});
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(4, items.length)}, () => consume()));
  for (const row of outcomes) known.set(row.key,row);
  tables.adStills = [...known.values()];
  return assets;
}

/** Content-addressed upload is idempotent; writes require the live publication lease. */
export async function storeStills(assets: StillAsset[], tables: Record<string, Row[]>, env: Env, fence: () => Promise<unknown>, receipts: Row[], request: typeof fetch = fetch) {
  if (env.SUPABASE_URL?.replace(/\/$/, '') !== 'https://bldgtotkfmhoxmlzowdx.supabase.co' || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Creative Triage storage credentials required');
  for (const asset of assets) {
    const resource = `/storage/v1/object/cockpit-ad-stills/${asset.path}`;
    let stored = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await fence();
      receipts.push({resource, method: 'POST', phase: 'intent', attempt, sha256: asset.sha256, at: new Date().toISOString()});
      let response:Response;
      try {
        response = await request(`${env.SUPABASE_URL}${resource}`, {method: 'POST', redirect:'error', headers: {apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': asset.contentType, 'x-upsert': 'false'}, body: new Blob([new Uint8Array(asset.bytes)], {type: asset.contentType}), signal: AbortSignal.timeout(30000)});
      } catch { receipts.push({resource,method:'POST',phase:'unknown',attempt}); throw new Error('Still upload transport failed'); }
      receipts.push({resource, method: 'POST', phase: 'response', http_status: response.status, attempt, at: new Date().toISOString()});
      if (response.ok) { stored = true; break; }
      let duplicate=response.status===409;
      if(response.status===400){
        try{
          const detail=await response.clone().json();
          duplicate=Number(detail.statusCode)===409||['Duplicate','ResourceAlreadyExists','already_exists'].includes(detail.code??detail.error);
        }catch{/* Unrecognized errors remain fatal. */}
      }
      if (duplicate) {
        const publicResource=`/storage/v1/object/public/cockpit-ad-stills/${asset.path}`;
        receipts.push({resource:publicResource,method:'GET',phase:'intent',attempt});
        try {
          const existing=await request(`${env.SUPABASE_URL}${publicResource}`,{redirect:'error',signal:AbortSignal.timeout(30000)});
          receipts.push({resource:publicResource,method:'GET',phase:'response',http_status:existing.status,attempt});
          if(!existing.ok||!existing.body)throw new Error('Stored image readback failed');
          const reader=existing.body.getReader(),hash=createHash('sha256');let bytes=0;
          for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>asset.bytes.byteLength){await reader.cancel();throw new Error('Stored image differs');}hash.update(chunk.value);}
          if(bytes!==asset.bytes.byteLength||hash.digest('hex')!==asset.sha256)throw new Error('Stored image checksum differs');
          stored=true;break;
        } catch { receipts.push({resource:publicResource,method:'GET',phase:'unknown',attempt});throw new Error('Existing still was not verified'); }
      }
      if (response.status < 500 && response.status !== 429) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
    if (!stored) throw new Error('Still storage upload failed; no feed published');
    for (const outcome of tables.adStills.filter(row => row.key === asset.key)) Object.assign(outcome, {status: 'saved', savedAt: Date.now(), url: `${env.SUPABASE_URL}/storage/v1/object/public/cockpit-ad-stills/${asset.path}`});
  }
  const byKey = new Map<string, Row>(tables.adStills.filter(row => row.status === 'saved').map(row => [row.key, row]));
  attachStoredStills(tables,byKey);
  return byKey;
}

export function attachStoredStills(tables:Record<string,Row[]>,stills:ReadonlyMap<string,Row>){
  for (const table of [tables.ads, tables.metaTree, tables.winnersArchive]) for (const row of table) {
    const key = stillKeyFor(row.creativeId, row.adId ?? row.metaAdId ?? row.metaId), still = key && stills.get(key);
    if (still) Object.assign(row, {stillKey: key, stillUrl: still.url, stillTinyUrl: still.tinyUrl});
  }
}
