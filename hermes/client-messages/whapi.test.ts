import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Transport } from "../ad-billing-guard/transport.ts";
import { ledgerFetch, type Receipt } from "./ledger.ts";
import { makeWhapi, NOT_CONFIRMED, NOT_LEFT, SEND_URL } from "./whapi.ts";

// A fake WhatsApp stands in for gate.whapi.cloud; nothing touches a network. Every group and text is invented.
const GROUP = "120363000000000001@g.us";
const ENV = {
  AD_BILLING_WHAPI_TOKEN: "test-whapi-token",
  CLICKUP_API_TOKEN: "pk_test",
  AD_BILLING_APPLY: "true",
};
const BODY =
  "مرحبا، هذا ملخص تجريبي للمكالمة.\n\nإذا ما حجزت مكالمة المتابعة لين الحين، تقدر تحجزها من هنا:\nhttps://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh";

type Call = {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
};
function fake(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: String(init?.method ?? "GET"),
      body: typeof init?.body === "string" ? init.body : null,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
    };
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

describe("sendText: one POST, the stored text byte for byte", () => {
  test("posts exactly {to, body} with the guard's token, and no reference line", async () => {
    const net = fake(() =>
      json({ sent: true, message: { id: "wamid-test-1" } }),
    );
    const out = await makeWhapi(ENV, net.fetch).sendText(GROUP, BODY);
    expect(out).toEqual({
      state: "sent",
      providerId: "wamid-test-1",
      status: 200,
    });
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].url).toBe(SEND_URL);
    expect(net.calls[0].method).toBe("POST");
    expect(net.calls[0].headers.Authorization).toBe("Bearer test-whapi-token");
    expect(net.calls[0].body).toBe(JSON.stringify({ to: GROUP, body: BODY }));
    expect(JSON.parse(net.calls[0].body as string)).toEqual({
      to: GROUP,
      body: BODY,
    });
    expect(net.calls[0].body).not.toContain("مرجع المتابعة");
    expect(net.calls[0].body).not.toContain("Reference");
  });

  test("a 502, a 429 and a timeout each make exactly one fetch and end unknown", async () => {
    for (const answer of [
      () => json({ error: "bad gateway" }, 502),
      () => json({ error: "slow down" }, 429),
      () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
      () => {
        throw new TypeError("network down");
      },
      () => new Response("<html>gateway</html>", { status: 200 }),
      () => json({}, 408),
    ]) {
      const net = fake(answer as (c: Call) => Response);
      const out = await makeWhapi(ENV, net.fetch).sendText(GROUP, BODY);
      expect(out.state).toBe("unknown");
      expect(out).toMatchObject({ reason: NOT_CONFIRMED });
      expect(net.calls).toHaveLength(1);
    }
  });

  test("a 2xx without sent true or without a string message id is unknown", async () => {
    for (const answer of [
      { sent: false, message: { id: "x" } },
      { sent: true },
      { sent: true, message: { id: 42 } },
      { sent: "true", message: { id: "x" } },
      { message: { id: "x" } },
    ]) {
      const net = fake(() => json(answer));
      expect(
        (await makeWhapi(ENV, net.fetch).sendText(GROUP, BODY)).state,
      ).toBe("unknown");
      expect(net.calls).toHaveLength(1);
    }
  });

  test("a 400 is failed with its status; a group that is not a group is refused before any call", async () => {
    const net = fake(() => json({ error: "bad request" }, 400));
    expect(await makeWhapi(ENV, net.fetch).sendText(GROUP, BODY)).toEqual({
      state: "failed",
      reason: "WhatsApp refused the recap (400). Nothing was sent.",
      status: 400,
    });
    const none = fake(() => json({ sent: true, message: { id: "x" } }));
    expect(
      (
        await makeWhapi(ENV, none.fetch).sendText(
          "96550000001@s.whatsapp.net",
          BODY,
        )
      ).state,
    ).toBe("failed");
    expect(none.calls).toHaveLength(0);
    const noToken = fake(() => json({ sent: true, message: { id: "x" } }));
    expect(
      (await makeWhapi({}, noToken.fetch).sendText(GROUP, BODY)).state,
    ).toBe("failed");
    expect(noToken.calls).toHaveLength(0);
  });

  test("through the ledger: the intent receipt first, then the response, under whapi with the group collapsed", async () => {
    const rows: Receipt[] = [];
    const net = fake(() =>
      json({ sent: true, message: { id: "wamid-test-2" } }),
    );
    const ledger = ledgerFetch({
      insert: async r => void rows.push(r),
      runKey: "client-messages:msg-1",
      fetch: net.fetch,
    });
    expect(
      (await makeWhapi(ENV, ledger.fetch).sendText(GROUP, BODY)).state,
    ).toBe("sent");
    expect(
      rows.map(
        r =>
          `${r.phase} ${r.provider} ${r.method} ${r.resource} ${r.http_status} ${r.run_key}`,
      ),
    ).toEqual([
      "intent whapi POST gate.whapi.cloud/messages/text null client-messages:msg-1",
      "response whapi POST gate.whapi.cloud/messages/text 200 client-messages:msg-1",
    ]);
    expect(JSON.stringify(rows)).not.toContain("مرحبا");
  });

  test("a send the ledger stopped before it left is failed, not unknown, and WhatsApp is never called", async () => {
    // The sentence names the button the Messages card shows for a failed recap (RecapApproval.tsx).
    expect(NOT_LEFT).toBe(
      "The send could not be recorded first, so nothing was sent. Press Try again.",
    );
    // No intent receipt (a database blip): nothing leaves, so nobody needs to look in the group.
    const noReceipt = fake(() =>
      json({ sent: true, message: { id: "wamid-never" } }),
    );
    const blocked = ledgerFetch({
      insert: async () => {
        throw new Error("The database did not answer.");
      },
      runKey: "client-messages:msg-2",
      fetch: noReceipt.fetch,
    });
    expect(await makeWhapi(ENV, blocked.fetch).sendText(GROUP, BODY)).toEqual({
      state: "failed",
      reason: NOT_LEFT,
      status: 0,
    });
    expect(noReceipt.calls).toHaveLength(0);

    // The receipt took longer than the send's 20 s limit: stopped before the request, failed too.
    const slow = fake(() =>
      json({ sent: true, message: { id: "wamid-never" } }),
    );
    const limit = new AbortController();
    const late = ledgerFetch({
      insert: async row => {
        if (row.phase === "intent") limit.abort(); // the 20 s ran out while it was written
      },
      runKey: "client-messages:msg-3",
      fetch: slow.fetch,
    });
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => limit.signal;
    try {
      expect(await makeWhapi(ENV, late.fetch).sendText(GROUP, BODY)).toEqual({
        state: "failed",
        reason: NOT_LEFT,
        status: 0,
      });
    } finally {
      AbortSignal.timeout = realTimeout;
    }
    expect(slow.calls).toHaveLength(0);

    // A request that left and broke on the way stays unknown: it may have reached the group.
    const broke = fake(() => {
      throw new TypeError("network down");
    });
    const left = ledgerFetch({
      insert: async () => {},
      runKey: "client-messages:msg-4",
      fetch: broke.fetch,
    });
    expect(await makeWhapi(ENV, left.fetch).sendText(GROUP, BODY)).toEqual({
      state: "unknown",
      reason: NOT_CONFIRMED,
      status: null,
    });
    expect(broke.calls).toHaveLength(1);
  });
});

