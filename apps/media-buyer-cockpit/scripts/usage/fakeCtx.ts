/**
 * Usage test harness (usage plan, section 4.0).
 *
 * The same file lives in all three apps under scripts/usage/fakeCtx.ts.
 * Keep the copies identical: edit one, copy it to the other two.
 *
 * It runs the apps' real registered Convex functions against an in-memory
 * database and counts what Convex bills for: function calls, documents and
 * bytes read, documents and bytes written, outbound request bytes, and the
 * reactive re-runs a write would cause in open subscriptions.
 *
 * Quick start (from a test in scripts/usage/):
 *
 *   import { api, internal } from "../../convex/_generated/api";
 *   import { makeApp, linkApps, appDir, setNow } from "./fakeCtx";
 *
 *   const mb = await makeApp();                     // this app
 *   const csm = await makeApp(appDir("csm"));       // a sibling app
 *   linkApps({ mb, csm });                          // POST <url>/bridge works
 *   const admin = await mb.makeUser({ email: "aziz@maharamedia.com" });
 *   const m = mb.meter.mark();
 *   const jobs = await mb.watch(api.portal.adminJobs, {}, { as: admin });
 *   await mb.run(internal.health.beat, { job: "sync", ok: true, ms: 1, everyMin: 10 });
 *   jobs.triggers;                                  // re-runs caused
 *   mb.meter.since(m).bytesRead;                    // bytes read since mark
 *
 * What it models, briefly:
 * - Queries and mutations run as transactions. A mutation's writes are
 *   applied when it returns and dropped when it throws, and what it
 *   schedules is queued only when it commits. Nested runQuery and
 *   runMutation calls are sub-transactions of the caller.
 * - Transactions in one app run one at a time, so concurrent callers see
 *   serial results, as Convex guarantees.
 * - Every document a query scans counts as read, including those a
 *   `.filter` then drops. Size is Buffer.byteLength(JSON.stringify(doc)),
 *   a proxy for Convex's own encoding: assert bounds and ratios with it.
 * - A committed write counts once per document, with its final size (the
 *   deleted size for a delete).
 * - Read sets follow Convex: an index range, cut at the last scanned key
 *   when `take`, `first`, `unique` or `paginate` stopped early, plus every
 *   `get(id)`. `invalidates(readSet, write)` is true when the old or the
 *   new document falls in a recorded range, or its id was read.
 * - Arguments, return values and stored documents are checked against the
 *   real validators and schema. An unknown table or index throws.
 * - `fetch` never reaches the network. Requests to a linked app's site URL
 *   run that app's http.ts router in its own fake ctx. Other URLs go to
 *   routes a test adds with `web.on(...)`, and anything else throws.
 * - Env values are fake constants per app. Real env is never visible to app
 *   code. Module-level env reads see the values of the first load.
 * - `Date.now()` and `new Date()` follow a fake clock (`setNow`, `advance`).
 * - Scheduled functions wait in a queue until `flushScheduled(untilMs)`,
 *   and run without a signed-in user, as on Convex.
 *
 * Do not import convex function modules statically in a test: load them
 * through makeApp so their module-level env reads see the fake values.
 * Call `restoreGlobals()` in `afterAll` when a file is done.
 */

import { setSystemTime } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { getFunctionName } from "convex/server";

type Any = any;

// ------------------------------------------------------------------ types

export type AppName = "mb" | "csm" | "creative";
export type FnKind = "query" | "mutation" | "action" | "http";
export type Doc = Record<string, Any> & { _id: string; _creationTime: number };
export type WriteKind = "insert" | "patch" | "replace" | "delete";

/** One committed change to one document. */
export type WriteRecord = {
  app: AppName;
  table: string;
  id: string;
  kind: WriteKind;
  before: Doc | null;
  after: Doc | null;
  bytes: number;
  callId: number;
  at: number;
};

type IndexOp = {
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  field: string;
  pos: number;
  value: unknown;
};

/** A scanned index range. `cut` ends it early; `after` starts it late. */
export type RangeRead = {
  kind: "range";
  table: string;
  index: string;
  fields: string[];
  ops: IndexOp[];
  order: "asc" | "desc";
  cut?: unknown[] | "start";
  after?: unknown[];
};
export type IdRead = { kind: "id"; table: string; id: string };
export type ReadSet = (RangeRead | IdRead)[];

export type FetchRecord = {
  from: AppName | "test";
  callId: number | null;
  to: AppName | "web" | "unrouted";
  method: string;
  url: string;
  status: number;
  requestBytes: number;
  responseBytes: number;
};

export type CallRecord = {
  id: number;
  app: AppName;
  name: string;
  kind: FnKind;
  parent: number | null;
  /** The call in another app whose fetch started this one. */
  via: { app: AppName | "test"; callId: number | null } | null;
  scheduled: boolean;
  args: unknown;
  at: number;
  /** Own reads plus those of nested query and mutation sub-transactions. */
  docsRead: number;
  bytesRead: number;
  /** Writes this call committed (top-level transactions only). */
  docsWritten: number;
  bytesWritten: number;
  writes: Record<string, number>;
  egressBytes: number;
  fetches: number;
  readSet: ReadSet;
  ok: boolean | null;
  error?: string;
};

export type MeterDelta = {
  calls: Record<string, number>;
  totalCalls: number;
  docsRead: number;
  bytesRead: number;
  docsWritten: number;
  bytesWritten: number;
  writes: Record<string, number>;
  egressBytes: number;
  fetches: number;
  /** Reactive re-runs triggered in watched queries. */
  reruns: number;
  scheduled: number;
};

export type MeterMark = { readonly delta: MeterDelta };

export type ScheduledItem = {
  id: string;
  app: AppName;
  name: string;
  args: Any;
  at: number;
  state: "pending" | "running" | "success" | "failed" | "canceled";
  fromCall: number | null;
  error?: string;
};

export type CallOptions = {
  /** Run as this user id (auth subject `<id>|s`). Null or absent: signed out. */
  as?: string | null;
  /** Skip argument and return validation. */
  noValidate?: boolean;
};

type AnyRef = FunctionReference<Any, Any, Any, Any> | string;
type ArgsOf<F> =
  F extends FunctionReference<Any, Any, Any, Any>
    ? FunctionArgs<F>
    : Record<string, unknown>;
type ReturnOf<F> =
  F extends FunctionReference<Any, Any, Any, Any> ? FunctionReturnType<F> : Any;

type RegisteredFn = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isHttp?: boolean;
  exportArgs?: () => string;
  exportReturns?: () => string;
  _handler: (ctx: Any, args: Any) => Any;
};

// ------------------------------------------------------------------ paths

const HERE = fileURLToPath(new URL(".", import.meta.url));

const APP_FOLDERS: Record<AppName, string> = {
  mb: "media-buyer-cockpit",
  csm: "client-success-cockpit",
  creative: "creative-director-cockpit",
};

/** The convex/ folder of any of the three apps, found from this file. */
export function appDir(name: AppName): string {
  return resolve(HERE, "../../..", APP_FOLDERS[name], "convex");
}

function appNameOf(convexDir: string): AppName | null {
  for (const [name, folder] of Object.entries(APP_FOLDERS))
    if (convexDir.split(sep).includes(folder)) return name as AppName;
  return null;
}

// ------------------------------------------------------------------ fake env

export const FAKE_SITE: Record<AppName, string> = {
  mb: "https://mb.fake.convex.site",
  csm: "https://csm.fake.convex.site",
  creative: "https://creative.fake.convex.site",
};

export const FAKE_TOKENS = {
  csmBridge: "fake-csm-bridge-token",
  creativeBridge: "fake-creative-bridge-token",
  askai: "fake-askai-token",
  watchdog: "fake-watchdog-token",
} as const;

/** The env each app sees unless a test adds more. All values are fake. */
export function defaultEnv(name: AppName): Record<string, string> {
  const common = {
    CONVEX_SITE_URL: FAKE_SITE[name],
    CONVEX_CLOUD_URL: FAKE_SITE[name].replace(".site", ".cloud"),
    // auth.ts and http.ts refuse to load without these.
    VIKTOR_SPACES_ACCESS_MODE: "authenticated",
    VIKTOR_SPACES_AUTH_PROVIDERS: '["email_password"]',
  };
  if (name === "mb")
    return {
      ...common,
      CSM_BRIDGE_URL: FAKE_SITE.csm,
      CSM_BRIDGE_TOKEN: FAKE_TOKENS.csmBridge,
      CREATIVE_BRIDGE_URL: FAKE_SITE.creative,
      CREATIVE_BRIDGE_TOKEN: FAKE_TOKENS.creativeBridge,
      ASKAI_TOKEN: FAKE_TOKENS.askai,
      WATCHDOG_TOKEN: FAKE_TOKENS.watchdog,
    };
  return {
    ...common,
    BRIDGE_TOKEN:
      name === "csm" ? FAKE_TOKENS.csmBridge : FAKE_TOKENS.creativeBridge,
    PORTAL_SITE_URL: FAKE_SITE.mb,
  };
}

// ------------------------------------------------------------------ values

function bigintSafe(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof ArrayBuffer) return `bytes:${value.byteLength}`;
  return value;
}

