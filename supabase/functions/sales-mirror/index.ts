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
// What each run does:
// - reps and signed deals: all of them (9 and 50 rows).
// - leads: the contacts HighLevel changed since the last run, plus a full
//   pass every six hours that also drops contacts B2B no longer has.
// - appointments: the hot window (three days back, thirty ahead) every run,
//   and 180 days back every half hour, dropping appointments B2B dropped.
// - the Follow Up and Callback calendars, which B2B does not carry: read
//   from HighLevel directly when SALES_GHL_TOKEN is set.
// - Maqsam calls B2B stored since the last run, then linked to leads by the
//   phone's last eight digits.
// - rep scorecards (B2B's own b2b_rep_scorecard) every fifteen minutes.
// Each run leaves a row in cockpit_sales_mirror_runs; a failed step is
// written there and the other steps still run.

import {
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
} from "./lib.ts";

type Row = Record<string, unknown>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FULL_LEADS_EVERY = 6 * HOUR;
const FULL_CALLS_EVERY = 30 * 60_000;
const SCORECARDS_EVERY = 15 * 60_000;
const LEAD_PAGE = 1000;
const GHL = "https://services.leadconnectorhq.com";
// HighLevel sits behind Cloudflare, which refuses a request with no
// browser-like agent (error 1010).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface State {
  leads_since?: string | null;
  leads_full_at?: string | null;
  calls_full_at?: string | null;
  dials_since?: string | null;
  scorecards_at?: string | null;
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

async function mirrorReps(at: string): Promise<number> {
  const rows = (await b2b(repsSql())).map(r => ({ ...r, mirrored_at: at }));
  return await upsert("cockpit_sales_reps", "id", rows);
}

async function mirrorDeals(at: string): Promise<number> {
  const rows = (await b2b(dealsSql())).map(r => ({ ...r, mirrored_at: at }));
  return await upsert("cockpit_sales_deals", "response_id", rows);
}

async function mirrorLeads(
  state: State,
  at: string,
  now: number,
): Promise<{ n: number; full: boolean; dropped: number }> {
  const full = older(state.leads_full_at, FULL_LEADS_EVERY, now) || !state.leads_since;
  // Half an hour of overlap: a contact HighLevel stamped a moment before the
  // last read, and B2B stored a moment after, is read again, not missed.
  const since = full
    ? null
    : new Date(Date.parse(String(state.leads_since)) - 30 * 60_000).toISOString();
  let after: string | null = null;
  let n = 0;
  let newest = state.leads_since ?? null;
  for (let page = 0; page < 50; page++) {
    const rows = await b2b(leadsSql({ since, after, limit: LEAD_PAGE }));
    if (!rows.length) break;
    for (const r of rows) {
      const c = r.changed_at ? String(r.changed_at) : null;
      if (c && (!newest || Date.parse(c) > Date.parse(newest))) newest = new Date(Date.parse(c)).toISOString();
    }
    n += await upsert(
      "cockpit_sales_leads",
      "contact_id",
      rows.map(r => leadRow(r, at)),
    );
    after = String(rows[rows.length - 1].contact_id);
    if (rows.length < LEAD_PAGE) break;
  }
  let dropped = 0;
  if (full && n > 0) {
    // A full pass that read every contact may drop the ones B2B no longer
    // has. Only webhook rows (origin other than b2b) would be kept, and
    // there are none yet.
    const out = await rest(
      `cockpit_sales_leads?mirrored_at=lt.${encodeURIComponent(at)}&select=contact_id`,
      { method: "DELETE", prefer: "return=representation" },
    );
    dropped = (JSON.parse(out || "[]") as unknown[]).length;
    state.leads_full_at = at;
  }
  state.leads_since = newest;
  return { n, full, dropped };
}

async function mirrorCalls(
  state: State,
  at: string,
  now: number,
): Promise<{ n: number; full: boolean; dropped: number }> {
  const full = older(state.calls_full_at, FULL_CALLS_EVERY, now);
  const from = new Date(now - (full ? 180 : 3) * DAY).toISOString();
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
    const out = await rest(
      `cockpit_sales_appointments?origin=eq.b2b&start_at=gte.${encodeURIComponent(from)}&start_at=lt.${encodeURIComponent(to)}&mirrored_at=lt.${encodeURIComponent(at)}&select=appointment_id`,
      { method: "DELETE", prefer: "return=representation" },
    );
    dropped = (JSON.parse(out || "[]") as unknown[]).length;
    state.calls_full_at = at;
  }
  return { n, full, dropped };
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

async function mirrorDials(state: State, at: string, now: number): Promise<number> {
  const since =
    state.dials_since ?? new Date(now - 180 * DAY).toISOString();
  const rows = await b2b(
    dialsSql(new Date(Date.parse(since) - 10 * 60_000).toISOString(), 5000),
  );
  let newest = state.dials_since ?? null;
  for (const r of rows) {
    const s = r.synced_at ? new Date(Date.parse(String(r.synced_at))).toISOString() : null;
    if (s && (!newest || Date.parse(s) > Date.parse(newest))) newest = s;
  }
  const out = rows.map(({ synced_at: _s, ...r }) => ({ ...r, mirrored_at: at }));
  const n = await upsert("cockpit_sales_dials", "call_id", out);
  state.dials_since = newest;
  return n;
}

async function mirrorScorecards(state: State, at: string, now: number): Promise<number> {
  if (!older(state.scorecards_at, SCORECARDS_EVERY, now)) return 0;
  let n = 0;
  for (const w of scorecardWindows(now)) {
    const out = await b2b(scorecardSql(w.from, w.to));
    const raw = out[0]?.payload;
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    const rows = scorecardRows(w, list, at);
    n += await upsert("cockpit_sales_scorecards", "window_key,person_key", rows);
    // Anyone who dropped out of this window since the last read.
    await rest(
      `cockpit_sales_scorecards?window_key=eq.${w.key}&computed_at=lt.${encodeURIComponent(at)}`,
      { method: "DELETE", prefer: "return=minimal" },
    );
  }
  state.scorecards_at = at;
  return n;
}

Deno.serve(async (req: Request) => {
  // Only the pg_cron job, which sends the shared secret from the vault, may run it.
  const expected = env("CRON_SECRET");
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || given !== expected)
    return Response.json({ ok: false, error: "not allowed" }, { status: 401 });

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
});
