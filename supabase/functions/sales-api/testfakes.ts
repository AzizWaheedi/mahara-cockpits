// Test fakes for the live-call modules (not a test file itself; not imported
// by index.ts, so never deployed). A small PostgREST over in-memory tables
// that keeps the rules the real schema keeps and the modules lean on: unique
// keys (by constraint name), partial unique indexes, the rooms guard (version
// up by one on a state change, finished rooms never move, the code picked
// when left out), the event lease, the handover claim and alerts. Plus a
// HighLevel router, a clock that sleep() moves, and background work the test
// can wait for.

import { DbError, type DbInit, GhlError, type LiveIO } from "./liveio.ts";

type Row = Record<string, unknown>;

interface Unique {
  name: string;
  cols: string[];
  where?: (r: Row) => boolean;
}

const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];
const FINAL = ["ended", "expired", "failed", "cancelled"];

const UNIQUES: Record<string, Unique[]> = {
  cockpit_sales_rooms: [
    { name: "cockpit_sales_rooms_pkey", cols: ["id"] },
    { name: "cockpit_sales_rooms_request_id_key", cols: ["request_id"] },
    { name: "cockpit_sales_rooms_code_key", cols: ["code"] },
    { name: "cockpit_sales_rooms_one_per_lead", cols: ["contact_id"], where: r => LIVE.includes(String(r.state)) && r.contact_id != null },
    { name: "cockpit_sales_rooms_one_per_host", cols: ["host_email"], where: r => LIVE.includes(String(r.state)) && r.purpose !== "booked" },
  ],
  cockpit_sales_room_events: [
    { name: "cockpit_sales_room_events_pkey", cols: ["id"] },
    { name: "cockpit_sales_room_events_dedupe_key_key", cols: ["dedupe_key"] },
  ],
  cockpit_sales_messages: [{ name: "cockpit_sales_messages_request_id_key", cols: ["request_id"] }],
  cockpit_sales_settings: [{ name: "cockpit_sales_settings_pkey", cols: ["key"] }],
  cockpit_sales_availability: [{ name: "cockpit_sales_availability_pkey", cols: ["email"] }],
  cockpit_sales_followup_meta: [{ name: "cockpit_sales_followup_meta_pkey", cols: ["followup_id"] }],
  cockpit_sales_followup_levels: [{ name: "cockpit_sales_followup_levels_pkey", cols: ["kind_key"] }],
  cockpit_sales_followup_waves: [
    { name: "cockpit_sales_followup_waves_pkey", cols: ["id"] },
    { name: "cockpit_sales_followup_waves_one_running_pool", cols: ["pool"], where: r => ["running", "paused"].includes(String(r.state)) },
  ],
  cockpit_sales_followup_stops: [{ name: "cockpit_sales_followup_stops_pkey", cols: ["contact_id", "said_at"] }],
  cockpit_sales_alerts: [{ name: "cockpit_sales_alerts_dedupe_key_key", cols: ["dedupe_key"] }],
  cockpit_sales_live: [
    { name: "cockpit_sales_live_pkey", cols: ["id"] },
    { name: "cockpit_sales_live_one_claim_per_closer", cols: ["claimed_by"], where: r => ["claimed", "room_ready", "lead_joined"].includes(String(r.state)) },
  ],
};

