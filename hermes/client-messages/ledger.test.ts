import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_POSTS,
  LedgerRefused,
  ledgerFetch,
  providerOf,
  type Receipt,
  resourceOf,
} from "./ledger.ts";
import { makeWhapi } from "./whapi.ts";

// Fakes only; nothing touches a network. The Google service account is generated here and deleted after.
type Call = { url: string; method: string };
function fake(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { calls, fetch: f };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let dir = "";
let credentials = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "client-messages-ledger-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  credentials = join(dir, "service-account.json");
  writeFileSync(
    credentials,
    JSON.stringify({
      type: "service_account",
      client_email: "reader@invented-project.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    }),
  );
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("what may leave", () => {
  test("a POST other than the two named is refused before any receipt or fetch", async () => {
    const rows: Receipt[] = [];
    const net = fake(() => json({}));
    const ledger = ledgerFetch({
      insert: async r => void rows.push(r),
      runKey: "client-messages:run",
      fetch: net.fetch,
    });
    for (const [url, method] of [
      ["https://api.clickup.com/api/v2/task/86abc0001/comment", "POST"],
      ["https://api.clickup.com/api/v2/task/86abc0001/field/abc", "POST"],
      ["https://gate.whapi.cloud/messages/image", "POST"],
      ["https://gate.whapi.cloud/messages/text?to=x", "POST"],
      ["https://gate.whapi.cloud/messages/text", "PUT"],
      ["https://gate.whapi.cloud/messages/abc", "DELETE"],
      ["https://eu1.make.com/api/v2/scenarios/9523861/start", "POST"],
      ["https://api.typeform.com/forms/fRokTITH/webhooks/cockpit", "PUT"],
    ] as const) {
      await expect(ledger.fetch(url, { method })).rejects.toBeInstanceOf(
        LedgerRefused,
      );
    }
    await expect(
      ledger.fetch("https://slack.com/api/chat.postMessage"),
    ).rejects.toBeInstanceOf(LedgerRefused);
    await expect(
      ledger.fetch("http://gate.whapi.cloud/health"),
    ).rejects.toBeInstanceOf(LedgerRefused);
    expect(net.calls).toHaveLength(0);
    expect(rows).toHaveLength(0);
    expect([...ALLOWED_POSTS]).toEqual([
      "https://gate.whapi.cloud/messages/text",
      "https://oauth2.googleapis.com/token",
    ]);
  });

  test("no intent receipt, no request", async () => {
    const net = fake(() => json({}));
    const ledger = ledgerFetch({
      insert: async () => {
        throw new Error("the ledger refused the receipt");
      },
      runKey: "client-messages:run",
      fetch: net.fetch,
    });
    await expect(
      ledger.fetch("https://gate.whapi.cloud/health?wakeup=false"),
    ).rejects.toThrow("the ledger refused the receipt");
    expect(net.calls).toHaveLength(0);
  });

  test("a call that breaks after it left writes an unknown receipt; a response receipt that fails is counted, never retried", async () => {
    const rows: Receipt[] = [];
    const broken = fake(() => {
      throw new TypeError("reset");
    });
    const ledger = ledgerFetch({
      insert: async r => void rows.push(r),
      runKey: "client-messages:m1",
      fetch: broken.fetch,
    });
    await expect(
      ledger.fetch("https://gate.whapi.cloud/messages/text", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("reset");
    expect(rows.map(r => r.phase)).toEqual(["intent", "unknown"]);
    let n = 0;
    const net = fake(() => json({ ok: true }));
    const half = ledgerFetch({
      insert: async () => {
        n += 1;
        if (n === 2) throw new Error("full");
      },
      runKey: "client-messages:m2",
      fetch: net.fetch,
    });
    expect(
      (await half.fetch("https://gate.whapi.cloud/health?wakeup=false")).status,
    ).toBe(200);
    expect(net.calls).toHaveLength(1);
    expect(half.state.failures).toBe(1);
  });

  test("the body is read before the response receipt, and the caller gets the same status, headers and bytes", async () => {
    const order: string[] = [];
    const net = fake(
      () =>
        new Response(
          new ReadableStream(
            {
              pull(c) {
                order.push("body read");
                c.enqueue(new TextEncoder().encode('{"sent":true}'));
                c.close();
              },
            },
            { highWaterMark: 0 },
          ),
          { status: 201, headers: { "X-Invented": "kept" } },
        ),
    );
    const ledger = ledgerFetch({
      insert: async r => void order.push(r.phase),
      runKey: "client-messages:m1",
      fetch: net.fetch,
    });
    const res = await ledger.fetch("https://gate.whapi.cloud/health");
    expect(order).toEqual(["intent", "body read", "response"]);
    expect(res.status).toBe(201);
    expect(res.headers.get("X-Invented")).toBe("kept");
    expect(await res.json()).toEqual({ sent: true });
  });

  test("a status that may not carry a body comes back without one", async () => {
    const rows: Receipt[] = [];
    const ledger = ledgerFetch({
      insert: async r => void rows.push(r),
      runKey: "client-messages:m1",
      fetch: fake(() => new Response(null, { status: 204 })).fetch,
    });
    const res = await ledger.fetch("https://gate.whapi.cloud/health");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(rows.map(r => `${r.phase} ${r.http_status}`)).toEqual([
      "intent null",
      "response 204",
    ]);
  });

  test("a body that breaks on the way stays left and unconfirmed: an unknown receipt with the status, and the error", async () => {
    const rows: Receipt[] = [];
    const ledger = ledgerFetch({
      insert: async r => void rows.push(r),
      runKey: "client-messages:m1",
      fetch: fake(
        () =>
          new Response(
            new ReadableStream({
              pull(c) {
                c.error(new TypeError("reset"));
              },
            }),
            { status: 200 },
          ),
      ).fetch,
    });
    await expect(
      ledger.fetch("https://gate.whapi.cloud/messages/text", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("reset");
    expect(rows.map(r => `${r.phase} ${r.http_status}`)).toEqual([
      "intent null",
      "unknown 200",
    ]);
  });

  test("one state shared by two ledgers counts every receipt lost after its call left, the unknown one included", async () => {
    const state = { failures: 0 };
    const loseAfter = async (r: Receipt) => {
      if (r.phase !== "intent") throw new Error("full");
    };
    const ok = fake(() => json({ ok: true }));
    const broken = fake(() => {
      throw new TypeError("reset");
    });
    const a = ledgerFetch({
      insert: loseAfter,
      runKey: "client-messages:run",
      fetch: ok.fetch,
      state,
    });
    const b = ledgerFetch({
      insert: loseAfter,
      runKey: "client-messages:m1",
      fetch: broken.fetch,
      state,
    });
    expect(a.state).toBe(state);
    expect(b.state).toBe(state);
    expect(
      (await a.fetch("https://gate.whapi.cloud/health?wakeup=false")).status,
    ).toBe(200);
    await expect(
      b.fetch("https://api.clickup.com/api/v2/task/86abc0001"),
    ).rejects.toThrow("reset");
    // Each call left once and is never repeated; both lost answers are on the one count.
    expect(ok.calls).toHaveLength(1);
    expect(broken.calls).toHaveLength(1);
    expect(state.failures).toBe(2);
  });

  test("providers by host and resources with every id collapsed", () => {
    expect(
      [
        "gate.whapi.cloud",
        "sheets.googleapis.com",
        "oauth2.googleapis.com",
        "api.clickup.com",
        "api.typeform.com",
        "eu1.make.com",
        "make.com",
        "evil-make.com",
        "api.slack.com",
      ].map(providerOf),
    ).toEqual([
      "whapi",
      "google",
      "google",
      "clickup",
      "typeform",
      "make",
      "make",
      null,
      null,
    ]);
    expect(
      resourceOf(
        new URL(
          "https://gate.whapi.cloud/messages/list/120363000000000001@g.us?count=100",
        ),
      ),
    ).toBe("gate.whapi.cloud/messages/list/:group");
    expect(
      resourceOf(new URL("https://api.clickup.com/api/v2/task/86abc0001")),
    ).toBe("api.clickup.com/api/v2/task/:id");
    expect(
      resourceOf(new URL("https://eu1.make.com/api/v2/scenarios/9523861")),
    ).toBe("eu1.make.com/api/v2/scenarios/:id");
    expect(
      resourceOf(new URL("https://api.typeform.com/forms/fRokTITH/webhooks")),
    ).toBe("api.typeform.com/forms/fRokTITH/webhooks");
  });
});

describe("Client Data through the ledger", () => {
  test("sheet() reads through the ledger fetch, its token POST receipted under google", async () => {
    const rows: Receipt[] = [];
    const net = fake(call => {
      if (call.url === "https://oauth2.googleapis.com/token")
        return json({ access_token: "ya29.invented" });
      if (call.url.startsWith("https://sheets.googleapis.com/"))
        return json({ values: [["ClickUp ID", "WA Group ID"]] });
      return json({}, 404);
    });
    const ledger = ledgerFetch({
      insert: async r => void rows.push(r),
      runKey: "client-messages:run",
      fetch: net.fetch,
    });
    const whapi = makeWhapi(
      { GOOGLE_APPLICATION_CREDENTIALS: credentials },
      ledger.fetch,
    );
    expect(await whapi.sheet()).toEqual([["ClickUp ID", "WA Group ID"]]);
    expect(net.calls.map(c => c.method)).toEqual(["POST", "GET"]);
    expect(
      rows.map(r => `${r.phase} ${r.provider} ${r.method} ${r.resource}`),
    ).toEqual([
      "intent google POST oauth2.googleapis.com/token",
      "response google POST oauth2.googleapis.com/token",
      "intent google GET sheets.googleapis.com/v4/spreadsheets/:id/values/Client%20Data!A:ZZ",
      "response google GET sheets.googleapis.com/v4/spreadsheets/:id/values/Client%20Data!A:ZZ",
    ]);
    const all = JSON.stringify(rows);
    for (const leak of ["ya29", "invented-project", "PRIVATE KEY"])
      expect(all).not.toContain(leak);
  });
});
