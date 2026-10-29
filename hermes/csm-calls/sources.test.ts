import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { meetingRow } from "./fathomRules.ts";
import { type Db, ProviderError, type Transport } from "./lib";
import type { Client, Row } from "./match";
import {
  type Ctx,
  fathomActionsBackfill,
  fathomSource,
  ghlSource,
  keepManual,
  linkTypeforms,
  metaAccounts,
  readTypeforms,
  recordingOf,
  storePass,
  typeformSource,
  unmatchedQueue,
} from "./sources";

const card = (taskId: string, name: string, aliases: string[] = [], stopped = false): Client => ({ taskId, name, aliases, stopped });
const fakeDb = (tables: Record<string, Record<string, unknown>[]>, asked: string[] = []) =>
  ({ all: async (table: string, query: string) => (asked.push(`${table}?${query}`), tables[table] ?? []) }) as unknown as Db;

test("an enrolled billing account is read even when no name matches its client", async () => {
  // 22 Oct 2026: Safad's Meta account is named "Safad Consulting" and its only campaign row was deleted.
  const clients = [card("86ewvnqgz", "Safad Consultant Engineering", ["safad", "safad consultant engineering"]), card("old1", "Old Client", [], true)];
  const asked: string[] = [];
  const accounts = await metaAccounts(fakeDb({
    clients: [{ name: "Safad Consulting", meta_ad_account_id: "act_774492648699300" }],
    cockpit_ad_billing_bindings: [{ client_task_id: "86ewvnqgz", account_id: "774492648699300" }, { client_task_id: "old1", account_id: "111111111" }],
  }, asked), clients);
  expect([...accounts]).toEqual([["774492648699300", "86ewvnqgz"]]);
  expect(asked).toContain("cockpit_ad_billing_bindings?select=client_task_id,account_id&enabled=eq.true");
});

test("name matches still count, and the billing watch's task id wins over a name match", async () => {
  const clients = [card("ocean", "ocean home"), card("a", "Alpha Interiors"), card("b", "Beta Build")];
  const accounts = await metaAccounts(fakeDb({
    clients: [{ name: "ocean home", meta_ad_account_id: "act_568262692064148" }],
    cockpit_campaigns: [{ client_name: "Alpha Interiors", meta_account_id: "999999999" }],
    cockpit_ad_billing_bindings: [{ client_task_id: "b", account_id: "999999999" }],
  }), clients);
  expect(accounts.get("568262692064148")).toBe("ocean");
  expect(accounts.get("999999999")).toBe("b");
});

test("a manual match cannot reattach its recording to another client's appointment", () => {
  const update = keepManual(
    { task_id: "client-b", linked_call_id: 24, match_method: "appointment_time" },
    { task_id: "client-a", linked_call_id: null, match_method: "manual" },
  );
  expect(update.task_id).toBe("client-a");
  expect(update.linked_call_id).toBeNull();
  expect(update.match_method).toBe("manual");
});

test("a manual match keeps its client's name, whichever source rewrites the row (contract A7.13)", () => {
  const clients = [card("client-a", "Alpha Interiors"), card("client-b", "Beta Build")];
  const auto = () => ({ task_id: "client-b", client_name: "Beta Build", match_method: "appointment_time" });
  // The clients list's name for the person's client, else the stored one, never the automatic match's.
  expect(keepManual(auto(), { task_id: "client-a", client_name: "Alpha Interiors", match_method: "manual" }, clients).client_name).toBe("Alpha Interiors");
  expect(keepManual(auto(), { task_id: "client-a", client_name: null, match_method: "manual" }, clients).client_name).toBe("Alpha Interiors");
  expect(keepManual(auto(), { task_id: "client-c", client_name: "Gamma Homes", match_method: "manual" }, clients).client_name).toBe("Gamma Homes");
  expect(keepManual(auto(), { task_id: "client-c", client_name: null, match_method: "manual" }, clients).client_name).toBeNull();
  // An automatic row keeps its own.
  expect(keepManual(auto(), { task_id: "client-a", client_name: "Alpha Interiors", match_method: "same_room" }, clients).client_name).toBe("Beta Build");
});

// ---------------------------------------------------------------- the Fathom intake (docs/forms/STAGE2-CONTRACT.md 4.1)
//
// A small in-memory PostgREST: the filters, selects and writes the worker sends, the column defaults
// it relies on, and the meetings privacy trigger of migration 20261027g (internal and sales rows keep
// no summary and no content keys, whoever writes). People, links, rooms, summaries and transcript
// lines are invented; client names are the business names the contract uses.

const CONTENT = ["default_summary", "action_items", "highlights", "transcript"];
const DEFAULTS: Record<string, () => Row> = {
  cockpit_csm_calls: () => ({
    task_id: null, client_name: null, match_method: null, match_confidence: null, kind: "other", status: "booked", linked_call_id: null,
    candidate: false, hints: [], settled_reason: null, room: null, summary: null, transcript_path: null, transcript_text: null, external_invitees: [],
  }),
  cockpit_fathom_meetings: () => ({ class: null, summary: null, transcript_path: null, missing_since: null, gone_at: null, room: null, recorder_team: null, external: false, invitees: [] }),
  cockpit_csm_call_forms: () => ({ linked_call_id: null }),
  cockpit_csm_unmatched: () => ({ resolved_at: null, resolved_by: null, resolved_task_id: null }),
};
const CONFLICT: Record<string, string[]> = {
  cockpit_csm_calls: ["source", "source_id"],
  cockpit_fathom_meetings: ["recording_id"],
  cockpit_csm_call_forms: ["token"],
  cockpit_csm_unmatched: ["item_kind", "item_ref"],
  cockpit_sync_state: ["key"],
};
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const omit = (o: Row, keys: string[]) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !keys.includes(k)));

