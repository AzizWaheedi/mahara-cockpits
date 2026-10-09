/**
 * Test helpers: a runner that works under `deno test` and `bun test`, an
 * in-memory Store, and a fetch that answers from a route table and records
 * every call. Nothing here touches a network or a database.
 */

import { makeCtx } from "./context.ts";
import type { HealthRow } from "./providers.ts";
import type { AuditRow, Job, Row, SendRow, Store, Trigger } from "./store.ts";

type Fn = () => void | Promise<void>;
const D = (globalThis as { Deno?: { test: (name: string, fn: Fn) => void } }).Deno;
const bunTest = "bun:test";
export const test: (name: string, fn: Fn) => void = D
  ? (name, fn) => D.test(name, fn)
  : ((await import(bunTest)) as { test: (name: string, fn: Fn) => void }).test;

const fmt = (v: unknown) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
function deepEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.hasOwn(b as object, k) && deepEq((a as Row)[k], (b as Row)[k]));
}
const fail = (msg: string | undefined, detail: string): never => {
  throw new Error(msg ? `${msg}: ${detail}` : detail);
};

/** The few assertions these tests need, with no package behind them. */
export const assert = {
  ok(v: unknown, msg?: string) {
    if (!v) fail(msg, `expected a true value, got ${fmt(v)}`);
  },
  equal(a: unknown, b: unknown, msg?: string) {
    if (!Object.is(a, b)) fail(msg, `expected ${fmt(b)}, got ${fmt(a)}`);
  },
  deepEqual(a: unknown, b: unknown, msg?: string) {
    if (!deepEq(a, b)) fail(msg, `expected ${fmt(b)}, got ${fmt(a)}`);
  },
  match(s: string, re: RegExp, msg?: string) {
    if (!re.test(s)) fail(msg, `${fmt(s)} does not match ${re}`);
  },
  async rejects(
    p: Promise<unknown>,
    check?: RegExp | (new (...a: never[]) => Error) | ((e: never) => boolean),
  ) {
    try {
      await p;
    } catch (e) {
      if (!check) return;
      if (check instanceof RegExp) {
        if (!check.test(String((e as Error)?.message))) fail(undefined, `${fmt((e as Error)?.message)} does not match ${check}`);
      } else if (check.prototype instanceof Error || check === Error) {
        if (!(e instanceof (check as new () => Error))) fail(undefined, `wrong error type: ${(e as Error)?.message}`);
      } else if (!(check as (e: unknown) => boolean)(e)) fail(undefined, `error rejected by check: ${(e as Error)?.message}`);
      return;
    }
    fail(undefined, "expected a rejection");
  },
};

export class FakeStore implements Store {
  meta = new Map<string, unknown>();
  cands = new Map<string, Row>();
  events: Row[] = [];
  applications: Row[] = [];
  runs: Row[] = [];
  state = new Map<string, Row>();
  healthRows: Row[] = [];
  audits: AuditRow[] = [];
  sends: Row[] = [];
  /** Set to make claimSend behave as if another send holds the draft. */
  sendConflict = false;
  failAudit = false;

  getMeta(key: string) {
    return Promise.resolve(this.meta.has(key) ? structuredClone(this.meta.get(key)) : null);
  }
  putMeta(key: string, value: unknown) {
    this.meta.set(key, structuredClone(value));
    return Promise.resolve();
  }
  candidates() {
    return Promise.resolve([...this.cands.values()].map(r => ({ ...r })));
  }
  candidate(id: string) {
    const r = this.cands.get(id);
    return Promise.resolve(r ? { ...r } : null);
  }
  candidatesByIds(ids: string[]) {
    return Promise.resolve(ids.map(i => this.cands.get(i)).filter(Boolean).map(r => ({ ...r! })));
  }
  upsertCandidates(rows: Row[]) {
    for (const r of rows) this.cands.set(r.id, { ...(this.cands.get(r.id) ?? {}), ...r });
    return Promise.resolve();
  }
  patchCandidate(id: string, patch: Row) {
    const r = this.cands.get(id);
    if (r) this.cands.set(id, { ...r, ...patch });
    return Promise.resolve();
  }
  insertEvents(rows: Row[]) {
    for (const r of rows) {
      if (!this.cands.has(r.candidate_id)) throw new Error("foreign key: no such candidate");
      this.events.push({ id: this.events.length + 1, ok: true, at: new Date().toISOString(), from_stage: null, ...r });
    }
    return Promise.resolve();
  }
  stageMoves(limit: number) {
    return Promise.resolve(
      this.events.filter(e => e.kind === "stage" && e.from_stage !== null).reverse().slice(0, limit),
    );
  }
  actedOrDrafted() {
    return Promise.resolve(
      this.events.filter(e => e.kind === "action" && (e.ok === true || String(e.detail ?? "").startsWith("Drafted"))),
    );
  }
  drafts(limit: number) {
    return Promise.resolve(
      this.events
        .filter(e => e.kind === "action" && e.ok === false && String(e.detail ?? "").startsWith("Drafted"))
        .reverse()
        .slice(0, limit),
    );
  }
  event(id: number) {
    const e = this.events.find(x => x.id === id);
    return Promise.resolve(e ? { ...e } : null);
  }
  patchEvent(id: number, patch: Row) {
    const i = this.events.findIndex(x => x.id === id);
    if (i >= 0) this.events[i] = { ...this.events[i], ...patch };
    return Promise.resolve();
  }
  upsertApplication(row: Row) {
    this.applications.push(row);
    return Promise.resolve();
  }
  claimRun(job: Job, trigger: Trigger, actor: string | null, apply: boolean) {
    if (this.runs.some(r => r.job === job && r.status === "running")) return Promise.resolve(null);
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ id, job, trigger, actor, apply, status: "running" });
    return Promise.resolve(id);
  }
  finishRun(id: string, status: "ok" | "failed", result: unknown, error: string | null) {
    const r = this.runs.find(x => x.id === id);
    if (r) Object.assign(r, { status, result, error });
    return Promise.resolve();
  }
  syncState(key: string, patch: Row) {
    this.state.set(key, { ...(this.state.get(key) ?? {}), ...patch });
    return Promise.resolve();
  }
  health(row: HealthRow & { run_id: string | null; actor_email: string | null }) {
    this.healthRows.push(row);
    return Promise.resolve();
  }
  audit(row: AuditRow) {
    if (this.failAudit) return Promise.reject(new Error("audit store down"));
    this.audits.push(row);
    return Promise.resolve();
  }
  liveSends(ids: number[]) {
    return Promise.resolve(
      this.sends.filter(s => ids.includes(s.event_id) && ["claimed", "sent"].includes(s.status)).map(s => s.event_id),
    );
  }
  claimSend(row: SendRow) {
    if (this.sendConflict || this.sends.some(s => s.event_id === row.event_id && ["claimed", "sent"].includes(s.status)))
      return Promise.resolve(null);
    const id = this.sends.length + 1;
    this.sends.push({ id, ...row });
    return Promise.resolve(id);
  }
  recordSend(row: SendRow) {
    this.sends.push({ id: this.sends.length + 1, ...row });
    return Promise.resolve();
  }
  finishSend(id: number, patch: Row) {
    const s = this.sends.find(x => x.id === id && x.status === "claimed");
    if (s) Object.assign(s, patch);
    return Promise.resolve();
  }
}

