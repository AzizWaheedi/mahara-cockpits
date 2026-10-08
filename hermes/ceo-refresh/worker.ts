import { createHash, randomUUID } from "node:crypto";
import { withRuntime, type Adapter, type DailyPoint, type Row, errorText, object, rows } from "./runtime.ts";
import { createProviderDriver, withProviderSection, type Environment } from "./providerTools.ts";
import { createRepository } from "./repository.ts";
import { DEFINITIONS, extract } from "./native/metrics.ts";
import { createMoneyAdapter } from "./native/adapters/money.js";
import { createExpensesAdapter } from "./native/adapters/expenses.js";
import { assets } from "./native/adapters/assets.js";
import { b2bAds } from "./native/adapters/b2bAds.js";
import { calls } from "./native/adapters/calls.js";
import { clients } from "./native/adapters/clients.js";
import { delivery } from "./native/adapters/delivery.js";
import { growth } from "./native/adapters/growth.js";
import { hiring } from "./native/adapters/hiring.js";
import { machine } from "./native/adapters/machine.js";
import { organic } from "./native/adapters/organic.js";
import { portal } from "./native/adapters/portal.js";
import { team } from "./native/adapters/team.js";
import { webinar } from "./native/adapters/webinar.js";

export const SECTION_KEYS = ["money", "expenses", "growth", "webinar", "b2bAds", "delivery", "calls", "clients", "team", "hiring", "portal", "assets", "organic", "machine"] as const;
export type SectionKey = typeof SECTION_KEYS[number];
export interface RefreshOptions {
  env: Environment;
  fetcher?: typeof fetch;
  only?: string[];
  apply?: boolean;
  runId?: string;
}
export interface SectionReport {
  key: string;
  status: "computed" | "failed";
  error?: string;
  sourceCount?: number;
  dailyCount?: number;
  metricCount?: number;
}
export interface RefreshReport {
  ok: boolean;
  status: "dry-run" | "published" | "partial" | "failed";
  dryRun: boolean;
  runId: string;
  sections: SectionReport[];
  receipts: number;
  error?: string;
  missing?: string[];
  revision?: number;
}
export interface DoctorReport {
  ok: boolean;
  dryRunDefault: true;
  required: string[];
  missing: string[];
  config: string[];
  financePrerequisites: string[];
}
export interface CliOptions {
  command: "doctor" | "run" | "serve";
  apply: boolean;
  only?: string[];
}

type ComputedSection = {
  key: SectionKey;
  label: string;
  payload: Row;
  sources: Row[];
  daily: DailyPoint[];
  clientPayments?: Row[];
  financeRevision?: number;
  values: Row[];
};

type Failure = { key: SectionKey; error: string };
const TRIAGE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
const BASE_KEYS = ["SUPABASE_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"];
const SECTION_KEYS_REQUIRED: Record<SectionKey, string[]> = {
  money: [], expenses: [], growth: [], webinar: [], b2bAds: ["META_SYSTEM_TOKEN"],
  delivery: [], calls: [], clients: ["CLICKUP_API_TOKEN", "TYPEFORM_TOKEN"], team: [],
  hiring: ["GHL_HIRING_PIT", "GHL_HIRING_LOCATION"], portal: [], assets: [],
  organic: ["META_SYSTEM_TOKEN", "GOOGLE_SERVICE_ACCOUNT_JSON"], machine: [],
};
const LABELS: Record<SectionKey, string> = {
  money: "Money", expenses: "Expenses and P&L", growth: "Marketing and sales", webinar: "Webinar funnel",
  b2bAds: "Our ads", delivery: "Client delivery", calls: "Call center", clients: "Client success",
  team: "Management", hiring: "Recruiting", portal: "Client portal", assets: "Sales assets",
  organic: "Organic", machine: "Machine and data trust",
};
const ADAPTERS: Record<Exclude<SectionKey, "money" | "expenses">, Adapter> = {
  growth, webinar, b2bAds, delivery, calls, clients, team, hiring, portal, assets, organic, machine,
};

function requiredMissing(env: Environment, sections: SectionKey[]): string[] {
  const required = new Set<string>(BASE_KEYS);
  for (const section of sections) for (const name of SECTION_KEYS_REQUIRED[section]) required.add(name);
  return [...required].filter(name => !env[name]?.trim()).sort();
}

function configErrors(env: Environment): string[] {
  const errors: string[] = [];
  if ((env.SUPABASE_URL ?? "").replace(/\/+$/, "") !== TRIAGE_URL) errors.push("SUPABASE_URL must identify the fixed Creative Triage project bldgtotkfmhoxmlzowdx");
  return errors;
}

