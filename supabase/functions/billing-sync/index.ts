// billing-sync: the ClickUp billing fields, kept in Supabase without Convex.
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), called by pg_cron
// (migration 20261009a_billing_native_sync.sql) with the shared secret from
// the vault. Each run:
//   1. reads every card on Clients - Mahara (ClickUp list 901816559981) and
//      its field definitions, read-only, each call receipted in
//      cockpit_csm_provider_health through cockpit-csm-api's providerTools;
//   2. merges the cards onto cockpit_billing_accounts (billing.ts says how:
//      never blank a value, keep a cockpit edit newer than the card);
//   3. writes today's cockpit_client_billing_days snapshot per card;
//   4. takes pending cockpit_billing_inbox payments into the ledger;
//   5. records the run in cockpit_sync_state under 'billing-sync'.
//
// It never writes to ClickUp. Database writes happen only when the secret
// BILLING_SYNC_APPLY is exactly "true"; otherwise the run is a dry run that
// reports what it would write. A request body of {"dryRun":true} forces a dry
// run, {"report":true} returns the full report instead of the counts, and
// {"doctor":true} names the secrets that are set without reading or writing.
// Secrets by name: CRON_SECRET, CLICKUP_API_TOKEN, BILLING_SYNC_APPLY, and the
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY every function receives.

import { providerTools } from "../cockpit-csm-api/tools.ts";
import {
  billingDays,
  CRITICAL_FIELDS,
  lastPage,
  LIST_ID,
  missingFields,
  optionsFrom,
  planMirror,
  readProblem,
  redact,
  runNote,
} from "./billing.ts";

const KEY = "billing-sync";
const MAX_PAGES = 20;
const EVENT_LOOKBACK_DAYS = 60;

type Row = Record<string, unknown>;

