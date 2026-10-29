import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerFetch, type Receipt } from "./ledger.ts";
import {
  CACHE_MS,
  holdSentence,
  makeOrigin,
  oldSenders,
  readOldSenders,
} from "./oldSenders.ts";

// A fake Typeform and Make; the cache lives in a scratch folder deleted after.
// MAKE_ZONE is a bare zone, the shape the VPS's api-keys.env holds (read 2026-10-29, shape only).
const ENV = {
  TYPEFORM_TOKEN: "tfp_invented",
  MAKE_API_KEY: "make-invented",
  MAKE_ZONE: "eu2",
};
type World = {
  webhooks: unknown[] | "fail";
  scenarios: Record<string, boolean | "fail">;
};
function fakeWorld(world: World) {
  const calls: { url: string; method: string; auth: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: String(init?.method ?? "GET"),
      auth: String(
        (init?.headers as Record<string, string>)?.Authorization ?? "",
      ),
    });
    if (url === "https://api.typeform.com/forms/fRokTITH/webhooks") {
      return world.webhooks === "fail"
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ items: world.webhooks }));
    }
    const m = url.match(
      /^https:\/\/eu[12]\.make\.com\/api\/v2\/scenarios\/(\d+)$/,
    );
    if (m) {
      const s = world.scenarios[m[1]];
      return s === "fail" || s === undefined
        ? new Response("{}", { status: 401 })
        : new Response(
            JSON.stringify({ scenario: { id: Number(m[1]), isActive: s } }),
          );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { calls, fetch: f };
}
const off: World = {
  webhooks: [
    {
      id: "w1",
      tag: "cockpit",
      url: "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/forms-door",
      enabled: true,
    },
    { id: "w2", url: "https://hook.eu1.make.com/abc", enabled: false },
  ],
  scenarios: { "9209179": false, "9523861": false },
};
const NOW = new Date("2026-10-29T10:00:00Z");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "client-messages-senders-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("the old senders", () => {
  test("all off: nothing holds; every read is a GET with its own token", async () => {
    const w = fakeWorld(off);
    const s = await readOldSenders({
      env: ENV,
      fetch: w.fetch,
      now: () => NOW,
      cachePath: null,
    });
    expect(s).toEqual({
      at: NOW.toISOString(),
      typeform: "off",
      scenarios: { "9209179": "off", "9523861": "off" },
      held: false,
      sentence: null,
    });
    expect(w.calls.map(c => `${c.method} ${c.url} ${c.auth}`)).toEqual([
      "GET https://api.typeform.com/forms/fRokTITH/webhooks Bearer tfp_invented",
      "GET https://eu2.make.com/api/v2/scenarios/9209179 Token make-invented",
      "GET https://eu2.make.com/api/v2/scenarios/9523861 Token make-invented",
    ]);
  });

  test("the VPS's bare zone (eu2) reads Make; a host or an origin reads it too; junk is unread and holds", async () => {
    for (const zone of [
      "eu2",
      "EU2",
      " eu2 ",
      "eu2.make.com",
      "https://eu2.make.com",
    ]) {
      const w = fakeWorld(off);
      const s = await readOldSenders({
        env: { ...ENV, MAKE_ZONE: zone },
        fetch: w.fetch,
        now: () => NOW,
        cachePath: null,
      });
      expect([zone, s.held, s.scenarios]).toEqual([
        zone,
        false,
        { "9209179": "off", "9523861": "off" },
      ]);
      expect(
        w.calls.filter(c => c.url.includes("make.com")).map(c => c.url),
      ).toEqual([
        "https://eu2.make.com/api/v2/scenarios/9209179",
        "https://eu2.make.com/api/v2/scenarios/9523861",
      ]);
    }
    for (const zone of [
      "eu2.evil.test",
      "make",
      "e2",
      "eu123",
      "eu2/../x",
      "not a zone",
    ]) {
      const w = fakeWorld(off);
      const s = await readOldSenders({
        env: { ...ENV, MAKE_ZONE: zone },
        fetch: w.fetch,
        now: () => NOW,
        cachePath: null,
      });
      expect([zone, s.scenarios, s.held]).toEqual([
        zone,
        { "9209179": "unread", "9523861": "unread" },
        true,
      ]);
      expect(w.calls.some(c => c.url.includes("make.com"))).toBe(false);
    }
  });

  test("through the ledger: each read is receipted first, Make's under make with the scenario collapsed", async () => {
    const rows: Receipt[] = [];
    const ledger = ledgerFetch({
      insert: async r => void rows.push(r),
      runKey: "client-messages:doctor",
      fetch: fakeWorld(off).fetch,
    });
    const s = await readOldSenders({
      env: ENV,
      fetch: ledger.fetch,
      now: () => NOW,
      cachePath: null,
    });
    expect(s.held).toBe(false);
    expect(
      rows.map(
        r =>
          `${r.phase} ${r.provider} ${r.method} ${r.resource} ${r.http_status}`,
      ),
    ).toEqual([
      "intent typeform GET api.typeform.com/forms/fRokTITH/webhooks null",
      "response typeform GET api.typeform.com/forms/fRokTITH/webhooks 200",
      "intent make GET eu2.make.com/api/v2/scenarios/:id null",
      "response make GET eu2.make.com/api/v2/scenarios/:id 200",
      "intent make GET eu2.make.com/api/v2/scenarios/:id null",
      "response make GET eu2.make.com/api/v2/scenarios/:id 200",
    ]);
  });

  test("Make 07 on holds with its scenario named; an enabled make.com webhook holds", async () => {
    const make = await readOldSenders({
      env: ENV,
      fetch: fakeWorld({
        ...off,
        scenarios: { "9209179": false, "9523861": true },
      }).fetch,
      now: () => NOW,
      cachePath: null,
    });
    expect(make).toMatchObject({
      held: true,
      sentence:
        "Make's recap sender is still on (scenario 9523861). The cockpit sends 1-1 recaps only after the switch-over.",
    });
    const hook = await readOldSenders({
      env: ENV,
      fetch: fakeWorld({
        ...off,
        webhooks: [
          { id: "w2", url: "https://hook.eu1.make.com/abc", enabled: true },
        ],
      }).fetch,
      now: () => NOW,
      cachePath: null,
    });
    expect(hook).toMatchObject({
      typeform: "on",
      held: true,
      sentence:
        "The 1-1 Typeform still sends to Make. The cockpit sends 1-1 recaps only after the switch-over.",
    });
  });

  test("a read that fails is unread, which holds like on; a missing key or zone is unread too", async () => {
    const failed = await readOldSenders({
      env: ENV,
      fetch: fakeWorld({
        webhooks: "fail",
        scenarios: { "9209179": false, "9523861": "fail" },
      }).fetch,
      now: () => NOW,
      cachePath: null,
    });
    expect(failed).toMatchObject({
      typeform: "unread",
      scenarios: { "9209179": "off", "9523861": "unread" },
      held: true,
    });
    expect(failed.sentence).toBe(
      "The cockpit could not read the 1-1 Typeform's webhooks or Make scenario 9523861, so it holds the recaps. It reads them again within 10 minutes.",
    );
    const noKeys = await readOldSenders({
      env: {},
      fetch: fakeWorld(off).fetch,
      now: () => NOW,
      cachePath: null,
    });
    expect(noKeys).toMatchObject({
      typeform: "unread",
      scenarios: { "9209179": "unread", "9523861": "unread" },
      held: true,
    });
  });

  test("cached for 10 minutes; read again after", async () => {
    const cachePath = join(dir, "old-senders.json");
    const w = fakeWorld(off);
    let now = NOW;
    const deps = { env: ENV, fetch: w.fetch, now: () => now, cachePath };
    expect((await oldSenders(deps)).cached).toBe(false);
    expect(w.calls).toHaveLength(3);
    now = new Date(NOW.getTime() + CACHE_MS - 1000);
    expect((await oldSenders(deps)).cached).toBe(true);
    expect(w.calls).toHaveLength(3);
    now = new Date(NOW.getTime() + CACHE_MS + 1000);
    expect((await oldSenders(deps)).cached).toBe(false);
    expect(w.calls).toHaveLength(6);
    // The doctor reads fresh.
    expect((await oldSenders(deps, { fresh: true })).cached).toBe(false);
  });

  test("Make's zone must be a bare zone or a make.com host; the sentences name what holds", () => {
    expect(makeOrigin("eu2")).toBe("https://eu2.make.com");
    expect(makeOrigin("US1")).toBe("https://us1.make.com");
    expect(makeOrigin("eu1.make.com")).toBe("https://eu1.make.com");
    expect(makeOrigin("https://us1.make.com/")).toBe("https://us1.make.com");
    expect(makeOrigin("https://make.com.evil.test")).toBeNull();
    expect(makeOrigin("http://eu2.make.com")).toBeNull();
    expect(makeOrigin("eu2.evil.test")).toBeNull();
    expect(makeOrigin("e2")).toBeNull();
    expect(makeOrigin("not a zone")).toBeNull();
    expect(makeOrigin("")).toBeNull();
    expect(makeOrigin(undefined)).toBeNull();
    expect(
      holdSentence({
        typeform: "off",
        scenarios: { "9209179": "on", "9523861": "on" },
      }),
    ).toBe(
      "Make's recap sender is still on (scenario 9209179 and 9523861). The cockpit sends 1-1 recaps only after the switch-over.",
    );
    expect(
      holdSentence({
        typeform: "off",
        scenarios: { "9209179": "off", "9523861": "off" },
      }),
    ).toBeNull();
  });
});
