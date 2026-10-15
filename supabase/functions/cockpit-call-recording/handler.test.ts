import { describe, expect, test } from "bun:test";
import { makeRecordingApi, type RpcResult } from "./handler.ts";
import { type HealthRow, safeRecordingUrl } from "./tools.ts";

const SIGNED =
  "https://storage.mq.maqsam.com/recordings/376100636.mp3?X-Amz-Signature=secret-signature&X-Amz-Expires=60";
const KEY = "test-access-key";
const SECRET = "test-secret";

type Seen = { url: string; init?: RequestInit };
type Opts = {
  scope?: RpcResult | "throw";
  played?: RpcResult | "throw";
  env?: Record<string, string | undefined>;
  /** Maqsam's API answer. */
  api?: Response | "throw";
  /** Maqsam storage's answer. */
  storage?: (init?: RequestInit) => Response | "throw";
};

function setup(opts: Opts = {}) {
  const fetched: Seen[] = [];
  const rpcs: { fn: string; jwt: string; args: unknown }[] = [];
  const health: HealthRow[] = [];
  let cancelled = false;
  const audio = (status = 200, extra: Record<string, string> = {}) =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("ID3-audio-bytes"));
          c.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
      {
        status,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": "15",
          "accept-ranges": "bytes",
          "x-amz-request-id": "storage-internal",
          ...extra,
        },
      },
    );
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetched.push({ url, init });
    if (url.startsWith("https://api.mq.maqsam.com/")) {
      if (opts.api === "throw") throw new TypeError("network down");
      return (
        opts.api ??
        Response.json({ result: "success", message: { url: SIGNED } })
      );
    }
    const answer = opts.storage ? opts.storage(init) : audio();
    if (answer === "throw") throw new TypeError("network down");
    return answer;
  }) as typeof fetch;
  const handler = makeRecordingApi({
    userRpc: async (jwt, fn, args) => {
      rpcs.push({ fn, jwt, args });
      const r =
        fn === "cockpit_call_recording_scope"
          ? (opts.scope ?? {
              data: { ok: true, clientName: "Client A" },
              error: null,
            })
          : (opts.played ?? { data: null, error: null });
      if (r === "throw") throw new Error("database down");
      return r;
    },
    health: async row => {
      health.push(row);
    },
    env: name =>
      opts.env
        ? opts.env[name]
        : (
            {
              SALES_MAQSAM_ACCESS_KEY: KEY,
              SALES_MAQSAM_SECRET: SECRET,
            } as Record<string, string>
          )[name],
    fetch: fakeFetch,
  });
  const send = (
    body: unknown = { callId: "376100636" },
    headers: Record<string, string> = { Authorization: "Bearer seat-jwt" },
    method = "POST",
  ) =>
    handler(
      new Request("https://fn.test/cockpit-call-recording", {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      }),
    );
  return {
    send,
    fetched,
    rpcs,
    health,
    audio,
    wasCancelled: () => cancelled,
  };
}