/** A column or a JSON path (raw->recorded_by->>team), as PostgREST reads it. */
function valueAt(row: Row, path: string): unknown {
  const [col, ...rest] = path.split(/(?=->)/);
  let v: unknown = row[col];
  for (const step of rest) {
    const asText = step.startsWith("->>");
    const key = step.replace(/^->>?/, "");
    v = v && typeof v === "object" ? (v as Row)[key] : undefined;
    if (asText) v = v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return v;
}

function holds(row: Row, path: string, condition: string): boolean {
  const negate = condition.startsWith("not.");
  const [op, ...restArg] = (negate ? condition.slice(4) : condition).split(".");
  const arg = restArg.join(".");
  const v = valueAt(row, path);
  const text = path.includes("->>");
  const cmp = (): number => {
    const a = String(v);
    if (!text && /^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}T/.test(arg)) return Date.parse(a) - Date.parse(arg);
    return a < arg ? -1 : a > arg ? 1 : 0;
  };
  let ok: boolean;
  if (op === "is") ok = arg === "null" ? v == null : arg === "true" ? v === true : v === false;
  else if (v == null) ok = false;
  else if (op === "eq") ok = String(v) === arg;
  else if (op === "neq") ok = String(v) !== arg;
  else if (op === "gt") ok = cmp() > 0;
  else if (op === "gte") ok = cmp() >= 0;
  else if (op === "lt") ok = cmp() < 0;
  else if (op === "lte") ok = cmp() <= 0;
  else if (op === "in") ok = listOf(arg).includes(String(v));
  else if (op === "like") ok = new RegExp(`^${arg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(String(v));
  else throw new Error(`The fake does not know ${op}`);
  return negate ? !ok : ok;
}

function listOf(arg: string): string[] {
  const inner = arg.replace(/^\(/, "").replace(/\)$/, "");
  return [...inner.matchAll(/"([^"]*)"|([^,]+)/g)].map(m => m[1] ?? m[2]);
}

function parse(query: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let select: string[] | undefined;
  let order: [string, boolean] | undefined;
  let limit: number | undefined;
  for (const part of query.split("&").filter(Boolean)) {
    const i = part.indexOf("=");
    const key = part.slice(0, i);
    const value = decodeURIComponent(part.slice(i + 1));
    if (key === "select") select = value.split(",");
    else if (key === "order") order = [value.split(".")[0], value.endsWith(".desc")];
    else if (key === "limit") limit = Number(value);
    else if (key === "or") {
      const any = value.replace(/^\(/, "").replace(/\)$/, "").split(",").map(c => {
        const dot = c.indexOf(".");
        return (r: Row) => holds(r, c.slice(0, dot), c.slice(dot + 1));
      });
      filters.push(r => any.some(f => f(r)));
    } else filters.push(r => holds(r, key, value));
  }
  return { filters, select, order, limit };
}

function project(row: Row, select: string[] | undefined): Row {
  if (!select) return clone(row);
  const out: Row = {};
  for (const item of select) {
    const [alias, path] = item.includes(":") ? item.split(":") : [undefined, item];
    out[alias ?? path.split(/->>?/).at(-1)!] = clone(valueAt(row, path));
  }
  return out;
}

type Write = { op: string; table: string; filter?: string; values?: Row; rows?: Row[] };

function store(seed: Record<string, Row[]>, objects: Record<string, string> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, clone(v)]));
  const files = new Map(Object.entries(objects));
  const writes: Write[] = [];
  const removed: string[] = [];
  let nextId = 5000;
  const table = (name: string) => (tables[name] ??= []);
  const trigger = (name: string, r: Row) => {
    if (name === "cockpit_fathom_meetings" && (r.class === "internal" || r.class === "sales")) {
      r.summary = null;
      r.raw = omit(r.raw, CONTENT);
    }
  };
  const upsertOne = (name: string, row: Row): Row => {
    const keys = CONFLICT[name] ?? ["id"];
    const found = table(name).find(r => keys.every(k => String(r[k]) === String(row[k])));
    if (found) {
      Object.assign(found, clone(row));
      trigger(name, found);
      return found;
    }
    const fresh: Row = { id: nextId++, ...(DEFAULTS[name]?.() ?? {}), ...clone(row) };
    trigger(name, fresh);
    table(name).push(fresh);
    return fresh;
  };
  const db = {
    async all(name: string, query: string) {
      const q = parse(query);
      let rows = table(name).filter(r => q.filters.every(f => f(r)));
      if (q.order) {
        const [col, desc] = q.order;
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (desc ? -1 : 1));
      }
      if (q.limit !== undefined) rows = rows.slice(0, q.limit);
      return rows.map(r => project(r, q.select));
    },
    async upsert(name: string, rows: Row[]) {
      writes.push({ op: "upsert", table: name, rows: clone(rows) });
      for (const r of rows) upsertOne(name, r);
    },
    async insertReturning(name: string, rows: Row[]) {
      writes.push({ op: "upsert", table: name, rows: clone(rows) });
      return rows.map(r => upsertOne(name, r)).map(r => ({ id: r.id, source: r.source, source_id: r.source_id }));
    },
    async insert(name: string, rows: Row[]) {
      writes.push({ op: "insert", table: name, rows: clone(rows) });
      for (const r of rows) table(name).push({ id: nextId++, ...(DEFAULTS[name]?.() ?? {}), ...clone(r) });
    },
    async patch(name: string, filter: string, values: Row) {
      writes.push({ op: "patch", table: name, filter, values: clone(values) });
      const q = parse(filter);
      for (const r of table(name).filter(r => q.filters.every(f => f(r)))) {
        Object.assign(r, clone(values));
        trigger(name, r);
      }
    },
    async storage(path: string, content: string) {
      files.set(path, content);
    },
    async storageRemove(path: string) {
      if (!/^fathom\/\d{1,20}\.txt$/.test(path)) throw new Error("Only a Fathom transcript object can be removed");
      // An object that is not there counts as removed, as Storage's 404 does in lib.ts.
      removed.push(path);
      files.delete(path);
    },
    async ping() {
      return true;
    },
  };
  const rows = (name: string) => table(name);
  const one = (name: string, pred: (r: Row) => boolean) => table(name).find(pred);
  return { db: db as unknown as Db, rows, one, files, writes, removed };
}

type Fake = ReturnType<typeof store>;

/** Fathom's list (one page) and its recordings' transcripts; every request is recorded. */
function fathomApi(list: Row[], transcripts: Record<string, Row[] | number> = {}) {
  const asked: { what: string; params?: Record<string, string>; id?: string }[] = [];
  const t = {
    receipts: [],
    fathom: async (p: URLSearchParams) => {
      asked.push({ what: "meetings", params: Object.fromEntries(p) });
      return { items: clone(list), next_cursor: null };
    },
    fathomRecording: async (id: string, part: string) => {
      asked.push({ what: part, id });
      const lines = transcripts[id];
      if (lines === undefined || typeof lines === "number") throw new ProviderError("fathom", typeof lines === "number" ? lines : 404, "fathom refused it");
      return { transcript: clone(lines) };
    },
  };
  return { t: t as unknown as Transport, asked };
}

const NOW = Date.parse("2026-10-28T09:00:00Z");
const SINCE = "2026-10-21T09:00:00Z";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const CS = "Customer Success";
const CSM = { name: "Test CSM", email: "csm@maharamedia.com", email_domain: "maharamedia.com", team: CS };
const CLOSER = { name: "Test Closer", email: "closer@maharamedia.com", email_domain: "maharamedia.com", team: "Sales" };
const CSM_INVITE = { name: "Test CSM", email: "csm@maharamedia.com", email_domain: "maharamedia.com", is_external: false };
const OWNER = { name: "Invented Owner", email: "owner@citywood.example", email_domain: "citywood.example", is_external: true };
const ZOOM = "https://us05web.zoom.us/j/12345678901?pwd=TEST";
const ZOOM_ROOM = "zoom:12345678901";
const MEET = "https://meet.google.com/abc-defg-hij";
const MEET_ROOM = "meet:abc-defg-hij";
const TRANSCRIPT_REF = "0773087f-beda-4e2c-bf50-acdac0dcbe05";
const TYPEFORM_TEXT = "Impromptu recording with no client yet. Put it on its client here, or paste its Fathom link in the 1-1 form.";
const NATIVE_TEXT = "Impromptu recording with no client yet. Pick the client in the 1-1 notes or here.";
const CITY = card("86exc1tyw", "City Wood", ["citywood"]);
const MAKERS = card("86exmak3r", "Makers");
const SMMIM = card("86exsmm1m", "Smmim studio");
const CLIENTS = [CITY, MAKERS, SMMIM];

/** A Fathom Meeting: by default the CSM's impromptu call, flagged external, shared, with its content. */
function meeting(id: number, start: number, over: Row = {}, minutes = 30): Row {
  return {
    title: "Impromptu Zoom Meeting",
    meeting_title: "Impromptu Zoom Meeting",
    recording_id: id,
    url: `https://fathom.video/calls/${id + 100}`,
    share_url: `https://fathom.video/share/TEST${id}`,
    created_at: iso(start + minutes * MIN + 15_000),
    scheduled_start_time: iso(start),
    scheduled_end_time: iso(start + 30 * MIN),
    recording_start_time: iso(start),
    recording_end_time: iso(start + minutes * MIN),
    meeting_url: ZOOM,
    meeting_type: "external",
    calendar_invitees_domains_type: "one_or_more_external",
    shared_with: "all_teams",
    recorded_by: CSM,
    calendar_invitees: [CSM_INVITE],
    default_summary: { template_name: "Enhanced", markdown_formatted: `## Summary\nAn invented summary of call ${id}.` },
    action_items: [{ description: `Send the invented plan of call ${id}`, completed: false, recording_timestamp: "00:05:00", assignee: { name: "Test CSM", email: CSM.email, team: CS } }],
    highlights: null,
    crm_matches: null,
    transcript: null,
    ...over,
  };
}
/** A team meeting: no external flag, nothing to keep. */
const teamMeeting = (id: number, start: number) => meeting(id, start, { calendar_invitees_domains_type: "only_internal", title: "Team sync", meeting_title: "Team sync" });
const booking = (id: number, client: Client, start: number, over: Row = {}): Row => ({
  id,
  source: "ghl_appointment",
  source_id: `ghl-${id}`,
  task_id: client.taskId,
  client_name: client.name,
  kind: "checkin",
  title: `${client.name} - Check In`,
  starts_at: iso(start),
  ends_at: iso(start + 30 * MIN),
  status: "confirmed",
  room: null,
  join_url: null,
  external_invitees: [{ email: "owner@client.example", name: "Invented Contact" }],
  ...over,
});
/** The stored meeting row the worker would have written for m with this class. */
const storedMeeting = (m: Row, cls: string, over: Row = {}): Row => ({
  ...meetingRow(m, cls as "client", iso(NOW - DAY)),
  first_seen_at: iso(NOW - DAY),
  missing_since: null,
  gone_at: null,
  transcript_path: null,
  ...over,
});
const storedCall = (id: number, m: Row, over: Row = {}): Row => ({
  id,
  source: "fathom",
  source_id: String(m.recording_id),
  task_id: null,
  client_name: null,
  match_method: null,
  match_confidence: null,
  kind: "other",
  title: m.title,
  starts_at: m.recording_start_time,
  ends_at: m.recording_end_time,
  status: "held",
  host_email: m.recorded_by?.email ?? null,
  summary: m.default_summary?.markdown_formatted ?? null,
  external_invitees: [],
  linked_call_id: null,
  candidate: false,
  hints: [],
  settled_reason: null,
  room: null,
  transcript_path: null,
  transcript_text: null,
  ...over,
});
const seedOf = (over: Record<string, Row[]> = {}): Record<string, Row[]> => ({
  cockpit_forms: [{ key: "checkin", provider: "typeform" }],
  cockpit_sales_recordings: [],
  cockpit_people: [{ name: "Test CSM", email: CSM.email, active: true }],
  cockpit_csm_calls: [],
  cockpit_fathom_meetings: [],
  cockpit_csm_call_forms: [],
  cockpit_csm_unmatched: [],
  ...over,
});
const ctxOf = (fake: Fake, t: Transport, over: Partial<Ctx> = {}): Ctx => ({
  db: fake.db,
  t,
  apply: true,
  now: NOW,
  clients: CLIENTS,
  reasons: new Map(),
  shareToTask: new Map(),
  stateOf: () => undefined,
  plan: {},
  ...over,
});
const callOf = (fake: Fake, rid: number) => fake.one("cockpit_csm_calls", r => r.source === "fathom" && r.source_id === String(rid))!;
const meetingOf = (fake: Fake, rid: number) => fake.one("cockpit_fathom_meetings", r => r.recording_id === String(rid))!;
const patchesOf = (fake: Fake, id: number) => fake.writes.filter(w => w.op === "patch" && w.table === "cockpit_csm_calls" && w.filter === `id=eq.${id}`);

