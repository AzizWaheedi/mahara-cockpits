/**
 * hermes/forms-relay (docs/forms/WAVE56-CONTRACT.md 3.8, 4.14.4; 20261102l): a fake database outbox and a
 * fake GitHub. Every client, card and value is invented; nothing reaches a provider. The relay has no sheet
 * door: a stray client_data_row row is skipped, and the ledger refuses any Google call.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerFetch, NotSent, resourceOf } from "./providers.ts";
import {
  type Answer,
  type Config,
  dispatchBody,
  readConfig,
  type RelayRow,
  type Row,
  runOnce,
  SAY,
  TEST_CARD,
} from "./relay.ts";
import { doctor, ENV_KEYS, hasDispatchCredential, readApply, readEnv } from "./worker.ts";

const VALUES = {
  DISPATCH_OWNER: "invented-org",
  DISPATCH_REPO: "market-intel",
  DISPATCH_NAME_KEY: "client_name",
  DISPATCH_ID_KEY: "clickup_id",
};
/** The Client Data lines a config.env written before 20261102l may still hold. */
const OLD_CLIENT_DATA = {
  CLIENT_DATA_SHEET_ID: "sheetInvented01",
  CLIENT_DATA_TAB: "Client Data",
  CLIENT_DATA_CARD_COLUMN: "C",
  CLIENT_DATA_COLUMNS: JSON.stringify({ A: "client", C: "task" }),
};
const CONFIG = readConfig(VALUES).config as Config;
const PAYLOAD = {
  taskId: "86card0001",
  client: "Cedar Homes",
  submittedAt: "2026-11-02T21:30:00Z",
  answers: { "514bfd3f-4ca1-469e-b9e7-87656503f65c": "Cedar Homes Co" },
};
const BODY = {
  event_type: "market_intel",
  client_payload: { client_name: "Cedar Homes", clickup_id: "86card0001" },
};

function world(
  opts: {
    rows?: RelayRow[];
    dispatch?: Answer;
    counts?: Row | "throw";
    apply?: boolean;
    dispatchCredentialPresent?: boolean;
  } = {},
) {
  const rpcs: { name: string; args: Row }[] = [];
  const healths: Row[] = [];
  const dispatched: Row[] = [];
  const deps = {
    apply: opts.apply ?? true,
    config: CONFIG,
    configProblems: [],
    dispatchCredentialPresent: opts.dispatchCredentialPresent ?? true,
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
  return { deps, rpcs, healths, dispatched, done };
}
const row = (
  id: number,
  effectKey: string,
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
  test("every dispatch line named when missing, never a value; no Client Data line is asked for or kept", () => {
    expect(readConfig({}).problems).toEqual([
      "DISPATCH_OWNER is not set in ~/.forms-relay/config.env.",
      "DISPATCH_REPO is not set in ~/.forms-relay/config.env.",
      "DISPATCH_NAME_KEY is not set in ~/.forms-relay/config.env.",
      "DISPATCH_ID_KEY is not set in ~/.forms-relay/config.env.",
    ]);
    const old = readConfig({ ...VALUES, ...OLD_CLIENT_DATA });
    expect(old.problems).toEqual([]);
    expect(old.config).toEqual(CONFIG);
    expect(Object.keys(CONFIG).sort()).toEqual([
      "dispatchEvent",
      "dispatchIdKey",
      "dispatchNameKey",
      "dispatchOwner",
      "dispatchRepo",
    ]);
    expect(CONFIG.dispatchEvent).toBe("market_intel");
  });

  test("the dispatch body under the blueprint's keys", () => {
    expect(dispatchBody(CONFIG, PAYLOAD)).toEqual(BODY);
  });
});