/** Bytes of a value as JSON: the harness's size measure. */
export function sizeOf(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return Buffer.byteLength(JSON.stringify(value, bigintSafe) ?? "");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== "object") return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/**
 * A deep copy in Convex value rules: object fields that are undefined are
 * dropped; undefined anywhere else, functions, dates and class instances
 * throw.
 */
export function wire(value: unknown, path = "value"): Any {
  if (value === undefined)
    throw new Error(`${path}: undefined is not a valid Convex value`);
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return value;
    case "object":
      break;
    default:
      throw new Error(`${path}: ${typeof value} is not a valid Convex value`);
  }
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (Array.isArray(value)) {
    if (value.length > 8192)
      throw new Error(`${path}: arrays hold at most 8192 values`);
    return value.map((x, i) => wire(x, `${path}[${i}]`));
  }
  if (!isPlainObject(value))
    throw new Error(
      `${path}: ${Object.prototype.toString.call(value)} is not a plain object`,
    );
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(value)) {
    if (x === undefined) continue;
    if (k.startsWith("$"))
      throw new Error(`${path}: field ${k} may not start with $`);
    out[k] = wire(x, `${path}.${k}`);
  }
  return out;
}

function typeRank(x: unknown): number {
  if (x === undefined) return 0;
  if (x === null) return 1;
  if (typeof x === "bigint") return 2;
  if (typeof x === "number") return 3;
  if (typeof x === "boolean") return 4;
  if (typeof x === "string") return 5;
  if (x instanceof ArrayBuffer) return 6;
  if (Array.isArray(x)) return 7;
  return 8;
}

/** Convex's value order: undefined < null < int64 < number < boolean < string < bytes < array < object. */
export function compareValues(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 0:
    case 1:
      return 0;
    case 2:
    case 3:
    case 5:
      return (a as number) < (b as number)
        ? -1
        : (a as number) > (b as number)
          ? 1
          : 0;
    case 4:
      return Number(a) - Number(b);
    case 6: {
      const x = new Uint8Array(a as ArrayBuffer);
      const y = new Uint8Array(b as ArrayBuffer);
      for (let i = 0; i < Math.min(x.length, y.length); i++)
        if (x[i] !== y[i]) return x[i] - y[i];
      return x.length - y.length;
    }
    case 7: {
      const x = a as unknown[];
      const y = b as unknown[];
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const c = compareValues(x[i], y[i]);
        if (c) return c;
      }
      return x.length - y.length;
    }
    default: {
      const x = JSON.stringify(a, bigintSafe);
      const y = JSON.stringify(b, bigintSafe);
      return x < y ? -1 : x > y ? 1 : 0;
    }
  }
}

function compareKeys(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = compareValues(a[i], b[i]);
    if (c) return c;
  }
  return 0;
}

/** Check a value against a validator's JSON form (`validator.json`). */
export function checkValue(json: Any, value: unknown, path = "value"): void {
  const fail: (why: string) => never = why => {
    throw new Error(
      `${path}: ${why} (validator ${json.type}, got ${String(
        JSON.stringify(value, bigintSafe),
      ).slice(0, 160)})`,
    );
  };
  switch (json.type) {
    case "any":
      return;
    case "null":
      if (value !== null) fail("expected null");
      return;
    case "number":
      if (typeof value !== "number") fail("expected a number");
      return;
    case "bigint":
      if (typeof value !== "bigint") fail("expected a bigint");
      return;
    case "boolean":
      if (typeof value !== "boolean") fail("expected a boolean");
      return;
    case "string":
      if (typeof value !== "string") fail("expected a string");
      return;
    case "bytes":
      if (!(value instanceof ArrayBuffer)) fail("expected bytes");
      return;
    case "id":
      if (typeof value !== "string" || tableOfId(value) !== json.tableName)
        fail(`expected an id of ${json.tableName}`);
      return;
    case "literal":
      if (value !== json.value) fail(`expected ${JSON.stringify(json.value)}`);
      return;
    case "array":
      if (!Array.isArray(value)) fail("expected an array");
      value.forEach((x, i) => {
        checkValue(json.value, x, `${path}[${i}]`);
      });
      return;
    case "record":
      if (!isPlainObject(value)) fail("expected a record");
      for (const [k, x] of Object.entries(value)) {
        checkValue(json.keys, k, `${path} key ${k}`);
        checkValue(json.values.fieldType, x, `${path}.${k}`);
      }
      return;
    case "object": {
      if (!isPlainObject(value)) fail("expected an object");
      for (const [k, spec] of Object.entries<Any>(json.value)) {
        const x = value[k];
        if (x === undefined) {
          if (!spec.optional) fail(`missing field ${k}`);
          continue;
        }
        checkValue(spec.fieldType, x, `${path}.${k}`);
      }
      for (const k of Object.keys(value))
        if (!(k in json.value) && value[k] !== undefined)
          fail(`unexpected field ${k}`);
      return;
    }
    case "union": {
      const errors: string[] = [];
      for (const option of json.value) {
        try {
          checkValue(option, value, path);
          return;
        } catch (e) {
          errors.push(String(e));
        }
      }
      fail(`no union member matched: ${errors.join(" | ").slice(0, 400)}`);
      return;
    }
    default:
      throw new Error(`${path}: validator type ${json.type} is not supported`);
  }
}

