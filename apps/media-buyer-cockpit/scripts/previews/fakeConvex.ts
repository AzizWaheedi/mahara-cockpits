/**
 * A small in-memory stand-in for a Convex deployment, for bun tests only.
 *
 * Runs the real registered handlers (`func._handler`) with a fake ctx:
 * tables with the schema's real indexes, argument / return / schema
 * validation from the real validators, file storage, a scheduler that only
 * records, and a function-call counter. Mutations roll back on throw.
 */

import schema from "../../convex/schema.ts";
import { getFunctionName } from "../../node_modules/convex/dist/esm/server/index.js";

// biome-ignore lint/suspicious/noExplicitAny: test harness
type Any = any;

// ---------------------------------------------------------------- values

/** Convex serialisation: drop undefined object fields, refuse undefined elsewhere. */
export function wire(value: Any, path = "value"): Any {
  if (value === undefined)
    throw new Error(`${path}: undefined is not a Convex value`);
  if (value === null || typeof value !== "object") {
    if (
      typeof value === "number" &&
      !Number.isFinite(value) &&
      !Number.isNaN(value)
    )
      return value;
    if (typeof value === "function") throw new Error(`${path}: function`);
    return value;
  }
  if (value instanceof ArrayBuffer) return value;
  if (Array.isArray(value))
    return value.map((x, i) => wire(x, `${path}[${i}]`));
  const out: Record<string, Any> = {};
  for (const [k, x] of Object.entries(value)) {
    if (x === undefined) continue;
    out[k] = wire(x, `${path}.${k}`);
  }
  return out;
}

