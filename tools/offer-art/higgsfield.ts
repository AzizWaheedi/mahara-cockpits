/**
 * Draws the set's pictures with Higgsfield's API: GPT Image 2.5 Sunburst
 * (`marketing-studio/image/sunburst`), as Salma does (hermes/salma/salma.py).
 *
 * - Keys are read by name and never printed: HF_KEY (the environment, else
 *   ~/.higgsfield-api.env), or with `--key pair` HIGGSFIELD_ID and
 *   HIGGSFIELD_SECRET (the environment, else /opt/data/bibi/api-keys.env).
 *   The key goes only to *.higgsfield.ai, never to the picture's own host.
 * - Every call writes an intent row to ledger.jsonl before it leaves, then a
 *   response (or unknown) row: host only, never a path, a query or a key. A
 *   row that cannot be written stops the call.
 * - The cap in prompts.website.json (at most 12) counts every request
 *   Higgsfield accepted, finished or not; a request refused for an empty
 *   wallet drew nothing and is not counted, and stops the run.
 *
 *   bun higgsfield.ts [--only hero-a,stone-b] [--key hf|pair] [--dry] [--redo]
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DIRS, JOBS, LEDGER, SET_DIR, type Slot } from "./paths";
import { fullPrompt, loadPrompts, type PromptFile } from "./set";

export const API = "https://api.higgsfield.ai";
export const USER_AGENT = "Mahara offer art";
export const KEY_FILES = {
  hf: join(homedir(), ".higgsfield-api.env"),
  pair: "/opt/data/bibi/api-keys.env",
};
export const POLL_MS = 4000;
export const WAIT_MS = 8 * 60 * 1000;

export const WALLET_EMPTY = (from: string) =>
  `Higgsfield's API wallet behind ${from} is empty. Top it up at open.higgsfield.ai/billing (the app's own credits do not pay for the API), then run this again.`;
export const KEY_REFUSED = (from: string) =>
  `Higgsfield refused the key in ${from}. Make a new one at open.higgsfield.ai/api-keys and put it on the server under that name.`;
export const NSFW =
  "Higgsfield's safety check refused this picture. Change the prompt, then draw it again.";

export class NoCredits extends Error {}
export class Refused extends Error {}

/** One NAME=value line of an env file, by name. Never logged. */
export function readEnvValue(file: string, name: string): string {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.startsWith(`${name}=`)) {
        return line
          .slice(name.length + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    // A missing file is the same as a missing name.
  }
  return "";
}

export type KeyRoute = "hf" | "pair";
export interface Key {
  value: string;
  /** The names it was read under, for sentences. Never the value. */
  from: string;
}

export function readKey(
  route: KeyRoute,
  env: Record<string, string | undefined> = process.env,
  files = KEY_FILES,
): Key | null {
  if (route === "hf") {
    const v = env.HF_KEY?.trim() || readEnvValue(files.hf, "HF_KEY");
    return v ? { value: v, from: "HF_KEY" } : null;
  }
  const id =
    env.HIGGSFIELD_ID?.trim() || readEnvValue(files.pair, "HIGGSFIELD_ID");
  const secret =
    env.HIGGSFIELD_SECRET?.trim() ||
    readEnvValue(files.pair, "HIGGSFIELD_SECRET");
  return id && secret
    ? { value: `${id}:${secret}`, from: "HIGGSFIELD_ID and HIGGSFIELD_SECRET" }
    : null;
}