describe("fathomSource: candidates", () => {
  const T0 = NOW - 2 * DAY;
  // Makers' Blueprint call was booked in its own Meet room; the CSM held it 4 minutes early in her Zoom room.
  const makersBooking = () => booking(41, MAKERS, T0, { kind: "blueprint", room: "meet:kln-opqr-stu", join_url: "https://meet.google.com/kln-opqr-stu" });
  const impromptu = meeting(900000101, T0 - 4 * MIN, {}, 43);

  test("an impromptu Customer Success call is a candidate: a call row with the recorder as host, at most 3 hints, and her queue", async () => {
    const fake = store(seedOf({ cockpit_csm_calls: [makersBooking()] }));
    const { t, asked } = fathomApi([impromptu]);
    const ctx = ctxOf(fake, t);
    const health = await fathomSource(ctx, SINCE);
    expect(asked[0]).toEqual({ what: "meetings", params: { created_after: SINCE, include_summary: "true", include_action_items: "true" } });
    const row = callOf(fake, 900000101);
    expect(row).toMatchObject({ candidate: true, task_id: null, match_method: null, linked_call_id: null, status: "held", host_email: CSM.email, kind: "other", room: ZOOM_ROOM });
    expect(row.summary).toContain("An invented summary of call 900000101");
    expect(row.hints.length).toBeGreaterThan(0);
    expect(row.hints.length).toBeLessThanOrEqual(3);
    expect(row.hints[0]).toMatchObject({ taskId: MAKERS.taskId, clientName: "Makers", signal: "near_booking", label: "possible", bookingId: 41, minutes: 4 });
    // Business names only: never the booking's contact.
    expect(JSON.stringify(row.hints)).not.toMatch(/Invented Contact|owner@client\.example/);
    expect(meetingOf(fake, 900000101)).toMatchObject({ class: "candidate", recorder_team: CS, room: ZOOM_ROOM, missing_since: null, gone_at: null });
    expect(meetingOf(fake, 900000101).raw.action_items).toHaveLength(1);
    expect(health).toMatchObject({ key: "csm-fathom", ok: true });
    expect(health.note).toContain("1 candidates");

    await unmatchedQueue(ctx);
    const queued = fake.one("cockpit_csm_unmatched", u => u.item_kind === "call" && u.item_ref === String(row.id))!;
    expect(queued).toMatchObject({ host_email: CSM.email, reason: TYPEFORM_TEXT, hint: row.hints[0].why, title: "Impromptu Zoom Meeting" });
    // 09:00 UTC is 12:00 in Kuwait.
    expect(queued.hint).toBe("Started 4 min before Makers's booked call at 12:00.");
  });

  test("from the cut-over the queue asks for the pick in the 1-1 notes, with no code change", async () => {
    const fake = store(seedOf({ cockpit_forms: [{ key: "checkin", provider: "native" }] }));
    const ctx = ctxOf(fake, fathomApi([impromptu]).t);
    await fathomSource(ctx, SINCE);
    await unmatchedQueue(ctx);
    expect(fake.rows("cockpit_csm_unmatched").map(u => u.reason)).toEqual([NATIVE_TEXT]);
  });

  test("the sales index never makes a Customer Success recording sales; a Sales-team recording in it gets no call row and no content", async () => {
    const cs = meeting(900000102, T0);
    const sold = meeting(900000103, T0 + HOUR, { recorded_by: CLOSER, calendar_invitees: [OWNER], title: "Pricing call" });
    const service = meeting(900000104, T0 + 2 * HOUR, { recorded_by: CLOSER, calendar_invitees: [OWNER], title: "Invented client check-in" });
    const fake = store(
      seedOf({
        cockpit_sales_recordings: [
          { recording_id: "900000102", hidden_reason: null },
          { recording_id: "900000103", hidden_reason: "internal" },
          { recording_id: "900000104", hidden_reason: "client service" },
        ],
      }),
    );
    await fathomSource(ctxOf(fake, fathomApi([cs, sold, service]).t), SINCE);
    expect(callOf(fake, 900000102)).toMatchObject({ candidate: true });
    expect(meetingOf(fake, 900000102).class).toBe("candidate");
    expect(meetingOf(fake, 900000103)).toMatchObject({ class: "sales", summary: null });
    for (const key of ["default_summary", "action_items", "highlights", "transcript"]) expect(Object.keys(meetingOf(fake, 900000103).raw)).not.toContain(key);
    expect(fake.one("cockpit_csm_calls", r => r.source_id === "900000103")).toBeUndefined();
    expect(meetingOf(fake, 900000104).class).toBe("client");
    expect(callOf(fake, 900000104).summary).toContain("call 900000104");
  });

  test("a short call: 2 minutes with no summary is internal and gets no row", async () => {
    const fake = store(seedOf());
    await fathomSource(ctxOf(fake, fathomApi([meeting(900000105, T0, { default_summary: null }, 2)]).t), SINCE);
    expect(meetingOf(fake, 900000105).class).toBe("internal");
    expect(fake.rows("cockpit_csm_calls")).toHaveLength(0);
  });

  test("a form link attaches the recording, read from the stored forms when the Typeform source did not run", async () => {
    const m = meeting(900000106, T0);
    const link = "https://fathom.video/share/TEST900000106";
    for (const how of ["this run", "the store"]) {
      const fake = store(
        seedOf({
          cockpit_csm_call_forms: [{ token: "tok-a", form_id: "fRokTITH", task_id: CITY.taskId, answers: [{ ref: TRANSCRIPT_REF, type: "long_text", value: `Notes ${link}?timestamp=12` }] }],
        }),
      );
      const ctx = ctxOf(fake, fathomApi([m]).t, { shareToTask: how === "this run" ? new Map([[link, CITY.taskId]]) : new Map() });
      await fathomSource(ctx, SINCE);
      expect(callOf(fake, 900000106)).toMatchObject({ task_id: CITY.taskId, client_name: "City Wood", match_method: "form_task_id", match_confidence: 0.95, candidate: false, linked_call_id: null, kind: "other", hints: [] });
      await unmatchedQueue(ctx);
      expect(fake.rows("cockpit_csm_unmatched")).toHaveLength(0);
    }
  });

  test("a same-room match sets the booking and its kind; the same room beats the invitee's booked time", async () => {
    const makers = booking(41, MAKERS, T0, { kind: "blueprint", room: ZOOM_ROOM, join_url: ZOOM });
    const city = booking(42, CITY, T0 + 40 * MIN, { kind: "checkin", room: MEET_ROOM, join_url: MEET, external_invitees: [{ email: OWNER.email, name: "Invented Owner" }] });
    const candidate = meeting(900000107, T0 + 12 * MIN);
    const invited = meeting(900000108, T0 + 35 * MIN, { calendar_invitees: [CSM_INVITE, OWNER] });
    const fake = store(seedOf({ cockpit_csm_calls: [makers, city] }));
    await fathomSource(ctxOf(fake, fathomApi([candidate, invited]).t), SINCE);
    expect(callOf(fake, 900000107)).toMatchObject({ task_id: MAKERS.taskId, match_method: "same_room", match_confidence: 1, linked_call_id: 41, kind: "blueprint", candidate: false, hints: [] });
    expect(callOf(fake, 900000108)).toMatchObject({ task_id: MAKERS.taskId, match_method: "same_room", linked_call_id: 41, kind: "blueprint" });
    // Out of the room, the invitee's booked time decides as before.
    const elsewhere = store(seedOf({ cockpit_csm_calls: [makers, city] }));
    await fathomSource(ctxOf(elsewhere, fathomApi([{ ...invited, meeting_url: null }]).t), SINCE);
    expect(callOf(elsewhere, 900000108)).toMatchObject({ task_id: CITY.taskId, match_method: "appointment_time", linked_call_id: 42, kind: "checkin" });
  });

  test("a booking that went gone proves nothing by its room, and the lost match leaves no hint of its old client", async () => {
    const m = meeting(900000112, T0 + 5 * MIN);
    const fake = store(
      seedOf({
        cockpit_csm_calls: [
          booking(50, CITY, T0, { room: ZOOM_ROOM, join_url: ZOOM, status: "gone" }),
          storedCall(73, m, { task_id: CITY.taskId, client_name: "City Wood", match_method: "same_room", match_confidence: 1, linked_call_id: 50 }),
        ],
      }),
    );
    await fathomSource(ctxOf(fake, fathomApi([m]).t), SINCE);
    const row = callOf(fake, 900000112);
    expect(row).toMatchObject({ task_id: null, match_method: null, linked_call_id: null, candidate: true });
    expect(row.hints.map((h: Row) => h.signal)).not.toContain("matched");
    expect(row.hints.map((h: Row) => h.signal)).not.toContain("same_room");
  });

  test("a manual match keeps its client, its booking and that booking's kind", async () => {
    const m = meeting(900000109, T0);
    const fake = store(
      seedOf({
        cockpit_csm_calls: [
          booking(43, SMMIM, T0 + 50 * MIN, { kind: "blueprint" }),
          storedCall(70, m, { task_id: SMMIM.taskId, client_name: "Smmim studio", match_method: "manual", match_confidence: 1, linked_call_id: 43, kind: "blueprint" }),
        ],
      }),
    );
    await fathomSource(ctxOf(fake, fathomApi([m]).t), SINCE);
    expect(callOf(fake, 900000109)).toMatchObject({
      task_id: SMMIM.taskId,
      client_name: "Smmim studio",
      match_method: "manual",
      linked_call_id: 43,
      kind: "blueprint",
      candidate: false,
    });
  });

  test("a manual match keeps the name a person placed: never blanked, never the automatic match's (contract A7.13)", async () => {
    const ARCTURUS = card("86exarctu", "Arcturus"); // not on the clients list
    // A client-class call whose invitee is on City Wood's booking 10 minutes later: the automatic match is City Wood's.
    const onCity = meeting(900000113, T0, { meeting_url: null, calendar_invitees: [CSM_INVITE, OWNER] });
    const impromptu = meeting(900000114, T0 + 3 * HOUR); // a candidate nothing places
    const renamed = meeting(900000115, T0 + 5 * HOUR); // stored with another client's name by an older writer
    const left = meeting(900000116, NOW - 10 * DAY); // outside the window; the re-match loop never rewrites a manual row
    const manual = { match_method: "manual", match_confidence: 1 };
    const fake = store(
      seedOf({
        cockpit_csm_calls: [
          booking(46, CITY, T0 + 10 * MIN, { external_invitees: [{ email: OWNER.email, name: "Invented Owner" }] }),
          storedCall(74, onCity, { ...manual, task_id: SMMIM.taskId, client_name: "Smmim studio" }),
          storedCall(75, impromptu, { ...manual, task_id: ARCTURUS.taskId, client_name: "Arcturus" }),
          storedCall(76, renamed, { ...manual, task_id: SMMIM.taskId, client_name: "City Wood" }),
          storedCall(77, left, { ...manual, task_id: SMMIM.taskId, client_name: "Smmim studio" }),
        ],
        cockpit_fathom_meetings: [storedMeeting(left, "candidate")],
      }),
    );
    for (let run = 0; run < 2; run++) await fathomSource(ctxOf(fake, fathomApi([onCity, impromptu, renamed]).t), SINCE);
    expect(callOf(fake, 900000113)).toMatchObject({ task_id: SMMIM.taskId, client_name: "Smmim studio", match_method: "manual", linked_call_id: null, kind: "other" });
    // A client that has left the list keeps the name stored with the match.
    expect(callOf(fake, 900000114)).toMatchObject({ task_id: ARCTURUS.taskId, client_name: "Arcturus", match_method: "manual" });
    // The clients list's name for the person's client wins over a name another writer left on the row.
    expect(callOf(fake, 900000115)).toMatchObject({ task_id: SMMIM.taskId, client_name: "Smmim studio" });
    expect(callOf(fake, 900000116)).toMatchObject({ task_id: SMMIM.taskId, client_name: "Smmim studio" });
    expect(patchesOf(fake, 77)).toHaveLength(0);
  });

  test("a settled row stays settled: no match, candidate false, no hints, no queue entry, no re-match", async () => {
    const inWindow = meeting(900000110, T0);
    const older = meeting(900000111, NOW - 12 * DAY);
    const hint = { recordingId: "900000110", taskId: MAKERS.taskId, clientName: "Makers", signal: "hint_window", label: "hint", why: "An earlier hint.", preselect: false, ask: false };
    const fake = store(
      seedOf({
        cockpit_csm_calls: [
          booking(44, MAKERS, T0 + 10 * MIN, { room: ZOOM_ROOM, join_url: ZOOM }),
          booking(45, MAKERS, NOW - 12 * DAY + 5 * MIN, { room: ZOOM_ROOM, join_url: ZOOM }),
          storedCall(71, inWindow, { settled_reason: "not_client", hints: [hint] }),
          storedCall(72, older, { settled_reason: "part_of_call" }),
        ],
        cockpit_fathom_meetings: [storedMeeting(older, "candidate")],
      }),
    );
    const ctx = ctxOf(fake, fathomApi([inWindow]).t);
    await fathomSource(ctx, SINCE);
    // Hints are for an unplaced, unsettled candidate only (contract A7 item 12): the ones it held as a candidate go.
    expect(callOf(fake, 900000110)).toMatchObject({ task_id: null, match_method: null, linked_call_id: null, candidate: false, settled_reason: "not_client", hints: [] });
    expect(callOf(fake, 900000111)).toMatchObject({ task_id: null, candidate: false, settled_reason: "part_of_call" });
    expect(patchesOf(fake, 72)).toHaveLength(0);
    await unmatchedQueue(ctx);
    expect(fake.rows("cockpit_csm_unmatched")).toHaveLength(0);
  });
});

