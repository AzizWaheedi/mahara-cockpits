// sales-conversations: copy the sales sub-account's HighLevel conversations
// and their messages into Creative Triage, for the cockpit's Messages page.
//
// Scheduled by pg_cron every minute (mahara-sales-conversations) with the
// shared cron secret from the vault (x-cron-secret), the same door as
// sales-mirror. One run at a time under the cockpit_sales_lock lease.
//
// Each run, within about 45 seconds:
// 1. The conversations HighLevel changed since the last run (its search,
//    newest first, read back to the cursor with five minutes' overlap), and
//    the newest messages of each one that moved on.
// 2. Conversations never read yet, newest first, while time is left: the
//    first runs read all 4,810 back this way.
// 3. Every twenty minutes, a pass over the whole list (carried over runs)
//    so assignment, unread counts and tags stay right on quiet threads.
// 4. Each touched conversation's summary is worked out again in the
//    database (cockpit_sales_conversation_refresh).
// A HighLevel 429 ends the run's reading (the next minute goes on); every
// run leaves a cockpit_sales_mirror_runs row (mode conversations) and the
// worker status row sales-conversations/sync that the watchdog and the
// Messages page read. SALES_GHL_TOKEN missing is said, never taken as empty.

import {
  conversationRow,
  messageRow,
  needsMessages,
  redact,
  SALES_LOCATION,
} from "./lib.ts";

type Row = Record<string, unknown>;

const GHL = "https://services.leadconnectorhq.com";
// HighLevel sits behind Cloudflare, which refuses a request with no
// browser-like agent (error 1010).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LOCK = "sales-conversations";
const LOCK_SECONDS = 120;
const BUDGET_MS = 45_000;
const OVERLAP_MS = 5 * 60_000;
const FULL_EVERY_MS = 20 * 60_000;
const NEW_PAGES = 10;
const FULL_PAGES_PER_RUN = 8;
const CHANGED_PER_RUN = 80;
const BACKFILL_PER_RUN = 90;
// Three at a time: HighLevel allows about 100 requests in 10 seconds for the
// whole sub-account, and the reps' own sends share it (a 429 on 2026-10-29
// at five).
const PARALLEL = 3;

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

class RateLimited extends Error {}

async function rest(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<string> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Triage ${res.status} on ${path.split("?")[0]}: ${redact(text)}`);
  return text;
}

async function upsert(table: string, conflict: string, rows: Row[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 400)
    await rest(`${table}?on_conflict=${conflict}`, {
      method: "POST",
      body: rows.slice(i, i + 400),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  return rows.length;
}

async function ghl(path: string): Promise<Row> {
  const token = env("SALES_GHL_TOKEN");
  if (!token) throw new Error("SALES_GHL_TOKEN is not set, so HighLevel cannot be read");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${GHL}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json", "User-Agent": UA },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 429) throw new RateLimited("HighLevel asked us to slow down (429)");
    if (!res.ok)
      throw Object.assign(new Error(`HighLevel ${res.status} on ${path.split("?")[0]}: ${redact(text)}`), { status: res.status });
    // An empty or unreadable answer is no answer, never "nothing there".
    if (!text) throw new Error(`HighLevel answered ${path.split("?")[0]} with nothing`);
    return JSON.parse(text) as Row;
  } finally {
    clearTimeout(t);
  }
}

/** One page of HighLevel's conversation list, newest first, after the given sort key. */
async function searchPage(after: string | null): Promise<{ list: Row[]; next: string | null }> {
  const q = new URLSearchParams({ locationId: SALES_LOCATION, limit: "100", sort: "desc", sortBy: "last_message_date" });
  if (after) q.set("startAfterDate", after);
  const out = await ghl(`/conversations/search?${q}`);
  if (!Array.isArray(out.conversations)) throw new Error("HighLevel's conversation list came back without a list");
  const list = out.conversations as Row[];
  const last = list.at(-1);
  const sortKey = last ? (Array.isArray(last.sort) ? last.sort[0] : last.lastMessageDate) : null;
  return { list, next: list.length === 100 && sortKey ? String(sortKey) : null };
}

async function messagesOf(conversationId: string, limit: number, at: string): Promise<Row[]> {
  const out = await ghl(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`);
  const inner = (out.messages ?? {}) as Row;
  const list = Array.isArray(inner.messages) ? inner.messages : Array.isArray(out.messages) ? out.messages : null;
  if (!list) throw new Error("HighLevel's messages came back without a list");
  return (list as Row[]).map(m => messageRow(m, at)).filter((r): r is Row => r !== null);
}