let seq = 0;
export function fakeUuid(): string {
  seq++;
  const h = seq.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function cmp(stored: unknown, given: string): number {
  if (stored === null || stored === undefined) return Number.NaN;
  if (typeof stored === "number") return stored - Number(given);
  const s = String(stored);
  if (ISO.test(s) && ISO.test(given)) return Date.parse(s) - Date.parse(given);
  return s < given ? -1 : s > given ? 1 : 0;
}

function parseList(v: string): string[] {
  const inner = v.replace(/^[({]/, "").replace(/[)}]$/, "");
  if (!inner) return [];
  return inner.split(",").map(x => x.replace(/^"|"$/g, ""));
}

function match(row: Row, col: string, expr: string): boolean {
  const neg = expr.startsWith("not.");
  const e = neg ? expr.slice(4) : expr;
  const dot = e.indexOf(".");
  const op = e.slice(0, dot);
  const val = e.slice(dot + 1);
  const v = row[col];
  let ok: boolean;
  switch (op) {
    case "eq":
      if (Array.isArray(v)) ok = JSON.stringify(v) === JSON.stringify(parseList(val));
      else if (typeof v === "boolean") ok = String(v) === val;
      else ok = v !== null && v !== undefined && cmp(v, val) === 0;
      break;
    case "neq":
      ok = v !== null && v !== undefined && cmp(v, val) !== 0;
      break;
    case "gt":
      ok = cmp(v, val) > 0;
      break;
    case "gte":
      ok = cmp(v, val) >= 0;
      break;
    case "lt":
      ok = cmp(v, val) < 0;
      break;
    case "lte":
      ok = cmp(v, val) <= 0;
      break;
    case "is":
      ok = val === "null" ? v === null || v === undefined : String(v) === val;
      break;
    case "in":
      ok = v !== null && v !== undefined && parseList(val).includes(String(v));
      break;
    case "cs":
      ok = Array.isArray(v) && parseList(val).every(x => (v as unknown[]).map(String).includes(x));
      break;
    default:
      throw new Error(`fake db: unknown operator ${op}`);
  }
  return neg ? !ok : ok;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  calls: { method: string; path: string; body?: unknown }[] = [];
  /** Throw this error on the next call whose path starts with the key (a database fault). */
  faults: { prefix: string; method?: string; error: Error; times: number }[] = [];
  /** Runs before a PATCH lands, for interleaving a second writer. */
  beforePatch: ((table: string, rows: Row[]) => void) | null = null;
  rpcs: Record<string, (args: Row) => unknown> = {};

  constructor(public clock: { now: number }) {
    this.rpcs.cockpit_sales_room_event_lease = a => this.lease(a);
    this.rpcs.cockpit_sales_alert_set = a => this.alertSet(a);
    this.rpcs.cockpit_sales_live_claim = a => this.liveClaim(a);
  }

  t(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name] as Row[];
  }
  seed(name: string, rows: Row[]): void {
    for (const r of rows) this.insertOne(name, { ...r }, "error");
  }
  iso(): string {
    return new Date(this.clock.now).toISOString();
  }

  private fault(method: string, path: string): void {
    const f = this.faults.find(x => path.startsWith(x.prefix) && (!x.method || x.method === method) && x.times > 0);
    if (f) {
      f.times--;
      throw f.error;
    }
  }

  private defaults(table: string, r: Row): Row {
    const now = this.iso();
    if (r.id === undefined && !["cockpit_sales_settings", "cockpit_sales_availability", "cockpit_sales_followup_meta", "cockpit_sales_followup_levels", "cockpit_sales_followup_stops", "cockpit_sales_room_hosts", "cockpit_sales_people"].includes(table))
      r.id = fakeUuid();
    if (table === "cockpit_sales_rooms") {
      r.state ??= "requested";
      r.version ??= 1;
      r.requested_at ??= now;
      r.created_at ??= now;
      r.link_channels ??= [];
      r.link_message_ids ??= {};
      r.send_on ??= "open";
      if (r.code === undefined || r.code === null) r.code = this.code();
    }
    if (table === "cockpit_sales_room_events") {
      r.at ??= now;
      r.tries ??= 0;
      r.detail ??= {};
      r.handled_at ??= null;
      r.lease_until ??= null;
    }
    if (table === "cockpit_sales_messages") {
      r.created_at ??= now;
      r.state ??= "sending";
    }
    if (table === "cockpit_sales_live") {
      r.version ??= 1;
      r.state ??= "offered";
      r.declined_by ??= [];
      r.offered_to ??= [];
      r.reoffers ??= 0;
    }
    if (table === "cockpit_sales_followup_waves") {
      r.version ??= 1;
      r.created_at ??= now;
      r.state ??= "draft";
      if (r.state === "running") r.started_at ??= now;
    }
    if (table === "cockpit_sales_availability") r.updated_at = now;
    return r;
  }

  private codeN = 0;
  private code(): string {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let n = ++this.codeN;
    let out = "";
    for (let i = 0; i < 6; i++) {
      out = A[n % 32] + out;
      n = Math.floor(n / 32);
    }
    return out;
  }

  private checkUnique(table: string, row: Row, skip?: Row): void {
    for (const u of UNIQUES[table] ?? []) {
      if (u.where && !u.where(row)) continue;
      if (u.cols.some(c => row[c] === null || row[c] === undefined)) continue;
      const clash = this.t(table).find(
        x => x !== skip && (!u.where || u.where(x)) && u.cols.every(c => String(x[c]) === String(row[c])),
      );
      if (clash)
        throw new DbError(`database 409: duplicate key value violates unique constraint "${u.name}"`, 409, "23505", u.name);
    }
  }

  private conflictTarget(table: string, onConflict: string | null, row: Row): Row | undefined {
    if (!onConflict) return undefined;
    const cols = onConflict.split(",");
    return this.t(table).find(x => cols.every(c => String(x[c]) === String(row[c])));
  }

  insertOne(table: string, body: Row, resolution: "error" | "ignore" | "merge", onConflict: string | null = null): Row | null {
    const row = this.defaults(table, { ...body });
    const target = this.conflictTarget(table, onConflict, row);
    if (target) {
      if (resolution === "ignore") return null;
      if (resolution === "merge") {
        const next = { ...target, ...body };
        this.guard(table, target, next);
        this.checkUnique(table, next, target);
        Object.assign(target, next);
        return target;
      }
    }
    this.checkUnique(table, row);
    this.t(table).push(row);
    return row;
  }

  /** The triggers the modules lean on. */
  private guard(table: string, old: Row, next: Row): void {
    if (table === "cockpit_sales_rooms") {
      if (next.state !== old.state || next.version !== old.version) next.version = Number(old.version) + 1;
      if (next.state !== old.state) {
        if (FINAL.includes(String(old.state)))
          throw new DbError(`database 400: Room ${old.code} has already ${old.state}.`, 400, "P0001");
        if (FINAL.includes(String(next.state)) && !next.ended_at) next.ended_at = this.iso();
        if (next.state === "open" && !next.opened_at) next.opened_at = this.iso();
        if ((next.state === "host_in" || next.state === "lead_in") && !next.host_in_at) next.host_in_at = this.iso();
      }
    }
    if (table === "cockpit_sales_followup_waves" && next.state !== old.state) {
      if (["done", "cancelled"].includes(String(old.state))) throw new DbError("database 400: This wave has already ended.", 400, "P0001");
      if (["done", "cancelled"].includes(String(next.state))) next.ended_at ??= this.iso();
    }
  }

  private query(path: string): { table: string; filters: [string, string][]; params: Record<string, string> } {
    const q = path.indexOf("?");
    const table = q < 0 ? path : path.slice(0, q);
    const filters: [string, string][] = [];
    const params: Record<string, string> = {};
    if (q >= 0)
      for (const part of path.slice(q + 1).split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const k = part.slice(0, eq);
        const v = decodeURIComponent(part.slice(eq + 1));
        if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) params[k] = v;
        else filters.push([k, v]);
      }
    return { table, filters, params };
  }

  private pick(table: string, filters: [string, string][]): Row[] {
    return this.t(table).filter(r => filters.every(([c, e]) => match(r, c, e)));
  }

  async db(path: string, init: DbInit = {}): Promise<Row[]> {
    const method = init.method ?? "GET";
    this.calls.push({ method, path, body: init.body });
    this.fault(method, path);
    const { table, filters, params } = this.query(path);
    const prefer = init.prefer ?? "";
    if (method === "GET") {
      let rows = this.pick(table, filters).map(r => ({ ...r }));
      if (params.order) {
        const [col, dir] = params.order.split(".");
        rows.sort((a, b) => {
          const x = a[col as string];
          const y = b[col as string];
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          const c = cmp(x, String(y));
          return dir === "desc" ? -c : c;
        });
      }
      const off = Number(params.offset ?? 0);
      if (params.limit) rows = rows.slice(off, off + Number(params.limit));
      return structuredClone(rows);
    }
    if (method === "POST") {
      const list = Array.isArray(init.body) ? (init.body as Row[]) : [init.body as Row];
      const resolution = /ignore-duplicates/.test(prefer) ? "ignore" : /merge-duplicates/.test(prefer) ? "merge" : "error";
      const out: Row[] = [];
      for (const b of list) {
        const r = this.insertOne(table, structuredClone(b), resolution, params.on_conflict ?? null);
        if (r) out.push(r);
      }
      return /return=representation/.test(prefer) ? structuredClone(out) : [];
    }
    if (method === "PATCH") {
      const rows = this.pick(table, filters);
      if (this.beforePatch) {
        const hook = this.beforePatch;
        this.beforePatch = null;
        hook(table, rows);
      }
      const still = rows.filter(r => filters.every(([c, e]) => match(r, c, e)));
      const out: Row[] = [];
      for (const r of still) {
        const next = { ...r, ...structuredClone(init.body as Row) };
        this.guard(table, r, next);
        this.checkUnique(table, next, r);
        Object.assign(r, next);
        out.push(r);
      }
      return /return=representation/.test(prefer) ? structuredClone(out) : [];
    }
    if (method === "DELETE") {
      const gone = new Set(this.pick(table, filters));
      this.tables[table] = this.t(table).filter(r => !gone.has(r));
      return [];
    }
    throw new Error(`fake db: ${method}`);
  }

  async rpc(fn: string, args: Row): Promise<unknown> {
    this.calls.push({ method: "RPC", path: fn, body: args });
    this.fault("RPC", fn);
    const f = this.rpcs[fn];
    if (!f) throw new DbError(`database 404: no function ${fn}`, 404, "PGRST202");
    return f(args);
  }

  /** cockpit_sales_room_event_lease: one caller holds an event at a time. */
  lease(a: Row): string | null {
    const e = this.t("cockpit_sales_room_events").find(
      x =>
        (!a.p_event_id || x.id === a.p_event_id) &&
        (!a.p_dedupe_key || x.dedupe_key === a.p_dedupe_key) &&
        (a.p_event_id || a.p_dedupe_key) &&
        !x.handled_at &&
        (!x.lease_until || Date.parse(String(x.lease_until)) <= this.clock.now),
    );
    if (!e) return null;
    e.lease_until = new Date(this.clock.now + Math.min(600, Math.max(1, Number(a.p_seconds ?? 60))) * 1000).toISOString();
    return String(e.id);
  }

  alertSet(a: Row): number {
    const list = this.t("cockpit_sales_alerts");
    const cur = list.find(x => x.dedupe_key === a.p_key && !x.resolved_at);
    if (a.p_on) {
      if (cur) {
        cur.last_seen_at = this.iso();
        return 0;
      }
      list.push({ id: fakeUuid(), dedupe_key: a.p_key, kind: a.p_kind, subject: a.p_subject, message: a.p_message, detail: a.p_detail, raised_at: this.iso() });
      return 1;
    }
    if (cur) cur.resolved_at = this.iso();
    return 0;
  }

  /** The claim, as cockpit_sales_live_claim decides it (standby adoption and the five claim_room cases, simplified). */
  liveClaim(a: Row): Row[] {
    const me = String(a.p_email).toLowerCase();
    const l = this.t("cockpit_sales_live").find(x => x.id === a.p_live_id);
    if (!l || l.state !== "offered" || Date.parse(String(l.offer_until)) <= this.clock.now || !(l.offered_to as string[]).includes(me)) return [];
    if (this.t("cockpit_sales_live").some(x => x !== l && x.claimed_by === me && ["claimed", "room_ready", "lead_joined"].includes(String(x.state))))
      throw new DbError('database 409: duplicate key value violates unique constraint "cockpit_sales_live_one_claim_per_closer"', 409, "23505", "cockpit_sales_live_one_claim_per_closer");
    l.state = "claimed";
    l.claimed_by = me;
    l.version = Number(l.version) + 1;
    const rooms = this.t("cockpit_sales_rooms");
    const lr = rooms.find(x => x.contact_id === l.contact_id && LIVE.includes(String(x.state)));
    let via = "none";
    if (lr && lr.state === "lead_in") {
      via = "lead_room";
      l.room_id = lr.id;
      l.state = "lead_joined";
    } else if (lr && lr.purpose === "booked") via = "busy";
    else if (lr && lr.host_email === me) {
      via = "own_room";
      l.room_id = lr.id;
    } else {
      if (lr) {
        lr.state = "cancelled";
        lr.result = "cancelled";
        lr.end_reason = "replaced";
        lr.ended_at = this.iso();
        lr.version = Number(lr.version) + 1;
      }
      const sb = rooms.find(x => x.host_email === me && x.purpose === "standby" && !x.contact_id && LIVE.includes(String(x.state)));
      if (sb) {
        Object.assign(sb, {
          contact_id: l.contact_id,
          purpose: "handover",
          handover_id: l.id,
          call_kind: l.kind,
          send_on: sb.state === "host_in" ? "open" : "host_in",
          lead_by: new Date(this.clock.now + 600_000).toISOString(),
          version: Number(sb.version) + 1,
        });
        via = "standby";
        l.room_id = sb.id;
        if (sb.state === "host_in") l.state = "room_ready";
      }
    }
    l.claim_room = via;
    this.insertOne("cockpit_sales_room_events", {
      room_id: l.room_id ?? null,
      kind: "live.claimed",
      source: "claim",
      dedupe_key: `live.claimed:${l.id}:${l.reoffers}`,
      lease_until: new Date(this.clock.now + 60_000).toISOString(),
      text: "A closer took this lead live.",
      detail: { handover_id: l.id, claim_room: via },
    }, "ignore", "dedupe_key");
    return [structuredClone(l)];
  }
}