export function doctor(env: Environment, only: string[] = [...SECTION_KEYS]): DoctorReport {
  const selected = normalizeSections(only);
  const required = [...new Set([...BASE_KEYS, ...selected.flatMap(section => SECTION_KEYS_REQUIRED[section])])].sort();
  const missing = required.filter(name => !env[name]?.trim());
  const config = configErrors(env);
  const financePrerequisites = selected.includes("money")
    ? ["manual payment history must be reconciled", "finance aliases must be reconciled", "manual_ready and history_ready must already be true", "a recent bank statement and confirmed read-only provider inputs are required"]
    : [];
  return { ok: missing.length === 0 && config.length === 0, dryRunDefault: true, required, missing, config, financePrerequisites };
}

function normalizeSections(input: string[]): SectionKey[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Choose at least one CEO section");
  const requested = new Set<SectionKey>();
  for (const name of input) {
    if (!SECTION_KEYS.includes(name as SectionKey)) throw new Error(`Unknown CEO section ${name}`);
    requested.add(name as SectionKey);
  }
  if (requested.has("money") || requested.has("expenses")) {
    requested.add("money");
    requested.add("expenses");
  }
  return SECTION_KEYS.filter(key => requested.has(key));
}

function validateJsonObject(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} returned no object`);
  return value as Row;
}

function validateDaily(value: unknown, key: SectionKey): DailyPoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} returned an invalid daily history`);
  return value.map((item, index) => {
    const row = validateJsonObject(item, `${key} daily row ${index + 1}`);
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || typeof row.metric !== "string" || !row.metric.startsWith(`${key}.`) || typeof row.scope !== "string" || !row.scope || typeof row.value !== "number" || !Number.isFinite(row.value)) {
      throw new Error(`${key} daily row ${index + 1} is not a confirmed metric point`);
    }
    if (!DEFINITIONS.some(definition => definition.metric === row.metric && definition.section === key)) {
      throw new Error(`${key} daily metric ${row.metric} has no registered definition`);
    }
    return { date: row.date, metric: row.metric, scope: row.scope.slice(0, 120), value: row.value };
  });
}

function validateSources(value: unknown, key: SectionKey): Row[] {
  const sourceRows = rows(value, `${key} source evidence`);
  if (sourceRows.length === 0) throw new Error(`${key} returned no source evidence`);
  for (const source of sourceRows) {
    if (typeof source.name !== "string" || source.ok !== true) {
      const name = typeof source.name === "string" ? source.name : "unknown source";
      const note = typeof source.note === "string" ? `: ${source.note}` : "";
      throw new Error(`${name} was not confirmed${note}`);
    }
  }
  return sourceRows;
}

function extractCurrentValues(key: SectionKey, payload: Row): Row[] {
  const values = extract(key, payload);
  const seen = new Set<string>();
  const today = new Date(Date.now() + 3 * 60 * 60_000).toISOString().slice(0, 10);
  const output = [];
  for (const value of values) {
    if (!value || typeof value.metric !== "string" || typeof value.scope !== "string" || typeof value.window !== "string") continue;
    if (value.value === null || typeof value.value !== "number" || !Number.isFinite(value.value)) continue;
    const scope = value.scope.slice(0, 120);
    const unique = `${value.metric}\u0000${scope}\u0000${value.window}`;
    if (seen.has(unique)) throw new Error(`${key} produced duplicate current metric ${value.metric}/${scope}/${value.window}`);
    seen.add(unique);
    output.push({ section: key, day: today, metric: value.metric, scope, window: value.window, value: value.value, window_from: value.windowFrom ?? null, window_to: value.windowTo ?? null });
  }
  return output;
}

function asFailure(key: SectionKey, error: unknown): Failure {
  return { key, error: errorText(error) };
}

// PostgreSQL `jsonb -> 'output'` returns JSON null (not SQL NULL) when a
// serialized null is present. Omit absent finance fields so Portal-only and
// partial CEO refreshes do not masquerade as incomplete finance output.
export function financePublication(id: string | null, output: unknown, error: string | null) {
  if (!id) return undefined;
  return { id, ...(output === null ? {} : { output }), ...(error === null ? {} : { error }) };
}