/** Run fn over items, a few at a time, stopping early when time runs out or HighLevel says 429. */
async function pool<T>(items: T[], fn: (x: T) => Promise<void>, until: number, stop: { why: string | null }) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !stop.why && Date.now() < until) {
      const x = items[i++];
      try {
        await fn(x);
      } catch (e) {
        if (e instanceof RateLimited) stop.why = e.message;
        else throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

Deno.serve(async (req: Request) => {
  const expected = env("CRON_SECRET");
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || given !== expected) return Response.json({ ok: false, error: "not allowed" }, { status: 401 });

  const holder = crypto.randomUUID();
  let held = false;
  try {
    held =
      JSON.parse(
        await rest("rpc/cockpit_sales_lock", {
          method: "POST",
          body: { p_name: LOCK, p_holder: holder, p_seconds: LOCK_SECONDS },
        }),
      ) === true;
  } catch (e) {
    return Response.json({ ok: false, error: `lock: ${redact(String(e))}` }, { status: 503 });
  }
  if (!held) return Response.json({ ok: true, skipped: "the last run is still going" });
  try {
    return await run();
  } finally {
    await rest("rpc/cockpit_sales_unlock", { method: "POST", body: { p_name: LOCK, p_holder: holder } }).catch(() => {});
  }
});

async function run(): Promise<Response> {
  const started = Date.now();
  const until = started + BUDGET_MS;
  const at = new Date(started).toISOString();
  const counts: Record<string, unknown> = {};
  const errors: string[] = [];
  const stop: { why: string | null } = { why: null };
  const touched = new Set<string>();

  let runId: number | null = null;
  try {
    const out = await rest("cockpit_sales_mirror_runs?select=id", {
      method: "POST",
      body: { started_at: at, mode: "conversations" },
      prefer: "return=representation",
    });
    runId = (JSON.parse(out)?.[0]?.id as number) ?? null;
  } catch (e) {
    errors.push(`run row: ${redact(String(e))}`);
  }

  const state = (JSON.parse(
    await rest("cockpit_sales_conversation_sync?name=eq.conversations&select=*"),
  )?.[0] ?? {}) as Row;
  const patch: Row = { last_run_at: at };

  /** Store a page of conversations; returns the ones whose messages need reading. */
  const storeConversations = async (list: Row[]): Promise<string[]> => {
    const rows = list.map(c => conversationRow(c, at)).filter((r): r is Row => r !== null);
    if (!rows.length) return [];
    const ids = rows.map(r => String(r.conversation_id));
    const stored = new Map<string, { ghl_last_at: string | null; messages_synced_at: string | null; read_failures: number }>();
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100).map(id => `"${id}"`).join(",");
      for (const s of JSON.parse(
        await rest(`cockpit_sales_conversations?conversation_id=in.(${part})&select=conversation_id,ghl_last_at,messages_synced_at,read_failures`),
      ) as Row[])
        stored.set(String(s.conversation_id), {
          ghl_last_at: (s.ghl_last_at as string) ?? null,
          messages_synced_at: (s.messages_synced_at as string) ?? null,
          read_failures: Number(s.read_failures ?? 0),
        });
    }
    const need = needsMessages(
      rows.map(r => ({ conversation_id: String(r.conversation_id), ghl_last_at: (r.ghl_last_at as string) ?? null })),
      stored,
    );
    // A conversation whose messages need reading keeps its stored ghl_last_at
    // and goes back in the read-back queue (messages_synced_at null), so a run
    // that stops early, or the full pass finding a change the newest-first
    // read missed (a backdated message), always reads it later. Every row
    // carries the same keys, so the batch upsert never mixes shapes.
    const now = rows.map(r => {
      const id = String(r.conversation_id);
      const s = stored.get(id);
      return need.includes(id)
        ? { ...r, ghl_last_at: s ? s.ghl_last_at : r.ghl_last_at, messages_synced_at: null }
        : { ...r, messages_synced_at: s?.messages_synced_at ?? null };
    });
    await upsert("cockpit_sales_conversations", "conversation_id", now);
    for (const id of ids) touched.add(id);
    return need;
  };

  let failedReads = 0;
  let firstFailure: string | null = null;
  /**
   * Read and store a conversation's messages, then mark it read at
   * HighLevel's time. A conversation HighLevel no longer has is dropped. A
   * read that fails otherwise (a timeout, a 5xx) leaves it in the queue to
   * be tried again, counted in read_failures; only after five failures in a
   * row is it passed over until it changes again, so one bad thread never
   * holds up the rest (a 429 still stops the run).
   */
  const readMessages = async (id: string, limit: number, ghlLastAt: string | null, failures = 0) => {
    let rows: Row[];
    try {
      rows = await messagesOf(id, limit, at);
    } catch (e) {
      if (e instanceof RateLimited) throw e;
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 400) {
        await rest(`cockpit_sales_conversation_messages?conversation_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
        await rest(`cockpit_sales_conversations?conversation_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
        touched.delete(id);
        return;
      }
      failedReads++;
      firstFailure ??= redact(String((e as Error).message ?? e));
      if (failures + 1 < 5) {
        await rest(`cockpit_sales_conversations?conversation_id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { messages_synced_at: null, read_failures: failures + 1 },
          prefer: "return=minimal",
        });
        return;
      }
      rows = [];
    }
    if (rows.length) await upsert("cockpit_sales_conversation_messages", "id", rows);
    await rest(`cockpit_sales_conversations?conversation_id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { messages_synced_at: at, read_failures: 0, ...(ghlLastAt ? { ghl_last_at: ghlLastAt } : {}) },
      prefer: "return=minimal",
    });
    touched.add(id);
  };

  // 1. What changed since the last run.
  const changed: { id: string; last: string | null }[] = [];
  try {
    // The first run starts a day back: the full pass and the read-back bring in the rest.
    const cursor = (state.cursor_at ? Date.parse(String(state.cursor_at)) : started - 86_400_000) - OVERLAP_MS;
    let after: string | null = null;
    let newest: string | null = null;
    // True once the newest-first read reached the cursor (or the list's end):
    // only then has every changed conversation been stored and queued.
    let reachedCursor = false;
    for (let page = 0; page < NEW_PAGES && Date.now() < until; page++) {
      const { list, next } = await searchPage(after);
      if (!newest && list[0]) newest = conversationRow(list[0], at)?.ghl_last_at as string ?? null;
      const recent = list.filter(c => Number(c.lastMessageDate) >= cursor);
      const need = await storeConversations(recent);
      for (const c of recent)
        if (need.includes(String(c.id)))
          changed.push({ id: String(c.id), last: conversationRow(c, at)?.ghl_last_at as string ?? null });
      if (!next || recent.length < list.length) {
        reachedCursor = true;
        break;
      }
      after = next;
    }
    counts.changed = changed.length;
    await pool(changed.slice(0, CHANGED_PER_RUN), x => readMessages(x.id, 60, x.last), until, stop);
    // The cursor moves once every change since it was stored. A change not
    // read this run is already back in the read-back queue (storeConversations).
    if (newest && reachedCursor && !stop.why) patch.cursor_at = newest;
  } catch (e) {
    if (e instanceof RateLimited) stop.why = e.message;
    else errors.push(`changes: ${redact(String((e as Error).message ?? e))}`);
  }

  // 2. Conversations never read yet, newest first.
  try {
    if (!stop.why && Date.now() < until - 8_000) {
      const queue = JSON.parse(
        await rest(
          `cockpit_sales_conversations?messages_synced_at=is.null&select=conversation_id,ghl_last_at,read_failures&order=ghl_last_at.desc.nullslast&limit=${BACKFILL_PER_RUN}`,
        ),
      ) as Row[];
      let n = 0;
      await pool(queue, async q => {
        await readMessages(String(q.conversation_id), 100, null, Number(q.read_failures ?? 0));
        n++;
      }, until - 5_000, stop);
      counts.backfill = n;
    }
  } catch (e) {
    errors.push(`backfill: ${redact(String((e as Error).message ?? e))}`);
  }

  // 3. The whole list every twenty minutes, carried over runs.
  try {
    const due = !state.full_started_at && (!state.full_done_at || Date.parse(String(state.full_done_at)) < started - FULL_EVERY_MS);
    if (!stop.why && (due || state.full_started_at) && Date.now() < until - 6_000) {
      let after = due ? null : ((state.full_after as string) ?? null);
      if (due) patch.full_started_at = at;
      let pages = 0;
      let done = false;
      while (pages < FULL_PAGES_PER_RUN && Date.now() < until - 4_000) {
        const { list, next } = await searchPage(after);
        await storeConversations(list);
        pages++;
        if (!next) {
          done = true;
          break;
        }
        after = next;
      }
      counts.full_pages = pages;
      if (done) Object.assign(patch, { full_done_at: at, full_started_at: null, full_after: null });
      else patch.full_after = after;
    }
  } catch (e) {
    if (e instanceof RateLimited) stop.why = e.message;
    else errors.push(`full pass: ${redact(String((e as Error).message ?? e))}`);
  }

  // 4. Summaries for everything touched.
  try {
    const ids = [...touched];
    let n = 0;
    for (let i = 0; i < ids.length; i += 300)
      n += Number(await rest("rpc/cockpit_sales_conversation_refresh", { method: "POST", body: { p_ids: ids.slice(i, i + 300) } }));
    counts.refreshed = n;
  } catch (e) {
    errors.push(`summaries: ${redact(String((e as Error).message ?? e))}`);
  }

  if (stop.why) counts.slowed = stop.why;
  if (failedReads) counts.failed_reads = failedReads;
  if (firstFailure) counts.first_failure = firstFailure;
  const ok = errors.length === 0;
  const finished = new Date().toISOString();
  Object.assign(patch, ok ? { last_ok_at: finished, last_error: null } : { last_error: errors.join(" | ").slice(0, 1000) }, { counts });
  await rest("cockpit_sales_conversation_sync?name=eq.conversations", { method: "PATCH", body: patch, prefer: "return=minimal" }).catch(e =>
    errors.push(`state: ${redact(String(e))}`)
  );
  const detail = ok
    ? `${counts.changed ?? 0} changed, ${counts.backfill ?? 0} read back, ${counts.full_pages ?? 0} list pages${failedReads ? `, ${failedReads} threads HighLevel would not give (${firstFailure})` : ""}${stop.why ? `; ${stop.why}` : ""}.`
    : errors.join(" | ");
  await upsert("cockpit_sales_worker_status", "worker,job", [
    { worker: "sales-conversations", job: "sync", ok, detail: detail.slice(0, 500), at: finished },
  ]).catch(() => {});
  if (runId !== null)
    await rest(`cockpit_sales_mirror_runs?id=eq.${runId}`, {
      method: "PATCH",
      body: { finished_at: finished, ok, counts, error: ok ? null : errors.join(" | ").slice(0, 2000) },
      prefer: "return=minimal",
    }).catch(() => {});
  return Response.json({ ok, counts, errors });
}