export interface LedgerRow {
  at: string;
  provider: "higgsfield";
  method: string;
  resource: string;
  phase: "intent" | "response" | "unknown";
  http_status: number | null;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Ctx {
  key: Key;
  fetch: Fetch;
  ledger: (row: LedgerRow) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const isHiggsfieldHost = (host: string) =>
  host === "higgsfield.ai" || host.endsWith(".higgsfield.ai");

/**
 * One call. The key is sent only to Higgsfield's own hosts; a picture's
 * download goes out with no key. Plain https on port 443 only.
 */
export async function call(
  ctx: Ctx,
  purpose: "draw" | "status" | "cancel" | "download" | "models",
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username) {
    throw new Refused(`Refusing to call ${u.host}: only plain https is allowed.`);
  }
  const ours = isHiggsfieldHost(u.hostname);
  if (purpose !== "download" && !ours) {
    throw new Refused(`Refusing to send a ${purpose} call to ${u.hostname}.`);
  }
  const resource = `${purpose}:${u.hostname}`;
  const row = (phase: LedgerRow["phase"], http_status: number | null) => ({
    at: new Date(ctx.now()).toISOString(),
    provider: "higgsfield" as const,
    method,
    resource,
    phase,
    http_status,
  });
  ctx.ledger(row("intent", null)); // throws: the call never leaves
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (ours) headers.Authorization = `Key ${ctx.key.value}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: ours ? "error" : "follow",
    });
  } catch (e) {
    ctx.ledger(row("unknown", null));
    throw e;
  }
  ctx.ledger(row("response", res.status));
  return res;
}

async function json(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text || "{}");
  } catch {
    return { detail: text.slice(0, 200) };
  }
}

const creditWords = /credit balance|not_enough_credits|top up/i;

/** Higgsfield's no, as an error a person can act on. */
export function refusal(key: Key, code: number, said: any): Error {
  const detail = typeof said?.detail === "string" ? said.detail : "";
  const error = typeof said?.error === "string" ? said.error : "";
  if (creditWords.test(detail) || creditWords.test(error)) {
    return new NoCredits(WALLET_EMPTY(key.from));
  }
  if (code === 401) return new Refused(KEY_REFUSED(key.from));
  return new Refused(
    `Higgsfield said no (${code}): ${(detail || error || JSON.stringify(said)).slice(0, 200)}`,
  );
}

export interface Drawn {
  requestId: string;
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Submit one picture and wait for it. `onAccepted` runs as soon as
 * Higgsfield gives the request an id, so the cap counts it even if the
 * wait is cut short.
 */
export async function draw(
  ctx: Ctx,
  model: string,
  body: Record<string, unknown>,
  onAccepted: (requestId: string) => void,
): Promise<Drawn> {
  const sub = await call(ctx, "draw", "POST", `${API}/${model}`, body);
  const s = await json(sub);
  if (sub.status >= 400 || typeof s?.request_id !== "string") {
    throw refusal(ctx.key, sub.status, s);
  }
  const requestId: string = s.request_id;
  onAccepted(requestId);
  const statusUrl: string =
    typeof s.status_url === "string"
      ? s.status_url
      : `${API}/requests/${requestId}/status`;
  const deadline = ctx.now() + WAIT_MS;
  for (;;) {
    await ctx.sleep(POLL_MS);
    let st: any = null;
    let code = 0;
    try {
      const r = await call(ctx, "status", "GET", statusUrl);
      code = r.status;
      st = await json(r);
    } catch (e) {
      if (e instanceof Refused) throw e;
      // A network blip while it draws is not a failed picture.
    }
    const status = st?.status;
    if (status === "completed") {
      const url = st?.images?.[0]?.url;
      if (typeof url !== "string") {
        throw new Refused("Higgsfield finished but sent no picture back.");
      }
      const dl = await call(ctx, "download", "GET", url);
      if (!dl.ok) throw new Refused(`The finished picture would not download (${dl.status}).`);
      const bytes = new Uint8Array(await dl.arrayBuffer());
      if (bytes.length < 10_000) {
        throw new Refused("Higgsfield returned an empty file.");
      }
      return {
        requestId,
        bytes,
        contentType: dl.headers.get("content-type") ?? "",
      };
    }
    if (status === "nsfw") throw new Refused(NSFW);
    if (status === "failed") throw refusal(ctx.key, 200, st);
    if (status === "canceled") {
      throw new Refused("The picture was cancelled at Higgsfield. Draw it again.");
    }
    if (code >= 400 && code < 500) throw refusal(ctx.key, code, st);
    if (ctx.now() > deadline) {
      try {
        await call(
          ctx,
          "cancel",
          "POST",
          typeof s.cancel_url === "string"
            ? s.cancel_url
            : statusUrl.replace(/\/status$/, "/cancel"),
        );
      } catch {
        // The sentence below matters more than the cancel.
      }
      throw new Refused(
        `Higgsfield took longer than ${WAIT_MS / 60000} minutes. Draw it again.`,
      );
    }
  }
}

/** The file extension a picture's bytes call for. */
export function extOf(bytes: Uint8Array, contentType = ""): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45
  ) {
    return "webp";
  }
  if (/png/.test(contentType)) return "png";
  if (/jpe?g/.test(contentType)) return "jpg";
  return "bin";
}

export interface Job {
  variant: string;
  slot: Slot;
  model: string;
  key: string;
  promptSha: string;
  requestId: string | null;
  status:
    | "submitting"
    | "accepted"
    | "completed"
    | "failed"
    | "no_credits";
  at: string;
  doneAt?: string;
  file?: string;
  bytes?: number;
  sha256?: string;
  error?: string;
}

/** Requests that count against the cap: every one Higgsfield accepted. */
export const counted = (jobs: readonly Job[]) =>
  jobs.filter(j => j.requestId !== null && j.status !== "no_credits").length;

export function readJobs(path = JOBS): Job[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as Job[];
}

export function writeJobs(jobs: Job[], path = JOBS) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(jobs, null, 1)}\n`);
  renameSync(tmp, path);
}

