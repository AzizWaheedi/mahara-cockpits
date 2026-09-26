// sales-mirror: copy the B2B sales records the sales cockpit shows into
// Creative Triage's cockpit_sales_* tables.
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), scheduled by
// pg_cron every three minutes with the shared cron secret from the vault
// (x-cron-secret), the same door tap-charges-sync uses.
//
// B2B (flwboeijllbtrufxkhts) is Muhammed's and read only for us. It is read
// through the Supabase management API with `read_only: true`, which connects
// as supabase_read_only_user, so nothing here can write to it. The token is
// the function secret SALES_B2B_MGMT_TOKEN and never leaves this file.
//
// What each run does (one at a time: a run that finds the last one still
// going stops, and the lock lapses by itself after five minutes):
// - reps and signed deals: all of them (9 and 50 rows), dropping any B2B
//   deleted.
// - leads: the contacts HighLevel changed since the last run, plus a full
//   pass every six hours, carried over as many runs as it takes, that drops
//   contacts B2B no longer has only once it has read to the end.
// - appointments: the hot window (three days back, thirty ahead) every run,
//   180 days back every half hour and two years back every six hours,
//   dropping appointments B2B dropped.
// - the Follow Up and Callback calendars, which B2B does not carry: read
//   from HighLevel directly when SALES_GHL_TOKEN is set.
// - Maqsam calls B2B stored since the last run, paged so none is skipped,
//   then linked to leads by the whole number (cockpit_sales_link_dials).
// - rep scorecards (B2B's own b2b_rep_scorecard) every fifteen minutes.
// - the sales assets and their tags (B2B's asset library) every hour,
//   dropping any B2B unpublished.
// - when B2B last read each of its own sources (settings b2b_sources).
// A drop that would remove more than a fifth of what was read is refused
// and reported: that is B2B answering oddly, and a person decides.
// Each run leaves a row in cockpit_sales_mirror_runs (kept thirty days); a
// failed step is written there and the other steps still run.

import {
  assetsSql,
  assetVocabSql,
  B2B_REF,
  type CalendarInfo,
  callsSql,
  dealsSql,
  dialsSql,
  ghlContactRow,
  ghlEventRow,
  inboxRow,
  leadRow,
  leadsSql,
  redact,
  repsSql,
  SALES_LOCATION,
  scorecardRows,
  scorecardSql,
  scorecardWindows,
  monthWindows,
  applyVoids,
  dropLooksWrong,
  sourcesSql,
  voidedDealsSql,
  type VoidedDeal,
} from "./lib.ts";