function getPath(doc: Any, field: string): unknown {
  let cur = doc;
  for (const part of field.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function tableOfId(id: string): string | null {
  const i = id.lastIndexOf("~");
  return i > 0 ? id.slice(0, i) : null;
}

// ------------------------------------------------------------------ world

type Store = {
  app: FakeApp;
  call: CallRecord;
  txn: Txn | null;
  identity: string | null;
};

type WebHandler = (req: Request) => unknown;
type WebRoute = {
  match: string | RegExp | ((req: Request) => boolean);
  handler: WebHandler;
};

type Registry = {
  dir: string;
  functions: Map<string, RegisteredFn>;
  loadErrors: Map<string, unknown>;
  router: Any | null;
  crons: Record<string, { name: string; args: Any[]; schedule: Any }>;
  tables: Map<string, { indexes: Map<string, string[]>; documentType: Any }>;
  schemaValidation: boolean;
};

type World = {
  als: AsyncLocalStorage<Store>;
  loadingEnv: Record<string, string> | null;
  loadLock: Promise<void>;
  registries: Map<string, Promise<Registry>>;
  sites: Map<string, FakeApp>;
  routes: WebRoute[];
  fetchLog: FetchRecord[];
  unrouted: string[];
  sleepScale: number;
  installed: boolean;
  realEnv: Any;
  realFetch: typeof fetch;
  realSetTimeout: typeof setTimeout;
  now: number;
  seq: number;
};

const WORLD_KEY = Symbol.for("mahara.usage.fakeCtx.world");
const DEFAULT_NOW = Date.parse("2026-09-16T08:00:00Z");

function world(): World {
  const g = globalThis as Any;
  if (!g[WORLD_KEY])
    g[WORLD_KEY] = {
      als: new AsyncLocalStorage<Store>(),
      loadingEnv: null,
      loadLock: Promise.resolve(),
      registries: new Map(),
      sites: new Map(),
      routes: [],
      fetchLog: [],
      unrouted: [],
      sleepScale: 1,
      installed: false,
      realEnv: process.env,
      realFetch: globalThis.fetch,
      realSetTimeout: globalThis.setTimeout,
      now: DEFAULT_NOW,
      seq: 0,
    } satisfies World;
  return g[WORLD_KEY];
}

function currentStore(): Store | undefined {
  return world().als.getStore();
}

function installGlobals(): void {
  const w = world();
  if (w.installed) return;
  w.installed = true;
  w.realEnv = process.env;
  w.realFetch = globalThis.fetch;
  w.realSetTimeout = globalThis.setTimeout;
  const envFor = (): Record<string, string> | null =>
    currentStore()?.app.env ?? w.loadingEnv;
  // Inside app code only the app's fake env exists; outside it, the real one.
  (process as Any).env = new Proxy(
    {},
    {
      get(_t, key) {
        const env = envFor();
        if (!env) return w.realEnv[key as Any];
        return typeof key === "string" ? env[key] : undefined;
      },
      set(_t, key, value) {
        const env = envFor();
        if (!env) w.realEnv[key as Any] = value;
        else if (typeof key === "string") env[key] = String(value);
        return true;
      },
      deleteProperty(_t, key) {
        const env = envFor();
        if (!env) delete w.realEnv[key as Any];
        else if (typeof key === "string") delete env[key];
        return true;
      },
      has(_t, key) {
        const env = envFor();
        if (!env) return key in w.realEnv;
        return typeof key === "string" && key in env;
      },
      ownKeys() {
        const env = envFor();
        return Reflect.ownKeys(env ?? w.realEnv);
      },
      getOwnPropertyDescriptor(_t, key) {
        const env = envFor() ?? w.realEnv;
        if (!(key in env)) return undefined;
        return {
          value: env[key as Any],
          enumerable: true,
          configurable: true,
          writable: true,
        };
      },
    },
  );
  globalThis.fetch = fakeFetch as typeof fetch;
  globalThis.setTimeout = ((fn: Any, ms?: number, ...rest: Any[]) => {
    const scale = currentStore() ? w.sleepScale : 1;
    return w.realSetTimeout(fn, (ms ?? 0) * scale, ...rest);
  }) as typeof setTimeout;
  setNow(w.now);
}

/** Put fetch, env, timers and the clock back. Call in `afterAll`. */
export function restoreGlobals(): void {
  const w = world();
  if (!w.installed) return;
  w.installed = false;
  (process as Any).env = w.realEnv;
  globalThis.fetch = w.realFetch;
  globalThis.setTimeout = w.realSetTimeout;
  setSystemTime();
}

// ------------------------------------------------------------------ clock

/** Set the fake clock (ms since epoch, or a Date or ISO string). */
export function setNow(at: number | string | Date): number {
  const ms =
    typeof at === "number"
      ? at
      : typeof at === "string"
        ? Date.parse(at)
        : at.getTime();
  if (!Number.isFinite(ms)) throw new Error(`setNow: bad time ${String(at)}`);
  world().now = ms;
  setSystemTime(new Date(ms));
  return ms;
}

export function now(): number {
  return world().now;
}

export function advance(ms: number): number {
  return setNow(world().now + ms);
}

/**
 * Inside app code, multiply every setTimeout delay by `scale` (for example
 * 0.001 to make retry sleeps quick). 1 restores real delays.
 */
export function setSleepScale(scale: number): void {
  world().sleepScale = scale;
}

// ------------------------------------------------------------------ web

/**
 * Routes for URLs outside the linked apps. `match` is a URL prefix, a
 * RegExp on the URL, or a predicate. The handler returns a Response, or any
 * other value to be sent as JSON. Returns a function that removes the route.
 */
export const web = {
  on(match: WebRoute["match"], handler: WebHandler): () => void {
    const route = { match, handler };
    world().routes.unshift(route);
    return () => {
      const routes = world().routes;
      const i = routes.indexOf(route);
      if (i >= 0) routes.splice(i, 1);
    };
  },
  clear(): void {
    world().routes.length = 0;
    world().fetchLog.length = 0;
    world().unrouted.length = 0;
  },
  /** Every request any app sent, in order. */
  get log(): FetchRecord[] {
    return world().fetchLog;
  },
  /** Requests no route answered ("METHOD url"); each also threw. */
  get unrouted(): string[] {
    return world().unrouted;
  },
};

function routeMatches(route: WebRoute, req: Request): boolean {
  if (typeof route.match === "string") return req.url.startsWith(route.match);
  if (route.match instanceof RegExp) return route.match.test(req.url);
  return route.match(req);
}

async function bodyBytes(r: Request | Response): Promise<number> {
  try {
    return (await r.clone().arrayBuffer()).byteLength;
  } catch {
    return 0;
  }
}

async function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const w = world();
  const req = new Request(input, init);
  const store = currentStore();
  const requestBytes = await bodyBytes(req);
  const record: FetchRecord = {
    from: store?.app.name ?? "test",
    callId: store?.call.id ?? null,
    to: "unrouted",
    method: req.method,
    url: req.url,
    status: 0,
    requestBytes,
    responseBytes: 0,
  };
  w.fetchLog.push(record);
  if (store) store.app.meter.egress(store.call, requestBytes);
  const origin = new URL(req.url).origin;
  let res: Response | undefined;
  const target = w.sites.get(origin);
  if (target) {
    record.to = target.name;
    res = await target.httpFrom(req, {
      app: store?.app.name ?? "test",
      callId: store?.call.id ?? null,
    });
  } else {
    for (const route of [...w.routes]) {
      if (!routeMatches(route, req)) continue;
      const out = await route.handler(req.clone());
      if (out === undefined) continue;
      res = out instanceof Response ? out : Response.json(out);
      record.to = "web";
      break;
    }
  }
  if (!res) {
    w.unrouted.push(`${req.method} ${req.url}`);
    throw new TypeError(
      `fetch failed: no fake route for ${req.method} ${req.url}`,
    );
  }
  record.status = res.status;
  record.responseBytes = await bodyBytes(res);
  return res;
}

// ------------------------------------------------------------------ loading

function listModules(dir: string): { mod: string; path: string }[] {
  const out: { mod: string; path: string }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        if (name === "_generated" || name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|js|mjs)$/.test(name)) continue;
      if (/\.(d|test|spec)\.ts$/.test(name)) continue;
      const mod = relative(dir, full)
        .replace(/\.(ts|js|mjs)$/, "")
        .split(sep)
        .join("/");
      out.push({ mod, path: full });
    }
  };
  walk(dir);
  return out;
}