describe("the guard's send is never this worker's", () => {
  test("pin: Transport.send still appends its reference marker to a WhatsApp body", async () => {
    const net = fake(() =>
      json({ sent: true, message: { id: "wamid-guard" } }),
    );
    const t = new Transport(ENV, net.fetch);
    await t.send({
      id: "delivery-1",
      binding_id: "b1",
      revision: 1,
      channel: "whatsapp",
      destination: GROUP,
      body: "Invented billing note.",
      claim: "c",
      state: "sending",
    });
    expect(JSON.parse(net.calls[0].body as string).body).toBe(
      "Invented billing note.\n\nمرجع المتابعة: BG-delivery-1",
    );
  });
  test("neither the worker nor whapi.ts ever calls a transport's send", () => {
    for (const file of ["worker.ts", "whapi.ts", "g5.ts"]) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect([file, /\.send\(/.test(src)]).toEqual([file, false]);
    }
  });
  test("AD_BILLING_APPLY is never read by this worker's code (its comments may name it)", () => {
    for (const file of [
      "worker.ts",
      "whapi.ts",
      "g5.ts",
      "db.ts",
      "ledger.ts",
      "oldSenders.ts",
      "core.ts",
    ]) {
      const code = readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect([file, code.includes("AD_BILLING_APPLY")]).toEqual([file, false]);
    }
  });
});

describe("reads", () => {
  test("listMessages pages by 100 to 500, keeps the fields the sender reads, and may retry a read", async () => {
    let n = 0;
    const net = fake(call => {
      const offset = Number(new URL(call.url).searchParams.get("offset"));
      n += 1;
      if (n === 1) return json({}, 503); // retried once, as reads may
      const size = offset < 400 ? 100 : 3;
      return json({
        messages: Array.from({ length: size }, (_, i) => ({
          id: `m${offset + i}`,
          from_me: i % 2 === 0,
          from: "96550000099",
          text: { body: `x${i}` },
          timestamp: 1_790_000_000 + i,
        })),
      });
    });
    const out = await makeWhapi(ENV, net.fetch).listMessages(
      GROUP,
      1_790_000_000,
    );
    expect(out).toHaveLength(403);
    expect(out[0]).toEqual({
      id: "m0",
      fromMe: true,
      from: "96550000099",
      body: "x0",
      at: 1_790_000_000,
    });
    const urls = net.calls.map(c => new URL(c.url));
    expect(
      urls.every(
        u =>
          u.pathname === `/messages/list/${GROUP}` &&
          u.searchParams.get("count") === "100" &&
          u.searchParams.get("time_from") === "1790000000",
      ),
    ).toBe(true);
    expect(urls.map(u => u.searchParams.get("offset"))).toEqual([
      "0",
      "0",
      "100",
      "200",
      "300",
      "400",
    ]);
  });
  test("health gives the channel's number as its last four digits only", async () => {
    const net = fake(() =>
      json({
        status: { text: "AUTH" },
        user: { id: "96550001234", name: "Invented" },
      }),
    );
    expect(await makeWhapi(ENV, net.fetch).health()).toEqual({
      status: "AUTH",
      channelLast4: "1234",
    });
    expect(net.calls[0].url).toBe(
      "https://gate.whapi.cloud/health?wakeup=false",
    );
  });
});