async function rest(
  base: string,
  key: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<unknown> {
  const res = await fetch(`${base.replace(/\/+$/, "")}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path.split("?")[0]}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  // Only the pg_cron job, which sends the shared secret from the vault, may run it.
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || !given || given !== expected)
    return new Response(JSON.stringify({ ok: false, note: "not allowed" }), { status: 401 });

  let body: Row = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Row;
  } catch {
    body = {};
  }
  const forcedDry = body.dryRun === true;
  const apply = Deno.env.get("BILLING_SYNC_APPLY") === "true" && !forcedDry;
  const wantReport = body.report === true || !apply;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (Deno.env.get("CLICKUP_API_TOKEN") ?? "").trim();
  const secrets = [token, serviceKey, expected];
  const now = new Date();
  const nowIso = now.toISOString();
  const db = (path: string, init?: Parameters<typeof rest>[3]) => rest(supabaseUrl, serviceKey, path, init);

  // A manual dry run while the job is live leaves the live job's state alone.
  const keepsState = !(forcedDry && Deno.env.get("BILLING_SYNC_APPLY") === "true");
  const state = async (patch: Row) => {
    if (!keepsState) return;
    await db("cockpit_sync_state?on_conflict=key", {
      method: "POST",
      body: [{ key: KEY, last_run_at: nowIso, updated_at: nowIso, ...patch }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  };

  // doctor: which secrets are present, by name. No provider call, no write.
  if (body.doctor === true) {
    const set = (v: string) => (v ? "set" : "missing");
    return new Response(
      JSON.stringify({
        ok: Boolean(supabaseUrl && serviceKey && token),
        secrets: {
          CRON_SECRET: "set",
          CLICKUP_API_TOKEN: set(token),
          SUPABASE_URL: set(supabaseUrl),
          SUPABASE_SERVICE_ROLE_KEY: set(serviceKey),
          BILLING_SYNC_APPLY: Deno.env.get("BILLING_SYNC_APPLY") === "true" ? "true: runs write" : "not true: runs are dry runs",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!supabaseUrl || !serviceKey)
    return new Response(JSON.stringify({ ok: false, note: "Supabase is not configured on this function." }), { status: 200 });
  if (!token) {
    const note = "CLICKUP_API_TOKEN is not set on this Edge Function. Add it under Edge Functions, Secrets, in the Supabase dashboard.";
    await state({ ok: false, note, rows_seen: 0 });
    return new Response(JSON.stringify({ ok: false, note }), { status: 200 });
  }

  let seen = 0;
  try {
    // Every ClickUp call lands in the CSM provider ledger the native monitor reads.
    const clickup = providerTools(token, async row => {
      await db("cockpit_csm_provider_health", {
        method: "POST",
        body: { ...row, provider: "clickup", action_id: null },
        prefer: "return=minimal",
      });
    });
    // Reads only, so a rate limit or a blip is retried twice before it counts.
    const read = async (path: string): Promise<Row> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return (await clickup.call("GET", path)) as Row;
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          if (attempt >= 2 || !/\((429|5\d\d)\)|unknown/i.test(m)) throw e;
          await pause(1500 * (attempt + 1));
        }
      }
    };

    const options = optionsFrom(await read(`list/${LIST_ID}/field`));
    const tasks: Row[] = [];
    let pagesCapped = true;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await read(`list/${LIST_ID}/task?include_closed=true&subtasks=false&page=${page}`);
      const batch = (Array.isArray(res.tasks) ? res.tasks : []) as Row[];
      tasks.push(...batch);
      if (lastPage(res, batch)) {
        pagesCapped = false;
        break;
      }
    }
    seen = tasks.length;

    const since = new Date(now.getTime() - EVENT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const [existing, events] = (await Promise.all([
      db("cockpit_billing_accounts?select=*"),
      db(
        "cockpit_billing_events?select=clickup_task_id,kind,from_value,to_value,detail,source,at" +
          "&source=in.(ceo,csm,maher)&kind=in.(method,plan,amount,date,extension,pause,resume,payment)" +
          `&at=gte.${encodeURIComponent(since)}&order=at.desc&limit=5000`,
      ),
    ])) as [Row[], Row[]];

    const plan = planMirror(tasks, options, existing ?? [], events ?? [], nowIso);
    const days = billingDays(tasks, options, now.getTime());
    const missing = missingFields(options);
    const problem = readProblem({
      tasks: tasks.length,
      pagesCapped,
      missingFields: missing.filter(id => CRITICAL_FIELDS.includes(id)),
      accounts: plan.rows.length,
      mirrorRows: (existing ?? []).length,
    });
    if (problem) throw new Error(problem);

    const runSummary = {
      at: nowIso,
      cards: plan.rows.length,
      changed: plan.changed.slice(0, 200),
      held: plan.held.slice(0, 200),
      kept: plan.kept.slice(0, 200),
      notOnList: plan.notOnList.slice(0, 200),
      unread: plan.unread,
      internal: plan.internal,
      unknownCurrencies: days.unknownCurrencies,
      missingFields: missing,
    };

    let applied: Row | null = null;
    if (apply)
      applied = (await db("rpc/cockpit_billing_sync_apply", {
        method: "POST",
        body: { p_accounts: plan.rows, p_days: days.rows, p_run: runSummary },
      })) as Row;
    const inbox = (await db("rpc/cockpit_billing_ingest_inbox", {
      method: "POST",
      body: { p_apply: apply, p_limit: 50 },
    })) as Row;

    const skipped = Array.isArray(applied?.skipped) ? (applied?.skipped as unknown[]).length : 0;
    const note = runNote({
      apply,
      plan,
      days: days.rows.length,
      unknownCurrencies: days.unknownCurrencies,
      inbox: inbox as Parameters<typeof runNote>[0]["inbox"],
      skipped,
      missingFields: missing,
    });
    // A dry run is not a sync: the job reads as not running until it writes.
    if (apply) await state({ ok: true, last_ok_at: nowIso, note, rows_seen: plan.rows.length });
    else await state({ ok: false, note, rows_seen: plan.rows.length });

    const counts = {
      cards: plan.rows.length,
      changed: plan.changed.length,
      held: plan.held.length,
      kept: plan.kept.length,
      notOnList: plan.notOnList.length,
      days: days.rows.length,
      skipped,
    };
    return new Response(
      JSON.stringify({
        ok: true,
        apply,
        note,
        counts,
        ...(wantReport ? { report: { ...runSummary, days: days.rows.length, inbox } } : {}),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const note = redact(e instanceof Error ? e.message : String(e), secrets);
    try {
      await state({ ok: false, note, rows_seen: seen });
    } catch {
      // The state row is the monitor's signal; the response still says why.
    }
    return new Response(JSON.stringify({ ok: false, apply, note }), { status: 200 });
  }
});
