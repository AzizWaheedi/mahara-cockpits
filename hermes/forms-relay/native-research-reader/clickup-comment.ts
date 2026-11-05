/** Offline candidate: task-scoped, bounded ClickUp comment retrieval.
 * Never logs provider data. No real credentials or default network transport. */
export type CommentReceipt = {taskId: string; commentId: string; bytes: Uint8Array};
export class CommentReadDenied extends Error { constructor() { super('Comment read denied'); } }
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const PAGE_LIMIT = 4;
const RESPONSE_LIMIT = 1024 * 1024;
const COMMENT_LIMIT = 256 * 1024;
const TIMEOUT_MS = 5000;
const textEncoder = new TextEncoder();

async function readBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || response.status !== 200 || !response.body) throw new CommentReadDenied();
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d{1,8}$/.test(declared) || Number(declared) > RESPONSE_LIMIT)) throw new CommentReadDenied();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new CommentReadDenied());
    else signal.addEventListener('abort', () => reject(new CommentReadDenied()), {once: true});
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_LIMIT) throw new CommentReadDenied();
      chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new CommentReadDenied(); }
}

export function makeClickupCommentReader(token: string, fetchPage: Fetch) {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token) || typeof fetchPage !== 'function') throw new CommentReadDenied();
  return async (taskId: string, commentId: string, signal: AbortSignal): Promise<CommentReceipt | null> => {
    if (!/^[A-Za-z0-9]{1,64}$/.test(taskId) || !/^[0-9]{1,32}$/.test(commentId) || !signal || signal.aborted) throw new CommentReadDenied();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener('abort', stop, {once:true});
    const timer = setTimeout(stop, TIMEOUT_MS);
    try {
      const seen = new Set<string>(); let cursor: {id: string; date: string} | null = null;
      for (let page = 0; page < PAGE_LIMIT; page++) {
        const url = new URL(`https://api.clickup.com/api/v2/task/${taskId}/comment`);
        if (cursor) { url.searchParams.set('start_id', cursor.id); url.searchParams.set('start', cursor.date); }
        const pending = fetchPage(url.toString(), {method:'GET', headers:{Authorization:token, Accept:'application/json'}, redirect:'error', signal:controller.signal});
        const aborted = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(new CommentReadDenied());
          else controller.signal.addEventListener('abort', () => reject(new CommentReadDenied()), {once:true});
        });
        const response = await Promise.race([pending, aborted]);
        if (controller.signal.aborted || response.redirected || (response.url && response.url !== url.toString())) throw new CommentReadDenied();
        const parsed = await readBounded(response, controller.signal);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).comments) || (parsed as any).comments.length > 25) throw new CommentReadDenied();
        const entries = (parsed as any).comments as any[];
        let found: string | null = null;
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[0-9]{1,32}$/.test(entry.id) || seen.has(entry.id)) throw new CommentReadDenied();
          seen.add(entry.id);
          if (entry.id === commentId) {
            if (typeof entry.comment_text !== 'string') throw new CommentReadDenied();
            found = entry.comment_text;
          }
        }
        if (found !== null) {
          const bytes = textEncoder.encode(found);
          if (bytes.byteLength > COMMENT_LIMIT) throw new CommentReadDenied();
          return {taskId, commentId, bytes};
        }
        if (entries.length < 25) return null;
        const last = entries[entries.length - 1];
        if (typeof last.date !== 'string' || !/^[0-9]{1,16}$/.test(last.date)) throw new CommentReadDenied();
        cursor = {id:last.id, date:last.date};
      }
      throw new CommentReadDenied();
    } catch { throw new CommentReadDenied(); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', stop); controller.abort(); }
  };
}