/** Everything a browser can see of a response, as text. */
async function visible(res: Response) {
  const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`);
  return `${res.status}\n${headers.join("\n")}\n${await res.text()}`;
}

describe("the door", () => {
  test("CORS preflight allows the token and Range; only POST plays", async () => {
    const s = setup();
    const pre = await s.send(undefined, {}, "OPTIONS");
    expect(pre.status).toBe(200);
    expect(pre.headers.get("access-control-allow-headers")).toContain("range");
    expect(pre.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect((await s.send(undefined, {}, "GET")).status).toBe(405);
  });

  test("no token, or no call id, gets a plain answer and touches nothing", async () => {
    const s = setup();
    const noToken = await s.send({ callId: "1" }, {});
    expect(noToken.status).toBe(401);
    expect(await noToken.json()).toEqual({ error: "Sign in first." });
    for (const callId of [undefined, "", "12ab", "1".repeat(21), "../x"]) {
      const res = await s.send({ callId });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Choose a call to play." });
    }
    expect(s.rpcs).toEqual([]);
    expect(s.fetched).toEqual([]);
    expect(s.health).toEqual([]);
  });

  test("the database's refusal is a 403 with its own sentence, before Maqsam is called", async () => {
    const s = setup({
      scope: {
        data: null,
        error: {
          code: "42501",
          message:
            "This call belongs to a client that is not on your cockpit seat.",
        },
      },
    });
    const res = await s.send();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "This call belongs to a client that is not on your cockpit seat.",
    });
    expect(s.rpcs).toEqual([
      {
        fn: "cockpit_call_recording_scope",
        jwt: "seat-jwt",
        args: { p_call_id: "376100636" },
      },
    ]);
    expect(s.fetched).toEqual([]);
    expect(s.health).toEqual([]);
  });

  test("a database fault is not a refusal, and its words are not shown", async () => {
    const internal = setup({
      scope: {
        data: null,
        error: { code: "XX000", message: "relation secret_table missing" },
      },
    });
    const res = await internal.send();
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret_table");
    expect((await setup({ scope: "throw" }).send()).status).toBe(502);
    const notOk = await setup({
      scope: { data: { ok: false }, error: null },
    }).send();
    expect(notOk.status).toBe(403);
  });

  test("no Maqsam keys on the server: a 503 that says so, and no call", async () => {
    const s = setup({ env: {} });
    const res = await s.send();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(
      "Recordings are not connected yet: the Maqsam keys are missing on the server. Tell the CEO.",
    );
    expect(s.fetched).toEqual([]);
  });
});

describe("playing", () => {
  test("streams the audio, private and never cached, and writes the audit row first", async () => {
    const s = setup();
    const res = await s.send();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-amz-request-id")).toBeNull();
    expect(await res.text()).toBe("ID3-audio-bytes");
    expect(s.rpcs.map(r => r.fn)).toEqual([
      "cockpit_call_recording_scope",
      "cockpit_call_recording_played",
    ]);
    expect(s.rpcs[1]).toEqual({
      fn: "cockpit_call_recording_played",
      jwt: "seat-jwt",
      args: { p_call_id: "376100636" },
    });
    // Maqsam's API gets the keys; storage gets no credentials at all.
    expect(s.fetched[0].url).toBe(
      "https://api.mq.maqsam.com/v3/recording/id/376100636?return_url=true",
    );
    expect(new Headers(s.fetched[0].init?.headers).get("authorization")).toBe(
      `Basic ${btoa(`${KEY}:${SECRET}`)}`,
    );
    expect(s.fetched[1].url).toBe(SIGNED);
    expect(
      new Headers(s.fetched[1].init?.headers).get("authorization"),
    ).toBeNull();
    expect(s.fetched.every(f => f.init?.redirect === "error")).toBe(true);
  });

  test("every Maqsam call lands in the health ledger, without the signed link", async () => {
    const s = setup();
    await (await s.send()).text();
    expect(s.health).toEqual([
      {
        provider: "maqsam",
        method: "GET",
        resource: "v3/recording/id",
        object_id: "376100636",
        phase: "intent",
      },
      {
        provider: "maqsam",
        method: "GET",
        resource: "v3/recording/id",
        object_id: "376100636",
        phase: "response",
        http_status: 200,
      },
      {
        provider: "maqsam",
        method: "GET",
        resource: "storage/recording",
        object_id: "376100636",
        phase: "intent",
      },
      {
        provider: "maqsam",
        method: "GET",
        resource: "storage/recording",
        object_id: "376100636",
        phase: "response",
        http_status: 200,
      },
    ]);
    expect(JSON.stringify(s.health)).not.toContain("storage.mq.maqsam.com");
  });

  test("Range goes to storage and the partial answer comes back as it is", async () => {
    let asked: string | null = null;
    const s = setup({
      storage: init => {
        asked = new Headers(init?.headers).get("range");
        return s.audio(206, {
          "content-range": "bytes 0-99/48000",
          "content-length": "100",
        });
      },
    });
    const res = await s.send(undefined, {
      Authorization: "Bearer seat-jwt",
      Range: "bytes=0-99",
    });
    expect(asked as string | null).toBe("bytes=0-99");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/48000");
    expect(res.headers.get("content-length")).toBe("100");
    expect(res.headers.get("access-control-expose-headers")).toContain(
      "content-range",
    );
    await res.text();
  });

  test("a malformed or many-part Range is refused before anything is asked", async () => {
    for (const range of [
      "bytes=1-2,5-6",
      "bytes=-",
      "items=0-1",
      "bytes=a-b",
    ]) {
      const s = setup();
      const res = await s.send(undefined, {
        Authorization: "Bearer seat-jwt",
        Range: range,
      });
      expect(res.status).toBe(416);
      expect(s.rpcs).toEqual([]);
      expect(s.fetched).toEqual([]);
    }
    const s = setup({
      storage: () => new Response(null, { status: 416 }),
    });
    const res = await s.send(undefined, {
      Authorization: "Bearer seat-jwt",
      Range: "bytes=999999-",
    });
    expect(res.status).toBe(416);
    expect(s.rpcs.map(r => r.fn)).toEqual(["cockpit_call_recording_scope"]);
  });
});

describe("the allow-list and the signed link", () => {
  test("only https links on Maqsam's storage hosts are followed", async () => {
    for (const url of [
      "https://evil.example.com/a.mp3",
      "http://storage.mq.maqsam.com/a.mp3",
      "https://user:pw@storage.mq.maqsam.com/a.mp3",
      "https://storage.mq.maqsam.com:8443/a.mp3",
      "https://storage.mq.maqsam.com.evil.example/a.mp3",
      "javascript:alert(1)",
      "",
    ]) {
      const s = setup({
        api: Response.json({ result: "success", message: { url } }),
      });
      const res = await s.send();
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe(
        "Maqsam sent a recording link the cockpit does not trust, so it was not played.",
      );
      expect(s.fetched).toHaveLength(1);
      expect(s.rpcs.map(r => r.fn)).toEqual(["cockpit_call_recording_scope"]);
    }
    expect(safeRecordingUrl("https://storage.maqsam.com/x.mp3")).toBe(
      "https://storage.maqsam.com/x.mp3",
    );
  });

  test("no answer of any kind carries the signed link", async () => {
    const answers = [
      await setup().send(),
      await setup({
        storage: () => new Response("expired", { status: 403 }),
      }).send(),
      await setup({
        storage: () =>
          new Response("<html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      }).send(),
      await setup({ storage: () => "throw" }).send(),
      await setup({
        played: { data: null, error: { code: "XX000", message: SIGNED } },
      }).send(),
      await setup({ api: new Response("nope", { status: 500 }) }).send(),
    ];
    for (const res of answers) {
      const text = await visible(res);
      expect(text).not.toContain("secret-signature");
      expect(text).not.toContain("X-Amz");
      expect(text).not.toContain("storage.mq.maqsam.com");
    }
  });
});

describe("when something fails", () => {
  test("no recording at Maqsam is a 404 that says so", async () => {
    const s = setup({ api: new Response("{}", { status: 404 }) });
    const res = await s.send();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Maqsam has no recording of this call.",
    });
    expect(s.health.at(-1)).toMatchObject({
      phase: "response",
      http_status: 404,
    });
  });

  test("Maqsam not answering is an unknown receipt and a 502", async () => {
    const s = setup({ api: "throw" });
    const res = await s.send();
    expect(res.status).toBe(502);
    expect(s.health.map(h => h.phase)).toEqual(["intent", "unknown"]);
  });

  test("storage failing, or sending something that is not audio, plays nothing and records no play", async () => {
    const expired = setup({
      storage: () => new Response("expired", { status: 403 }),
    });
    expect((await expired.send()).status).toBe(502);
    const html = setup({
      storage: () =>
        new Response("<html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const res = await html.send();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(
      "Maqsam sent something that is not audio, so it was not played.",
    );
    for (const s of [expired, html])
      expect(s.rpcs.map(r => r.fn)).toEqual(["cockpit_call_recording_scope"]);
  });

  test("when the audit row cannot be written, the audio is not sent", async () => {
    const s = setup({ played: "throw" });
    const res = await s.send();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(
      "The play could not be recorded, so the recording was not sent. Try again.",
    );
    expect(s.wasCancelled()).toBe(true);
    const refused = setup({
      played: {
        data: null,
        error: {
          code: "42501",
          message:
            "Sign in with your cockpit account to see call centre numbers.",
        },
      },
    });
    expect((await refused.send()).status).toBe(403);
  });

  test("a health ledger that cannot be written stops the call", async () => {
    const asked: string[] = [];
    const handler = makeRecordingApi({
      userRpc: async () => ({ data: { ok: true }, error: null }),
      health: async () => {
        throw new Error("Could not save provider health receipt");
      },
      env: () => "x",
      fetch: (async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    const res = await handler(
      new Request("https://fn.test/", {
        method: "POST",
        headers: { Authorization: "Bearer seat-jwt" },
        body: JSON.stringify({ callId: "1" }),
      }),
    );
    expect(res.status).toBe(502);
    expect(asked).toEqual([]);
  });
});
