// api(): a lapsed sign-in is said as one, and a laptop that woke with the
// network still down is the connection, not a sign-out (fallback review 1).
//
// bun test src/lib/api.signin.test.ts

import { describe, expect, mock, test } from "bun:test";
import { AuthRetryableFetchError } from "@supabase/supabase-js";

let session: { access_token: string } | null = null;
let sessionError: unknown = null;
mock.module("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session }, error: sessionError }),
    },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const g = globalThis as unknown as { window?: unknown };
g.window ??= globalThis;

// Another file may have put a stand-in for ./api in this run: read the file
// itself, under a name nothing else mocks.
const { api } = (await import(
  `./api.ts?signin=${Date.now()}`
)) as typeof import("./api");
const { ApiError, SIGNED_OUT, UNREACHED } = await import("./apiErrors");

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as InstanceType<typeof ApiError>;
  }
  throw new Error("it did not fail");
}

describe("the session", () => {
  test("no session and a retryable error: the connection, read again later", async () => {
    session = null;
    sessionError = new AuthRetryableFetchError("Failed to fetch", 0);
    const e = await failure(api("live.status"));
    expect(e.kind).toBe("network");
    expect(e.message).toBe(UNREACHED);
  });

  test("no session and no error: the sign-in ran out", async () => {
    session = null;
    sessionError = null;
    const e = await failure(api("live.status"));
    expect(e.kind).toBe("signin");
    expect(e.message).toBe(SIGNED_OUT);
  });

  test("a 401 from the gateway is a sign-in, not a 'try again'", async () => {
    session = { access_token: "t" };
    sessionError = null;
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ msg: "Invalid JWT" }), {
        status: 401,
      })) as unknown as typeof fetch;
    try {
      const e = await failure(api("live.status"));
      expect(e.kind).toBe("signin");
    } finally {
      globalThis.fetch = real;
    }
  });

  test("a read's own shorter wait", async () => {
    session = { access_token: "t" };
    const real = globalThis.fetch;
    globalThis.fetch = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      )) as unknown as typeof fetch;
    try {
      const at = Date.now();
      const e = await failure(api("live.status", {}, { timeoutMs: 50 }));
      expect(e.kind).toBe("timeout");
      expect(Date.now() - at).toBeLessThan(2000);
    } finally {
      globalThis.fetch = real;
    }
  });
});
