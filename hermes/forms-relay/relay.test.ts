/**
 * hermes/forms-relay (docs/forms/WAVE56-CONTRACT.md 3.8, 4.14.4): a fake database outbox, a fake Client Data sheet
 * and a fake GitHub. Every client, card and value is invented; nothing reaches a provider.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerFetch, NotSent, resourceOf } from "./providers.ts";
import {
  type Answer,
  columnIndex,
  type Config,
  dispatchBody,
  hasCardRow,
  kuwaitDay,
  readConfig,
  type RelayRow,
  type Row,
  rowValues,
  runOnce,
  SAY,
  TEST_CARD,
} from "./relay.ts";
import { doctor, readApply, readEnv } from "./worker.ts";

const REF_NAME = "514bfd3f-4ca1-469e-b9e7-87656503f65c";
const VALUES = {
  CLIENT_DATA_SHEET_ID: "sheetInvented01",
  CLIENT_DATA_TAB: "Client Data",
  CLIENT_DATA_CARD_COLUMN: "C",
  CLIENT_DATA_COLUMNS: JSON.stringify({
    A: "client",
    B: "kuwaitDay",
    C: "task",
    E: `answer:${REF_NAME}`,
    F: "const:",
  }),
  DISPATCH_OWNER: "invented-org",
  DISPATCH_REPO: "market-intel",
  DISPATCH_NAME_KEY: "client_name",
  DISPATCH_ID_KEY: "clickup_id",
};
const CONFIG = readConfig(VALUES).config as Config;
const PAYLOAD = {
  taskId: "86card0001",
  client: "Cedar Homes",
  submittedAt: "2026-11-02T21:30:00Z",
  answers: { [REF_NAME]: "Cedar Homes Co" },
};

function world(
  opts: {
    rows?: RelayRow[];
    sheet?: unknown[][];
    append?: Answer;
    keep?: boolean;
    dispatch?: Answer;
    counts?: Row | "throw";
    apply?: boolean;
  } = {},
) {
  const rpcs: { name: string; args: Row }[] = [];
  const healths: Row[] = [];
  const sheet = opts.sheet ?? [
    ["Client", "Day", "Card"],
    ["Old Client", "2026-10-01", "86old00001"],
  ];
  const appended: string[][] = [];
  const dispatched: Row[] = [];
  let reads = 0;
  const deps = {
    apply: opts.apply ?? true,
    config: CONFIG,
    configProblems: [],
    db: {
      rpc: async (name: string, args: Row = {}) => {
        rpcs.push({ name, args });
        if (name === "cockpit_form_relay_claim")
          return { rows: opts.rows ?? [] };
        if (name === "cockpit_form_relay_counts") {
          if (opts.counts === "throw") throw new Error("Supabase 503");
          return { byState: opts.counts ?? {} };
        }
        return { ok: true };
      },
      health: async (h: Row) => {
        healths.push(h);
      },
    },
    sheet: {
      read: async () => {
        reads++;
        return structuredClone(sheet);
      },
      append: async (row: string[]) => {
        appended.push(row);
        if (opts.keep !== false && (opts.append?.ok ?? true)) sheet.push(row);
        return opts.append ?? { ok: true, status: 200 };
      },
    },
    github: {
      dispatch: async (body: Row) => {
        dispatched.push(body);
        return opts.dispatch ?? { ok: true, status: 204 };
      },
    },
  };
  const done = () =>
    rpcs
      .filter(r => r.name === "cockpit_form_relay_done")
      .map(r => [r.args.p_id, r.args.p_outcome, r.args.p_detail.reason]);
  return {
    deps,
    rpcs,
    healths,
    appended,
    dispatched,
    done,
    reads: () => reads,
  };
}
const row = (
  id: number,
  effectKey: RelayRow["effectKey"],
  taskId = PAYLOAD.taskId,
  payload: Row = PAYLOAD,
): RelayRow => ({
  id,
  claim: `claim-${id}`,
  effectKey,
  taskId,
  responseId: "8f0c1d2e-0000-4000-8000-000000000001",
  payload: { ...payload, taskId },
  attempts: 1,
});

describe("the config", () => {
  test("every line named when missing, never a value; the card column must hold the card", () => {
    expect(readConfig({}).problems).toHaveLength(8);
    expect(readConfig({}).problems[0]).toBe(
      "CLIENT_DATA_SHEET_ID is not set in ~/.forms-relay/config.env.",
    );
    expect(
      readConfig({ ...VALUES, CLIENT_DATA_COLUMNS: "{not json" }).problems,
    ).toEqual(["CLIENT_DATA_COLUMNS is not a JSON object of column letters."]);
    expect(
      readConfig({
        ...VALUES,
        CLIENT_DATA_COLUMNS: JSON.stringify({ A: "task" }),
      }).problems,
    ).toEqual([
      "CLIENT_DATA_COLUMNS must put the card id (task) in CLIENT_DATA_CARD_COLUMN.",
    ]);
    expect(
      readConfig({
        ...VALUES,
        CLIENT_DATA_COLUMNS: JSON.stringify({ C: "task", D: "phone_of_owner" }),
      }).problems,
    ).toEqual([
      "CLIENT_DATA_COLUMNS gives column D a source the relay does not know.",
    ]);
    expect(CONFIG.dispatchEvent).toBe("market_intel");
  });

  test("the row from A to the last mapped column, the dispatch body under the blueprint's keys", () => {
    expect(columnIndex("A")).toBe(0);
    expect(columnIndex("AA")).toBe(26);
    expect(kuwaitDay("2026-11-02T21:30:00Z")).toBe("2026-11-03");
    expect(rowValues(CONFIG, PAYLOAD)).toEqual([
      "Cedar Homes",
      "2026-11-03",
      "86card0001",
      "",
      "Cedar Homes Co",
      "",
    ]);
    expect(dispatchBody(CONFIG, PAYLOAD)).toEqual({
      event_type: "market_intel",
      client_payload: { client_name: "Cedar Homes", clickup_id: "86card0001" },
    });
    expect(hasCardRow([["a", "b", " 86card0001 "]], "C", "86card0001")).toBe(
      true,
    );
    expect(hasCardRow([["86card0001"]], "C", "86card0001")).toBe(false);
  });
});

describe("a run", () => {
  test("switched off: nothing claimed; counts and keys only, never a value", async () => {
    const w = world({ apply: false, counts: { queued: 2, sent: 4 } });
    const r = await runOnce(w.deps);
    expect(w.rpcs.map(x => x.name)).toEqual(["cockpit_form_relay_counts"]);
    expect(r.note).toBe(
      SAY.dry(
        2,
        "Client Data columns A, B, C, E, F; dispatch keys client_name, clickup_id",
      ),
    );
    expect(r.note).not.toContain("Cedar");
    const empty = world({ apply: false, counts: { sent: 4 } });
    expect((await runOnce(empty.deps)).note).toBe("Nothing to relay.");
    const unread = world({ apply: false, counts: "throw" });
    expect(await runOnce(unread.deps)).toMatchObject({
      ok: false,
      note: SAY.uncounted,
    });
  });

  test("the sheet is read before writing; a row already there is sent once with nothing written", async () => {
    const w = world({
      rows: [row(1, "client_data_row")],
      sheet: [["Cedar Homes", "2026-11-03", "86card0001"]],
    });
    const r = await runOnce(w.deps);
    expect(w.appended).toEqual([]);
    expect(w.done()).toEqual([[1, "sent", "already there"]]);
    expect(r).toMatchObject({ ok: true, counts: { sent: 1 } });
  });

  test("a new row is appended once, read back, and recorded sent; the dispatch is sent once", async () => {
    const w = world({
      rows: [row(1, "client_data_row"), row(2, "github_dispatch")],
    });
    const r = await runOnce(w.deps);
    expect(w.appended).toEqual([
      ["Cedar Homes", "2026-11-03", "86card0001", "", "Cedar Homes Co", ""],
    ]);
    expect(w.reads()).toBe(2);
    expect(w.dispatched).toEqual([
      {
        event_type: "market_intel",
        client_payload: {
          client_name: "Cedar Homes",
          clickup_id: "86card0001",
        },
      },
    ]);
    expect(w.done()).toEqual([
      [1, "sent", "Written."],
      [2, "sent", "Dispatched."],
    ]);
    expect(r.note).toBe("Relayed 2 rows: 2 sent.");
    expect(w.healths[0]).toMatchObject({ key: "forms-relay", ok: true });
  });

  test("the test card is never written to the sheet or dispatched", async () => {
    const w = world({
      rows: [
        row(1, "client_data_row", TEST_CARD),
        row(2, "github_dispatch", TEST_CARD),
      ],
    });
    await runOnce(w.deps);
    expect(w.appended).toEqual([]);
    expect(w.dispatched).toEqual([]);
    expect(w.done()).toEqual([
      [1, "skipped", SAY.canarySheet],
      [2, "skipped", SAY.canaryDispatch],
    ]);
    // Its own row on the sheet still reads as already there.
    const there = world({
      rows: [row(1, "client_data_row", TEST_CARD)],
      sheet: [["Test card", "", TEST_CARD]],
    });
    await runOnce(there.deps);
    expect(there.done()).toEqual([[1, "sent", "already there"]]);
  });

  test("a refused write is failed (tried again by the database); an unclear one or a row that never shows is unknown", async () => {
    const refused = world({
      rows: [row(1, "client_data_row")],
      append: { ok: false, status: 403, definite: true },
    });
    expect((await runOnce(refused.deps)).ok).toBe(false);
    expect(refused.done()).toEqual([[1, "failed", SAY.sheetRefused(403)]]);
    const unclear = world({
      rows: [row(1, "client_data_row")],
      append: { ok: false, status: 503, definite: false },
    });
    await runOnce(unclear.deps);
    expect(unclear.done()).toEqual([[1, "unknown", SAY.sheetUnsure]]);
    const lost = world({ rows: [row(1, "client_data_row")], keep: false });
    await runOnce(lost.deps);
    expect(lost.done()).toEqual([[1, "unknown", SAY.notBack]]);
    const gh = world({
      rows: [row(2, "github_dispatch")],
      dispatch: { ok: false, status: 0, definite: false },
    });
    await runOnce(gh.deps);
    expect(gh.done()).toEqual([[2, "unknown", SAY.dispatchUnsure]]);
    const ghNo = world({
      rows: [row(2, "github_dispatch")],
      dispatch: { ok: false, status: 404, definite: true },
    });
    await runOnce(ghNo.deps);
    expect(ghNo.done()).toEqual([[2, "failed", SAY.dispatchRefused(404)]]);
  });

  test("nothing claimed: Nothing to relay; no config: nothing claimed and the gap said", async () => {
    const w = world({ rows: [] });
    expect((await runOnce(w.deps)).note).toBe("Nothing to relay.");
    const none = world({ rows: [row(1, "client_data_row")] });
    const r = await runOnce({
      ...none.deps,
      config: null,
      configProblems: [
        "DISPATCH_REPO is not set in ~/.forms-relay/config.env.",
      ],
    });
    expect(r).toMatchObject({
      ok: false,
      note: "The relay is not set up: DISPATCH_REPO is not set in ~/.forms-relay/config.env. Nothing was claimed.",
    });
    expect(none.rpcs).toEqual([]);
  });
});

describe("the ledger", () => {
  test("an intent receipt before each call, a response after; only the named hosts and POSTs; ids collapsed", async () => {
    const receipts: Row[] = [];
    const calls: string[] = [];
    const f = ledgerFetch(
      async r => {
        receipts.push(r);
      },
      "forms-relay:run:test",
      (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    );
    const res = await f(
      "https://api.github.com/repos/invented-org/market-intel/dispatches",
      { method: "POST", body: "{}" },
    );
    expect(res.status).toBe(204);
    expect(
      receipts.map(r => [r.provider, r.method, r.phase, r.http_status]),
    ).toEqual([
      ["github", "POST", "intent", null],
      ["github", "POST", "response", 204],
    ]);
    expect(receipts[0].resource).toBe(
      "api.github.com/repos/invented-org/market-intel/dispatches",
    );
    expect(
      resourceOf(
        new URL(
          "https://sheets.googleapis.com/v4/spreadsheets/1_0Nv-IFvzhH4NBNh1dx/values/A:ZZ",
        ),
      ),
    ).toBe("sheets.googleapis.com/v4/spreadsheets/:id/values/A:ZZ");
    await expect(f("https://evil.example/x")).rejects.toBeInstanceOf(NotSent);
    await expect(
      f("https://api.github.com/repos/a/b/issues", { method: "POST" }),
    ).rejects.toBeInstanceOf(NotSent);
    const noReceipt = ledgerFetch(
      async () => {
        throw new Error("down");
      },
      "k",
      (async () => new Response("{}")) as typeof fetch,
    );
    await expect(
      noReceipt("https://api.github.com/repos/a/b"),
    ).rejects.toBeInstanceOf(NotSent);
    expect(calls).toHaveLength(1);
  });
});

describe("the doctor and the files", () => {
  test("keys by name, the switch only from its file, the config's gaps, reads only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-"));
    const keys = join(dir, "keys.env");
    const cred = join(dir, "cred.json");
    writeFileSync(
      keys,
      "GITHUB_DISPATCH_TOKEN=invented-token\nFORMS_RELAY_APPLY=true\n",
    );
    writeFileSync(
      cred,
      JSON.stringify({
        client_email: "relay@invented.iam",
        private_key: "invented",
      }),
    );
    const read = readEnv([keys]);
    expect(read.env).toEqual({ GITHUB_DISPATCH_TOKEN: "invented-token" });
    const switches = join(dir, "switches.env");
    writeFileSync(switches, "FORMS_RELAY_APPLY=false\n");
    expect(readApply(switches)).toBe(false);
    writeFileSync(switches, "FORMS_RELAY_APPLY=true\n");
    expect(readApply(switches)).toBe(true);
    expect(readApply(join(dir, "missing.env"))).toBe(false);
    const r = await doctor({
      env: {
        ...read.env,
        GOOGLE_APPLICATION_CREDENTIALS: cred,
        SUPABASE_URL: "x",
        SUPABASE_SERVICE_ROLE_KEY: "y",
      },
      apply: false,
      config: readConfig(VALUES),
      counts: async () => ({ byState: { queued: 1 } }),
      sheetRead: async () => [["a"], ["b"]],
      repoStatus: async () => 200,
    });
    expect(r).toMatchObject({
      ok: true,
      problems: [],
      checks: { outbox: { queued: 1 }, clientDataRows: 2, repository: 200 },
    });
    expect(JSON.stringify(r)).not.toContain("invented-token");
    const bad = await doctor({
      env: {},
      apply: false,
      config: readConfig({}),
      counts: async () => ({}),
      sheetRead: async () => [],
      repoStatus: async () => 404,
    });
    expect(bad.ok).toBe(false);
    expect(bad.problems).toContain(
      "GITHUB_DISPATCH_TOKEN is not set in the relay's key files.",
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