describe("fathomSource: the re-match loop", () => {
  test("a candidate older than the window whose title names a client stays unattached and carries a title hint", async () => {
    const old = meeting(900000201, NOW - 10 * DAY, { title: "City Wood follow up" });
    const fake = store(
      seedOf({
        cockpit_fathom_meetings: [storedMeeting(old, "candidate")],
        cockpit_csm_calls: [storedCall(80, old, { candidate: true })],
      }),
    );
    const ctx = ctxOf(fake, fathomApi([]).t);
    await fathomSource(ctx, SINCE);
    const row = callOf(fake, 900000201);
    expect(row).toMatchObject({ task_id: null, match_method: null, candidate: true });
    expect(row.hints).toEqual([
      { recordingId: "900000201", taskId: CITY.taskId, clientName: "City Wood", signal: "title", label: "likely", why: "The title names City Wood.", preselect: true, ask: true },
    ]);
    expect(patchesOf(fake, 80).every(p => !("task_id" in (p.values ?? {})))).toBe(true);
    await unmatchedQueue(ctx);
    expect(fake.rows("cockpit_csm_unmatched")).toEqual([
      expect.objectContaining({ item_ref: "80", reason: TYPEFORM_TEXT, hint: "The title names City Wood.", host_email: CSM.email }),
    ]);
    // The same hints next run: nothing is written again.
    const before = fake.writes.length;
    await fathomSource(ctxOf(fake, fathomApi([]).t), SINCE);
    expect(fake.writes.slice(before).filter(w => w.filter === "id=eq.80")).toHaveLength(0);
  });

  test("a candidate older than the window is attached once a stored 1-1 form holds its link", async () => {
    const old = meeting(900000202, NOW - 10 * DAY);
    const fake = store(
      seedOf({
        cockpit_fathom_meetings: [storedMeeting(old, "candidate")],
        cockpit_csm_calls: [storedCall(81, old, { candidate: true })],
      }),
    );
    const ctx = ctxOf(fake, fathomApi([]).t, { shareToTask: new Map([[old.share_url, MAKERS.taskId]]) });
    const health = await fathomSource(ctx, SINCE);
    expect(callOf(fake, 900000202)).toMatchObject({ task_id: MAKERS.taskId, match_method: "form_task_id", candidate: false, hints: [] });
    expect(health.note).toContain("1 matched on a later run");
  });

  test("a sales recording is never re-matched, while a client row still re-matches as before", async () => {
    const sold = meeting(900000203, NOW - 10 * DAY, { recorded_by: CLOSER, calendar_invitees: [OWNER], title: "City Wood pricing" });
    const client = meeting(900000204, NOW - 9 * DAY, { calendar_invitees: [CSM_INVITE, OWNER], meeting_url: null });
    const fake = store(
      seedOf({
        cockpit_sales_recordings: [{ recording_id: "900000203", hidden_reason: null }],
        cockpit_fathom_meetings: [storedMeeting(sold, "client"), storedMeeting(client, "client")],
        cockpit_csm_calls: [
          booking(46, CITY, NOW - 9 * DAY + 10 * MIN, { kind: "checkin", external_invitees: [{ email: OWNER.email, name: "Invented Owner" }] }),
          storedCall(82, sold),
          storedCall(83, client),
        ],
      }),
    );
    const ctx = ctxOf(fake, fathomApi([]).t);
    await fathomSource(ctx, SINCE);
    expect(patchesOf(fake, 82).filter(p => "task_id" in (p.values ?? {}))).toHaveLength(0);
    expect(callOf(fake, 900000203).task_id).toBeNull();
    expect(callOf(fake, 900000204)).toMatchObject({ task_id: CITY.taskId, match_method: "appointment_time", linked_call_id: 46, kind: "checkin" });
    await unmatchedQueue(ctx);
    expect(fake.rows("cockpit_csm_unmatched").map(u => u.item_ref)).not.toContain("82");
  });
});

describe("fathomSource: one match block from exactMatch (contract A7 item 2)", () => {
  test("each exact signal writes the webhook's and the pull's block, in the run and in the re-match loop; every invitee email counts, lower-cased", async () => {
    // A candidate's client email is on the invite without Fathom's external flag (flagged, it would be a client call).
    const unflagged = { name: "Invented Owner", email: "Owner@CityWood.Example", email_domain: "citywood.example", is_external: false };
    const invite = { calendar_invitees: [CSM_INVITE, unflagged], meeting_url: null };
    // The title's kind (launch) is told apart from the bookings' (blueprint, onboarding).
    const titled = { title: "Launch review", meeting_title: "Launch review" };
    const four = (id: number, at: number) => [
      meeting(id + 1, at + 12 * MIN, titled), // the booked room, 12 minutes in
      meeting(id + 2, at + 3 * HOUR + 10 * MIN, { ...titled, ...invite }), // the invitee, 10 minutes after her booking
      meeting(id + 3, at + 2 * DAY, { ...titled, ...invite }), // the invitee, no booking near
      meeting(id + 4, at + DAY, { ...titled, meeting_url: null }), // its link in a stored 1-1 form
    ];
    const bookingsAt = (room: number, invited: number, at: number) => [
      booking(room, MAKERS, at, { kind: "blueprint", room: ZOOM_ROOM, join_url: ZOOM }),
      booking(invited, CITY, at + 3 * HOUR, { kind: "onboarding", external_invitees: [{ email: OWNER.email, name: "Invented Owner" }] }),
    ];
    const fresh = four(900000020, NOW - 3 * DAY);
    const old = four(900000030, NOW - 12 * DAY);
    const fake = store(
      seedOf({
        // The older four were stored before the window as candidates, still on no client.
        cockpit_csm_calls: [...bookingsAt(61, 62, NOW - 3 * DAY), ...bookingsAt(63, 64, NOW - 12 * DAY), ...old.map((m, i) => storedCall(91 + i, m, { candidate: true }))],
        cockpit_fathom_meetings: old.map(m => storedMeeting(m, "candidate")),
      }),
    );
    const ctx = ctxOf(fake, fathomApi(fresh).t, { shareToTask: new Map([fresh[3], old[3]].map(m => [String(m.share_url), SMMIM.taskId])) });
    await fathomSource(ctx, SINCE);

    const block = (client: Client, method: string, confidence: number, link: number | null, kind: string) => ({
      task_id: client.taskId,
      client_name: client.name,
      match_method: method,
      match_confidence: confidence,
      linked_call_id: link,
      kind,
      candidate: false,
      hints: [],
    });
    const want = (room: number, invited: number) => [
      block(MAKERS, "same_room", 1, room, "blueprint"),
      block(CITY, "appointment_time", 1, invited, "onboarding"),
      block(CITY, "invitee_email", 0.9, null, "launch"),
      block(SMMIM, "form_task_id", 0.95, null, "launch"),
    ];
    expect(fresh.map(m => callOf(fake, m.recording_id))).toMatchObject(want(61, 62));
    // The re-match loop writes the whole block too: the title's kind, not the kind the row held before.
    expect(old.map(m => callOf(fake, m.recording_id))).toMatchObject(want(63, 64));
    expect([91, 92, 93, 94].map(id => patchesOf(fake, id).at(-1)?.values?.kind)).toEqual(["blueprint", "onboarding", "launch", "launch"]);
    await unmatchedQueue(ctx);
    expect(fake.rows("cockpit_csm_unmatched")).toHaveLength(0);
    // The matcher reads every calendar invitee's email, lower-cased: the CSM's own and the client's.
    expect(recordingOf(fresh[1], "candidate", undefined).inviteeEmails).toEqual(["csm@maharamedia.com", "owner@citywood.example"]);
  });
});