async function withLoadLock<T>(fn: () => Promise<T>): Promise<T> {
  const w = world();
  const prev = w.loadLock;
  let release!: () => void;
  w.loadLock = new Promise<void>(r => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function loadRegistry(
  dir: string,
  env: Record<string, string>,
): Promise<Registry> {
  return await withLoadLock(async () => {
    const w = world();
    const functions = new Map<string, RegisteredFn>();
    const loadErrors = new Map<string, unknown>();
    const modules: Record<string, Any> = {};
    w.loadingEnv = env;
    try {
      for (const { mod, path } of listModules(dir)) {
        try {
          modules[mod] = await import(path);
        } catch (e) {
          loadErrors.set(mod, e);
        }
      }
    } finally {
      w.loadingEnv = null;
    }
    const missingHandler: string[] = [];
    for (const [mod, exports] of Object.entries(modules)) {
      for (const [exportName, value] of Object.entries<Any>(exports)) {
        if (
          !value ||
          (typeof value !== "function" && typeof value !== "object")
        )
          continue;
        if (!(value.isQuery || value.isMutation || value.isAction)) continue;
        const name = exportName === "default" ? mod : `${mod}:${exportName}`;
        if (typeof value._handler !== "function") {
          missingHandler.push(name);
          continue;
        }
        functions.set(name, value);
      }
    }
    if (missingHandler.length)
      throw new Error(
        `Convex registered functions no longer carry _handler (${missingHandler
          .slice(0, 3)
          .join(
            ", ",
          )}). The usage harness needs updating for this Convex version.`,
      );
    const schemaMod = modules.schema;
    if (!schemaMod?.default)
      throw new Error(
        `${dir}/schema.ts did not load: ${String(loadErrors.get("schema"))}`,
      );
    const exported = JSON.parse(schemaMod.default.export());
    const tables = new Map<
      string,
      { indexes: Map<string, string[]>; documentType: Any }
    >();
    for (const t of exported.tables) {
      const indexes = new Map<string, string[]>();
      for (const i of t.indexes ?? []) indexes.set(i.indexDescriptor, i.fields);
      tables.set(t.tableName, { indexes, documentType: t.documentType });
    }
    const router = modules.http?.default?.isRouter
      ? modules.http.default
      : null;
    const crons = modules.crons?.default?.crons ?? {};
    return {
      dir,
      functions,
      loadErrors,
      router,
      crons,
      tables,
      schemaValidation: exported.schemaValidation !== false,
    };
  });
}

// ------------------------------------------------------------------ store

const SYSTEM_TABLES = new Set(["_storage", "_scheduled_functions"]);

class Txn {
  writes = new Map<string, Map<string, Doc | null>>();
  kinds = new Map<string, WriteKind>();
  scheduled: ScheduledItem[] = [];
  readSet: ReadSet = [];
  constructor(
    readonly app: FakeApp,
    readonly parent: Txn | null,
    readonly readOnly: boolean,
  ) {}

  root(): Txn {
    return this.parent ? this.parent.root() : this;
  }

  get(table: string, id: string): Doc | null {
    const own = this.writes.get(table);
    if (own?.has(id)) return own.get(id) ?? null;
    if (this.parent) return this.parent.get(table, id);
    return this.app.committed(table).get(id) ?? null;
  }

  scan(table: string): Doc[] {
    const base = this.parent
      ? this.parent.scan(table)
      : [...this.app.committed(table).values()];
    const own = this.writes.get(table);
    if (!own || own.size === 0) return base;
    const byId = new Map(base.map(d => [d._id, d]));
    for (const [id, doc] of own) {
      if (doc) byId.set(id, doc);
      else byId.delete(id);
    }
    return [...byId.values()];
  }

  put(table: string, id: string, doc: Doc | null, kind: WriteKind): void {
    if (this.readOnly)
      throw new Error("Queries cannot write: this is a read-only transaction");
    let own = this.writes.get(table);
    if (!own) {
      own = new Map();
      this.writes.set(table, own);
    }
    own.set(id, doc);
    const prev = this.kinds.get(id);
    if (kind === "delete") this.kinds.set(id, "delete");
    else if (prev === "insert") this.kinds.set(id, "insert");
    else if (prev === "replace" && kind === "patch")
      this.kinds.set(id, "replace");
    else this.kinds.set(id, kind);
  }

  mergeIntoParent(): void {
    const parent = this.parent;
    if (!parent) return;
    for (const [table, docs] of this.writes)
      for (const [id, doc] of docs)
        parent.put(table, id, doc, this.kinds.get(id) ?? "replace");
    parent.scheduled.push(...this.scheduled);
    parent.readSet.push(...this.readSet);
  }
}

// ------------------------------------------------------------------ queries

type RangeBuilder = {
  eq(field: string, value: unknown): RangeBuilder;
  gt(field: string, value: unknown): RangeBuilder;
  gte(field: string, value: unknown): RangeBuilder;
  lt(field: string, value: unknown): RangeBuilder;
  lte(field: string, value: unknown): RangeBuilder;
};

function buildRange(
  table: string,
  index: string,
  fields: string[],
  fn: ((q: RangeBuilder) => unknown) | undefined,
): IndexOp[] {
  const ops: IndexOp[] = [];
  if (!fn) return ops;
  const add =
    (op: IndexOp["op"]) =>
    (field: string, value: unknown): RangeBuilder => {
      const pos = fields.indexOf(field);
      if (pos < 0)
        throw new Error(
          `${table}.${index}: ${field} is not a field of this index (${fields.join(", ")})`,
        );
      ops.push({
        op,
        field,
        pos,
        value:
          value === undefined ? undefined : wire(value, `${index}.${field}`),
      });
      return builder;
    };
  const builder: RangeBuilder = {
    eq: add("eq"),
    gt: add("gt"),
    gte: add("gte"),
    lt: add("lt"),
    lte: add("lte"),
  };
  fn(builder);
  // Convex's rule: equalities on a prefix, in order, then at most one lower
  // and one upper bound on the next field.
  let i = 0;
  while (i < ops.length && ops[i].op === "eq") {
    if (ops[i].pos !== i)
      throw new Error(
        `${table}.${index}: eq on ${ops[i].field} is out of index order`,
      );
    i++;
  }
  const bounds = ops.slice(i);
  const lower = bounds.filter(o => o.op === "gt" || o.op === "gte");
  const upper = bounds.filter(o => o.op === "lt" || o.op === "lte");
  if (
    bounds.length !== lower.length + upper.length ||
    lower.length > 1 ||
    upper.length > 1 ||
    bounds.some(o => o.pos !== i)
  )
    throw new Error(
      `${table}.${index}: a range must be eq on leading fields, then one lower and one upper bound on the next field`,
    );
  return ops;
}

function opsMatch(ops: IndexOp[], key: unknown[]): boolean {
  for (const o of ops) {
    const c = compareValues(key[o.pos], o.value);
    if (o.op === "eq" && c !== 0) return false;
    if (o.op === "gt" && c <= 0) return false;
    if (o.op === "gte" && c < 0) return false;
    if (o.op === "lt" && c >= 0) return false;
    if (o.op === "lte" && c > 0) return false;
  }
  return true;
}

type Expr = (doc: Doc) => unknown;
const evalExpr = (x: unknown, doc: Doc): unknown =>
  typeof x === "function" ? (x as Expr)(doc) : x;

const filterBuilder = {
  field:
    (path: string): Expr =>
    doc =>
      getPath(doc, path),
  eq:
    (a: unknown, b: unknown): Expr =>
    d =>
      compareValues(evalExpr(a, d), evalExpr(b, d)) === 0,
  neq:
    (a: unknown, b: unknown): Expr =>
    d =>
      compareValues(evalExpr(a, d), evalExpr(b, d)) !== 0,
  lt:
    (a: unknown, b: unknown): Expr =>
    d =>
      compareValues(evalExpr(a, d), evalExpr(b, d)) < 0,
  lte:
    (a: unknown, b: unknown): Expr =>
    d =>
      compareValues(evalExpr(a, d), evalExpr(b, d)) <= 0,
  gt:
    (a: unknown, b: unknown): Expr =>
    d =>
      compareValues(evalExpr(a, d), evalExpr(b, d)) > 0,
  gte:
    (a: unknown, b: unknown): Expr =>
    d =>
      compareValues(evalExpr(a, d), evalExpr(b, d)) >= 0,
  and:
    (...xs: unknown[]): Expr =>
    d =>
      xs.every(x => evalExpr(x, d) === true),
  or:
    (...xs: unknown[]): Expr =>
    d =>
      xs.some(x => evalExpr(x, d) === true),
  not:
    (x: unknown): Expr =>
    d =>
      evalExpr(x, d) !== true,
  add:
    (a: unknown, b: unknown): Expr =>
    d =>
      (evalExpr(a, d) as number) + (evalExpr(b, d) as number),
  sub:
    (a: unknown, b: unknown): Expr =>
    d =>
      (evalExpr(a, d) as number) - (evalExpr(b, d) as number),
  mul:
    (a: unknown, b: unknown): Expr =>
    d =>
      (evalExpr(a, d) as number) * (evalExpr(b, d) as number),
  div:
    (a: unknown, b: unknown): Expr =>
    d =>
      (evalExpr(a, d) as number) / (evalExpr(b, d) as number),
  mod:
    (a: unknown, b: unknown): Expr =>
    d =>
      (evalExpr(a, d) as number) % (evalExpr(b, d) as number),
  neg:
    (a: unknown): Expr =>
    d =>
      -(evalExpr(a, d) as number),
};

const END_CURSOR = "fake:end";

function encodeCursor(key: unknown[]): string {
  return `fake:${JSON.stringify(
    key.map(k => (k === undefined ? { $undefined: true } : k)),
    bigintSafe,
  )}`;
}

function decodeCursor(cursor: string): unknown[] | "end" {
  if (cursor === END_CURSOR) return "end";
  if (!cursor.startsWith("fake:"))
    throw new Error(`not a cursor from this harness: ${cursor}`);
  return (JSON.parse(cursor.slice(5)) as unknown[]).map(k =>
    isPlainObject(k) && k.$undefined ? undefined : k,
  );
}

class FakeQuery {
  private index = "by_creation_time";
  private fields: string[];
  private ops: IndexOp[] = [];
  private dir: "asc" | "desc" = "asc";
  private filters: unknown[] = [];
  private used = false;

  constructor(
    private readonly tx: Txn,
    private readonly call: CallRecord,
    private readonly table: string,
  ) {
    this.fields = tx.app.keyFields(table, "by_creation_time");
  }

  withIndex(name: string, range?: (q: RangeBuilder) => unknown): this {
    this.index = name;
    this.fields = this.tx.app.keyFields(this.table, name);
    this.ops = buildRange(this.table, name, this.fields, range);
    return this;
  }

  fullTableScan(): this {
    return this;
  }

  withSearchIndex(): never {
    throw new Error("search indexes are not supported by the usage harness");
  }

  order(dir: "asc" | "desc"): this {
    this.dir = dir;
    return this;
  }

  filter(fn: (q: typeof filterBuilder) => unknown): this {
    this.filters.push(fn(filterBuilder));
    return this;
  }

  private rows(): { doc: Doc; key: unknown[] }[] {
    const out = this.tx
      .scan(this.table)
      .map(doc => ({ doc, key: this.fields.map(f => getPath(doc, f)) }))
      .filter(r => opsMatch(this.ops, r.key));
    out.sort((a, b) => compareKeys(a.key, b.key));
    if (this.dir === "desc") out.reverse();
    return out;
  }

  private record(): RangeRead {
    const read: RangeRead = {
      kind: "range",
      table: this.table,
      index: this.index,
      fields: this.fields,
      ops: this.ops,
      order: this.dir,
    };
    this.tx.readSet.push(read);
    return read;
  }

  private start(): void {
    if (this.used) throw new Error("a query can only be run once");
    this.used = true;
  }

  private passes(doc: Doc): boolean {
    return this.filters.every(f => evalExpr(f, doc) === true);
  }

  private scan(
    limit: number,
    after?: unknown[],
  ): { docs: Doc[]; cut?: unknown[]; exhausted: boolean } {
    const read = this.record();
    if (after) read.after = after;
    const docs: Doc[] = [];
    for (const r of this.rows()) {
      if (after) {
        const c = compareKeys(r.key, after);
        if (this.dir === "asc" ? c <= 0 : c >= 0) continue;
      }
      if (docs.length >= limit) {
        return { docs, cut: read.cut as unknown[], exhausted: false };
      }
      this.tx.app.meter.read(this.call, r.doc);
      if (this.passes(r.doc)) {
        docs.push(structuredClone(r.doc));
        if (docs.length >= limit) read.cut = r.key;
      }
    }
    if (docs.length >= limit && read.cut)
      return { docs, cut: read.cut as unknown[], exhausted: false };
    read.cut = undefined;
    return { docs, exhausted: true };
  }

  async collect(): Promise<Doc[]> {
    this.start();
    return this.scan(Number.POSITIVE_INFINITY).docs;
  }

  async take(n: number): Promise<Doc[]> {
    this.start();
    if (!Number.isInteger(n) || n < 0)
      throw new Error(`take(${n}): expected a whole number`);
    if (n === 0) return [];
    return this.scan(n).docs;
  }

  async first(): Promise<Doc | null> {
    this.start();
    return this.scan(1).docs[0] ?? null;
  }

  async unique(): Promise<Doc | null> {
    this.start();
    const docs = this.scan(2).docs;
    if (docs.length > 1)
      throw new Error(
        `unique() found more than one document in ${this.table} (${this.index})`,
      );
    return docs[0] ?? null;
  }

  async paginate(opts: {
    numItems: number;
    cursor: string | null;
  }): Promise<{ page: Doc[]; isDone: boolean; continueCursor: string }> {
    this.start();
    let after: unknown[] | undefined;
    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded === "end") {
        this.record().cut = "start";
        return { page: [], isDone: true, continueCursor: END_CURSOR };
      }
      after = decoded;
    }
    const n = Math.max(1, Math.floor(opts.numItems));
    const { docs, cut, exhausted } = this.scan(n, after);
    return {
      page: docs,
      isDone: exhausted,
      continueCursor: exhausted || !cut ? END_CURSOR : encodeCursor(cut),
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<Doc> {
    this.start();
    const read = this.record();
    read.cut = "start";
    const rows = this.rows();
    let i = 0;
    return {
      next: async () => {
        while (i < rows.length) {
          const r = rows[i++];
          this.tx.app.meter.read(this.call, r.doc);
          read.cut = r.key;
          if (this.passes(r.doc))
            return { done: false, value: structuredClone(r.doc) };
        }
        read.cut = undefined;
        return { done: true, value: undefined };
      },
    };
  }
}

// ------------------------------------------------------------------ reads

function docInRange(read: RangeRead, doc: Doc | null): boolean {
  if (!doc || read.cut === "start") return false;
  const key = read.fields.map(f => getPath(doc, f));
  if (!opsMatch(read.ops, key)) return false;
  const sign = read.order === "asc" ? 1 : -1;
  if (read.after && sign * compareKeys(key, read.after) <= 0) return false;
  if (read.cut && sign * compareKeys(key, read.cut) > 0) return false;
  return true;
}

/** Would this write re-run a subscription with this read set? */
export function invalidates(readSet: ReadSet, write: WriteRecord): boolean {
  return readSet.some(r =>
    r.kind === "id"
      ? r.id === write.id
      : r.table === write.table &&
        (docInRange(r, write.before) || docInRange(r, write.after)),
  );
}

// ------------------------------------------------------------------ meter

function zeroDelta(): MeterDelta {
  return {
    calls: {},
    totalCalls: 0,
    docsRead: 0,
    bytesRead: 0,
    docsWritten: 0,
    bytesWritten: 0,
    writes: {},
    egressBytes: 0,
    fetches: 0,
    reruns: 0,
    scheduled: 0,
  };
}

function cloneDelta(d: MeterDelta): MeterDelta {
  return { ...d, calls: { ...d.calls }, writes: { ...d.writes } };
}

function diffCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    const d = v - (b[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

/** Subtract two meter readings. */
export function diffDelta(after: MeterDelta, before: MeterDelta): MeterDelta {
  return {
    calls: diffCounts(after.calls, before.calls),
    totalCalls: after.totalCalls - before.totalCalls,
    docsRead: after.docsRead - before.docsRead,
    bytesRead: after.bytesRead - before.bytesRead,
    docsWritten: after.docsWritten - before.docsWritten,
    bytesWritten: after.bytesWritten - before.bytesWritten,
    writes: diffCounts(after.writes, before.writes),
    egressBytes: after.egressBytes - before.egressBytes,
    fetches: after.fetches - before.fetches,
    reruns: after.reruns - before.reruns,
    scheduled: after.scheduled - before.scheduled,
  };
}

export class Meter {
  private totals = zeroDelta();
  readonly records: CallRecord[] = [];
  private parents = new Map<number, CallRecord>();

  constructor(private readonly app: FakeApp) {}

  /** Everything counted since the app was made (or last reset). */
  get total(): MeterDelta {
    return cloneDelta(this.totals);
  }

  mark(): MeterMark {
    return { delta: cloneDelta(this.totals) };
  }

  since(mark: MeterMark): MeterDelta {
    return diffDelta(this.totals, mark.delta);
  }

  reset(): void {
    this.totals = zeroDelta();
    this.records.length = 0;
    this.parents.clear();
  }

  /** Calls to one function, in order. */
  callsTo(name: string): CallRecord[] {
    return this.records.filter(r => r.name === name);
  }

  begin(
    fields: Pick<CallRecord, "name" | "kind" | "args" | "scheduled" | "via"> & {
      parent: CallRecord | null;
      txnParent: CallRecord | null;
    },
  ): CallRecord {
    const rec: CallRecord = {
      id: ++world().seq,
      app: this.app.name,
      name: fields.name,
      kind: fields.kind,
      parent: fields.parent?.id ?? null,
      via: fields.via,
      scheduled: fields.scheduled,
      args: fields.args,
      at: Date.now(),
      docsRead: 0,
      bytesRead: 0,
      docsWritten: 0,
      bytesWritten: 0,
      writes: {},
      egressBytes: 0,
      fetches: 0,
      readSet: [],
      ok: null,
    };
    if (fields.txnParent) this.parents.set(rec.id, fields.txnParent);
    this.records.push(rec);
    this.totals.calls[rec.name] = (this.totals.calls[rec.name] ?? 0) + 1;
    this.totals.totalCalls++;
    return rec;
  }

  read(call: CallRecord, doc: Doc): void {
    const bytes = sizeOf(doc);
    this.totals.docsRead++;
    this.totals.bytesRead += bytes;
    for (let c: CallRecord | undefined = call; c; c = this.parents.get(c.id)) {
      c.docsRead++;
      c.bytesRead += bytes;
    }
  }

  wrote(call: CallRecord, w: WriteRecord): void {
    this.totals.docsWritten++;
    this.totals.bytesWritten += w.bytes;
    this.totals.writes[w.table] = (this.totals.writes[w.table] ?? 0) + 1;
    call.docsWritten++;
    call.bytesWritten += w.bytes;
    call.writes[w.table] = (call.writes[w.table] ?? 0) + 1;
  }

  egress(call: CallRecord, bytes: number): void {
    this.totals.egressBytes += bytes;
    this.totals.fetches++;
    call.egressBytes += bytes;
    call.fetches++;
  }

  rerun(): void {
    this.totals.reruns++;
  }

  scheduledOne(): void {
    this.totals.scheduled++;
  }
}

// ------------------------------------------------------------------ watches

/** A live query, re-run (or marked stale) whenever a write touches its reads. */
export class Watch<T = Any> {
  result!: T;
  readSet: ReadSet = [];
  /** Times the query ran, the first run included. */
  runs = 0;
  /** Writes that invalidated it (each commit counts once). */
  triggers = 0;
  stale = false;
  active = true;
  error: unknown = null;

  constructor(
    private readonly app: FakeApp,
    readonly name: string,
    readonly args: Any,
    readonly as: string | null,
    readonly autoRerun: boolean,
  ) {}

  async rerun(): Promise<T> {
    const { result, call } = await this.app
      .invoke("query", this.name, this.args, { identity: this.as, top: true })
      .catch(e => {
        this.error = e;
        throw e;
      });
    this.result = result as T;
    this.readSet = call.readSet;
    this.runs++;
    this.stale = false;
    this.error = null;
    return this.result;
  }

  stop(): void {
    this.active = false;
  }
}

// ------------------------------------------------------------------ app

type Lock = () => void;

export type MakeAppOptions = {
  /** Which app this is; found from the folder name when absent. */
  name?: AppName;
  /** Extra fake env values (added to defaultEnv). */
  env?: Record<string, string>;
  /** Check args, returns and stored documents (default true). */
  validate?: boolean;
};

export class FakeApp {
  readonly meter: Meter;
  readonly env: Record<string, string>;
  readonly writeLog: WriteRecord[] = [];
  readonly queue: ScheduledItem[] = [];
  readonly watches: Watch[] = [];
  readonly siteUrl: string;
  private readonly tables = new Map<string, Map<string, Doc>>();
  private readonly files = new Map<
    string,
    { bytes: ArrayBuffer; contentType?: string; sha256: string }
  >();
  private lockTail: Promise<void> = Promise.resolve();
  private seq = 0;
  private lastCreation = 0;
  private inlineSeq = 0;
  private readonly inline = new Map<string, RegisteredFn>();

  constructor(
    readonly name: AppName,
    readonly registry: Registry,
    env: Record<string, string>,
    readonly validate: boolean,
  ) {
    this.meter = new Meter(this);
    this.env = env;
    this.siteUrl = env.CONVEX_SITE_URL ?? FAKE_SITE[name];
  }

  // --- registry ---------------------------------------------------------

  functionNames(): string[] {
    return [...this.registry.functions.keys()].sort();
  }

  /** The registered function object behind a reference or name. */
  fn(ref: AnyRef): RegisteredFn {
    const name = typeof ref === "string" ? ref : getFunctionName(ref);
    const found = this.registry.functions.get(name) ?? this.inline.get(name);
    if (found) return found;
    const mod = name.split(":")[0];
    const loadError = this.registry.loadErrors.get(mod);
    if (loadError)
      throw new Error(
        `${this.name}: module ${mod} failed to load: ${String(loadError)}`,
      );
    throw new Error(`${this.name}: no function ${name}`);
  }

  get loadErrors(): Map<string, unknown> {
    return this.registry.loadErrors;
  }

  /** Crons from crons.ts: name -> {name: function, args, schedule}. */
  get crons(): Registry["crons"] {
    return this.registry.crons;
  }

  keyFields(table: string, index: string): string[] {
    const t = this.registry.tables.get(table);
    if (!t && !SYSTEM_TABLES.has(table))
      throw new Error(`${this.name}: no table ${table} in the schema`);
    let fields: string[] | undefined;
    if (index === "by_creation_time") fields = ["_creationTime"];
    else if (index === "by_id") fields = ["_id"];
    else fields = t?.indexes.get(index);
    if (!fields)
      throw new Error(`${this.name}: no index ${table}.${index} in the schema`);
    const out = [...fields];
    if (!out.includes("_creationTime")) out.push("_creationTime");
    if (!out.includes("_id")) out.push("_id");
    return out;
  }

  // --- data -------------------------------------------------------------

  committed(table: string): Map<string, Doc> {
    let t = this.tables.get(table);
    if (!t) {
      t = new Map();
      this.tables.set(table, t);
    }
    return t;
  }

  private checkDoc(table: string, doc: Record<string, unknown>): void {
    const t = this.registry.tables.get(table);
    if (!t) throw new Error(`${this.name}: no table ${table} in the schema`);
    if (sizeOf(doc) > 1024 * 1024)
      throw new Error(`${table}: document is over 1 MiB`);
    if (!this.validate || !this.registry.schemaValidation) return;
    const { _id, _creationTime, ...rest } = doc;
    checkValue(t.documentType, rest, `${table} document`);
  }

  private newId(table: string): string {
    return `${table}~${++this.seq}`;
  }

  /** Creation times follow the clock and never repeat within this app. */
  private nextCreationTime(): number {
    const t = Math.max(Date.now(), this.lastCreation + 0.001);
    this.lastCreation = t;
    return t;
  }

  /**
   * Insert rows straight into the committed data, unmetered and without
   * waking watches. `creationTime` backdates rows (for age-based code).
   */
  seed(
    table: string,
    docs: Record<string, unknown>[],
    opts: { creationTime?: number | ((i: number) => number) } = {},
  ): string[] {
    const ids: string[] = [];
    docs.forEach((d, i) => {
      const clean = wire(d, `${table} seed`);
      this.checkDoc(table, clean);
      const _id = this.newId(table);
      const ct = opts.creationTime;
      const _creationTime =
        typeof ct === "function"
          ? ct(i)
          : typeof ct === "number"
            ? ct + i * 0.001
            : this.nextCreationTime();
      this.committed(table).set(_id, { ...clean, _id, _creationTime });
      ids.push(_id);
    });
    return ids;
  }

  /** Change a committed row directly, unmetered. Undefined removes a field. */
  patchDirect(id: string, fields: Record<string, unknown>): void {
    const table = tableOfId(id);
    const doc = table ? this.committed(table).get(id) : undefined;
    if (!table || !doc) throw new Error(`patchDirect: no document ${id}`);
    const next: Record<string, unknown> = { ...doc };
    for (const [k, v] of Object.entries(fields))
      if (v === undefined) delete next[k];
      else next[k] = wire(v, `patch ${k}`);
    this.checkDoc(table, next);
    this.committed(table).set(id, next as Doc);
  }

  /** Committed rows of a table (copies), in creation order. */
  docs(table: string): Doc[] {
    return [...this.committed(table).values()]
      .sort((a, b) => a._creationTime - b._creationTime)
      .map(d => structuredClone(d));
  }

  doc(id: string): Doc | null {
    const table = tableOfId(id);
    const d = table ? this.committed(table).get(id) : undefined;
    return d ? structuredClone(d) : null;
  }

  count(table: string): number {
    return this.committed(table).size;
  }

  /** A signed-in person: a `users` row. Pass the id as `{ as }`. */
  async makeUser(fields: Record<string, unknown> = {}): Promise<string> {
    return this.seed("users", [fields])[0];
  }

  setEnv(values: Record<string, string | undefined>): void {
    for (const [k, v] of Object.entries(values))
      if (v === undefined) delete this.env[k];
      else this.env[k] = v;
  }

  // --- calls ------------------------------------------------------------

  private async lock(): Promise<Lock> {
    const prev = this.lockTail;
    let release!: Lock;
    this.lockTail = new Promise<void>(r => {
      release = r;
    });
    await prev;
    return release;
  }

  /** Run a query, mutation or action by reference or name. */
  async run<F extends AnyRef>(
    ref: F,
    args?: ArgsOf<F>,
    opts: CallOptions = {},
  ): Promise<ReturnOf<F>> {
    return (await this.measure(ref, args, opts)).result;
  }

  async query<F extends AnyRef>(
    ref: F,
    args?: ArgsOf<F>,
    opts: CallOptions = {},
  ): Promise<ReturnOf<F>> {
    return (await this.call("query", ref, args, opts)).result;
  }

  async mutation<F extends AnyRef>(
    ref: F,
    args?: ArgsOf<F>,
    opts: CallOptions = {},
  ): Promise<ReturnOf<F>> {
    return (await this.call("mutation", ref, args, opts)).result;
  }

  async action<F extends AnyRef>(
    ref: F,
    args?: ArgsOf<F>,
    opts: CallOptions = {},
  ): Promise<ReturnOf<F>> {
    return (await this.call("action", ref, args, opts)).result;
  }

  /** Run and return the result, the call record, and what it cost. */
  async measure<F extends AnyRef>(
    ref: F,
    args?: ArgsOf<F>,
    opts: CallOptions = {},
  ): Promise<{ result: ReturnOf<F>; call: CallRecord; delta: MeterDelta }> {
    const kind = this.kindOf(this.fn(ref));
    return await this.call(kind, ref, args, opts);
  }

  private async call<F extends AnyRef>(
    kind: FnKind,
    ref: F,
    args: ArgsOf<F> | undefined,
    opts: CallOptions,
  ): Promise<{ result: ReturnOf<F>; call: CallRecord; delta: MeterDelta }> {
    const name = typeof ref === "string" ? ref : getFunctionName(ref);
    const mark = this.meter.mark();
    const { result, call } = await this.invoke(kind, name, args ?? {}, {
      identity: opts.as ?? null,
      noValidate: opts.noValidate,
      top: true,
    });
    return { result, call, delta: this.meter.since(mark) };
  }

  /**
   * Register an ad-hoc function on this app and return its name, usable
   * with run, watch and the scheduler. Arguments are not validated.
   */
  define(
    kind: "query" | "mutation" | "action",
    handler: (ctx: Any, args: Any) => unknown,
    name = `inline:${kind}${++this.inlineSeq}`,
  ): string {
    this.inline.set(name, {
      isQuery: kind === "query",
      isMutation: kind === "mutation",
      isAction: kind === "action",
      _handler: handler,
    });
    return name;
  }

  /**
   * Run an ad-hoc handler once with this app's ctx, as a function of the
   * given kind (for setup, checks and harness tests).
   */
  async inlineRun<T>(
    kind: "query" | "mutation" | "action",
    handler: (ctx: Any) => Promise<T> | T,
    opts: CallOptions = {},
  ): Promise<T> {
    const name = this.define(kind, ctx => handler(ctx));
    try {
      const { result } = await this.invoke(
        kind,
        name,
        {},
        {
          identity: opts.as ?? null,
          noValidate: true,
          top: true,
        },
      );
      return result as T;
    } finally {
      this.inline.delete(name);
    }
  }

  private kindOf(fn: RegisteredFn): FnKind {
    if (fn.isQuery) return "query";
    if (fn.isMutation) return "mutation";
    if (fn.isAction) return "action";
    return "http";
  }

  /** @internal The single path every call takes. */
  async invoke(
    kind: FnKind,
    name: string,
    args: Any,
    opts: {
      identity?: string | null;
      noValidate?: boolean;
      top?: boolean;
      scheduled?: boolean;
      via?: CallRecord["via"];
      handler?: (ctx: Any, args: Any) => Any;
    },
  ): Promise<{ result: Any; call: CallRecord }> {
    const outer = currentStore();
    const parent = !opts.top && outer?.app === this ? outer : undefined;
    const fn = opts.handler ? null : this.fn(name);
    if (fn && this.kindOf(fn) !== kind)
      throw new Error(`${name} is a ${this.kindOf(fn)}, not a ${kind}`);
    const identity =
      opts.identity !== undefined ? opts.identity : (parent?.identity ?? null);
    const validate = this.validate && !opts.noValidate;

    let txn: Txn | null = null;
    let release: Lock | null = null;
    if (kind === "query" || kind === "mutation") {
      if (parent?.txn) {
        if (kind === "mutation" && parent.txn.readOnly)
          throw new Error("a query cannot call runMutation");
        txn = new Txn(
          this,
          parent.txn,
          kind === "query" || parent.txn.readOnly,
        );
      } else {
        release = await this.lock();
        txn = new Txn(this, null, kind === "query");
      }
    }
    const call = this.meter.begin({
      name,
      kind,
      args: kind === "http" ? null : args,
      scheduled: !!opts.scheduled,
      via:
        opts.via ??
        (outer && outer.app !== this
          ? { app: outer.app.name, callId: outer.call.id }
          : null),
      parent: parent?.call ?? null,
      txnParent: txn?.parent ? (parent?.call ?? null) : null,
    });
    const store: Store = { app: this, call, txn, identity };
    let records: WriteRecord[] = [];
    try {
      let cleanArgs = args;
      if (kind !== "http") {
        cleanArgs = wire(args ?? {}, `${name} args`);
        if (validate && fn?.exportArgs)
          checkValue(JSON.parse(fn.exportArgs()), cleanArgs, `${name} args`);
      }
      const ctx = this.makeCtx(kind, store);
      const handler = opts.handler ?? fn!._handler;
      let result = await world().als.run(store, () =>
        Promise.resolve(handler(ctx, cleanArgs)),
      );
      if (kind !== "http") {
        result = wire(result === undefined ? null : result, `${name} returns`);
        const returns = validate && fn?.exportReturns?.();
        const spec = returns ? JSON.parse(returns) : null;
        if (spec) checkValue(spec, result, `${name} returns`);
      }
      if (txn) {
        if (txn.parent) txn.mergeIntoParent();
        else records = this.commit(txn, call);
        call.readSet = txn.readSet;
      }
      call.ok = true;
      return { result, call };
    } catch (e) {
      call.ok = false;
      call.error = String(e).slice(0, 500);
      throw e;
    } finally {
      release?.();
      if (records.length) await this.notifyWatches(records);
    }
  }

  private commit(txn: Txn, call: CallRecord): WriteRecord[] {
    const records: WriteRecord[] = [];
    const at = Date.now();
    for (const [table, docs] of txn.writes) {
      const committed = this.committed(table);
      for (const [id, after] of docs) {
        const before = committed.get(id) ?? null;
        if (!before && !after) continue;
        if (after) committed.set(id, after);
        else committed.delete(id);
        const kind: WriteKind = !before
          ? "insert"
          : !after
            ? "delete"
            : txn.kinds.get(id) === "patch"
              ? "patch"
              : "replace";
        const rec: WriteRecord = {
          app: this.name,
          table,
          id,
          kind,
          before,
          after,
          bytes: sizeOf(after ?? before),
          callId: call.id,
          at,
        };
        records.push(rec);
        this.writeLog.push(rec);
        this.meter.wrote(call, rec);
      }
    }
    for (const item of txn.scheduled) {
      this.queue.push(item);
      this.meter.scheduledOne();
    }
    return records;
  }

  private async notifyWatches(records: WriteRecord[]): Promise<void> {
    for (const w of [...this.watches]) {
      if (!w.active) continue;
      if (!records.some(r => invalidates(w.readSet, r))) continue;
      w.triggers++;
      this.meter.rerun();
      if (w.autoRerun) await w.rerun().catch(() => undefined);
      else w.stale = true;
    }
  }

  /**
   * Subscribe to a query the way an open screen does. Every later commit
   * that touches its reads counts a trigger and, unless `autoRerun` is
   * false, re-runs it (a metered call, as on Convex).
   */
  async watch<F extends AnyRef>(
    ref: F,
    args?: ArgsOf<F>,
    opts: CallOptions & { autoRerun?: boolean } = {},
  ): Promise<Watch<ReturnOf<F>>> {
    const name = typeof ref === "string" ? ref : getFunctionName(ref);
    const w = new Watch<ReturnOf<F>>(
      this,
      name,
      wire(args ?? {}),
      opts.as ?? null,
      opts.autoRerun !== false,
    );
    await w.rerun();
    this.watches.push(w);
    return w;
  }

  // --- ctx --------------------------------------------------------------

  private auth(store: Store) {
    return {
      getUserIdentity: async () =>
        store.identity
          ? {
              subject: `${store.identity}|s`,
              tokenIdentifier: `${this.siteUrl}|${store.identity}|s`,
              issuer: this.siteUrl,
            }
          : null,
    };
  }

  private makeCtx(kind: FnKind, store: Store): Any {
    const runQuery = (ref: AnyRef, args?: Any) =>
      this.runNested("query", ref, args);
    const runMutation = (ref: AnyRef, args?: Any) =>
      this.runNested("mutation", ref, args);
    const runAction = (ref: AnyRef, args?: Any) =>
      this.runNested("action", ref, args);
    const auth = this.auth(store);
    if (kind === "query")
      return {
        db: this.makeDb(store, false),
        auth,
        storage: this.storageApi("query"),
        runQuery,
      };
    if (kind === "mutation")
      return {
        db: this.makeDb(store, true),
        auth,
        storage: this.storageApi("mutation"),
        scheduler: this.scheduler(store),
        runQuery,
        runMutation,
      };
    return {
      auth,
      storage: this.storageApi("action"),
      scheduler: this.scheduler(store),
      runQuery,
      runMutation,
      runAction,
      vectorSearch: async () => {
        throw new Error("vectorSearch is not supported by the usage harness");
      },
    };
  }

  private async runNested(kind: FnKind, ref: AnyRef, args?: Any): Promise<Any> {
    const name = typeof ref === "string" ? ref : getFunctionName(ref);
    const { result } = await this.invoke(kind, name, args ?? {}, {});
    return result;
  }

  private makeDb(store: Store, writable: boolean): Any {
    const txn = store.txn!;
    const tableFor = (a: unknown, b: unknown): [string, string] => {
      const id = (b === undefined ? a : b) as string;
      if (typeof id !== "string")
        throw new Error(`expected a document id, got ${typeof id}`);
      const fromId = tableOfId(id);
      if (!fromId) throw new Error(`not a document id: ${id}`);
      if (b !== undefined && a !== fromId)
        throw new Error(`id ${id} is not in table ${String(a)}`);
      return [fromId, id];
    };
    const get = async (a: unknown, b?: unknown) => {
      const [table, id] = tableFor(a, b);
      txn.readSet.push({ kind: "id", table, id });
      if (table === "_storage") return this.storageDoc(id);
      if (table === "_scheduled_functions") return this.scheduledDoc(id);
      const doc = txn.get(table, id);
      if (!doc) return null;
      this.meter.read(store.call, doc);
      return structuredClone(doc);
    };
    const normalizeId = (table: string, id: string) =>
      typeof id === "string" && tableOfId(id) === table ? id : null;
    const reader: Any = {
      get,
      query: (table: string) => {
        if (SYSTEM_TABLES.has(table))
          throw new Error(`use ctx.db.system.query for ${table}`);
        this.keyFields(table, "by_creation_time");
        return new FakeQuery(txn, store.call, table);
      },
      normalizeId,
      system: {
        get,
        normalizeId,
        query: (table: string) => {
          throw new Error(
            `system table queries (${table}) are not supported by the usage harness`,
          );
        },
      },
    };
    if (!writable) return reader;
    const existing = (a: unknown, b: unknown, op: string): [string, Doc] => {
      const [table, id] = tableFor(a, b);
      if (SYSTEM_TABLES.has(table))
        throw new Error("System tables (prefixed with `_`) are read-only.");
      const doc = txn.get(table, id);
      if (!doc) throw new Error(`${op} on nonexistent document ID ${id}`);
      return [table, doc];
    };
    const noSystemFields = (doc: Doc, value: Record<string, unknown>) => {
      for (const k of ["_id", "_creationTime"])
        if (k in value && value[k] !== undefined && value[k] !== doc[k])
          throw new Error(`cannot change system field ${k}`);
    };
    return {
      ...reader,
      insert: async (table: string, value: Record<string, unknown>) => {
        if (table.startsWith("_"))
          throw new Error("System tables (prefixed with `_`) are read-only.");
        const clean = wire(value, `${table} insert`);
        for (const k of Object.keys(clean))
          if (k.startsWith("_"))
            throw new Error(`insert into ${table}: field ${k} is reserved`);
        this.checkDoc(table, clean);
        const _id = this.newId(table);
        txn.put(
          table,
          _id,
          { ...clean, _id, _creationTime: this.nextCreationTime() },
          "insert",
        );
        return _id;
      },
      patch: async (a: unknown, b: unknown, c?: unknown) => {
        const fields = (c === undefined ? b : c) as Record<string, unknown>;
        const [table, doc] = existing(
          a,
          c === undefined ? undefined : b,
          "patch",
        );
        noSystemFields(doc, fields);
        const next: Record<string, unknown> = { ...doc };
        for (const [k, v] of Object.entries(fields)) {
          if (k === "_id" || k === "_creationTime") continue;
          if (v === undefined) delete next[k];
          else next[k] = wire(v, `${table} patch ${k}`);
        }
        this.checkDoc(table, next);
        txn.put(table, doc._id, next as Doc, "patch");
      },
      replace: async (a: unknown, b: unknown, c?: unknown) => {
        const value = (c === undefined ? b : c) as Record<string, unknown>;
        const [table, doc] = existing(
          a,
          c === undefined ? undefined : b,
          "replace",
        );
        noSystemFields(doc, value);
        const { _id, _creationTime, ...rest } = value;
        const clean = wire(rest, `${table} replace`);
        this.checkDoc(table, clean);
        txn.put(
          table,
          doc._id,
          { ...clean, _id: doc._id, _creationTime: doc._creationTime },
          "replace",
        );
      },
      delete: async (a: unknown, b?: unknown) => {
        const [table, doc] = existing(a, b, "Delete");
        txn.put(table, doc._id, null, "delete");
      },
    };
  }

  // --- scheduler --------------------------------------------------------

  private scheduler(store: Store) {
    const schedule = async (at: number, ref: AnyRef, args?: Any) => {
      const name = typeof ref === "string" ? ref : getFunctionName(ref);
      const fn = this.fn(name);
      const clean = wire(args ?? {}, `${name} scheduled args`);
      if (this.validate && fn.exportArgs)
        checkValue(
          JSON.parse(fn.exportArgs()),
          clean,
          `${name} scheduled args`,
        );
      const item: ScheduledItem = {
        id: `_scheduled_functions~${++this.seq}`,
        app: this.name,
        name,
        args: clean,
        at,
        state: "pending",
        fromCall: store.call.id,
      };
      if (store.txn) store.txn.scheduled.push(item);
      else {
        this.queue.push(item);
        this.meter.scheduledOne();
      }
      return item.id;
    };
    return {
      runAfter: (delayMs: number, ref: AnyRef, args?: Any) =>
        schedule(Date.now() + Math.max(0, delayMs), ref, args),
      runAt: (when: number | Date, ref: AnyRef, args?: Any) =>
        schedule(typeof when === "number" ? when : when.getTime(), ref, args),
      cancel: async (id: string) => {
        const item = this.queue.find(i => i.id === id);
        if (item && item.state === "pending") item.state = "canceled";
      },
    };
  }

  private scheduledDoc(id: string): Any {
    const item = this.queue.find(i => i.id === id);
    if (!item) return null;
    return {
      _id: item.id,
      _creationTime: item.at,
      name: item.name,
      args: [item.args],
      scheduledTime: item.at,
      state:
        item.state === "running"
          ? { kind: "inProgress" }
          : item.state === "failed"
            ? { kind: "failed", error: item.error ?? "" }
            : { kind: item.state },
    };
  }

  /** Pending scheduled calls, soonest first. */
  pending(): ScheduledItem[] {
    return this.queue
      .filter(i => i.state === "pending")
      .sort((a, b) => a.at - b.at);
  }

  /**
   * Run every scheduled call due by `untilMs` (default: now), soonest
   * first, moving the clock to each one's time, including calls they
   * schedule in turn. The clock ends at `untilMs` when that is later.
   * Failures are recorded on the item, not thrown.
   */
  async flushScheduled(untilMs: number = Date.now()): Promise<ScheduledItem[]> {
    return await flushApps([this], untilMs);
  }

  /** @internal */
  async runScheduled(item: ScheduledItem): Promise<void> {
    item.state = "running";
    try {
      const kind = this.kindOf(this.fn(item.name));
      await this.invoke(kind, item.name, item.args, {
        identity: null,
        top: true,
        scheduled: true,
      });
      item.state = "success";
    } catch (e) {
      item.state = "failed";
      item.error = String(e).slice(0, 500);
    }
  }

  // --- storage ----------------------------------------------------------

  private storageDoc(id: string): Any {
    const f = this.files.get(id);
    if (!f) return null;
    return {
      _id: id,
      _creationTime: 0,
      sha256: f.sha256,
      size: f.bytes.byteLength,
      contentType: f.contentType,
    };
  }

  private storageApi(kind: "query" | "mutation" | "action"): Any {
    const getUrl = async (id: string) =>
      this.files.has(id)
        ? `${this.siteUrl.replace(".site", ".cloud")}/api/storage/${id}`
        : null;
    const getMetadata = async (id: string) => {
      const d = this.storageDoc(id);
      return d
        ? {
            storageId: id,
            sha256: d.sha256,
            size: d.size,
            contentType: d.contentType ?? null,
          }
        : null;
    };
    const api: Any = { getUrl, getMetadata };
    if (kind === "query") return api;
    api.delete = async (id: string) => {
      this.files.delete(id);
    };
    api.generateUploadUrl = async () =>
      `${this.siteUrl.replace(".site", ".cloud")}/api/storage/upload`;
    if (kind === "mutation") return api;
    api.store = async (blob: Blob) => {
      const bytes = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const id = `_storage~${++this.seq}`;
      this.files.set(id, {
        bytes,
        contentType: blob.type || undefined,
        sha256: Buffer.from(digest).toString("base64"),
      });
      return id;
    };
    api.get = async (id: string) => {
      const f = this.files.get(id);
      return f ? new Blob([f.bytes], { type: f.contentType ?? "" }) : null;
    };
    return api;
  }

  // --- http -------------------------------------------------------------

  /** Send a request to this app's http.ts router, as from outside. */
  async http(input: string | Request, init?: RequestInit): Promise<Response> {
    const req =
      typeof input === "string"
        ? new Request(new URL(input, this.siteUrl), init)
        : input;
    return await this.httpFrom(req, { app: "test", callId: null });
  }

  /** @internal */
  async httpFrom(req: Request, via: CallRecord["via"]): Promise<Response> {
    const router = this.registry.router;
    const path = new URL(req.url).pathname;
    const match = router?.lookup(path, req.method);
    if (!match)
      return new Response(`No HttpAction routed for ${path}`, { status: 404 });
    const [endpoint, method, routePath] = match;
    const handler = endpoint._handler ?? endpoint;
    const { result } = await this.invoke(
      "http",
      `http ${method} ${routePath}`,
      req,
      { identity: null, top: true, via, handler },
    );
    return result as Response;
  }
}

async function flushApps(
  apps: FakeApp[],
  untilMs: number,
): Promise<ScheduledItem[]> {
  const ran: ScheduledItem[] = [];
  for (let guard = 0; ; guard++) {
    if (guard > 10_000)
      throw new Error(
        "flushScheduled: over 10,000 runs; a function probably reschedules itself",
      );
    let next: { app: FakeApp; item: ScheduledItem } | null = null;
    for (const app of apps)
      for (const item of app.pending())
        if (item.at <= untilMs && (!next || item.at < next.item.at))
          next = { app, item };
    if (!next) break;
    if (next.item.at > Date.now()) setNow(next.item.at);
    await next.app.runScheduled(next.item);
    ran.push(next.item);
  }
  if (untilMs > Date.now()) setNow(untilMs);
  return ran;
}

// ------------------------------------------------------------------ public

/**
 * Load an app's convex/ folder (default: the app this file is in) into a
 * fresh in-memory deployment. Modules load once per process.
 */
export async function makeApp(
  convexDir: string = resolve(HERE, "../../convex"),
  opts: MakeAppOptions = {},
): Promise<FakeApp> {
  installGlobals();
  const dir = resolve(convexDir);
  const name = opts.name ?? appNameOf(dir);
  if (!name)
    throw new Error(`makeApp: cannot tell which app ${dir} is; pass { name }`);
  const env = { ...defaultEnv(name), ...(opts.env ?? {}) };
  const w = world();
  let registry = w.registries.get(dir);
  if (!registry) {
    registry = loadRegistry(dir, { ...env });
    w.registries.set(dir, registry);
  }
  const app = new FakeApp(name, await registry, env, opts.validate !== false);
  w.sites.set(new URL(app.siteUrl).origin, app);
  return app;
}

export type Linked = {
  apps: FakeApp[];
  meter: {
    mark(): Map<FakeApp, MeterMark>;
    /** Summed over the apps; `calls` keys are "[app] function". */
    since(mark: Map<FakeApp, MeterMark>): MeterDelta & {
      byApp: Partial<Record<AppName, MeterDelta>>;
    };
  };
  flushScheduled(untilMs?: number): Promise<ScheduledItem[]>;
};

/**
 * Route each app's site URL to that app, so bridge calls between them run
 * for real. The latest app made or linked for a site URL answers it.
 */
export function linkApps(apps: Partial<Record<AppName, FakeApp>>): Linked {
  const list = Object.values(apps).filter((a): a is FakeApp => !!a);
  for (const app of list) world().sites.set(new URL(app.siteUrl).origin, app);
  return {
    apps: list,
    meter: {
      mark: () => new Map(list.map(a => [a, a.meter.mark()])),
      since: mark => {
        const sum = zeroDelta();
        const byApp: Partial<Record<AppName, MeterDelta>> = {};
        for (const app of list) {
          const m = mark.get(app);
          const d = m ? app.meter.since(m) : app.meter.total;
          byApp[app.name] = d;
          for (const [k, v] of Object.entries(d.calls))
            sum.calls[`[${app.name}] ${k}`] = v;
          for (const [k, v] of Object.entries(d.writes))
            sum.writes[`[${app.name}] ${k}`] = v;
          sum.totalCalls += d.totalCalls;
          sum.docsRead += d.docsRead;
          sum.bytesRead += d.bytesRead;
          sum.docsWritten += d.docsWritten;
          sum.bytesWritten += d.bytesWritten;
          sum.egressBytes += d.egressBytes;
          sum.fetches += d.fetches;
          sum.reruns += d.reruns;
          sum.scheduled += d.scheduled;
        }
        return { ...sum, byApp };
      },
    },
    flushScheduled: (untilMs = Date.now()) => flushApps(list, untilMs),
  };
}