describe("a run", () => {
  test("a missing dispatch credential leaves queued rows and attempts untouched", async () => {
    const w = world({ rows: [row(2, "github_dispatch")], dispatchCredentialPresent: false });
    const report = await runOnce(w.deps);
    expect(report).toMatchObject({ ok: false, note: SAY.missingCredential, counts: { claimed: 0, failed: 0 } });
    expect(w.rpcs).toEqual([]);
    expect(w.dispatched).toEqual([]);
    expect(w.healths[0]).toMatchObject({ key: "forms-relay", ok: false });
  });

  test("the dry run still counts waiting rows without a dispatch credential", async () => {
    const w = world({ apply: false, counts: { queued: 1 }, dispatchCredentialPresent: false });
    expect((await runOnce(w.deps)).note).toBe(SAY.dry(1, "dispatch keys client_name, clickup_id"));
    expect(w.rpcs.map(x => x.name)).toEqual(["cockpit_form_relay_counts"]);
    expect(w.dispatched).toEqual([]);
  });
  test("switched off: nothing claimed; counts and keys only, never a value", async () => {
    const w = world({ apply: false, counts: { queued: 2, sent: 4 } });
    const r = await runOnce(w.deps);
    expect(w.rpcs.map(x => x.name)).toEqual(["cockpit_form_relay_counts"]);
    expect(r.note).toBe(SAY.dry(2, "dispatch keys client_name, clickup_id"));
    expect(r.note).not.toContain("Cedar");
    const empty = world({ apply: false, counts: { sent: 4 } });
    expect((await runOnce(empty.deps)).note).toBe("Nothing to relay.");
    const unread = world({ apply: false, counts: "throw" });
    expect(await runOnce(unread.deps)).toMatchObject({
      ok: false,
      note: SAY.uncounted,
    });
  });

  test("the dispatch is sent once and recorded sent", async () => {
    const w = world({ rows: [row(2, "github_dispatch")] });
    const r = await runOnce(w.deps);
    expect(w.dispatched).toEqual([BODY]);
    expect(w.done()).toEqual([[2, "sent", "Dispatched."]]);
    expect(r.note).toBe("Relayed 1 row: 1 sent.");
    expect(w.healths[0]).toMatchObject({ key: "forms-relay", ok: true });
  });

  test("a stray client_data_row row is skipped and written to no sheet; the dispatch beside it still goes", async () => {
    const w = world({
      rows: [row(1, "client_data_row"), row(2, "github_dispatch")],
    });
    const r = await runOnce(w.deps);
    expect(w.done()).toEqual([
      [1, "skipped", SAY.notDispatch],
      [2, "sent", "Dispatched."],
    ]);
    expect(w.dispatched).toEqual([BODY]);
    expect(r).toMatchObject({
      ok: true,
      note: "Relayed 2 rows: 1 sent, 1 skipped.",
    });
    // The relay has no sheet door, and its ledger lets no Google call out (no token, no read, no append).
    expect("sheet" in w.deps).toBe(false);
    const calls: string[] = [];
    const f = ledgerFetch(async () => {}, "forms-relay:run:test", (async (
      input: RequestInfo | URL,
    ) => {
      calls.push(String(input));
      return new Response("{}");
    }) as typeof fetch);
    for (const [url, method] of [
      ["https://oauth2.googleapis.com/token", "POST"],
      [
        "https://sheets.googleapis.com/v4/spreadsheets/sheetInvented01/values/Client%20Data!A%3AZZ:append",
        "POST",
      ],
      [
        "https://sheets.googleapis.com/v4/spreadsheets/sheetInvented01/values/Client%20Data!A%3AZZ",
        "GET",
      ],
    ])
      await expect(f(url, { method })).rejects.toBeInstanceOf(NotSent);
    expect(calls).toEqual([]);
  });

  test("the test card is never dispatched", async () => {
    const w = world({ rows: [row(2, "github_dispatch", TEST_CARD)] });
    await runOnce(w.deps);
    expect(w.dispatched).toEqual([]);
    expect(w.done()).toEqual([[2, "skipped", SAY.canaryDispatch]]);
  });

  test("a refused dispatch is failed (tried again by the database); an unclear one is unknown", async () => {
    const gh = world({
      rows: [row(2, "github_dispatch")],
      dispatch: { ok: false, status: 0, definite: false },
    });
    expect((await runOnce(gh.deps)).ok).toBe(false);
    expect(gh.done()).toEqual([[2, "unknown", SAY.dispatchUnsure]]);
    const ghNo = world({
      rows: [row(2, "github_dispatch")],
      dispatch: { ok: false, status: 404, definite: true },
    });
    expect((await runOnce(ghNo.deps)).ok).toBe(false);
    expect(ghNo.done()).toEqual([[2, "failed", SAY.dispatchRefused(404)]]);
  });

  test("nothing claimed: Nothing to relay; no config: nothing claimed and the gap said", async () => {
    const w = world({ rows: [] });
    expect((await runOnce(w.deps)).note).toBe("Nothing to relay.");
    const none = world({ rows: [row(2, "github_dispatch")] });
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
  test("only the exact GitHub host is accepted, including against inherited property names", async () => {
    const calls: string[] = [];
    const f = ledgerFetch(async () => {}, "k", (async input => {
      calls.push(String(input));
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    for (const host of ["constructor", "__proto__", "api.github.com.evil.example"]) {
      await expect(f(`https://${host}/`)).rejects.toBeInstanceOf(NotSent);
    }
    expect(calls).toEqual([]);
  });

  test("a Request object's effective method cannot bypass the POST allowlist", async () => {
    const calls: string[] = [];
    const f = ledgerFetch(async () => {}, "k", (async input => {
      const req = input as Request;
      calls.push(`${req.url}:${req.method}`);
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    const otherPost = new Request("https://api.github.com/user/repos", { method: "POST" });
    await expect(f(otherPost)).rejects.toBeInstanceOf(NotSent);
    expect(calls).toEqual([]);
    const dispatch = new Request("https://api.github.com/repos/a/b/dispatches", { method: "POST" });
    expect((await f(dispatch)).status).toBe(204);
    expect(calls[0].endsWith(":POST")).toBe(true);
  });

  test("provider redirects cannot bypass the audited GitHub endpoint", async () => {
    const receipts: Row[] = [];
    let redirect: RequestRedirect | undefined;
    const f = ledgerFetch(async r => { receipts.push(r); }, "k", (async input => {
      redirect = (input as Request).redirect;
      throw new Error("redirect refused");
    }) as typeof fetch);
    await expect(f("https://api.github.com/repos/a/b/dispatches", {
      method: "POST", redirect: "follow",
    })).rejects.toThrow();
    expect(redirect).toBe("error");
    expect(receipts.map(r => r.phase)).toEqual(["intent", "unknown"]);
  });

  test("the target and options cannot change while the intent receipt is written", async () => {
    const target = new URL("https://api.github.com/repos/a/b/dispatches");
    const options: RequestInit = { method: "POST", headers: { "x-synthetic": "original" }, body: "first" };
    let sent: Request | undefined;
    const f = ledgerFetch(async r => {
      if (r.phase === "intent") {
        target.host = "example.invalid";
        (options.headers as Record<string, string>)["x-synthetic"] = "changed";
        options.body = "changed";
      }
    }, "k", (async input => {
      sent = input as Request;
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    expect((await f(target, options)).status).toBe(204);
    expect(sent?.url).toBe("https://api.github.com/repos/a/b/dispatches");
    expect(sent?.headers.get("x-synthetic")).toBe("original");
    expect(await sent?.text()).toBe("first");
  });

  test("a confirmed 204 does not depend on reading an empty body", async () => {
    const receipts: Row[] = [];
    const response = new Response(null, { status: 204 });
    response.text = async () => { throw new Error("should not read"); };
    const f = ledgerFetch(async r => { receipts.push(r); }, "k", (async () => response) as typeof fetch);
    expect((await f("https://api.github.com/repos/a/b/dispatches", { method: "POST" })).status).toBe(204);
    expect(receipts.map(r => [r.phase, r.http_status])).toEqual([["intent", null], ["response", 204]]);
  });

  test("a response body failure leaves an unknown receipt without leaking the error", async () => {
    const receipts: Row[] = [];
    const response = new Response(new ReadableStream({
      start(controller) { controller.error(new Error("private upstream detail")); },
    }), { status: 200 });
    const f = ledgerFetch(async r => { receipts.push(r); }, "k", (async () => response) as typeof fetch);
    await expect(f("https://api.github.com/repos/a/b")).rejects.toThrow("The GitHub response body could not be read.");
    expect(receipts.map(r => r.phase)).toEqual(["intent", "unknown"]);
    expect(JSON.stringify(receipts)).not.toContain("private upstream detail");
  });

  test("declared and streamed oversized provider bodies are rejected with unknown receipts", async () => {
    let cancelled = false;
    for (const response of [
      new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200, headers: { "content-length": "262145" } }),
      new Response(new Uint8Array(262145), { status: 200 }),
    ]) {
      const receipts: Row[] = [];
      const f = ledgerFetch(async r => { receipts.push(r); }, "k", (async () => response) as typeof fetch);
      await expect(f("https://api.github.com/repos/a/b")).rejects.toThrow("The GitHub response body could not be read.");
      expect(receipts.map(r => r.phase)).toEqual(["intent", "unknown"]);
    }
    expect(cancelled).toBe(true);
  });

  test("an aborted stalled response is cancelled and recorded as unknown", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 });
    const controller = new AbortController();
    const receipts: Row[] = [];
    const f = ledgerFetch(async r => { receipts.push(r); }, "k", (async () => response) as typeof fetch);
    const pending = f("https://api.github.com/repos/a/b", { signal: controller.signal });
    setTimeout(() => controller.abort(), 1);
    await expect(pending).rejects.toThrow("The GitHub response body could not be read.");
    expect(receipts.map(r => r.phase)).toEqual(["intent", "unknown"]);
    expect(cancelled).toBe(true);
  });

  test("an intent receipt before each call, a response after; only GitHub and its dispatch POST; ids collapsed", async () => {
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
      resourceOf(new URL("https://api.github.com/repos/invented-org/r2d2x9")),
    ).toBe("api.github.com/repos/invented-org/:id");
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
  test("credential readiness requires a nonblank dispatch key", () => {
    expect(hasDispatchCredential({})).toBe(false);
    expect(hasDispatchCredential({ GITHUB_DISPATCH_TOKEN: "   " })).toBe(false);
    expect(hasDispatchCredential({ GITHUB_DISPATCH_TOKEN: "fictional-token" })).toBe(true);
  });

  test("keys by name with no Google key, the switch only from its file, the config's gaps, reads only", async () => {
    expect([...ENV_KEYS]).toEqual([
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GITHUB_DISPATCH_TOKEN",
    ]);
    const dir = mkdtempSync(join(tmpdir(), "relay-"));
    const keys = join(dir, "keys.env");
    writeFileSync(
      keys,
      "GITHUB_DISPATCH_TOKEN=invented-token\nFORMS_RELAY_APPLY=true\nGOOGLE_APPLICATION_CREDENTIALS=/invented/cred.json\n",
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
        SUPABASE_URL: "x",
        SUPABASE_SERVICE_ROLE_KEY: "y",
      },
      apply: false,
      config: readConfig({ ...VALUES, ...OLD_CLIENT_DATA }),
      counts: async () => ({ byState: { queued: 1 } }),
      repoStatus: async () => 200,
    });
    expect(r).toEqual({
      ok: true,
      problems: [],
      keys: {
        SUPABASE_URL: true,
        SUPABASE_SERVICE_ROLE_KEY: true,
        GITHUB_DISPATCH_TOKEN: true,
      },
      checks: { apply: false, outbox: { queued: 1 }, repository: 200 },
    });
    expect(JSON.stringify(r)).not.toContain("invented-token");
    const bad = await doctor({
      env: {},
      apply: false,
      config: readConfig({}),
      counts: async () => ({}),
      repoStatus: async () => 404,
    });
    expect(bad.ok).toBe(false);
    expect(bad.problems).toContain(
      "GITHUB_DISPATCH_TOKEN is not set in the relay's key files.",
    );
    expect(bad.problems.join(" ")).not.toMatch(
      /Google|Client Data|CLIENT_DATA/,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
