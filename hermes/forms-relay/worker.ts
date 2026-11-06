/**
 * hermes/forms-relay on the VPS (relay.ts says what it does):
 *
 *   bun hermes/forms-relay/worker.ts doctor
 *   bun hermes/forms-relay/worker.ts run
 *
 * Keys by name only, first file wins, from FORMS_RELAY_ENV_FILES (run.sh points it at the native runtime file):
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_DISPATCH_TOKEN. The switch FORMS_RELAY_APPLY only from
 * ~/.forms-relay/switches.env; the dispatch settings only from ~/.forms-relay/config.env (filled at D-S4F from
 * the saved Make 13 blueprint). No Google key and no Client Data setting: the relay writes nothing to Client
 * Data (20261102l), so old CLIENT_DATA_* lines in config.env are ignored. Never a value printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  ledgerFetch,
  makeDb,
  makeGithub,
  SUPABASE,
  type Env,
} from "./providers.ts";
import { type Deps, readConfig, runOnce, type Row } from "./relay.ts";

export const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GITHUB_DISPATCH_TOKEN",
] as const;

/** A presence check only; never treat it as proof of GitHub authorization. */
export function hasDispatchCredential(env: Env): boolean {
  return Boolean(env.GITHUB_DISPATCH_TOKEN?.trim());
}

/** KEY=VALUE lines (or a JSON object for a .json runtime file), first value of a key wins. */
export function parseFile(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8");
  const out: Record<string, string> = {};
  if (path.endsWith(".json")) {
    const j = JSON.parse(text);
    if (j && typeof j === "object")
      for (const [k, v] of Object.entries(j))
        if (typeof v === "string") out[k] = v;
    return out;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && out[m[1]] === undefined)
      out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

/** The named keys, first file wins; where each came from (a path, never a value). */
export function readEnv(files: string[]): {
  env: Env;
  from: Record<string, string>;
} {
  const env: Env = {};
  const from: Record<string, string> = {};
  for (const file of files.filter(Boolean)) {
    let values: Record<string, string>;
    try {
      values = parseFile(file);
    } catch {
      continue;
    }
    for (const key of ENV_KEYS)
      if (env[key] === undefined && values[key]) {
        env[key] = values[key];
        from[key] = file;
      }
  }
  return { env, from };
}

/** FORMS_RELAY_APPLY exactly "true" in the switches file; a missing file or line is off. */
export function readApply(path: string): boolean {
  try {
    return parseFile(path).FORMS_RELAY_APPLY === "true";
  } catch {
    return false;
  }
}

export function readConfigFile(path: string) {
  let values: Record<string, string> = {};
  try {
    values = parseFile(path);
  } catch {
    return {
      config: null,
      problems: [`${path.replace(homedir(), "~")} could not be read.`],
    };
  }
  return readConfig(values);
}

export type DoctorDeps = {
  env: Env;
  apply: boolean;
  config: ReturnType<typeof readConfig>;
  counts: () => Promise<Row>;
  repoStatus: () => Promise<number>;
};

/** Reads only: the keys by name, the config, the database, one repository read. */
export async function doctor(d: DoctorDeps): Promise<{
  ok: boolean;
  problems: string[];
  keys: Record<string, boolean>;
  checks: Row;
}> {
  const problems: string[] = [];
  const keys = Object.fromEntries(ENV_KEYS.map(k => [k, Boolean(d.env[k])]));
  for (const k of ENV_KEYS)
    if (!d.env[k]) problems.push(`${k} is not set in the relay's key files.`);
  const checks: Row = { apply: d.apply };
  problems.push(...d.config.problems);
  try {
    checks.outbox = (await d.counts())?.byState ?? {};
  } catch (e) {
    problems.push(
      `The relay outbox could not be read: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
    );
  }
  if (d.config.config && d.env.GITHUB_DISPATCH_TOKEN) {
    try {
      const status = await d.repoStatus();
      checks.repository = status;
      if (status !== 200)
        problems.push(
          `The dispatch repository answered ${status} to the token.`,
        );
    } catch (e) {
      problems.push(
        `The dispatch repository could not be read: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
      );
    }
  }
  return { ok: problems.length === 0, problems, keys, checks };
}

async function main() {
  const cmd = process.argv[2] ?? "run";
  const home = homedir();
  const read = readEnv(
    String(process.env.FORMS_RELAY_ENV_FILES ?? "").split(":"),
  );
  const apply = readApply(`${home}/.forms-relay/switches.env`);
  const config = readConfigFile(`${home}/.forms-relay/config.env`);
  const url = String(read.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  let db: ReturnType<typeof makeDb> | null = null;
  try {
    if (url === SUPABASE) db = makeDb(read.env);
  } catch {
    db = null;
  }
  if (!db) {
    console.log(
      JSON.stringify({
        ok: false,
        note: "No database: SUPABASE_URL or the service key is missing. Run the doctor (RUNBOOK, forms relay).",
      }),
    );
    process.exit(1);
  }
  const fetcher = ledgerFetch(
    db.receipt,
    `forms-relay:${cmd}:${crypto.randomUUID()}`,
  );
  const github = config.config
    ? makeGithub(read.env, config.config, fetcher)
    : null;
  if (cmd === "doctor") {
    const r = await doctor({
      env: read.env,
      apply,
      config,
      counts: () => db.rpc("cockpit_form_relay_counts"),
      repoStatus: () =>
        github
          ? github.repoReadable()
          : Promise.reject(new Error("No config.")),
    });
    console.log(
      JSON.stringify({ ...r, envFrom: Object.keys(read.from) }, null, 2),
    );
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd !== "run") {
    console.log("Use doctor or run.");
    process.exit(2);
  }
  const deps: Deps = {
    apply,
    config: config.config,
    configProblems: config.problems,
    dispatchCredentialPresent: hasDispatchCredential(read.env),
    db,
    github: github ?? {
      dispatch: async () => ({ ok: false, status: 0, definite: true }),
    },
  };
  const report = await runOnce(deps);
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.main && existsSync(homedir()))
  main().catch(e => {
    console.log(
      JSON.stringify({
        ok: false,
        note: `The relay stopped: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`,
      }),
    );
    process.exit(1);
  });