type Row = Record<string, unknown>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FULL_LEADS_EVERY = 6 * HOUR;
const FULL_CALLS_EVERY = 30 * 60_000;
const SCORECARDS_EVERY = 15 * 60_000;
const MONTHS_EVERY = 6 * 3_600_000;
const ASSETS_EVERY = HOUR;
const ARCHIVE_EVERY = 6 * HOUR;
const LEAD_PAGE = 1000;
// A full pass reads this many pages a run and carries on in the next.
const LEAD_PAGES_PER_RUN = 20;
const DIAL_PAGE = 5000;
const DIAL_PAGES_PER_RUN = 10;
const RUNS_KEPT = 30 * DAY;
const LOCK = "sales-mirror";
const LOCK_SECONDS = 300;
const GHL = "https://services.leadconnectorhq.com";
// HighLevel sits behind Cloudflare, which refuses a request with no
// browser-like agent (error 1010).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface State {
  leads_since?: string | null;
  leads_full_at?: string | null;
  /** The full pass under way: when it began, where it has read to, how many. */
  leads_pass_from?: string | null;
  leads_pass_after?: string | null;
  leads_pass_read?: number | null;
  calls_full_at?: string | null;
  calls_archive_at?: string | null;
  dials_since?: string | null;
  /** Every stored call was read again once, for its whole number. */
  dials_digits?: boolean;
  scorecards_at?: string | null;
  months_at?: string | null;
  assets_at?: string | null;
}

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<string> {
  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${base}/rest/v1/${path}`, {
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
  if (!res.ok)
    throw new Error(`Triage ${res.status} on ${path.split("?")[0]}: ${redact(text)}`);
  return text;
}

/** Upsert in batches, so one oversized payload cannot lose the lot. */
async function upsert(
  table: string,
  conflict: string,
  rows: Row[],
): Promise<number> {
  for (let i = 0; i < rows.length; i += 500) {
    await rest(`${table}?on_conflict=${conflict}`, {
      method: "POST",
      body: rows.slice(i, i + 500),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
  return rows.length;
}

async function b2b(sql: string): Promise<Row[]> {
  const token = env("SALES_B2B_MGMT_TOKEN");
  if (!token) throw new Error("SALES_B2B_MGMT_TOKEN is not set on this project");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${B2B_REF}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql, read_only: true }),
      },
    );
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`B2B ${res.status}: ${redact(text)}`);
    const out = text ? JSON.parse(text) : [];
    return Array.isArray(out) ? (out as Row[]) : [];
  }
  throw new Error("B2B kept answering busy; left for the next run");
}

async function readState(): Promise<{
  state: State;
  calendars: Record<string, CalendarInfo>;
}> {
  const rows = JSON.parse(
    await rest(
      "cockpit_sales_settings?select=key,value&key=in.(mirror_state,calendars)",
    ),
  ) as { key: string; value: unknown }[];
  const get = (k: string) => rows.find(r => r.key === k)?.value;
  return {
    state: (get("mirror_state") as State) ?? {},
    calendars: (get("calendars") as Record<string, CalendarInfo>) ?? {},
  };
}

async function saveState(state: State): Promise<void> {
  await upsert("cockpit_sales_settings", "key", [
    {
      key: "mirror_state",
      value: state,
      updated_by: "sales-mirror",
      updated_at: new Date().toISOString(),
    },
  ]);
}

const older = (iso: string | null | undefined, ms: number, now: number) =>
  !iso || now - Date.parse(iso) > ms;

/**
 * Rows the read just now did not touch (mirrored_at before `at`), dropped
 * unless there are suspiciously many. `extra` narrows the filter.
 */
async function dropStale(table: string, at: string, read: number, extra = ""): Promise<number> {
  const filter = `mirrored_at=lt.${encodeURIComponent(at)}${extra}`;
  const limit = Math.max(5, Math.ceil(read * 0.2)) + 1;
  const gone = JSON.parse(
    await rest(`${table}?${filter}&select=mirrored_at&limit=${limit}`),
  ) as unknown[];
  if (!gone.length) return 0;
  if (dropLooksWrong(read, gone.length))
    throw new Error(
      `${table}: B2B's read had ${read} rows and ${gone.length === limit ? `more than ${limit - 1}` : gone.length} of the copy's were missing from it; nothing was dropped`,
    );
  await rest(`${table}?${filter}`, { method: "DELETE", prefer: "return=minimal" });
  return gone.length;
}

async function mirrorReps(at: string): Promise<{ n: number; dropped: number }> {
  const rows = (await b2b(repsSql())).map(r => ({ ...r, mirrored_at: at }));
  if (!rows.length) throw new Error("B2B returned no reps; the copy was kept");
  const n = await upsert("cockpit_sales_reps", "id", rows);
  return { n, dropped: await dropStale("cockpit_sales_reps", at, n) };
}

async function mirrorDeals(at: string): Promise<{ n: number; dropped: number }> {
  const rows = (await b2b(dealsSql())).map(r => ({ ...r, mirrored_at: at }));
  if (!rows.length) throw new Error("B2B returned no deals; the copy was kept");
  const n = await upsert("cockpit_sales_deals", "response_id", rows);
  // A deal deleted in B2B (not voided) would otherwise stay in pay.
  return { n, dropped: await dropStale("cockpit_sales_deals", at, n) };
}

async function mirrorLeads(
  state: State,
  at: string,
  now: number,
): Promise<{ n: number; pass: string; dropped: number }> {
  let n = 0;
  let newest = state.leads_since ?? null;
  const seen = (rows: Row[]) => {
    for (const r of rows) {
      const c = r.changed_at ? Date.parse(String(r.changed_at)) : Number.NaN;
      if (!Number.isNaN(c) && (!newest || c > Date.parse(newest))) newest = new Date(c).toISOString();
    }
  };
  const write = async (rows: Row[]) => {
    seen(rows);
    n += await upsert("cockpit_sales_leads", "contact_id", rows.map(r => leadRow(r, at)));
  };

  // What HighLevel changed since the last run. Half an hour of overlap: a
  // contact stamped a moment before the last read, and stored by B2B a
  // moment after, is read again, not missed.
  let changedAll = true;
  if (state.leads_since) {
    const since = new Date(Date.parse(state.leads_since) - 30 * 60_000).toISOString();
    let after: string | null = null;
    changedAll = false;
    for (let page = 0; page < 50; page++) {
      const rows = await b2b(leadsSql({ since, after, limit: LEAD_PAGE }));
      if (rows.length) await write(rows);
      if (rows.length < LEAD_PAGE) {
        changedAll = true;
        break;
      }
      after = String(rows[rows.length - 1].contact_id);
    }
  }

  // The full pass: due every six hours, or at once when the changes above
  // were too many to read in one run (the watermark then stays put).
  if (!state.leads_pass_from && (older(state.leads_full_at, FULL_LEADS_EVERY, now) || !changedAll)) {
    state.leads_pass_from = at;
    state.leads_pass_after = null;
    state.leads_pass_read = 0;
  }
  let pass = "none";
  let dropped = 0;
  if (state.leads_pass_from) {
    pass = "under way";
    let done = false;
    for (let page = 0; page < LEAD_PAGES_PER_RUN; page++) {
      const rows = await b2b(leadsSql({ after: state.leads_pass_after ?? null, limit: LEAD_PAGE }));
      if (rows.length) {
        await write(rows);
        state.leads_pass_read = (state.leads_pass_read ?? 0) + rows.length;
        state.leads_pass_after = String(rows[rows.length - 1].contact_id);
      }
      if (rows.length < LEAD_PAGE) {
        done = true;
        break;
      }
    }
    if (done) {
      // Read to the end: whatever the pass did not touch, B2B no longer has.
      // A lead HighLevel added in the last two days that B2B has not copied
      // yet (mirrorNewContacts) stays.
      const recent = new Date(now - 2 * DAY).toISOString();
      try {
        dropped = await dropStale(
          "cockpit_sales_leads",
          state.leads_pass_from,
          state.leads_pass_read ?? 0,
          `&or=(lead_created_at.is.null,lead_created_at.lt.${encodeURIComponent(recent)})`,
        );
      } finally {
        state.leads_full_at = state.leads_pass_from;
        state.leads_pass_from = null;
        state.leads_pass_after = null;
        state.leads_pass_read = null;
      }
      pass = "finished";
    }
  }
  // Moved on only when every change was read, so nothing is stepped over.
  if (changedAll || !state.leads_since) state.leads_since = newest;
  return { n, pass, dropped };
}

async function mirrorCalls(
  state: State,
  at: string,
  now: number,
): Promise<{ n: number; full: boolean; archive: boolean; dropped: number }> {
  const full = older(state.calls_full_at, FULL_CALLS_EVERY, now);
  const archive = full && older(state.calls_archive_at, ARCHIVE_EVERY, now);
  const from = new Date(now - (archive ? 730 : full ? 180 : 3) * DAY).toISOString();
  const to = new Date(now + (full ? 60 : 30) * DAY).toISOString();
  const rows = (await b2b(callsSql(from, to))).map(r => ({
    ...r,
    origin: "b2b",
    mirrored_at: at,
  }));
  const n = await upsert("cockpit_sales_appointments", "appointment_id", rows);
  let dropped = 0;
  if (full) {
    // Appointments B2B no longer has inside the window it just read in full
    // (deleted in HighLevel). The dispositions made on them stay.
    dropped = await dropStale(
      "cockpit_sales_appointments",
      at,
      n,
      `&origin=eq.b2b&start_at=gte.${encodeURIComponent(from)}&start_at=lt.${encodeURIComponent(to)}`,
    );
    state.calls_full_at = at;
    if (archive) state.calls_archive_at = at;
  }
  return { n, full, archive, dropped };
}

/** The Follow Up and Callback calendars, straight from HighLevel. */
async function mirrorGhlCalendars(
  calendars: Record<string, CalendarInfo>,
  at: string,
  now: number,
): Promise<{ n: number; skipped?: string }> {
  const token = env("SALES_GHL_TOKEN");
  if (!token) return { n: 0, skipped: "SALES_GHL_TOKEN is not set" };
  const ids = Object.entries(calendars)
    .filter(([, c]) => c.type === "follow_up" || c.type === "callback")
    .map(([id]) => id);
  const start = now - 14 * DAY;
  const end = now + 30 * DAY;
  let n = 0;
  for (const id of ids) {
    const q = new URLSearchParams({
      locationId: SALES_LOCATION,
      calendarId: id,
      startTime: String(start),
      endTime: String(end),
    });
    const res = await fetch(`${GHL}/calendars/events?${q}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-04-15",
        Accept: "application/json",
        "User-Agent": UA,
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HighLevel ${res.status} on calendar ${id}: ${redact(text)}`);
    const events = (JSON.parse(text)?.events ?? []) as Row[];
    const rows = events
      .map(e => ghlEventRow(e, calendars, at))
      .filter((r): r is Row => r !== null);
    n += await upsert("cockpit_sales_appointments", "appointment_id", rows);
    // Events gone from the calendar in the window just read.
    await rest(
      `cockpit_sales_appointments?origin=eq.ghl&calendar_id=eq.${id}&start_at=gte.${encodeURIComponent(new Date(start).toISOString())}&start_at=lt.${encodeURIComponent(new Date(end).toISOString())}&mirrored_at=lt.${encodeURIComponent(at)}`,
      { method: "DELETE", prefer: "return=minimal" },
    );
  }
  return { n };
}

/** The 100 newest conversations, so a lead who wrote back is seen at once. */
async function mirrorInbox(at: string): Promise<{ n: number; skipped?: string }> {
  const token = env("SALES_GHL_TOKEN");
  if (!token) return { n: 0, skipped: "SALES_GHL_TOKEN is not set" };
  const q = new URLSearchParams({
    locationId: SALES_LOCATION,
    limit: "100",
    sort: "desc",
    sortBy: "last_message_date",
  });
  const res = await fetch(`${GHL}/conversations/search?${q}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-04-15",
      Accept: "application/json",
      "User-Agent": UA,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HighLevel ${res.status} on conversations: ${redact(text)}`);
  const rows = ((JSON.parse(text)?.conversations ?? []) as Row[])
    .map(c => inboxRow(c, at))
    .filter((r): r is Row => r !== null);
  return { n: await upsert("cockpit_sales_inbox", "conversation_id", rows) };
}

/**
 * Leads created in the last day that B2B has not copied yet, straight from
 * HighLevel, so a new lead is on the setter's list within one run.
 */
async function mirrorNewContacts(at: string, now: number): Promise<{ n: number; skipped?: string }> {
  const token = env("SALES_GHL_TOKEN");
  if (!token) return { n: 0, skipped: "SALES_GHL_TOKEN is not set" };
  const res = await fetch(`${GHL}/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      locationId: SALES_LOCATION,
      pageLimit: 50,
      sort: [{ field: "dateAdded", direction: "desc" }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HighLevel ${res.status} on contacts: ${redact(text)}`);
  const rows = ((JSON.parse(text)?.contacts ?? []) as Row[])
    .filter(c => c.dateAdded && now - Date.parse(String(c.dateAdded)) <= DAY)
    .map(c => ghlContactRow(c, at))
    .filter((r): r is Row => r !== null);
  if (!rows.length) return { n: 0 };
  // Insert only: a lead B2B already has keeps B2B's row.
  await rest("cockpit_sales_leads?on_conflict=contact_id", {
    method: "POST",
    body: rows,
    prefer: "resolution=ignore-duplicates,return=minimal",
  });
  return { n: rows.length };
}

async function mirrorDials(state: State, at: string, now: number): Promise<{ n: number; more: boolean }> {
  // Once, every stored call is read again so each carries its whole number.
  if (!state.dials_digits) {
    state.dials_since = "2020-01-01T00:00:00.000Z";
    state.dials_digits = true;
  }
  const since = state.dials_since ?? new Date(now - 180 * DAY).toISOString();
  // Ten minutes of overlap for a call B2B committed late with an earlier stamp.
  const from = new Date(Date.parse(since) - 10 * 60_000).toISOString();
  let after: { at: string; id: string } | null = null;
  let newest = state.dials_since ?? null;
  let n = 0;
  let more = false;
  for (let page = 0; page < DIAL_PAGES_PER_RUN; page++) {
    const rows = await b2b(dialsSql({ since: from, after, limit: DIAL_PAGE }));
    for (const r of rows) {
      const t = r.synced_at ? Date.parse(String(r.synced_at)) : Number.NaN;
      if (!Number.isNaN(t) && (!newest || t > Date.parse(newest))) newest = new Date(t).toISOString();
    }
    // B2B's copy wins over one the sales desk read from Maqsam itself.
    const out = rows.map(({ synced_at: _s, ...r }) => ({ ...r, origin: "b2b", mirrored_at: at }));
    n += await upsert("cockpit_sales_dials", "call_id", out);
    more = rows.length === DIAL_PAGE;
    if (!more) break;
    const last = rows[rows.length - 1];
    after = { at: String(last.synced_at), id: String(last.call_id) };
  }
  // Pages are in sync order, so the newest stamp read is where the next run
  // starts even when this one stopped at its page limit.
  state.dials_since = newest;
  return { n, more };
}

async function mirrorScorecards(state: State, at: string, now: number): Promise<number> {
  if (!older(state.scorecards_at, SCORECARDS_EVERY, now)) return 0;
  // The running month goes with the others every fifteen minutes; the eleven
  // closed months before it every six hours (a late mark or deal still
  // moves them, just not often).
  const closed = older(state.months_at, MONTHS_EVERY, now);
  const months = monthWindows(now).filter(w => w.current || closed);
  // Voided deals come out of every window (B2B's scorecard still counts them).
  const [voids, reps] = await Promise.all([b2b(voidedDealsSql()), b2b(repsSql())]);
  let n = 0;
  for (const w of [...scorecardWindows(now), ...months]) {
    const out = await b2b(scorecardSql(w.from, w.to));
    const raw = out[0]?.payload;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = applyVoids(
      Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [],
      voids as unknown as VoidedDeal[],
      reps as unknown as { id: string; closer_aliases: string[] | null }[],
      w,
    );
    const rows = scorecardRows(w, list, at);
    n += await upsert("cockpit_sales_scorecards", "window_key,person_key", rows);
    // Anyone who dropped out of this window since the last read.
    await rest(
      `cockpit_sales_scorecards?window_key=eq.${w.key}&computed_at=lt.${encodeURIComponent(at)}`,
      { method: "DELETE", prefer: "return=minimal" },
    );
  }
  state.scorecards_at = at;
  if (closed) state.months_at = at;
  return n;
}

async function mirrorAssets(state: State, at: string, now: number): Promise<number> {
  if (!older(state.assets_at, ASSETS_EVERY, now)) return 0;
  const [assets, vocab] = await Promise.all([b2b(assetsSql()), b2b(assetVocabSql())]);
  // An empty read is B2B answering oddly, not the library emptied: keep what we have.
  if (!assets.length) throw new Error("B2B returned no published assets; the copy was kept");
  const n = await upsert("cockpit_sales_assets", "id", assets.map(a => ({ ...a, mirrored_at: at })));
  await upsert("cockpit_sales_asset_vocab", "facet,value", vocab.map(v => ({ ...v, mirrored_at: at })));
  // Anything B2B no longer publishes.
  await dropStale("cockpit_sales_assets", at, n);
  if (vocab.length) await dropStale("cockpit_sales_asset_vocab", at, vocab.length);
  state.assets_at = at;
  return n;
}

/** When B2B last read each of its sources, for the pages that depend on them. */
async function mirrorSources(at: string): Promise<number> {
  const rows = await b2b(sourcesSql());
  await upsert("cockpit_sales_settings", "key", [
    { key: "b2b_sources", value: { read_at: at, sources: rows }, updated_by: "sales-mirror", updated_at: at },
  ]);
  return rows.length;
}

/** The run log keeps thirty days. */
async function trimRuns(now: number): Promise<void> {
  await rest(
    `cockpit_sales_mirror_runs?started_at=lt.${encodeURIComponent(new Date(now - RUNS_KEPT).toISOString())}`,
    { method: "DELETE", prefer: "return=minimal" },
  );
}

Deno.serve(async (req: Request) => {
  // Only the pg_cron job, which sends the shared secret from the vault, may run it.
  const expected = env("CRON_SECRET");
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || given !== expected)
    return Response.json({ ok: false, error: "not allowed" }, { status: 401 });

  // One run at a time: the lock lapses by itself if a run dies holding it.
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
    await rest("rpc/cockpit_sales_unlock", {
      method: "POST",
      body: { p_name: LOCK, p_holder: holder },
    }).catch(() => {});
  }
});

async function run(): Promise<Response> {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const counts: Record<string, unknown> = {};
  const errors: string[] = [];

  let runId: number | null = null;
  try {
    const out = await rest("cockpit_sales_mirror_runs?select=id", {
      method: "POST",
      body: { started_at: at, mode: "scheduled" },
      prefer: "return=representation",
    });
    runId = (JSON.parse(out)?.[0]?.id as number) ?? null;
  } catch (e) {
    errors.push(`run row: ${redact(String(e))}`);
  }

  let state: State = {};
  let calendars: Record<string, CalendarInfo> = {};
  try {
    ({ state, calendars } = await readState());
  } catch (e) {
    errors.push(`state: ${redact(String(e))}`);
  }

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      counts[name] = await fn();
    } catch (e) {
      counts[name] = "failed";
      errors.push(`${name}: ${redact(String((e as Error).message ?? e))}`);
    }
  };

  await step("reps", () => mirrorReps(at));
  await step("deals", () => mirrorDeals(at));
  await step("leads", () => mirrorLeads(state, at, now));
  await step("new_contacts", () => mirrorNewContacts(at, now));
  await step("appointments", () => mirrorCalls(state, at, now));
  await step("ghl_calendars", () => mirrorGhlCalendars(calendars, at, now));
  await step("inbox", () => mirrorInbox(at));
  await step("dials", () => mirrorDials(state, at, now));
  await step("linked_dials", async () => {
    const out = await rest("rpc/cockpit_sales_link_dials", { method: "POST", body: {} });
    return JSON.parse(out || "0");
  });
  await step("scorecards", () => mirrorScorecards(state, at, now));
  await step("assets", () => mirrorAssets(state, at, now));
  await step("b2b_sources", () => mirrorSources(at));
  // After a finished full pass, four times a day.
  if ((counts.leads as { pass?: string } | undefined)?.pass === "finished")
    await step("trim_runs", () => trimRuns(now));

  try {
    await saveState(state);
  } catch (e) {
    errors.push(`state save: ${redact(String(e))}`);
  }

  const ok = errors.length === 0;
  if (runId !== null) {
    try {
      await rest(`cockpit_sales_mirror_runs?id=eq.${runId}`, {
        method: "PATCH",
        body: {
          finished_at: new Date().toISOString(),
          ok,
          counts,
          error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
        },
        prefer: "return=minimal",
      });
    } catch {
      // The run row is a report, not the work; the work is done.
    }
  }
  return Response.json(
    { ok, counts, errors, ms: Date.now() - now },
    { status: ok ? 200 : 207 },
  );
}
