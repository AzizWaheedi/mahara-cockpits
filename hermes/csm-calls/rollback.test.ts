/**
 * The rollback release (docs/forms/STAGE2-CONTRACT.md 4.7): release 2cacdca5 with
 * rollback/2cacdca5.patch applied by patch -p1, as deploy step 6 stages it. The
 * old files are read with git show into a scratch folder outside the repository,
 * patched there, and the old fathomSource runs against an in-memory store. The
 * same files unpatched are the control: each guard is shown to change what the
 * old release did, and nothing else. People, links and lines are invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyMeeting } from "./fathomRules.ts";

type Row = Record<string, any>;
const RELEASE = "2cacdca5";
// Bun's own platform path of this folder: a file URL's pathname is "/C:/..." on Windows and keeps %20 for a space.
const HERE = import.meta.dir;
const PATCH = join(HERE, "rollback", `${RELEASE}.patch`);

const run = (cmd: string[], cwd: string, stdin?: Uint8Array) => {
  const r = Bun.spawnSync(cmd, { cwd, stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${new TextDecoder().decode(r.stderr).slice(0, 300)}`);
  return new TextDecoder().decode(r.stdout);
};

let scratch = "";
let files: string[] = [];
const roots = { plain: "", patched: "" };
let patchOutput = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "csm-rollback-"));
  const top = run(["git", "rev-parse", "--show-toplevel"], HERE).trim();
  files = run(["git", "ls-tree", "--name-only", `${RELEASE}:hermes/csm-calls`], top).split("\n").filter(Boolean);
  for (const which of ["plain", "patched"] as const) {
    roots[which] = join(scratch, which);
    mkdirSync(join(roots[which], "hermes/csm-calls"), { recursive: true });
    for (const f of files)
      writeFileSync(join(roots[which], "hermes/csm-calls", f), run(["git", "show", `${RELEASE}:hermes/csm-calls/${f}`], top));
  }
  patchOutput = run(["patch", "-p1"], roots.patched, readFileSync(PATCH));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

test("the patch applies to release 2cacdca5 with patch -p1 and changes sources.ts only", () => {
  expect(files).toEqual(["RUNBOOK.md", "eods.test.ts", "eods.ts", "lib.test.ts", "lib.ts", "match.test.ts", "match.ts", "run.sh", "sources.test.ts", "sources.ts", "worker.ts"]);
  expect(patchOutput).toContain("hermes/csm-calls/sources.ts");
  expect(readdirSync(join(roots.patched, "hermes/csm-calls")).sort()).toEqual([...files].sort());
  for (const f of files) {
    const same = readFileSync(join(roots.plain, "hermes/csm-calls", f), "utf8") === readFileSync(join(roots.patched, "hermes/csm-calls", f), "utf8");
    expect([f, same]).toEqual([f, f !== "sources.ts"]);
  }
  const patched = readFileSync(join(roots.patched, "hermes/csm-calls/sources.ts"), "utf8");
  expect(patched).toContain("if (!(s.raw?.calendar_invitees ?? []).some((i: Row) => i.is_external)) continue;");
  expect(patched).toContain("select=recording_id,raw,class&recording_id=in.(");
  expect(patched).toContain('const more = source === "fathom" ? ",client_name,linked_call_id,kind" : "";');
  expect(patched).toContain("if (prior.kind) row.kind = prior.kind;");
  expect(patched).toContain("if (prior.client_name) row.client_name = prior.client_name;");
});

// ---------------------------------------------------------------- a small store for the old code's queries
//
// With the meetings privacy trigger of migration 20261027g, which every rollback runs under: a meeting
// written without a class gets one by the rule of 4.2 (the old release never writes class), and an
// internal or sales meeting keeps no summary and no content keys.

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function holds(r: Row, col: string, cond: string): boolean {
  const neg = cond.startsWith("not.");
  const [op, ...rest] = (neg ? cond.slice(4) : cond).split(".");
  const arg = rest.join(".");
  const v = r[col];
  const ok =
    op === "is" ? v == null
    : v == null ? false
    : op === "eq" ? String(v) === arg
    : op === "neq" ? String(v) !== arg
    : op === "in" ? arg.replace(/^\(|\)$/g, "").split(",").includes(String(v))
    : (() => {
        throw new Error(`The fake does not know ${op}`);
      })();
  return neg ? !ok : ok;
}
function store(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = clone(seed);
  const writes: { op: string; table: string; filter?: string; values?: Row }[] = [];
  const asked: string[] = [];
  let nextId = 900;
  const t = (name: string) => (tables[name] ??= []);
  const trigger = (name: string, r: Row) => {
    if (name !== "cockpit_fathom_meetings") return;
    if (r.class == null) {
      const sales = new Set(t("cockpit_sales_recordings").filter(x => (x.hidden_reason ?? "") !== "client service").map(x => String(x.recording_id)));
      const summary = r.summary ? { markdown_formatted: r.summary } : null;
      r.class = classifyMeeting({ ...r.raw, recording_id: r.recording_id, default_summary: summary }, sales);
    }
    if (r.class === "internal" || r.class === "sales") {
      r.summary = null;
      r.raw = Object.fromEntries(Object.entries(r.raw ?? {}).filter(([k]) => !["default_summary", "action_items", "highlights", "transcript"].includes(k)));
    }
  };
  const db = {
    async all(name: string, query: string) {
      asked.push(`${name}?${query}`);
      let select: string[] | undefined;
      let order: string | undefined;
      const filters: ((r: Row) => boolean)[] = [];
      for (const part of query.split("&")) {
        const i = part.indexOf("=");
        const [k, v] = [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
        if (k === "select") select = v.split(",");
        else if (k === "order") order = v;
        else filters.push(r => holds(r, k, v));
      }
      let rows = t(name).filter(r => filters.every(f => f(r)));
      if (order) {
        const [col, dir] = order.split(".");
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
      }
      return rows.map(r => (select ? Object.fromEntries(select.map(c => [c, clone(r[c])])) : clone(r)));
    },
    async upsert(name: string, rows: Row[], on: string) {
      for (const row of rows) {
        const keys = on.split(",");
        let found = t(name).find(r => keys.every(k => String(r[k]) === String(row[k])));
        if (found) Object.assign(found, clone(row));
        else {
          found = clone(row);
          t(name).push(found);
        }
        trigger(name, found);
      }
    },
    async insertReturning(name: string, rows: Row[], on: string) {
      const out: Row[] = [];
      for (const row of rows) {
        const keys = on.split(",");
        let found = t(name).find(r => keys.every(k => String(r[k]) === String(row[k])));
        if (found) Object.assign(found, clone(row));
        else {
          found = { id: nextId++, ...clone(row) };
          t(name).push(found);
        }
        out.push({ id: found.id, source: found.source, source_id: found.source_id });
      }
      return out;
    },
    async patch(name: string, filter: string, values: Row) {
      writes.push({ op: "patch", table: name, filter, values: clone(values) });
      const conds = filter.split("&").map(p => [p.slice(0, p.indexOf("=")), decodeURIComponent(p.slice(p.indexOf("=") + 1))]);
      for (const r of t(name).filter(r => conds.every(([k, v]) => holds(r, k, v)))) {
        Object.assign(r, clone(values));
        trigger(name, r);
      }
    },
    async storage() {},
    async insert() {},
  };
  return { db, tables, writes, asked, one: (name: string, f: (r: Row) => boolean) => t(name).find(f) };
}

const NOW = Date.parse("2026-10-28T09:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const CITY = { taskId: "86exc1tyw", name: "City Wood", aliases: ["citywood"] };
const MAKERS = { taskId: "86exmak3r", name: "Makers", aliases: [] };
const CSM = { name: "Test CSM", email: "csm@maharamedia.com", team: "Customer Success" };
const CLOSER = { name: "Test Closer", email: "closer@maharamedia.com", team: "Sales" };
const OWNER = { name: "Invented Owner", email: "owner@citywood.example", is_external: true };

function meeting(id: number, start: number, over: Row = {}): Row {
  return {
    recording_id: id,
    title: "Impromptu Zoom Meeting",
    meeting_title: "Impromptu Zoom Meeting",
    created_at: iso(start + 31 * 60_000),
    recording_start_time: iso(start),
    recording_end_time: iso(start + 30 * 60_000),
    share_url: `https://fathom.video/share/TEST${id}`,
    url: `https://fathom.video/calls/${id + 100}`,
    meeting_url: "https://us05web.zoom.us/j/12345678901?pwd=TEST",
    calendar_invitees_domains_type: "one_or_more_external",
    shared_with: "all_teams",
    recorded_by: CSM,
    calendar_invitees: [{ name: "Test CSM", email: CSM.email, is_external: false }],
    default_summary: null,
    action_items: null,
    ...over,
  };
}
const callRow = (id: number, m: Row, over: Row = {}): Row => ({
  id,
  source: "fathom",
  source_id: String(m.recording_id),
  task_id: null,
  match_method: null,
  status: "held",
  starts_at: m.recording_start_time,
  transcript_path: null,
  ...over,
});
const meetingRow = (m: Row, cls: string): Row => ({ recording_id: String(m.recording_id), class: cls, raw: m, share_url: m.share_url });

/** Fathom for the old release: its meetings list, and its ±1 s window reads for transcripts. */
function fathom(list: Row[], stored: Row[]) {
  const asked: { transcriptFor?: string }[] = [];
  return {
    asked,
    t: {
      receipts: [],
      fathom: async (p: URLSearchParams) => {
        if (p.get("include_transcript") !== "true") return { items: clone(list), next_cursor: null };
        const from = Date.parse(p.get("created_after")!);
        const hit = stored.find(m => Math.abs(Date.parse(m.created_at) - (from + 1000)) < 1000);
        asked.push({ transcriptFor: hit ? String(hit.recording_id) : undefined });
        return { items: hit ? [{ ...clone(hit), transcript: [{ speaker: { display_name: "Test CSM" }, text: "An invented line.", timestamp: "00:00:01" }] }] : [] };
      },
    },
  };
}

