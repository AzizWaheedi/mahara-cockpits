/**
 * hermes/csm-calls: every call, call form and media buyer change per client,
 * for the client success cockpit. Its own cron line, lock and release; it never
 * touches the native media feed.
 *
 *   bun hermes/csm-calls/worker.ts doctor
 *   bun hermes/csm-calls/worker.ts run [--apply] [--report <path>] [--only ghl,typeform,fathom,meta,changes,eods,forms]
 *   bun hermes/csm-calls/worker.ts backfill --source ghl|fathom|meta|eods [--apply] [--report <path>]
 *   bun hermes/csm-calls/worker.ts backfill --source fathom-actions [--since YYYY-MM-DD] [--apply] [--report <path>]
 *   bun hermes/csm-calls/worker.ts seed [--apply]
 *   bun hermes/csm-calls/worker.ts reconcile [--apply] [--report <path>]
 *
 * A run is dry unless --apply. One failing source keeps its last good rows,
 * marks its own cockpit_sync_state row not ok with the provider named, and the
 * other sources still write.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { makeTransport, makeDb, writeHealth, REQUIRED, ProviderError, type Env, type Health } from "./lib";
import {
  type Ctx,
  type FormsRead,
  loadClients,
  ghlSource,
  readTypeforms,
  linkTypeforms,
  fathomSource,
  fathomActionsBackfill,
  metaSource,
  changesSource,
  formsRecord,
  unmatchedQueue,
  seed,
  reconcile,
} from "./sources";
import { eodSource } from "./eods";

const DAY = 86_400_000;

export function readEnv(): Env {
  const env: Env = { ...process.env };
  // Keys by name from the files named in the runbook; values never printed.
  for (const f of (process.env.CSM_CALLS_ENV_FILES ?? "").split(":").filter(Boolean)) {
    try {
      const text = readFileSync(f, "utf8");
      if (f.endsWith(".json")) Object.assign(env, { ...JSON.parse(text), ...env });
      else
        for (const line of text.split("\n")) {
          const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
          if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
        }
    } catch {}
  }
  return env;
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const errText = (e: unknown) =>
  e instanceof ProviderError ? `${e.provider} ${e.status || "unreachable"}: ${e.message}` : String((e as Error)?.message ?? e).slice(0, 240);

async function doctor(env: Env) {
  const missing = REQUIRED.filter(k => !env[k]);
  const out: Record<string, unknown> = { keys: Object.fromEntries(REQUIRED.map(k => [k, env[k] ? "set" : "missing"])), missing };
  if (missing.length) return { ok: false, ...out };
  const t = makeTransport(env, "doctor");
  const db = makeDb(env);
  const checks: Record<string, string> = {};
  const probe = async (name: string, f: () => Promise<unknown>) => {
    try {
      await f();
      checks[name] = "ok";
    } catch (e) {
      checks[name] = errText(e);
    }
  };
  await probe("supabase", () => db.ping());
  await probe("ghl", () => t.ghl("calendars/", { locationId: "wwG426bwruWWv9W3fazQ" }, "2021-04-15"));
  await probe("fathom", () => t.fathom(new URLSearchParams({ created_after: new Date(Date.now() - DAY).toISOString() })));
  await probe("typeform", () => t.typeform("forms/fRokTITH/responses", { page_size: "1" }));
  await probe("meta", () => t.meta("me", { fields: "id" }));
  await probe("store", () => db.all("cockpit_csm_calls", "select=id&limit=1"));
  // The Fathom intake's columns and the 1-1 notes registry (migrations 20261027f and 20261027g).
  await probe("intake store", () => db.all("cockpit_csm_calls", "select=candidate,hints,settled_reason,room&limit=1"));
  // Since Stage 2b: the switch-over time (20261029s) and the kickoff and Blueprint record sweep (20261029y), asked
  // with p_apply false, which writes nothing.
  await probe("forms registry", () => db.all("cockpit_forms", "select=provider,provider_since&key=eq.checkin"));
  await probe("forms record", () => db.rpc("cockpit_form_record_sweep", { p_apply: false }));
  await probe("eod sheet", () => t.sheetTabs());
  await probe("slack eods", () => t.slackHistory({ channel: "C09RQS2TFST", limit: "1" }));
  await probe("eod store", () => db.all("cockpit_csm_eod_mentions", "select=id&limit=1"));
  return { ok: Object.values(checks).every(v => v === "ok"), ...out, checks };
}

async function main() {
  const cmd = process.argv[2] ?? "run";
  const env = readEnv();
  if (cmd === "doctor") {
    const r = await doctor(env);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  const apply = process.argv.includes("--apply");
  const runKey = `${cmd}-${new Date().toISOString()}`;
  const t = makeTransport(env, runKey);
  const db = makeDb(env);
  const now = Date.now();
  const state = await db.all("cockpit_sync_state", "select=key,ok,last_ok_at,note&key=like.csm-*");
  const ctx: Ctx = {
    db,
    t,
    apply,
    now,
    clients: await loadClients(db),
    reasons: new Map(),
    shareToTask: new Map(),
    stateOf: k => state.find(s => s.key === k),
    plan: {},
  };
  const healths: Health[] = [];
  const failures: string[] = [];
  const guard = async (key: string, f: () => Promise<Health | Health[]>) => {
    try {
      const h = await f();
      healths.push(...(Array.isArray(h) ? h : [h]));
    } catch (e) {
      const msg = errText(e);
      failures.push(`${key}: ${msg}`);
      const provider = e instanceof ProviderError ? e.provider : "worker";
      healths.push({
        key,
        ok: false,
        rows: 0,
        note: `Failed, last good rows kept. ${msg}`,
        detail: { error: { provider, status: e instanceof ProviderError ? e.status : null, message: msg } },
      });
    }
  };
  const lookback = (key: string, fallbackDays: number, overlapDays: number) => {
    const last = Date.parse(ctx.stateOf(key)?.last_ok_at ?? "");
    return Number.isFinite(last) ? Math.min(last - overlapDays * DAY, now - overlapDays * DAY) : now - fallbackDays * DAY;
  };
  const only = (arg("--only") ?? "ghl,typeform,fathom,meta,changes,eods,forms").split(",");

  if (cmd === "run") {
    if (only.includes("ghl")) await guard("csm-ghl-calls", () => ghlSource(ctx, now - 30 * DAY, now + 60 * DAY));
    const formsFailed = (e: unknown) => {
      const msg = errText(e);
      failures.push(`typeform: ${msg}`);
      for (const key of ["csm-checkin-form", "csm-forms-history"])
        healths.push({ key, ok: false, rows: 0, note: `Failed, last good rows kept. ${msg}`, detail: { error: { provider: "typeform", message: msg } } });
    };
    // The forms are read before the Fathom source, which places recordings by the 1-1 forms' Fathom links,
    // and linked to their calls after it, so a form goes under the impromptu recording its link places in
    // this same run, never first under a booked check-in or a held call of its own (contract 4.1).
    let forms: FormsRead | undefined;
    if (only.includes("typeform")) {
      try {
        forms = await readTypeforms(ctx);
      } catch (e) {
        formsFailed(e);
      }
    }
    if (only.includes("fathom")) await guard("csm-fathom", () => fathomSource(ctx, new Date(lookback("csm-fathom", 7, 7)).toISOString().replace(/\.\d{3}Z$/, "Z")));
    if (forms) {
      try {
        healths.push(...(await linkTypeforms(ctx, forms)));
      } catch (e) {
        formsFailed(e);
      }
    }
    if (only.includes("meta")) await guard("csm-meta-activities", () => metaSource(ctx, lookback("csm-meta-activities", 3, 1)));
    if (only.includes("changes")) await guard("csm-media-changes", () => changesSource(ctx));
    // EODs are rewritten or corrected after posting: re-read the last 3 days every tick.
    if (only.includes("eods")) await guard("csm-eod-mentions", () => eodSource(ctx, Math.min(lookback("csm-eod-mentions", 3, 3), now - 3 * DAY)));
    // Kickoff and Blueprint responses into the forms tables (docs/forms/STAGE2B-CONTRACT.md 4.8): records only.
    if (only.includes("forms")) await guard("csm-forms-record", () => formsRecord(ctx));
  } else if (cmd === "backfill") {
    const source = arg("--source");
    if (source === "ghl") {
      // Weekly windows from 1 June, in 4-week slices so a slice failure names its dates.
      for (let s = Date.parse("2026-06-01T00:00:00+03:00"); s < now + 60 * DAY; s += 28 * DAY)
        await guard("csm-ghl-calls", () => ghlSource(ctx, s, Math.min(s + 28 * DAY, now + 60 * DAY)));
    } else if (source === "fathom") await guard("csm-fathom", () => fathomSource(ctx, "2026-07-01T00:00:00Z", 60));
    else if (source === "fathom-actions") {
      // Light: action items, class, room and team for the stored meetings, and the strip with no cap.
      const day = arg("--since") ?? "2026-09-25";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) throw new Error("--since YYYY-MM-DD");
      await guard("csm-fathom-actions", () => fathomActionsBackfill(ctx, `${day}T00:00:00Z`));
    } else if (source === "meta") await guard("csm-meta-activities", () => metaSource(ctx, now - 90 * DAY));
    else if (source === "eods") await guard("csm-eod-mentions", () => eodSource(ctx, now - 90 * DAY));
    else throw new Error("--source ghl|fathom|fathom-actions|meta|eods");
    // One health line per source for the whole backfill: slices add up, any failed slice fails it.
    const merged = new Map<string, Health>();
    for (const h of healths) {
      const m = merged.get(h.key);
      if (!m) {
        merged.set(h.key, { ...h, detail: { ...h.detail, slices: 1 } });
        continue;
      }
      const d = m.detail, e = h.detail;
      for (const k of ["read", "matched", "unmatched", "upserted", "gone"])
        if (typeof e[k] === "number") d[k] = (d[k] ?? 0) + e[k];
      d.slices += 1;
      m.ok = m.ok && h.ok;
      m.rows += h.rows;
      if (!h.ok) m.note = h.note;
    }
    healths.length = 0;
    for (const h of merged.values()) {
      if (h.ok && h.key === "csm-ghl-calls")
        h.note = `Backfill since 1 Jun: ${h.detail.read} appointments read in ${h.detail.slices} slices, ${h.detail.matched} matched, ${h.detail.unmatched} unmatched, ${h.detail.gone} gone.`;
      healths.push(h);
    }
  } else if (cmd === "seed") {
    await seed(ctx);
  } else if (cmd === "reconcile") {
    await guard("csm-reconcile", () => reconcile(ctx));
  } else throw new Error(`Unknown command ${cmd}`);

  let queue = { open: 0, resolved: 0 };
  if (cmd === "run" || cmd === "backfill") queue = await unmatchedQueue(ctx);
  if (apply) {
    for (const h of healths) {
      if (cmd === "run" || cmd === "reconcile") h.detail = { ...h.detail, unmatchedQueue: queue };
      await writeHealth(db, h);
    }
    if (t.receipts.length) await db.insert("cockpit_csm_provider_health", t.receipts);
  }
  const failedSources = [...new Set([...failures, ...healths.filter(h => !h.ok).map(h => `${h.key}: ${h.note}`)])];
  const report = {
    command: cmd,
    apply,
    runKey,
    clients: ctx.clients.length,
    plan: ctx.plan,
    queue,
    health: healths.map(h => ({ key: h.key, ok: h.ok, note: h.note })),
    failures: failedSources,
    receipts: t.receipts.length,
  };
  const path = arg("--report");
  if (path) {
    if (path.includes("/mahara-cockpits") || path.includes("/csm-calls-wt") || path.includes("/csm-calls/")) throw new Error("Write the report outside the repository");
    writeFileSync(path, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify({ command: cmd, apply, failures: failedSources, health: report.health }, null, 1));
  // A partial Meta read also exits nonzero. The guardian still sees each source's own health row.
  console.log(failedSources.length ? `csm-calls ${cmd} FAILED: ${failedSources.length} source(s) failed` : `csm-calls ${cmd} OK`);
  process.exit(failedSources.length ? 1 : 0);
}

if (import.meta.main)
  main().catch(e => {
    console.log(`csm-calls FAILED: ${errText(e)}`);
    process.exit(1);
  });