async function callRpc(tools: { rest(resource: string, body?: unknown): Promise<unknown> }, name: string, body?: unknown): Promise<Row> {
  return object(await tools.rest(`rpc/${name}`, body), `${name} RPC`);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function makeAdapters(financeSnapshot: Row | null, selected: SectionKey[]): Adapter[] {
  const adapters: Adapter[] = [];
  for (const key of selected) {
    if (key === "money") {
      if (!financeSnapshot) throw new Error("Canonical finance input was not loaded");
      adapters.push(createMoneyAdapter(financeSnapshot) as Adapter);
    } else if (key === "expenses") {
      if (!financeSnapshot) throw new Error("Canonical finance input was not loaded");
      adapters.push(createExpensesAdapter(financeSnapshot) as Adapter);
    } else {
      adapters.push(ADAPTERS[key]);
    }
  }
  return adapters;
}


function missingKeyFailure(key: SectionKey, missing: string[]): string {
  return `Missing configuration: ${missing.join(", ")}. Configure the named key${missing.length === 1 ? "" : "s"} for the ${LABELS[key]} section.`;
}

function emptyReport(runId: string, apply: boolean, sections: SectionReport[], error?: string, missing?: string[]): RefreshReport {
  return { ok: false, status: "failed", dryRun: !apply, runId, sections, receipts: 0, error, missing };
}

function normalizeRpcId(row: Row, snake: string, camel: string): string | null {
  const value = row[snake] ?? row[camel];
  return value == null ? null : String(value);
}

function financeSourceReady(snapshot: Row): void {
  if (snapshot.history_ready !== true || snapshot.aliases_ready !== true || snapshot.manual_ready !== true) {
    throw new Error("Canonical finance history, client aliases, or manual payment state is not ready; reconcile the source history first.");
  }
}


export async function runRefresh(options: RefreshOptions): Promise<RefreshReport> {
  const apply = options.apply === true;
  const runId = options.runId ?? randomUUID();
  let selected: SectionKey[];
  try { selected = normalizeSections(options.only ?? [...SECTION_KEYS]); }
  catch (error) { return emptyReport(runId, apply, [], errorText(error)); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    return emptyReport(runId, apply, [], "Run ID must be a UUID");
  }
  const missing = requiredMissing(options.env, selected);
  const config = configErrors(options.env);
  if (missing.length || config.length) {
    const error = [...config, ...(missing.length ? [`Missing configuration: ${missing.join(", ")}. Configure the named keys before running the CEO refresh.`] : [])].join(" ");
    return emptyReport(runId, apply, selected.map(key => ({ key, status: "failed", error })), error, missing);
  }

  const driver = createProviderDriver({ env: options.env, fetcher: options.fetcher ?? fetch, apply });
  const repository = createRepository(driver.read, options.env);
  const runtime = {
    env: driver.env,
    read: driver.read,
    repository,
    tools: driver.tools,
  };
  const reports = new Map<SectionKey, SectionReport>();
  const results = new Map<SectionKey, ComputedSection>();
  const failures: Failure[] = [];
  const sectionMissing = new Map<SectionKey, string[]>();
  for (const key of selected) {
    const needed = SECTION_KEYS_REQUIRED[key].filter(name => !options.env[name]?.trim());
    if (needed.length) {
      const error = missingKeyFailure(key, needed);
      failures.push({ key, error });
      reports.set(key, { key, status: "failed", error });
      sectionMissing.set(key, needed);
    }
  }

  let claim: Row | null = null;
  let financeJob: Row | null = null;
  let financeSnapshot: Row | null = null;
  let fatal: string | undefined;
  try {
    if (apply) {
      claim = await callRpc(driver.tools, "cockpit_ceo_refresh_claim", { p_run_id: runId, p_sections: selected });
      const existingStatus = String(claim.status ?? "");
      if (["published", "partial", "failed", "expired"].includes(existingStatus)) {
        const finalStatus = existingStatus === "expired" ? "failed" : existingStatus as "published" | "partial" | "failed";
        return {
          ok: finalStatus === "published",
          status: finalStatus,
          dryRun: false,
          runId,
          sections: [],
          receipts: 0,
          revision: Number(claim.revision ?? (claim.result as Row | null)?.revision ?? 0),
          error: typeof (claim.result as Row | null)?.error === "string" ? String((claim.result as Row).error) : undefined,
        };
      }
    }
    const financeSelected = selected.includes("money") && selected.includes("expenses");
    if (financeSelected && !sectionMissing.has("money") && !sectionMissing.has("expenses")) {
      if (apply) {
        financeJob = await callRpc(driver.tools, "cockpit_ceo_worker_begin_finance_refresh", {});
        const financeId = normalizeRpcId(financeJob, "id", "id");
        if (!financeId) throw new Error("Finance refresh RPC returned no job ID");
        financeSnapshot = await callRpc(driver.tools, "cockpit_finance_refresh_input", { p_id: financeId });
        if (Number(financeSnapshot.revision) !== Number(financeJob.revision)) throw new Error("Finance source revision changed between job claim and source read");
      } else {
        financeSnapshot = await callRpc(driver.tools, "cockpit_ceo_refresh_finance_source_snapshot");
      }
      financeSourceReady(financeSnapshot);
    }
  } catch (error) {
    fatal = errorText(error);
  }

  if (!fatal) {
    let adapters: Adapter[] = [];
    try { adapters = makeAdapters(financeSnapshot, selected); }
    catch (error) { fatal = errorText(error); }
    if (!fatal) {
      const selectedSet = new Set(selected);
      const work = adapters.filter(adapter => selectedSet.has(adapter.key as SectionKey) && !sectionMissing.has(adapter.key as SectionKey));
      await withRuntime(runtime, async () => {
        await Promise.all(work.map(async adapter => {
          const key = adapter.key as SectionKey;
          const started = driver.receipts.length;
          try {
            const result = await withProviderSection(key, () => adapter.compute({ repository }));
            const payload = validateJsonObject(result.payload, `${key} payload`);
            const sources = validateSources(result.sources, key);
            const daily = validateDaily(result.daily, key);
            const failedReceipt = driver.receipts.slice(started).find(receipt => receipt.section === key && (receipt.phase !== "response" || receipt.http_status === null || receipt.http_status < 200 || receipt.http_status >= 300));
            if (failedReceipt) throw new Error(`${failedReceipt.provider} provider did not confirm ${failedReceipt.resource}${failedReceipt.error ? `: ${failedReceipt.error}` : ""}`);
            const currentValues = extractCurrentValues(key, payload);
            const extra = result as typeof result & { clientPayments?: unknown; financeRevision?: number };
            const clientPayments = key === "money" ? rows(extra.clientPayments, "money client payment snapshots") : undefined;
            if (key === "money" && Number(extra.financeRevision) !== Number(financeSnapshot?.revision)) throw new Error("Money calculation used a different finance source revision");
            results.set(key, { key, label: LABELS[key], payload, sources, daily, values: currentValues, clientPayments });
            reports.set(key, { key, status: "computed", sourceCount: sources.length, dailyCount: daily.length, metricCount: currentValues.length });
          } catch (error) {
            const failure = asFailure(key, error);
            failures.push(failure);
            reports.set(key, { key, status: "failed", error: failure.error });
          }
        }));
      });
    }
  }

  if (fatal) {
    for (const key of selected) {
      if (reports.has(key)) continue;
      const failure = { key, error: fatal };
      failures.push(failure);
      reports.set(key, { key, status: "failed", error: fatal });
    }
  }

  const moneyFailed = selected.includes("money") && failures.some(item => item.key === "money");
  const expensesFailed = selected.includes("expenses") && failures.some(item => item.key === "expenses");
  let financeError: string | null = null;
  if (moneyFailed || expensesFailed) {
    financeError = `Money and Expenses must publish together. ${failures.filter(item => item.key === "money" || item.key === "expenses").map(item => item.error).join(" ")}`.slice(0, 1800);
    for (const key of ["money", "expenses"] as const) {
      results.delete(key);
      if (!failures.some(item => item.key === key)) failures.push({ key, error: financeError });
      reports.set(key, { key, status: "failed", error: financeError });
    }
  }

  const successful = selected.map(key => results.get(key)).filter((section): section is ComputedSection => section !== undefined);
  if (!apply) {
    const ok = failures.length === 0 && successful.length === selected.length;
    return { ok, status: "dry-run", dryRun: true, runId, sections: selected.map(key => reports.get(key) ?? { key, status: "failed", error: "Section did not produce a result" }), receipts: driver.receipts.length, error: ok ? undefined : failures.map(item => item.error).join(" ").slice(0, 1800), missing: [...new Set([...sectionMissing.values()].flat())] };
  }

  const claimId = normalizeRpcId(claim ?? {}, "run_id", "runId");
  const fence = normalizeRpcId(claim ?? {}, "lease_token", "leaseToken");
  if (!claimId || !fence) {
    return emptyReport(runId, true, selected.map(key => reports.get(key) ?? { key, status: "failed", error: "Worker lease was not confirmed" }), fatal ?? "Worker lease was not confirmed");
  }
  const financeId = normalizeRpcId(financeJob ?? {}, "id", "id");
  const financeSections = successful.filter(section => section.key === "money" || section.key === "expenses");
  const completeFinance = financeSections.length === 2 && !financeError && financeId !== null;
  const sectionKeys = new Set(successful.map(section => section.key));
  const definitions = DEFINITIONS.filter(definition => sectionKeys.has(definition.section as SectionKey)).map(definition => ({
    metric: definition.metric,
    section: definition.section,
    label: definition.label,
    definition: definition.definition,
    source: definition.source,
    leaves_out: definition.leavesOut ?? null,
    unit: definition.unit,
  }));
  const metricValues = successful.flatMap(section => section.values);
  const daily = successful.flatMap(section => section.daily);
  const financePayload = completeFinance ? {
    sections: financeSections.map(section => ({ key: section.key, label: section.label, payload: section.payload, sources: section.sources, daily: section.daily })),
    payments: financeSections.find(section => section.key === "money")!.clientPayments!,
  } : null;
  const publication = {
    sections: successful.filter(section => section.key !== "money" && section.key !== "expenses").map(section => ({ key: section.key, label: section.label, payload: section.payload, sources: section.sources, daily: section.daily })),
    definitions,
    values: metricValues,
    daily,
    failures: failures.map(item => ({ key: item.key, error: item.error.slice(0, 1000) })),
    receipts: driver.receipts,
    finance: financePublication(financeId, financePayload, financeError),
  };
  const planSha = sha256(publication);
  try {
    const result = await callRpc(driver.tools, "cockpit_ceo_refresh_publish", {
      p_run_id: claimId, p_lease_token: fence, p_plan_sha: planSha, p_publication: publication,
    });
    const status = String(result.status ?? (failures.length ? "partial" : "published")) as "published" | "partial";
    return {
      ok: status === "published",
      status,
      dryRun: false,
      runId,
      sections: selected.map(key => reports.get(key) ?? { key, status: "failed", error: "Section did not produce a result" }),
      receipts: driver.receipts.length,
      revision: Number(result.revision ?? 0),
      error: failures.length ? failures.map(item => item.error).join(" ").slice(0, 1800) : undefined,
      missing: [...new Set([...sectionMissing.values()].flat())],
    };
  } catch (error) {
    const message = errorText(error);
    try {
      await callRpc(driver.tools, "cockpit_ceo_refresh_fail", {
        p_run_id: claimId,
        p_lease_token: fence,
        p_error: message,
        p_receipts: driver.receipts,
        p_finance_id: financeId,
        p_finance_error: completeFinance ? null : financeError,
      });
    } catch (recordError) {
      return emptyReport(runId, true, selected.map(key => reports.get(key) ?? { key, status: "failed", error: message }), `${message}; failure receipt could not be recorded: ${errorText(recordError)}`);
    }
    return emptyReport(runId, true, selected.map(key => reports.get(key) ?? { key, status: "failed", error: message }), message);
  }
}

export function parseArguments(args: string[]): CliOptions {
  const command = (args[0] ?? "run") as CliOptions["command"];
  if (!["doctor", "run", "serve"].includes(command)) throw new Error("Use worker.ts doctor, run, or serve");
  let apply = false;
  let only: string[] | undefined;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--dry-run") { apply = false; continue; }
    if (arg === "--only") {
      const next = args[++index];
      if (!next) throw new Error("--only needs a comma-separated CEO section list");
      only = next.split(",").map(value => value.trim()).filter(Boolean);
      continue;
    }
    if (arg.startsWith("--only=")) { only = arg.slice(7).split(",").map(value => value.trim()).filter(Boolean); continue; }
    throw new Error(`Unknown CEO refresh option ${arg}`);
  }
  return { command, apply, only };
}

async function runCli(options: CliOptions): Promise<number> {
  const env: Environment = {};
  for (const name of [...BASE_KEYS, ...new Set(SECTION_KEYS.flatMap(key => SECTION_KEYS_REQUIRED[key]))]) env[name] = process.env[name];
  env.SUPABASE_URL = process.env.SUPABASE_URL;
  if (options.command === "doctor") {
    const report = doctor(env, options.only ?? [...SECTION_KEYS]);
    console.log(JSON.stringify(report));
    return report.ok ? 0 : 1;
  }
  if (options.command === "serve") {
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    while (!stopping) {
      const report = await runRefresh({ env, only: options.only, apply: options.apply });
      console.log(JSON.stringify(report));
      await new Promise(resolve => setTimeout(resolve, 15 * 60_000));
    }
    return 0;
  }
  const report = await runRefresh({ env, only: options.only, apply: options.apply });
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

if (import.meta.main) {
  try { process.exitCode = await runCli(parseArguments(process.argv.slice(2))); }
  catch (error) {
    console.error(JSON.stringify({ ok: false, error: errorText(error), dryRunDefault: true }));
    process.exitCode = 1;
  }
}
