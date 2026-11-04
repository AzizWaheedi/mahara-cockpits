/**
 * Brings in pictures drawn through the Higgsfield connector (the app's own
 * credits) when the API wallets are empty: same model (GPT Image 2.5
 * Sunburst), same prompts, same cap. Each one is downloaded with no key,
 * written to raw/ and recorded in jobs.json under the connector's name, so
 * the cap and the provenance stay in one place.
 *
 *   bun fetch-mcp.ts <list.json>    [{variant, jobId, url}]
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Ctx,
  call,
  counted,
  extOf,
  isHiggsfieldHost,
  type Job,
  readJobs,
  sha256,
  writeJobs,
} from "./higgsfield";
import { DIRS, LEDGER } from "./paths";
import { fullPrompt, loadPrompts } from "./set";

export const CONNECTOR = "Higgsfield connector (app credits)";
export const CONNECTOR_MODEL = "gpt_image_2_5 sunburst, high, 2k, 16:9";

export interface Fetched {
  variant: string;
  jobId: string;
  url: string;
}

/** Plain sentences for a list that may not be fetched. */
export function listProblems(
  list: Fetched[],
  variants: Record<string, unknown>,
  jobs: readonly Job[],
  cap: number,
): string[] {
  const out: string[] = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const f of list) {
    if (!variants[f.variant]) out.push(`${f.variant} is not a variant`);
    if (!uuid.test(f.jobId)) out.push(`${f.variant} has no job id`);
    let u: URL | null = null;
    try {
      u = new URL(f.url);
    } catch {
      out.push(`${f.variant} has no address`);
    }
    if (u && (u.protocol !== "https:" || isHiggsfieldHost(u.hostname))) {
      out.push(`${f.variant} is not a plain https file address`);
    }
  }
  const known = new Set(jobs.map(j => j.requestId));
  const fresh = list.filter(f => !known.has(f.jobId));
  if (counted(jobs) + fresh.length > cap) {
    out.push(
      `${fresh.length} more would pass the cap of ${cap} (${counted(jobs)} used)`,
    );
  }
  return out;
}

async function main(file: string) {
  const set = loadPrompts();
  mkdirSync(DIRS.raw, { recursive: true });
  const list = JSON.parse(readFileSync(file, "utf8")) as Fetched[];
  const jobs = readJobs();
  const problems = listProblems(list, set.variants, jobs, set.cap);
  if (problems.length) {
    console.log(`fetch-mcp: ${problems.join("; ")}.`);
    process.exit(2);
  }
  const ctx: Ctx = {
    key: { value: "", from: CONNECTOR },
    fetch: (u, i) => fetch(u, i),
    ledger: row => appendFileSync(LEDGER, `${JSON.stringify(row)}\n`),
    sleep: ms => Bun.sleep(ms),
    now: () => Date.now(),
  };
  for (const f of list) {
    if (jobs.some(j => j.requestId === f.jobId && j.status === "completed")) {
      console.log(`fetch-mcp: ${f.variant} is already in.`);
      continue;
    }
    const res = await call(ctx, "download", "GET", f.url);
    if (!res.ok) {
      console.log(`fetch-mcp: ${f.variant} would not download (${res.status}).`);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 10_000) {
      console.log(`fetch-mcp: ${f.variant} came back empty.`);
      continue;
    }
    const out = join(DIRS.raw, `${f.variant}.${extOf(bytes, res.headers.get("content-type") ?? "")}`);
    writeFileSync(out, bytes);
    const v = set.variants[f.variant];
    jobs.push({
      variant: f.variant,
      slot: v.slot,
      model: CONNECTOR_MODEL,
      key: CONNECTOR,
      promptSha: sha256(fullPrompt(set, f.variant)),
      requestId: f.jobId,
      status: "completed",
      at: new Date().toISOString(),
      doneAt: new Date().toISOString(),
      file: out,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    writeJobs(jobs);
    console.log(`fetch-mcp: ${f.variant} in (${bytes.length} bytes).`);
  }
  console.log(`fetch-mcp: ${counted(jobs)} of ${set.cap} used.`);
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.log("fetch-mcp: give the list file: bun fetch-mcp.ts <list.json>");
    process.exit(2);
  }
  await main(file);
}