export const sha256 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/** What a run would draw, or the sentence saying why it may not. */
export function plan(
  set: PromptFile,
  jobs: readonly Job[],
  only: string[] | null,
  redo: boolean,
): { run: string[] } | { refuse: string } {
  const ids = only ?? Object.keys(set.variants);
  const unknown = ids.filter(id => !set.variants[id]);
  if (unknown.length) {
    return { refuse: `No such variant: ${unknown.join(", ")}.` };
  }
  const done = new Set(
    jobs.filter(j => j.status === "completed").map(j => j.variant),
  );
  const todo = redo ? ids : ids.filter(id => !done.has(id));
  const used = counted(jobs);
  if (used + todo.length > set.cap) {
    return {
      refuse: `This run would draw ${todo.length} pictures and ${used} of the cap of ${set.cap} are used. Pick fewer with --only.`,
    };
  }
  return { run: todo };
}

function argOf(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

async function main(args: string[]) {
  const set = loadPrompts();
  mkdirSync(DIRS.raw, { recursive: true });
  mkdirSync(SET_DIR, { recursive: true });
  const route = (argOf(args, "--key") ?? "hf") as KeyRoute;
  if (route !== "hf" && route !== "pair") {
    console.log("higgsfield: --key is hf or pair.");
    process.exit(2);
  }
  const key = readKey(route);
  if (!key) {
    console.log(
      route === "hf"
        ? "higgsfield: no HF_KEY in the environment or ~/.higgsfield-api.env. Put the key there by that name."
        : "higgsfield: HIGGSFIELD_ID and HIGGSFIELD_SECRET are not both in the environment or /opt/data/bibi/api-keys.env.",
    );
    process.exit(2);
  }
  const only = argOf(args, "--only")?.split(",").filter(Boolean) ?? null;
  const jobs = readJobs();
  const p = plan(set, jobs, only, args.includes("--redo"));
  if ("refuse" in p) {
    console.log(`higgsfield: ${p.refuse}`);
    process.exit(2);
  }
  if (p.run.length === 0) {
    console.log("higgsfield: every variant asked for is already drawn.");
    return;
  }
  if (args.includes("--dry")) {
    console.log(`higgsfield: would draw ${p.run.join(", ")} with ${key.from}.`);
    return;
  }
  const ctx: Ctx = {
    key,
    fetch: (u, i) => fetch(u, i),
    ledger: row => appendFileSync(LEDGER, `${JSON.stringify(row)}\n`),
    sleep: ms => Bun.sleep(ms),
    now: () => Date.now(),
  };
  let stop: string | null = null;
  const one = async (variant: string) => {
    if (stop) return;
    const v = set.variants[variant];
    const prompt = fullPrompt(set, variant);
    const job: Job = {
      variant,
      slot: v.slot,
      model: set.model,
      key: key.from,
      promptSha: sha256(prompt),
      requestId: null,
      status: "submitting",
      at: new Date().toISOString(),
    };
    jobs.push(job);
    writeJobs(jobs);
    try {
      const got = await draw(
        ctx,
        set.model,
        { prompt, ...set.body },
        id => {
          job.requestId = id;
          job.status = "accepted";
          writeJobs(jobs);
        },
      );
      const file = join(DIRS.raw, `${variant}.${extOf(got.bytes, got.contentType)}`);
      writeFileSync(file, got.bytes);
      Object.assign(job, {
        status: "completed",
        doneAt: new Date().toISOString(),
        file,
        bytes: got.bytes.length,
        sha256: sha256(got.bytes),
      });
      console.log(`higgsfield: ${variant} drawn (${got.bytes.length} bytes).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      job.status = e instanceof NoCredits ? "no_credits" : "failed";
      job.error = msg.slice(0, 300);
      job.doneAt = new Date().toISOString();
      console.log(`higgsfield: ${variant}: ${msg}`);
      if (e instanceof NoCredits || /refused the key/.test(msg)) stop = msg;
    }
    writeJobs(jobs);
  };
  // Two at once: the API's own limit for this wallet.
  const queue = [...p.run];
  await Promise.all(
    [0, 1].map(async () => {
      while (queue.length && !stop) await one(queue.shift() as string);
    }),
  );
  console.log(
    `higgsfield: ${counted(jobs)} of ${set.cap} drawn or accepted in all.${stop ? " Stopped." : ""}`,
  );
  if (stop) process.exit(1);
}

if (import.meta.main) await main(process.argv.slice(2));