export function checkValue(json: Any, value: Any, path = "value"): void {
  const fail = (why: string) => {
    throw new Error(
      `${path}: ${why} (validator ${json.type}, got ${JSON.stringify(value)?.slice(0, 120)})`,
    );
  };
  switch (json.type) {
    case "any":
      return;
    case "null":
      if (value !== null) fail("expected null");
      return;
    case "number":
    case "float64":
      if (typeof value !== "number") fail("expected number");
      return;
    case "bigint":
    case "int64":
      if (typeof value !== "bigint") fail("expected bigint");
      return;
    case "boolean":
      if (typeof value !== "boolean") fail("expected boolean");
      return;
    case "string":
      if (typeof value !== "string") fail("expected string");
      return;
    case "bytes":
      if (!(value instanceof ArrayBuffer)) fail("expected bytes");
      return;
    case "id":
      if (typeof value !== "string" || !value.startsWith(`${json.tableName}~`))
        fail(`expected id of ${json.tableName}`);
      return;
    case "literal":
      if (value !== json.value) fail(`expected literal ${json.value}`);
      return;
    case "array":
      if (!Array.isArray(value)) fail("expected array");
      value.forEach((x: Any, i: number) => {
        checkValue(json.value, x, `${path}[${i}]`);
      });
      return;
    case "record":
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail("expected record");
      for (const [k, x] of Object.entries(value)) {
        checkValue(json.keys, k, `${path} key`);
        checkValue(json.values.fieldType, x, `${path}.${k}`);
      }
      return;
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail("expected object");
      for (const [k, spec] of Object.entries<Any>(json.value)) {
        const x = value[k];
        if (x === undefined) {
          if (!spec.optional) fail(`missing required field ${k}`);
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
      fail(`no union member matched: ${errors.join(" / ").slice(0, 300)}`);
      return;
    }
    default:
      throw new Error(
        `${path}: validator type ${json.type} not supported here`,
      );
  }
}

function cmp(a: Any, b: Any): number {
  const rank = (x: Any) =>
    x === undefined
      ? 0
      : x === null
        ? 1
        : typeof x === "bigint"
          ? 2
          : typeof x === "number"
            ? 3
            : typeof x === "boolean"
              ? 4
              : typeof x === "string"
                ? 5
                : 6;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a === b || ra <= 1) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- database

const TABLES: Record<string, Any> = (schema as Any).tables;

function indexFields(table: string, name: string): string[] {
  if (name === "by_creation_time") return ["_creationTime"];
  if (name === "by_id") return ["_id"];
  const def = TABLES[table];
  if (!def) throw new Error(`no table ${table} in schema`);
  const idx = (def.indexes as Any[]).find(i => i.indexDescriptor === name);
  if (!idx) throw new Error(`no index ${table}.${name} in schema`);
  return idx.fields;
}

type Op = { kind: string; field: string; value: Any };

class RangeBuilder {
  ops: Op[] = [];
  eq(field: string, value: Any) {
    this.ops.push({ kind: "eq", field, value });
    return this;
  }
  gt(field: string, value: Any) {
    this.ops.push({ kind: "gt", field, value });
    return this;
  }
  gte(field: string, value: Any) {
    this.ops.push({ kind: "gte", field, value });
    return this;
  }
  lt(field: string, value: Any) {
    this.ops.push({ kind: "lt", field, value });
    return this;
  }
  lte(field: string, value: Any) {
    this.ops.push({ kind: "lte", field, value });
    return this;
  }
}

class FilterBuilder {
  field(name: string) {
    return (r: Any) => r[name];
  }
  eq(a: Any, b: Any) {
    return (r: Any) =>
      cmp(
        typeof a === "function" ? a(r) : a,
        typeof b === "function" ? b(r) : b,
      ) === 0;
  }
}

export class FakeQuery {
  private sort: string[] = ["_creationTime"];
  private ops: Op[] = [];
  private dir: "asc" | "desc" = "asc";
  private filters: ((r: Any) => boolean)[] = [];
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  withIndex(name: string, fn?: (q: RangeBuilder) => Any) {
    const fields = indexFields(this.table, name);
    this.sort = [...fields, "_creationTime"];
    if (fn) {
      const b = new RangeBuilder();
      fn(b);
      // Index ranges must follow the index field order: equalities first.
      b.ops.forEach((op, i) => {
        if (op.kind === "eq" && fields[i] !== op.field)
          throw new Error(`index ${name}: eq on ${op.field} out of order`);
        if (op.kind !== "eq" && !fields.includes(op.field))
          throw new Error(`index ${name}: range on ${op.field} not in index`);
      });
      this.ops = b.ops;
    }
    this.db.reads.push(`${this.table}.${name}`);
    return this;
  }
  order(dir: "asc" | "desc") {
    this.dir = dir;
    return this;
  }
  filter(fn: (q: FilterBuilder) => Any) {
    this.filters.push(fn(new FilterBuilder()));
    return this;
  }
  private run(): Any[] {
    const rows = (this.db.tables[this.table] ?? []).filter(
      r =>
        this.ops.every(op => {
          const c = cmp(r[op.field], op.value);
          if (op.kind === "eq") return c === 0;
          if (r[op.field] === undefined) return false;
          if (op.kind === "gt") return c > 0;
          if (op.kind === "gte") return c >= 0;
          if (op.kind === "lt") return c < 0;
          return c <= 0;
        }) && this.filters.every(f => f(r)),
    );
    rows.sort((a, b) => {
      for (const f of this.sort) {
        const c = cmp(a[f], b[f]);
        if (c) return c;
      }
      return 0;
    });
    if (this.dir === "desc") rows.reverse();
    return rows.map(r => structuredClone(r));
  }
  async collect() {
    return this.run();
  }
  async first() {
    return this.run()[0] ?? null;
  }
  async take(n: number) {
    return this.run().slice(0, n);
  }
  async unique() {
    const rows = this.run();
    if (rows.length > 1)
      throw new Error(`unique() found ${rows.length} rows in ${this.table}`);
    return rows[0] ?? null;
  }
}

export class FakeDb {
  tables: Record<string, Any[]> = {};
  seq = 0;
  writes: string[] = [];
  reads: string[] = [];
  private tableOf(id: string) {
    return id.split("~")[0];
  }
  private validate(table: string, doc: Any) {
    const def = TABLES[table];
    if (!def) {
      if (table.startsWith("_")) return;
      throw new Error(`no table ${table}`);
    }
    const { _id, _creationTime, ...rest } = doc;
    checkValue(def.validator.json, rest, `${table} doc`);
  }
  query(table: string) {
    return new FakeQuery(this, table);
  }
  async get(id: string) {
    const row = (this.tables[this.tableOf(id)] ?? []).find(r => r._id === id);
    return row ? structuredClone(row) : null;
  }
  async insert(table: string, doc: Any) {
    const clean = wire(doc, `${table} insert`);
    this.validate(table, clean);
    const _id = `${table}~${++this.seq}`;
    this.tables[table] ??= [];
    this.tables[table].push({
      ...clean,
      _id,
      _creationTime: Date.now() + this.seq / 1000,
    });
    this.writes.push(`insert ${table}`);
    return _id;
  }
  async patch(id: string, fields: Any) {
    const table = this.tableOf(id);
    const row = (this.tables[table] ?? []).find(r => r._id === id);
    if (!row) throw new Error(`patch: no document ${id}`);
    const next = { ...row };
    for (const [k, x] of Object.entries(fields)) {
      if (x === undefined) delete next[k];
      else next[k] = wire(x, `patch ${k}`);
    }
    this.validate(table, next);
    for (const k of Object.keys(row)) delete row[k];
    Object.assign(row, next);
    this.writes.push(`patch ${table}`);
  }
  async replace(id: string, doc: Any) {
    const table = this.tableOf(id);
    const row = (this.tables[table] ?? []).find(r => r._id === id);
    if (!row) throw new Error(`replace: no document ${id}`);
    const clean = wire(doc, `${table} replace`);
    this.validate(table, clean);
    const keep = { _id: row._id, _creationTime: row._creationTime };
    for (const k of Object.keys(row)) delete row[k];
    Object.assign(row, clean, keep);
    this.writes.push(`replace ${table}`);
  }
  async delete(id: string) {
    const table = this.tableOf(id);
    const list = this.tables[table] ?? [];
    const i = list.findIndex(r => r._id === id);
    if (i < 0) throw new Error(`delete: no document ${id}`);
    list.splice(i, 1);
    this.writes.push(`delete ${table}`);
  }
  seed(table: string, docs: Any[]) {
    const ids: string[] = [];
    for (const d of docs) {
      const clean = wire(d);
      this.validate(table, clean);
      const _id = `${table}~${++this.seq}`;
      this.tables[table] ??= [];
      this.tables[table].push({
        ...clean,
        _id,
        _creationTime: Date.now() - 1e6 + this.seq,
      });
      ids.push(_id);
    }
    return ids;
  }
  all(table: string): Any[] {
    return structuredClone(this.tables[table] ?? []);
  }
}

// ---------------------------------------------------------------- storage

export class FakeStorage {
  files = new Map<string, { bytes: number; type: string }>();
  seq = 0;
  deleted: string[] = [];
  base = "https://fake-deployment.convex.cloud/api/storage/";
  async store(blob: Blob) {
    const id = `_storage~${++this.seq}`;
    this.files.set(id, { bytes: blob.size, type: blob.type });
    return id;
  }
  async getUrl(id: string) {
    return this.files.has(id) ? `${this.base}${id.split("~")[1]}` : null;
  }
  async delete(id: string) {
    this.files.delete(id);
    this.deleted.push(id);
  }
}

// ---------------------------------------------------------------- functions

export type Scheduled = { delay: number; name: string; args: Any };

export class FakeConvex {
  db = new FakeDb();
  storage = new FakeStorage();
  scheduled: Scheduled[] = [];
  calls: string[] = [];
  identity: { subject: string } | null = null;
  constructor(private modules: Record<string, Any>) {}

  private resolve(ref: Any) {
    const name = typeof ref === "string" ? ref : getFunctionName(ref);
    const [mod, fn] = name.split(":");
    const func = this.modules[mod]?.[fn ?? "default"];
    if (!func) throw new Error(`function ${name} not loaded in the harness`);
    return { name, func };
  }
  private scheduler() {
    return {
      runAfter: async (delay: number, ref: Any, args: Any) => {
        const { name, func } = this.resolve(ref);
        checkValue(
          JSON.parse(func.exportArgs()),
          wire(args),
          `${name} scheduled args`,
        );
        this.scheduled.push({ delay, name, args: wire(args) });
        return `_scheduled_functions~${this.scheduled.length}`;
      },
      runAt: async () => {
        throw new Error("runAt not faked");
      },
    };
  }
  private auth() {
    return { getUserIdentity: async () => this.identity };
  }
  queryCtx() {
    return {
      db: this.db,
      storage: { getUrl: (id: string) => this.storage.getUrl(id) },
      auth: this.auth(),
    };
  }
  mutationCtx() {
    return {
      db: this.db,
      storage: {
        getUrl: (id: string) => this.storage.getUrl(id),
        delete: (id: string) => this.storage.delete(id),
      },
      scheduler: this.scheduler(),
      auth: this.auth(),
    };
  }
  actionCtx() {
    return {
      runQuery: (ref: Any, args: Any) => this.run("query", ref, args ?? {}),
      runMutation: (ref: Any, args: Any) =>
        this.run("mutation", ref, args ?? {}),
      runAction: (ref: Any, args: Any) => this.run("action", ref, args ?? {}),
      storage: this.storage,
      scheduler: this.scheduler(),
      auth: this.auth(),
    };
  }
  async run(
    kind: "query" | "mutation" | "action",
    ref: Any,
    args: Any,
  ): Promise<Any> {
    const { name, func } = this.resolve(ref);
    const want =
      kind === "query"
        ? func.isQuery
        : kind === "mutation"
          ? func.isMutation
          : func.isAction;
    if (!want) throw new Error(`${name} is not a ${kind}`);
    this.calls.push(name);
    const sent = wire(args, `${name} args`);
    checkValue(JSON.parse(func.exportArgs()), sent, `${name} args`);
    const ctx =
      kind === "query"
        ? this.queryCtx()
        : kind === "mutation"
          ? this.mutationCtx()
          : this.actionCtx();
    const snapshot =
      kind === "mutation" ? structuredClone(this.db.tables) : null;
    let out: Any;
    try {
      out = await func._handler(ctx, sent);
    } catch (e) {
      if (snapshot) this.db.tables = snapshot;
      throw e;
    }
    const returns = JSON.parse(func.exportReturns());
    const back = out === undefined ? null : wire(out, `${name} returns`);
    if (returns) checkValue(returns, back, `${name} returns`);
    return back;
  }
  /** Run the scheduled functions (once; what they schedule stays queued). */
  async drain(filter?: (s: Scheduled) => boolean) {
    const now = this.scheduled.filter(s => !filter || filter(s));
    this.scheduled = this.scheduled.filter(s => !now.includes(s));
    const out: Any[] = [];
    for (const s of now) {
      const { func } = this.resolve(s.name);
      const kind = func.isQuery
        ? "query"
        : func.isMutation
          ? "mutation"
          : "action";
      out.push(await this.run(kind, s.name, s.args));
    }
    return out;
  }
  count(name: string) {
    return this.calls.filter(c => c === name).length;
  }
}

// ---------------------------------------------------------------- fetch

export type Route = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

export class FakeWeb {
  routes: Route[] = [];
  log: string[] = [];
  private original = globalThis.fetch;
  install() {
    globalThis.fetch = (async (input: Any, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      this.log.push(
        `${init?.method ?? "GET"} ${url.host}${url.pathname}${
          url.host.includes("graph")
            ? `?${[...url.searchParams.keys()]
                .filter(k => k !== "access_token")
                .map(k => `${k}=${url.searchParams.get(k)}`)
                .join("&")}`
            : ""
        }`,
      );
      for (const r of this.routes) {
        const res = await r(url, init);
        if (res) return res;
      }
      throw new TypeError(
        `fetch failed: no route for ${url.host}${url.pathname}`,
      );
    }) as typeof fetch;
  }
  uninstall() {
    globalThis.fetch = this.original;
  }
  graphCalls() {
    return this.log.filter(l => l.includes("graph.facebook.com"));
  }
}

export function image(bytes: number, type = "image/jpeg"): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": type, "content-length": String(bytes) },
  });
}

export function json(body: Any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function metaError(
  code: number,
  message: string,
  subcode?: number,
): Response {
  return json(
    {
      error: { code, message, error_subcode: subcode, type: "OAuthException" },
    },
    400,
  );
}