async function oldRun(which: "plain" | "patched", seed: Record<string, Row[]>, list: Row[], stored: Row[]) {
  const { fathomSource } = await import(join(roots[which], "hermes/csm-calls/sources.ts"));
  const fake = store(seed);
  const api = fathom(list, stored);
  const ctx = {
    db: fake.db,
    t: api.t,
    apply: true,
    now: NOW,
    clients: [CITY, MAKERS],
    reasons: new Map(),
    shareToTask: new Map(),
    stateOf: () => undefined,
    plan: {},
  };
  await fathomSource(ctx, "2026-10-21T09:00:00Z");
  return { ...fake, fetched: api.asked.map(a => a.transcriptFor), reasons: ctx.reasons };
}

describe("the rollback release's three guards", () => {
  test("a stored candidate whose edited title names a client stays unattached", async () => {
    const candidate = meeting(900001001, NOW - 10 * 86_400_000, { title: "City Wood follow up" });
    const seed = () => ({
      cockpit_fathom_meetings: [meetingRow(candidate, "candidate")],
      cockpit_csm_calls: [callRow(10, candidate, { candidate: true, transcript_path: "fathom/900001001.txt" })],
    });
    // The bare release attaches it by the name in its title, at 0.6.
    const plain = await oldRun("plain", seed(), [], [candidate]);
    expect(plain.one("cockpit_csm_calls", r => r.id === 10)).toMatchObject({ task_id: CITY.taskId, match_method: "name", match_confidence: 0.6 });
    const patched = await oldRun("patched", seed(), [], [candidate]);
    expect(patched.one("cockpit_csm_calls", r => r.id === 10)).toMatchObject({ task_id: null, match_method: null });
    expect(patched.writes.filter(w => w.filter === "id=eq.10")).toHaveLength(0);
    expect([...patched.reasons.keys()]).toEqual([]);
  });

  test("a stored external row still re-matches as before", async () => {
    const start = NOW - 9 * 86_400_000;
    const external = meeting(900001002, start, { calendar_invitees: [{ name: "Test CSM", email: CSM.email, is_external: false }, OWNER] });
    const seed = () => ({
      cockpit_fathom_meetings: [meetingRow(external, "client")],
      cockpit_csm_calls: [
        { id: 46, source: "ghl_appointment", task_id: CITY.taskId, kind: "checkin", starts_at: iso(start + 10 * 60_000), external_invitees: [{ email: OWNER.email, name: OWNER.name }] },
        callRow(11, external, { transcript_path: "fathom/900001002.txt" }),
      ],
    });
    const results = [];
    for (const which of ["plain", "patched"] as const) {
      const r = await oldRun(which, seed(), [], [external]);
      results.push(r.one("cockpit_csm_calls", x => x.id === 11));
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[1]).toMatchObject({ task_id: CITY.taskId, match_method: "appointment_time", match_confidence: 1, linked_call_id: 46 });
  });

  test("a stripped sales call row is never fetched, and a client row's transcript still is", async () => {
    const sold = meeting(900001003, NOW - 8 * 86_400_000, { recorded_by: CLOSER, calendar_invitees: [OWNER] });
    const client = meeting(900001004, NOW - 9 * 86_400_000, { calendar_invitees: [OWNER] });
    const seed = () => ({
      cockpit_sales_recordings: [{ recording_id: "900001003" }],
      cockpit_fathom_meetings: [meetingRow(sold, "sales"), meetingRow(client, "client")],
      cockpit_csm_calls: [callRow(12, sold), callRow(13, client, { task_id: CITY.taskId, match_method: "manual" })],
    });
    // The bare release downloads the stripped sales transcript again (the newest row first).
    const plain = await oldRun("plain", seed(), [], [sold, client]);
    expect(plain.fetched).toEqual(["900001003", "900001004"]);
    expect(plain.one("cockpit_csm_calls", r => r.id === 12)?.transcript_path).toBe("fathom/900001003.txt");
    const patched = await oldRun("patched", seed(), [], [sold, client]);
    expect(patched.fetched).toEqual(["900001004"]);
    expect(patched.one("cockpit_csm_calls", r => r.id === 12)?.transcript_path).toBeNull();
    expect(patched.one("cockpit_csm_calls", r => r.id === 13)?.transcript_path).toBe("fathom/900001004.txt");
    // The class is read once for the whole list, before any of the 8 slots is taken.
    expect(patched.asked.filter(q => q.startsWith("cockpit_fathom_meetings?select=recording_id,raw,class&recording_id=in.("))).toHaveLength(1);
  });

  test("a Fathom row placed by hand keeps the booking link, the kind and the name the 2a manual match wrote", async () => {
    // An external meeting of the window whose invitee is on no booking; the CSM put it on City Wood from the
    // queue, and the 2a manual match linked City Wood's check-in 10 minutes later and took its kind.
    const start = NOW - 2 * 86_400_000;
    const guest = { name: "Invented Guest", email: "guest@elsewhere.example", is_external: true };
    const placed = meeting(900001006, start, { calendar_invitees: [{ name: "Test CSM", email: CSM.email, is_external: false }, guest] });
    const seed = () => ({
      cockpit_fathom_meetings: [meetingRow(placed, "client")],
      cockpit_csm_calls: [
        { id: 46, source: "ghl_appointment", task_id: CITY.taskId, kind: "checkin", starts_at: iso(start + 10 * 60_000), external_invitees: [] },
        callRow(20, placed, { task_id: CITY.taskId, client_name: CITY.name, match_method: "manual", match_confidence: 1, linked_call_id: 46, kind: "checkin" }),
      ],
    });
    // The bare release rewrites it on City Wood but drops the link (so the card shows two calls) and the kind, and blanks the name.
    const plain = await oldRun("plain", seed(), [placed], [placed]);
    expect(plain.one("cockpit_csm_calls", r => r.id === 20)).toMatchObject({ task_id: CITY.taskId, match_method: "manual", linked_call_id: null, kind: "other", client_name: null });
    // Two runs of the rollback release, the second over what the first left: the row stays as the person placed it.
    let tables: Record<string, Row[]> = seed();
    for (let run = 0; run < 2; run++) {
      const patched = await oldRun("patched", tables, [placed], [placed]);
      tables = patched.tables;
      expect(patched.one("cockpit_csm_calls", r => r.id === 20)).toMatchObject({
        task_id: CITY.taskId,
        client_name: CITY.name,
        match_method: "manual",
        match_confidence: 1,
        linked_call_id: 46,
        kind: "checkin",
      });
      // Only Fathom rows read the three columns.
      expect(patched.asked).toContain("cockpit_csm_calls?select=id,source_id,task_id,match_method,status,transcript_path,client_name,linked_call_id,kind&source=eq.fathom");
    }
  });

  test("its own rows are unchanged: an external meeting in the window is still stored and matched as the old release did", async () => {
    const start = NOW - 2 * 86_400_000;
    const external = meeting(900001005, start, { calendar_invitees: [OWNER], title: "City Wood - Check In" });
    const seed = () => ({ cockpit_csm_calls: [] as Row[] });
    const rows = [];
    for (const which of ["plain", "patched"] as const) {
      const r = await oldRun(which, seed(), [external], [external]);
      rows.push([r.tables.cockpit_fathom_meetings, r.tables.cockpit_csm_calls]);
    }
    expect(rows[1]).toEqual(rows[0]);
  });
});