export type GhlRoute = (method: string, path: string, body: unknown) => Row | Promise<Row>;

/** The whole fake outside world: io for the modules, plus the knobs a test turns. */
export function fakeWorld(start = Date.parse("2026-10-04T07:00:00Z")) {
  const clock = { now: start };
  const db = new FakeDb(clock);
  const ghlCalls: { method: string; path: string; body: unknown }[] = [];
  const routes: GhlRoute[] = [];
  const pending: Promise<unknown>[] = [];
  const logs: string[] = [];
  const io: LiveIO = {
    now: () => clock.now,
    uuid: () => fakeUuid(),
    sleep: async ms => {
      clock.now += ms;
    },
    background: p => {
      pending.push(p.catch(e => logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
    },
    db: (path, init) => db.db(path, init),
    rpc: (fn, args) => db.rpc(fn, args),
    ghl: async (method, path, body) => {
      ghlCalls.push({ method, path, body });
      for (const r of routes) {
        const out = await r(method, path, body);
        if (out) return out;
      }
      throw new GhlError(`HighLevel said 404: no fake for ${method} ${path}`, 404);
    },
    log: m => logs.push(m),
  };
  /** Waits for every background job, including those started by background jobs. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 20 && pending.length; i++) {
      const now = pending.splice(0);
      await Promise.all(now);
    }
  }
  return { clock, db, io, ghlCalls, routes, logs, flush };
}