export type Call = { method: string; url: string; body: unknown };
type Route = [method: string, match: RegExp, answer: (call: Call) => { status?: number; body?: unknown }];

/** A fetch that answers from routes; an unrouted call fails the test loudly. */
export function fakeFetch(routes: Route[]) {
  const calls: Call[] = [];
  const f = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { method, url, body };
    calls.push(call);
    const route = routes.find(([m, re]) => m === method && re.test(url));
    if (!route) return Promise.reject(new Error(`unrouted ${method} ${url}`));
    const a = route[2](call);
    return Promise.resolve(
      new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status ?? 200 }),
    );
  };
  return { fetch: f as typeof fetch, calls };
}

/** The hiring board as GoHighLevel describes it, for meta. */
export const PIPELINES = {
  pipelines: [
    {
      id: "p-mb",
      name: "Media buyer",
      stages: [
        { id: "s-app", name: "Application" },
        { id: "s-loom", name: "Case studies" },
        { id: "s-group", name: "Group interview" },
        { id: "s-121", name: "One to one interview" },
        { id: "s-dq", name: "Disqualified" },
      ],
    },
  ],
};
export const CUSTOM_FIELDS = {
  customFields: [
    { id: "f-role", name: "Role applied for" },
    { id: "f-s1", name: "Score 1, application" },
    { id: "f-s2", name: "Score 2, Loom" },
    { id: "f-total", name: "Score 6, total" },
    { id: "f-notes", name: "Interview notes" },
    { id: "f-years", name: "Years of experience" },
  ],
};

/** Routes every GoHighLevel read a job needs; writes are added per test. */
export const ghlReads: Route[] = [
  ["GET", /\/opportunities\/pipelines\?/, () => ({ body: PIPELINES })],
  ["GET", /\/customFields\?model=contact/, () => ({ body: CUSTOM_FIELDS })],
  ["GET", /\/customValues$/, () => ({
    body: {
      customValues: [
        { name: "Hiring - Group interview booking link", value: "https://book.example/group" },
        { name: "Hiring - One-to-one booking link", value: "https://book.example/121" },
      ],
    },
  })],
];

export const ENV_BASE: Record<string, string> = {
  GHL_HIRING_PIT: "pit-00000000-0000-0000-0000-000000000000",
  GHL_HIRING_LOCATION: "loc-1",
  TYPEFORM_TOKEN: "tfp_testtoken_123456",
};

export function ctxFor(
  store: FakeStore,
  f: typeof fetch,
  env: Record<string, string> = {},
  actor: string | null = "aziz@maharamedia.com",
) {
  const all = { ...ENV_BASE, ...env };
  return makeCtx({
    env: n => all[n],
    store,
    actor,
    fetch: f,
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-10-09T12:00:00Z"),
  });
}

/** One candidate row as the mirror holds it. */
export const held = (over: Row = {}): Row => ({
  id: "opp-1",
  contact_id: "c-1",
  location_id: "loc-1",
  role: "media-buyer",
  role_label: "Media buyer",
  pipeline_id: "p-mb",
  stage: "application",
  stage_name: "Application",
  name: "Sara Ali",
  stage_since: "2026-10-01T00:00:00.000Z",
  exited_at: null,
  score_application: null,
  score_loom: null,
  score_group: null,
  score_one_to_one: null,
  score_test_project: null,
  notes: null,
  ...over,
});