describe("fathomSource: hints, titles and names as the webhook and the pull write them (contract A7 item 12)", () => {
  const T0 = NOW - 2 * DAY;
  const OLD = NOW - 10 * DAY;
  /** A hint an earlier write left on a row: the store keeps hints only on an unplaced, unsettled candidate. */
  const left = (rid: number) => ({ recordingId: String(rid), taskId: MAKERS.taskId, clientName: "Makers", signal: "hint_window", label: "hint", why: "An earlier hint.", preselect: false, ask: false });
  /** Someone outside Mahara whose email is on no booking: a client-class recording that nothing places. */
  const STRANGER = { name: "Invented Stranger", email: "desk@unknown.example", email_domain: "unknown.example", is_external: true };
  const callPatches = (writes: Write[], ids: number[]) =>
    writes.filter(w => w.op === "patch" && w.table === "cockpit_csm_calls" && ids.some(id => w.filter === `id=eq.${id}`));

  test("hints only on an unplaced, unsettled candidate: a matched, client-class, manual or settled row carries none, in the run and in the re-match loop", async () => {
    const makersRoom = "https://meet.google.com/kln-opqr-stu";
    const open = meeting(900000041, T0 - 4 * MIN, {}, 43); // 4 minutes before Makers' booking, in another room
    const placed = meeting(900000042, T0 + 5 * MIN, { meeting_url: makersRoom }); // in Makers' booked room
    // A client-class call 8 minutes after Makers' booking: as a candidate it would carry Makers' near_booking hint (as `open` does).
    const clientSide = meeting(900000043, T0 + 8 * MIN, { calendar_invitees: [CSM_INVITE, STRANGER] });
    const manual = meeting(900000044, T0 + 5 * HOUR);
    const settled = meeting(900000045, T0 + 6 * HOUR);
    // Stored before the window: a client-class row nothing places, one whose booking came later, and a candidate.
    const staleClient = meeting(900000046, OLD, { calendar_invitees: [CSM_INVITE, STRANGER] });
    const lateBooking = meeting(900000047, OLD + 3 * HOUR, { calendar_invitees: [CSM_INVITE, OWNER], meeting_url: null });
    const oldCandidate = meeting(900000048, OLD + 6 * HOUR, { meeting_url: null });
    const fake = store(
      seedOf({
        cockpit_csm_calls: [
          booking(141, MAKERS, T0, { kind: "blueprint", room: "meet:kln-opqr-stu", join_url: makersRoom }),
          booking(142, CITY, OLD + 3 * HOUR + 10 * MIN, { external_invitees: [{ email: OWNER.email, name: "Invented Owner" }] }),
          booking(143, SMMIM, OLD + 6 * HOUR + 30 * MIN, { external_invitees: [{ email: "owner@smmim.example", name: "Invented Contact" }] }),
          storedCall(101, manual, { task_id: SMMIM.taskId, client_name: "Smmim studio", match_method: "manual", match_confidence: 1, hints: [left(900000044)] }),
          storedCall(102, settled, { settled_reason: "not_client", hints: [left(900000045)] }),
          storedCall(103, staleClient, { hints: [left(900000046)] }),
          // Stored as a candidate before Fathom flagged its invitee as external.
          storedCall(104, lateBooking, { candidate: true, hints: [left(900000047)] }),
          storedCall(105, oldCandidate, { candidate: true }),
        ],
        cockpit_fathom_meetings: [storedMeeting(staleClient, "client"), storedMeeting(lateBooking, "client"), storedMeeting(oldCandidate, "candidate")],
      }),
    );
    const list = [open, placed, clientSide, manual, settled];
    await fathomSource(ctxOf(fake, fathomApi(list).t), SINCE);

    const openRow = callOf(fake, 900000041);
    expect(openRow).toMatchObject({ task_id: null, candidate: true });
    expect(openRow.hints[0]).toMatchObject({ taskId: MAKERS.taskId, signal: "near_booking", bookingId: 141 });
    expect(callOf(fake, 900000042)).toMatchObject({ task_id: MAKERS.taskId, match_method: "same_room", linked_call_id: 141, candidate: false, hints: [] });
    expect(meetingOf(fake, 900000043).class).toBe("client");
    expect(callOf(fake, 900000043)).toMatchObject({ task_id: null, match_method: null, candidate: false, hints: [] });
    expect(callOf(fake, 900000044)).toMatchObject({ task_id: SMMIM.taskId, match_method: "manual", candidate: false, hints: [] });
    expect(callOf(fake, 900000045)).toMatchObject({ task_id: null, settled_reason: "not_client", candidate: false, hints: [] });
    // The re-match loop: the client-class row on no client loses the stale hints; the one its booking now places
    // takes the booking with no hints and no candidate flag; the old candidate keeps the hint its booking gives.
    expect(callOf(fake, 900000046)).toMatchObject({ task_id: null, candidate: false, hints: [] });
    expect(callPatches(fake.writes, [103]).map(p => p.values)).toEqual([{ hints: [], updated_at: iso(NOW) }]);
    expect(callOf(fake, 900000047)).toMatchObject({
      task_id: CITY.taskId,
      client_name: "City Wood",
      match_method: "appointment_time",
      linked_call_id: 142,
      kind: "checkin",
      candidate: false,
      hints: [],
    });
    expect(callOf(fake, 900000048)).toMatchObject({ task_id: null, candidate: true });
    expect(callOf(fake, 900000048).hints).toEqual([
      expect.objectContaining({ taskId: SMMIM.taskId, signal: "hint_window", why: "30 min before Smmim studio's booked call.", bookingId: 143 }),
    ]);
    // Nothing is left to change: the next run writes none of these rows again.
    const before = fake.writes.length;
    await fathomSource(ctxOf(fake, fathomApi(list).t), SINCE);
    expect(callPatches(fake.writes.slice(before), [103, 104, 105])).toHaveLength(0);
  });

  test("the matcher reads the edited title only: a calendar title that names a client gives no title hint, and the row still shows it", async () => {
    // Fathom sent no edited title, and the calendar's title names City Wood.
    const untitled = meeting(900000051, T0, { title: null, meeting_title: "City Wood weekly" });
    const edited = meeting(900000052, T0 + 3 * HOUR, { title: "City Wood weekly" });
    const old = meeting(900000053, OLD, { title: null, meeting_title: "City Wood weekly" });
    const titleHint = (rid: number) => ({ recordingId: String(rid), taskId: CITY.taskId, clientName: "City Wood", signal: "title", label: "likely", why: "The title names City Wood.", preselect: true, ask: true });
    const fake = store(
      seedOf({
        cockpit_fathom_meetings: [storedMeeting(old, "candidate")],
        // An earlier run read the calendar's title as the title.
        cockpit_csm_calls: [storedCall(106, old, { candidate: true, hints: [titleHint(900000053)] })],
      }),
    );
    await fathomSource(ctxOf(fake, fathomApi([untitled, edited]).t), SINCE);
    expect(recordingOf(untitled, "candidate", undefined)).toMatchObject({ title: null, meetingTitle: "City Wood weekly" });
    expect(callOf(fake, 900000051)).toMatchObject({ task_id: null, candidate: true, title: "City Wood weekly", hints: [] });
    expect(callOf(fake, 900000052).hints).toEqual([titleHint(900000052)]);
    // The re-match loop reads it the same way.
    expect(callOf(fake, 900000053)).toMatchObject({ task_id: null, candidate: true, hints: [] });
  });

  test("a client that has left the clients list keeps the name of the booking the match names; a form link names no booking, so no name", async () => {
    const ARCTURUS = card("86exarctu", "Arcturus"); // not in CLIENTS
    const contact = { name: "Invented Contact", email: "owner@arcturus.example", email_domain: "arcturus.example", is_external: true };
    const invited = [{ email: contact.email, name: contact.name }];
    const sameRoom = meeting(900000054, T0 + 5 * MIN, { meeting_url: MEET }); // a candidate in the booked room
    const onInvite = meeting(900000055, T0 + 10 * MIN, { meeting_url: null, calendar_invitees: [CSM_INVITE, contact] }); // client-class
    const linked = meeting(900000056, T0 + 4 * HOUR, { meeting_url: null }); // its link in a stored 1-1 form
    const lateClient = meeting(900000057, OLD + 10 * MIN, { meeting_url: null, calendar_invitees: [CSM_INVITE, contact] });
    const fake = store(
      seedOf({
        cockpit_csm_calls: [
          booking(144, ARCTURUS, T0, { kind: "onboarding", room: MEET_ROOM, join_url: MEET, external_invitees: invited }),
          booking(145, ARCTURUS, OLD, { kind: "checkin", external_invitees: invited }),
          storedCall(107, lateClient),
        ],
        cockpit_fathom_meetings: [storedMeeting(lateClient, "client")],
      }),
    );
    const ctx = ctxOf(fake, fathomApi([sameRoom, onInvite, linked]).t, { shareToTask: new Map([[String(linked.share_url), ARCTURUS.taskId]]) });
    await fathomSource(ctx, SINCE);
    const on = (link: number | null, kind: string, method: string) => ({ task_id: ARCTURUS.taskId, linked_call_id: link, kind, match_method: method, candidate: false, hints: [] });
    expect(callOf(fake, 900000054)).toMatchObject({ ...on(144, "onboarding", "same_room"), client_name: "Arcturus" });
    expect(callOf(fake, 900000055)).toMatchObject({ ...on(144, "onboarding", "appointment_time"), client_name: "Arcturus" });
    expect(callOf(fake, 900000056)).toMatchObject({ ...on(null, "other", "form_task_id"), client_name: null });
    // The re-match loop's match names it the same way.
    expect(callOf(fake, 900000057)).toMatchObject({ ...on(145, "checkin", "appointment_time"), client_name: "Arcturus" });
  });
});

describe("fathomSource: the client on the invite (contract A7.13)", () => {
  const T0 = NOW - 2 * DAY;
  const ARCTURUS = card("86exarctu", "Arcturus"); // not in CLIENTS
  // The contact's email is on the candidate's invite without Fathom's external flag (flagged, it would be a client call).
  const unflagged = { name: "Invented Contact", email: "Owner@Arcturus.example", email_domain: "arcturus.example", is_external: false };
  const invite = { calendar_invitees: [CSM_INVITE, unflagged], meeting_url: null };
  const seed = (far: Row) =>
    seedOf({
      cockpit_csm_calls: [booking(146, ARCTURUS, T0, { kind: "onboarding", external_invitees: [{ email: "owner@arcturus.example", name: "Invented Contact" }] }), storedCall(108, far, { candidate: true })],
      cockpit_fathom_meetings: [storedMeeting(far, "candidate")],
    });

  test("a client missing from the clients list is named only by its booking within 30 minutes, in the run and in the re-match loop, as the webhook and the pull do", async () => {
    const near = meeting(900000061, T0 + 10 * MIN, invite);
    const later = meeting(900000062, T0 + 3 * HOUR, invite);
    const old = meeting(900000063, NOW - 10 * DAY, invite);
    const fake = store(seed(old));
    await fathomSource(ctxOf(fake, fathomApi([near, later]).t), SINCE);
    expect(callOf(fake, 900000061)).toMatchObject({
      task_id: ARCTURUS.taskId,
      client_name: "Arcturus",
      match_method: "appointment_time",
      match_confidence: 1,
      linked_call_id: 146,
      kind: "onboarding",
      candidate: false,
    });
    for (const rid of [900000062, 900000063]) expect(callOf(fake, rid)).toMatchObject({ task_id: null, match_method: null, candidate: true });
    // On the list, the email alone names it as before.
    const listed = store(seed(old));
    await fathomSource(ctxOf(listed, fathomApi([later]).t, { clients: [...CLIENTS, ARCTURUS] }), SINCE);
    for (const rid of [900000062, 900000063])
      expect(callOf(listed, rid)).toMatchObject({ task_id: ARCTURUS.taskId, client_name: "Arcturus", match_method: "invitee_email", match_confidence: 0.9, linked_call_id: null });
  });
});

describe("fathomSource: the store pass", () => {
  const indexedLate = () => {
    const m = meeting(900000301, NOW - 9 * DAY, { recorded_by: CLOSER, calendar_invitees: [OWNER], title: "Pricing call" });
    const path = "fathom/900000301.txt";
    return {
      m,
      path,
      fake: store(
        seedOf({
          cockpit_sales_recordings: [{ recording_id: "900000301", hidden_reason: null }],
          cockpit_fathom_meetings: [storedMeeting(m, "client", { transcript_path: path })],
          cockpit_csm_calls: [storedCall(90, m, { transcript_path: path, transcript_text: "[00:00:01] Test Closer: An invented line." })],
        }),
        { [path]: "[00:00:01] Test Closer: An invented line." },
      ),
    };
  };

  test("a Sales-team call stored as client 9 days ago and indexed since loses its content and its transcript object", async () => {
    const { fake, path } = indexedLate();
    const health = await fathomSource(ctxOf(fake, fathomApi([]).t), SINCE);
    expect(meetingOf(fake, 900000301)).toMatchObject({ class: "sales", summary: null, transcript_path: null });
    for (const key of ["default_summary", "action_items", "highlights"]) expect(Object.keys(meetingOf(fake, 900000301).raw)).not.toContain(key);
    expect(callOf(fake, 900000301)).toMatchObject({ summary: null, transcript_text: null, transcript_path: null });
    expect(fake.files.has(path)).toBe(false);
    expect(fake.removed).toEqual([path]);
    expect(health.note).toContain("1 stripped, 1 transcript objects removed");
    // Nothing is left to do on the next run.
    const again = await fathomSource(ctxOf(fake, fathomApi([]).t), SINCE);
    expect(again.note).toContain("0 stripped, 0 transcript objects removed");
  });

  test("at most 20 objects a run; the content goes at once, the rest of the objects on the next run", async () => {
    const seed = seedOf();
    const objects: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      const m = teamMeeting(900000400 + i, NOW - 20 * DAY + i * HOUR);
      const path = `fathom/${900000400 + i}.txt`;
      objects[path] = "An invented line.";
      seed.cockpit_fathom_meetings.push(storedMeeting(m, "internal", { transcript_path: path }));
      seed.cockpit_csm_calls.push(storedCall(200 + i, m, { summary: "An invented summary.", transcript_path: path, transcript_text: "An invented line." }));
    }
    const fake = store(seed, objects);
    const first = await storePass(ctxOf(fake, fathomApi([]).t), new Set());
    expect(first).toMatchObject({ stripped: 25, removed: 20, waiting: 5 });
    expect(fake.files.size).toBe(5);
    expect(fake.rows("cockpit_csm_calls").every(c => c.summary === null && c.transcript_text === null)).toBe(true);
    expect(fake.rows("cockpit_csm_calls").filter(c => c.transcript_path !== null)).toHaveLength(5);
    const second = await storePass(ctxOf(fake, fathomApi([]).t), new Set());
    expect(second).toMatchObject({ stripped: 0, removed: 5, waiting: 0 });
    expect(fake.files.size).toBe(0);
    expect(fake.rows("cockpit_fathom_meetings").every(m => m.transcript_path === null)).toBe(true);
  });

  test("a dry run counts and changes nothing", async () => {
    const { fake, path } = indexedLate();
    const plan = await storePass(ctxOf(fake, fathomApi([]).t, { apply: false }), new Set(["900000301"]));
    expect(plan).toMatchObject({ reclassed: 1, stripped: 1, removed: 1, waiting: 0 });
    expect(fake.writes).toHaveLength(0);
    expect(fake.files.has(path)).toBe(true);
  });
});

describe("fathomSource: transcripts", () => {
  test("only client and candidate rows are fetched, newest first, 8 a run; a stripped sales row takes no slot", async () => {
    const seed = seedOf({ cockpit_sales_recordings: [{ recording_id: "900000500", hidden_reason: null }] });
    const sold = meeting(900000500, NOW - 10 * DAY + 9 * HOUR, { recorded_by: CLOSER, calendar_invitees: [OWNER] });
    seed.cockpit_fathom_meetings.push(storedMeeting(sold, "sales"));
    seed.cockpit_csm_calls.push(storedCall(300, sold, { summary: null }));
    const lines: Record<string, Row[]> = {};
    for (let i = 1; i <= 9; i++) {
      const m = meeting(900000500 + i, NOW - 10 * DAY + i * MIN, { calendar_invitees: [CSM_INVITE, OWNER] });
      seed.cockpit_fathom_meetings.push(storedMeeting(m, "client"));
      seed.cockpit_csm_calls.push(storedCall(300 + i, m, { task_id: CITY.taskId, match_method: "manual" }));
      lines[String(900000500 + i)] = [{ speaker: { display_name: "Test CSM" }, text: "An invented line.", timestamp: "00:00:01" }];
    }
    const fake = store(seed);
    const { t, asked } = fathomApi([], lines);
    const health = await fathomSource(ctxOf(fake, t), SINCE);
    const fetched = asked.filter(a => a.what === "transcript").map(a => a.id);
    expect(fetched).toEqual(["900000509", "900000508", "900000507", "900000506", "900000505", "900000504", "900000503", "900000502"]);
    expect(fetched).not.toContain("900000500");
    expect(callOf(fake, 900000509)).toMatchObject({ transcript_path: "fathom/900000509.txt", transcript_text: "[00:00:01] Test CSM: An invented line." });
    expect(meetingOf(fake, 900000509).transcript_path).toBe("fathom/900000509.txt");
    expect(callOf(fake, 900000500).transcript_path).toBeNull();
    expect(health.note).toContain("8 transcripts stored");
  });

  test("a candidate's hints learn who spoke; a recording Fathom no longer has is skipped", async () => {
    const T0 = NOW - 2 * DAY;
    const m = meeting(900000601, T0);
    const gone = meeting(900000602, T0 + HOUR, {}, 20);
    const fake = store(seedOf({ cockpit_csm_calls: [booking(47, MAKERS, T0 - 3 * DAY, { external_invitees: [{ email: "owner@makers.example", name: "Invented Contact" }] })] }));
    const lines = [
      { speaker: { display_name: "Test CSM" }, text: "An invented question.", timestamp: "00:00:02" },
      { speaker: { display_name: "invented  contact" }, text: "An invented answer.", timestamp: "00:00:09" },
    ];
    const ctx = ctxOf(fake, fathomApi([m, gone], { "900000601": lines, "900000602": 404 }).t);
    await fathomSource(ctx, SINCE);
    const row = callOf(fake, 900000601);
    expect(row.hints[0]).toMatchObject({ taskId: MAKERS.taskId, signal: "speaker_name", why: "Makers's contact spoke on this call." });
    expect(JSON.stringify(row.hints)).not.toMatch(/invented\s+contact/i);
    expect(callOf(fake, 900000602).transcript_path).toBeNull();
    await unmatchedQueue(ctx);
    expect(fake.one("cockpit_csm_unmatched", u => u.item_ref === String(row.id))?.hint).toBe("Makers's contact spoke on this call.");
    // The next run keeps the speaker's hint from the stored transcript.
    await fathomSource(ctxOf(fake, fathomApi([m, gone], { "900000602": 404 }).t), SINCE);
    expect(callOf(fake, 900000601).hints[0].signal).toBe("speaker_name");
  });
});

describe("fathomSource: the gone pass", () => {
  const T0 = NOW - 2 * DAY;
  const window = (n: number) => Array.from({ length: n }, (_, i) => teamMeeting(900000700 + i, T0 + i * HOUR));

  test("gone after two misses 60 minutes apart: content cleared, the object removed, and restored on its return", async () => {
    const kept = window(11);
    const lost = meeting(900000799, T0 - HOUR);
    const path = "fathom/900000799.txt";
    const fake = store(
      seedOf({
        cockpit_fathom_meetings: [...kept.map(m => storedMeeting(m, "internal")), storedMeeting(lost, "candidate", { transcript_path: path })],
        cockpit_csm_calls: [storedCall(400, lost, { candidate: true, transcript_path: path, transcript_text: "An invented line." })],
      }),
      { [path]: "An invented line." },
    );
    const run = (now: number, list: Row[]) => fathomSource(ctxOf(fake, fathomApi(list).t, { now }), SINCE);
    const first = await run(NOW, kept);
    expect(first.ok).toBe(true);
    expect(meetingOf(fake, 900000799)).toMatchObject({ missing_since: iso(NOW), gone_at: null });
    expect(meetingOf(fake, 900000799).summary).toContain("call 900000799");
    await run(NOW + 30 * MIN, kept);
    expect(meetingOf(fake, 900000799).gone_at).toBeNull();
    const third = await run(NOW + 61 * MIN, kept);
    expect(third.note).toContain("1 gone");
    expect(meetingOf(fake, 900000799)).toMatchObject({ missing_since: iso(NOW), gone_at: iso(NOW + 61 * MIN), summary: null, transcript_path: null });
    for (const key of ["default_summary", "action_items", "highlights"]) expect(Object.keys(meetingOf(fake, 900000799).raw)).not.toContain(key);
    expect(callOf(fake, 900000799)).toMatchObject({ status: "gone", summary: null, transcript_text: null, transcript_path: null });
    expect(fake.files.has(path)).toBe(false);
    // Fathom returns it again.
    await run(NOW + 2 * HOUR, [...kept, lost]);
    expect(meetingOf(fake, 900000799)).toMatchObject({ missing_since: null, gone_at: null, class: "candidate" });
    expect(meetingOf(fake, 900000799).summary).toContain("call 900000799");
    expect(meetingOf(fake, 900000799).raw.action_items).toHaveLength(1);
    expect(callOf(fake, 900000799)).toMatchObject({ status: "held", candidate: true });
    expect(callOf(fake, 900000799).summary).toContain("call 900000799");
  });

  test("4 missing marks nothing and turns csm-fathom red with the count", async () => {
    const all = window(40);
    const fake = store(seedOf({ cockpit_fathom_meetings: all.map(m => storedMeeting(m, "internal")) }));
    const health = await fathomSource(ctxOf(fake, fathomApi(all.slice(4)).t), SINCE);
    expect(health.ok).toBe(false);
    expect(health.note.startsWith("Fathom returned 4 fewer recordings than stored; nothing was marked gone.")).toBe(true);
    expect(fake.rows("cockpit_fathom_meetings").filter(m => m.missing_since !== null)).toHaveLength(0);
    // The rows Fathom did return are still written.
    expect(meetingOf(fake, 900000739).updated_at).toBe(iso(NOW));
  });

  test("more than 10% of the window marks nothing either; 3 of 40 are marked", async () => {
    const small = window(15);
    const few = store(seedOf({ cockpit_fathom_meetings: small.map(m => storedMeeting(m, "internal")) }));
    const capped = await fathomSource(ctxOf(few, fathomApi(small.slice(2)).t), SINCE);
    expect(capped.ok).toBe(false);
    expect(capped.note).toContain("Fathom returned 2 fewer recordings than stored; nothing was marked gone.");
    const all = window(40);
    const fake = store(seedOf({ cockpit_fathom_meetings: all.map(m => storedMeeting(m, "internal")) }));
    const health = await fathomSource(ctxOf(fake, fathomApi(all.slice(3)).t), SINCE);
    expect(health.ok).toBe(true);
    expect(fake.rows("cockpit_fathom_meetings").filter(m => m.missing_since === iso(NOW)).map(m => m.recording_id)).toEqual(["900000700", "900000701", "900000702"]);
  });

  test("recordings already gone do not count toward the cap: a new miss is still marked", async () => {
    const all = window(40);
    const fake = store(
      seedOf({
        cockpit_fathom_meetings: all.map((m, i) => storedMeeting(m, "internal", i < 3 ? { missing_since: iso(NOW - 2 * DAY), gone_at: iso(NOW - DAY) } : {})),
      }),
    );
    const health = await fathomSource(ctxOf(fake, fathomApi(all.slice(4)).t), SINCE);
    expect(health.ok).toBe(true);
    expect(meetingOf(fake, 900000703).missing_since).toBe(iso(NOW));
    expect(meetingOf(fake, 900000700).gone_at).toBe(iso(NOW - DAY));
  });

  test("a meeting created before the window is never counted", async () => {
    const kept = window(11);
    const older = teamMeeting(900000798, NOW - 30 * DAY);
    const fake = store(seedOf({ cockpit_fathom_meetings: [...kept, older].map(m => storedMeeting(m, "internal")) }));
    const health = await fathomSource(ctxOf(fake, fathomApi(kept).t), SINCE);
    expect(health.ok).toBe(true);
    expect(meetingOf(fake, 900000798).missing_since).toBeNull();
  });
});

describe("fathomActionsBackfill", () => {
  test("action items only, except that an internal or sales meeting is stripped with its call row and its object (a 404 counts)", async () => {
    const T0 = NOW - 20 * DAY;
    const client = meeting(900000801, T0, { calendar_invitees: [CSM_INVITE, OWNER] });
    const short = meeting(900000802, T0 + HOUR, {}, 4);
    const sold = meeting(900000803, T0 + 2 * HOUR, { recorded_by: CLOSER, calendar_invitees: [OWNER] });
    const light = (m: Row) => ({ ...m, default_summary: null, transcript: null });
    const fake = store(
      seedOf({
        cockpit_sales_recordings: [{ recording_id: "900000803", hidden_reason: "internal" }],
        cockpit_fathom_meetings: [
          storedMeeting({ ...client, action_items: null }, "client", { transcript_path: "fathom/900000801.txt" }),
          storedMeeting({ ...short, action_items: null }, "candidate"),
          storedMeeting(sold, "client", { transcript_path: "fathom/900000803.txt" }),
        ],
        cockpit_csm_calls: [
          storedCall(500, client, { task_id: CITY.taskId, match_method: "appointment_time", linked_call_id: 46, transcript_path: "fathom/900000801.txt", transcript_text: "An invented line." }),
          storedCall(501, sold, { transcript_path: "fathom/900000803.txt", transcript_text: "An invented line." }),
        ],
      }),
      { "fathom/900000801.txt": "An invented line." },
    );
    const { t, asked } = fathomApi([light(client), light(short), light(sold)]);
    const before = fake.rows("cockpit_csm_calls").length;
    const health = await fathomActionsBackfill(ctxOf(fake, t), "2026-09-25T00:00:00Z");
    expect(asked).toEqual([{ what: "meetings", params: { created_after: "2026-09-25T00:00:00Z", include_action_items: "true" } }]);
    expect(meetingOf(fake, 900000801)).toMatchObject({ class: "client", room: ZOOM_ROOM, recorder_team: CS, transcript_path: "fathom/900000801.txt" });
    expect(meetingOf(fake, 900000801).summary).toContain("call 900000801");
    expect(meetingOf(fake, 900000801).raw.action_items).toEqual(client.action_items);
    expect(meetingOf(fake, 900000801).raw.default_summary.markdown_formatted).toContain("call 900000801");
    // The light list has no summary: the stored one keeps a 4-minute call a candidate.
    expect(meetingOf(fake, 900000802)).toMatchObject({ class: "candidate" });
    expect(meetingOf(fake, 900000802).raw.action_items).toEqual(short.action_items);
    expect(meetingOf(fake, 900000803)).toMatchObject({ class: "sales", summary: null, transcript_path: null });
    for (const key of ["default_summary", "action_items", "highlights"]) expect(Object.keys(meetingOf(fake, 900000803).raw)).not.toContain(key);
    expect(callOf(fake, 900000803)).toMatchObject({ summary: null, transcript_text: null, transcript_path: null });
    expect(fake.removed).toEqual(["fathom/900000803.txt"]);
    expect(fake.files.has("fathom/900000801.txt")).toBe(true);
    expect(fake.rows("cockpit_csm_calls")).toHaveLength(before);
    expect(callOf(fake, 900000801)).toMatchObject({ task_id: CITY.taskId, match_method: "appointment_time", linked_call_id: 46, transcript_text: "An invented line." });
    expect(callOf(fake, 900000801).summary).toContain("call 900000801");
    expect(health).toMatchObject({ key: "csm-fathom-actions", ok: true });
    expect(health.note).toContain("3 stored meetings updated");
    expect(health.note).toContain("action items stored for 2; 1 stripped, 1 transcript objects removed.");
  });
});

describe("ghlSource", () => {
  test("each booking also stores the room its link opens", async () => {
    const t = {
      receipts: [],
      ghl: async (path: string) => {
        if (path === "calendars/") return { calendars: [{ id: "SHjlq0UjeR11maltYNyh", name: "Check-in" }] };
        if (path === "calendars/events")
          return {
            events: [
              { id: "ev1", startTime: iso(NOW + HOUR), endTime: iso(NOW + 2 * HOUR), address: "https://us06web.zoom.us/j/12345678901?pwd=TEST", contactId: "c1", appointmentStatus: "confirmed" },
              { id: "ev2", startTime: iso(NOW + 3 * HOUR), endTime: iso(NOW + 4 * HOUR), address: "https://meet.google.com/abc-defg-hij?authuser=0", contactId: "c1", appointmentStatus: "confirmed" },
              { id: "ev3", startTime: iso(NOW + 5 * HOUR), endTime: iso(NOW + 6 * HOUR), address: "https://maps.app.goo.gl/TEST", contactId: "c1", appointmentStatus: "confirmed" },
            ],
          };
        return { contact: { id: "c1", email: "owner@client.example", contactName: "Invented Contact", customFields: [{ id: "Csj6vsVH3wSRseT3OkMU", value: CITY.taskId }] } };
      },
    } as unknown as Transport;
    const fake = store(seedOf());
    await ghlSource(ctxOf(fake, t), NOW, NOW + DAY);
    const rooms = Object.fromEntries(fake.rows("cockpit_csm_calls").map(r => [r.source_id, [r.join_url, r.room]]));
    expect(rooms.ev1).toEqual(["https://us06web.zoom.us/j/12345678901?pwd=TEST", ZOOM_ROOM]);
    expect(rooms.ev2).toEqual(["https://meet.google.com/abc-defg-hij?authuser=0", MEET_ROOM]);
    expect(rooms.ev3).toEqual([null, null]);
  });
});

describe("typeformSource: the 1-1 form link", () => {
  const SUBMITTED = NOW - 3 * HOUR;
  const link = "https://fathom.video/share/TEST900000901";
  const response = {
    token: "tok-1",
    submitted_at: iso(SUBMITTED),
    hidden: { task_id: CITY.taskId },
    answers: [{ field: { ref: TRANSCRIPT_REF, type: "long_text" }, type: "text", text: `Invented notes. ${link} and ${link}?timestamp=300` }],
  };
  const typeform = {
    receipts: [],
    typeform: async (path: string) => {
      if (path === "forms/fRokTITH/responses") return { items: [clone(response)], total_items: 1 };
      if (path.endsWith("/responses")) return { items: [], total_items: 0 };
      return { fields: [{ ref: TRANSCRIPT_REF, title: "Fathom link and notes" }] };
    },
  } as unknown as Transport;
  const recording = meeting(900000901, SUBMITTED - 2 * HOUR);
  const seed = (call: Row, extra: Row[] = []) =>
    seedOf({
      cockpit_fathom_meetings: [storedMeeting(recording, "candidate")],
      cockpit_csm_calls: [
        // A booked check-in within 48 h, which the form went to before.
        booking(48, CITY, SUBMITTED - 20 * HOUR),
        call,
        // The form's own held call from an earlier run.
        { id: 601, source: "checkin_form", source_id: "tok-1", task_id: CITY.taskId, match_method: "form_task_id", kind: "checkin", status: "held", starts_at: iso(SUBMITTED), linked_call_id: null },
        ...extra,
      ],
      cockpit_csm_call_forms: [{ token: "tok-1", form_id: "fRokTITH", task_id: CITY.taskId, matched_by: "hidden_field", linked_call_id: 601 }],
    });
  const heldOnCard = (fake: Fake) => fake.rows("cockpit_csm_calls").filter(r => r.task_id === CITY.taskId && r.status === "held" && r.source !== "ghl_appointment");

  test("an impromptu recording attached by its form link leaves exactly one held call on the card", async () => {
    const fake = store(seed(storedCall(600, recording, { task_id: CITY.taskId, match_method: "form_task_id" })));
    const ctx = ctxOf(fake, typeform);
    const [health] = await typeformSource(ctx);
    expect(ctx.shareToTask.get(link)).toBe(CITY.taskId);
    expect(fake.one("cockpit_csm_call_forms", f => f.token === "tok-1")?.linked_call_id).toBe(600);
    expect(fake.one("cockpit_csm_calls", r => r.id === 601)).toMatchObject({ status: "gone", linked_call_id: 600 });
    expect(heldOnCard(fake).map(r => r.id)).toEqual([600]);
    expect(fake.rows("cockpit_csm_calls").filter(r => r.source === "checkin_form")).toHaveLength(1);
    expect(health.note).toContain("1 linked to their recording, 0 to a booked check-in, 0 on their own");
  });

  test("the form goes under the recording's booking when that booking is on the card and not gone, else the recording's row", async () => {
    const parent = booking(49, CITY, SUBMITTED - 2 * HOUR, { kind: "blueprint" });
    const linked = store(seed(storedCall(600, recording, { task_id: CITY.taskId, match_method: "same_room", linked_call_id: 49 }), [parent]));
    await typeformSource(ctxOf(linked, typeform));
    expect(linked.one("cockpit_csm_call_forms", f => f.token === "tok-1")?.linked_call_id).toBe(49);
    expect(linked.one("cockpit_csm_calls", r => r.id === 601)).toMatchObject({ status: "gone", linked_call_id: 49 });
    const gone = store(seed(storedCall(600, recording, { task_id: CITY.taskId, match_method: "same_room", linked_call_id: 49 }), [{ ...parent, status: "gone" }]));
    await typeformSource(ctxOf(gone, typeform));
    expect(gone.one("cockpit_csm_call_forms", f => f.token === "tok-1")?.linked_call_id).toBe(600);
  });

  test("the first run after the form: read, the Fathom source places the impromptu recording by its link, then the form goes under it, with no booked check-in and no call of its own in between", async () => {
    // Before the run: the recording is an unplaced candidate (stored), or not stored yet; the form was never read.
    const seeds = {
      stored: () =>
        seedOf({
          cockpit_fathom_meetings: [storedMeeting(recording, "candidate")],
          cockpit_csm_calls: [booking(48, CITY, SUBMITTED - 20 * HOUR), storedCall(600, recording, { candidate: true })],
        }),
      new: () => seedOf({ cockpit_csm_calls: [booking(48, CITY, SUBMITTED - 20 * HOUR)] }),
    };
    for (const [how, seedFor] of Object.entries(seeds)) {
      const fake = store(seedFor());
      const t = { ...typeform, ...fathomApi([recording]).t } as unknown as Transport;
      const ctx = ctxOf(fake, t);
      // The worker's order (worker.ts): read the forms, run the Fathom source, link the forms.
      const read = await readTypeforms(ctx);
      expect(fake.rows("cockpit_csm_call_forms")).toHaveLength(0);
      await fathomSource(ctx, SINCE);
      const [health] = await linkTypeforms(ctx, read);
      const call = callOf(fake, 900000901);
      expect(call, how).toMatchObject({ task_id: CITY.taskId, match_method: "form_task_id", candidate: false });
      expect(fake.one("cockpit_csm_call_forms", f => f.token === "tok-1")?.linked_call_id, how).toBe(call.id);
      expect(fake.rows("cockpit_csm_calls").filter(r => r.source === "checkin_form"), how).toHaveLength(0);
      expect(heldOnCard(fake).map(r => r.id), how).toEqual([call.id]);
      expect(health.note, how).toContain("1 linked to their recording, 0 to a booked check-in, 0 on their own");
    }
    // Linked before the Fathom source runs (the order before), the same first run put the form on the booked check-in.
    const before = store(seeds.stored());
    await typeformSource(ctxOf(before, typeform));
    expect(before.one("cockpit_csm_call_forms", f => f.token === "tok-1")?.linked_call_id).toBe(48);
  });

  test("the worker reads the forms before the Fathom source and links them after it", () => {
    const run = readFileSync(join(import.meta.dir, "worker.ts"), "utf8");
    const at = (s: string) => {
      expect(run.split(s)).toHaveLength(2);
      return run.indexOf(s);
    };
    const fathomRun = 'fathomSource(ctx, new Date(lookback("csm-fathom"';
    expect(at("forms = await readTypeforms(ctx)")).toBeLessThan(at(fathomRun));
    expect(at(fathomRun)).toBeLessThan(at("await linkTypeforms(ctx, forms)"));
    expect(run).not.toContain("typeformSource");
  });

  test("a recording on another client, or none at all, leaves the form to the booked check-in as before", async () => {
    const fake = store(seed(storedCall(600, recording, { task_id: MAKERS.taskId, match_method: "same_room" })));
    await typeformSource(ctxOf(fake, typeform));
    expect(fake.one("cockpit_csm_call_forms", f => f.token === "tok-1")?.linked_call_id).toBe(48);
    expect(fake.one("cockpit_csm_calls", r => r.id === 601)).toMatchObject({ status: "gone", linked_call_id: 48 });
  });
});
