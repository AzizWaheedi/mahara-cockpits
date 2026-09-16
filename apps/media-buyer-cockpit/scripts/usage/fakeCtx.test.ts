/**
 * Self-test for the usage harness (fakeCtx.ts). The same file lives in all
 * three apps. It checks the harness, not the app: the only app code it runs
 * is each child's POST /bridge route and its `hermes:pending` query.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  advance,
  appDir,
  FAKE_SITE,
  type FakeApp,
  invalidates,
  linkApps,
  makeApp,
  now,
  restoreGlobals,
  setNow,
  sizeOf,
  web,
} from "./fakeCtx";

const START = Date.parse("2026-09-16T08:00:00Z");

type Chat = {
  thread: string;
  role: string;
  text: string;
  status: string;
  at: number;
  context?: string;
};

function chat(status: string, over: Partial<Chat> = {}): Chat {
  return {
    thread: "t1",
    role: "user",
    text: "hello",
    status,
    at: now(),
    ...over,
  };
}

let app: FakeApp;

beforeEach(async () => {
  setNow(START);
  web.clear();
  app = await makeApp();
});

afterAll(() => {
  restoreGlobals();
});

describe("loading", () => {
  test("every module loads and registered functions still carry _handler", () => {
    expect([...app.loadErrors.keys()]).toEqual([]);
    expect(app.functionNames().length).toBeGreaterThan(20);
    // Convex 1.45 sets `_handler` in server/impl/registration_impl.js. If an
    // upgrade drops it, makeApp throws before this line.
    expect(typeof app.fn("hermes:pending")._handler).toBe("function");
    expect(app.registry.router).not.toBeNull();
  });

  test("index fields come from the schema, and unknown names throw", () => {
    expect(app.keyFields("hermesChat", "by_status")).toEqual([
      "status",
      "_creationTime",
      "_id",
    ]);
    expect(() => app.keyFields("hermesChat", "by_nothing")).toThrow(
      /no index hermesChat.by_nothing/,
    );
    expect(() => app.keyFields("noSuchTable", "by_creation_time")).toThrow(
      /no table/,
    );
  });
});

describe("transactions", () => {
  test("a mutation's writes commit once per document and are metered", async () => {
    const m = app.meter.mark();
    const ids = await app.inlineRun("mutation", async ctx => {
      const a = await ctx.db.insert("hermesChat", chat("queued"));
      const b = await ctx.db.insert("hermesChat", chat("queued"));
      await ctx.db.patch(a, { status: "sent" });
      await ctx.db.patch(a, { text: "edited" });
      await ctx.db.delete(b);
      return [a, b];
    });
    const d = app.meter.since(m);
    expect(d.totalCalls).toBe(1);
    expect(d.writes).toEqual({ hermesChat: 1 });
    expect(d.docsWritten).toBe(1);
    expect(d.bytesWritten).toBe(sizeOf(app.doc(ids[0])));
    expect(app.doc(ids[0])?.status).toBe("sent");
    expect(app.doc(ids[1])).toBeNull();
    expect(app.writeLog.at(-1)?.kind).toBe("insert");
  });

  test("a mutation that throws writes nothing and schedules nothing", async () => {
    const later = app.define("mutation", async () => null);
    await expect(
      app.inlineRun("mutation", async ctx => {
        await ctx.db.insert("hermesChat", chat("queued"));
        await ctx.scheduler.runAfter(0, later, {});
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(app.count("hermesChat")).toBe(0);
    expect(app.pending()).toEqual([]);
    expect(app.meter.total.docsWritten).toBe(0);
  });

  test("documents are checked against the schema", async () => {
    await expect(
      app.inlineRun("mutation", async ctx =>
        ctx.db.insert("hermesChat", { thread: "t1", role: "user" }),
      ),
    ).rejects.toThrow(/missing field text/);
    await expect(
      app.inlineRun("mutation", async ctx =>
        ctx.db.insert("hermesChat", { ...chat("queued"), extra: 1 }),
      ),
    ).rejects.toThrow(/unexpected field extra/);
  });

  test("a nested runMutation that throws rolls back only its own writes", async () => {
    const failing = app.define("mutation", async ctx => {
      await ctx.db.insert("hermesChat", chat("queued", { text: "inner" }));
      throw new Error("inner failed");
    });
    await app.inlineRun("mutation", async ctx => {
      await ctx.db.insert("hermesChat", chat("queued", { text: "outer" }));
      await ctx.runMutation(failing, {}).catch(() => null);
    });
    expect(app.docs("hermesChat").map(d => d.text)).toEqual(["outer"]);
  });
});

describe("reads", () => {
  beforeEach(() => {
    app.seed(
      "hermesChat",
      Array.from({ length: 20 }, () =>
        chat("answered", { context: "x".repeat(6000) }),
      ),
    );
    app.seed("hermesChat", [chat("queued"), chat("queued"), chat("queued")]);
  });

  test("an index range reads only its own rows", async () => {
    const m = app.meter.mark();
    const rows = await app.inlineRun("query", ctx =>
      ctx.db
        .query("hermesChat")
        .withIndex("by_status", (q: any) => q.eq("status", "queued"))
        .take(10),
    );
    expect(rows).toHaveLength(3);
    const d = app.meter.since(m);
    expect(d.docsRead).toBe(3);
    expect(d.bytesRead).toBeLessThan(1000);
  });

  test("a filter still reads every row it scans", async () => {
    const m = app.meter.mark();
    const rows = await app.inlineRun("query", ctx =>
      ctx.db
        .query("hermesChat")
        .filter((q: any) => q.eq(q.field("status"), "queued"))
        .collect(),
    );
    expect(rows).toHaveLength(3);
    const d = app.meter.since(m);
    expect(d.docsRead).toBe(23);
    expect(d.bytesRead).toBeGreaterThan(20 * 6000);
  });

  test("take stops reading at its limit, in either order", async () => {
    const m = app.meter.mark();
    const newest = await app.inlineRun("query", ctx =>
      ctx.db.query("hermesChat").order("desc").first(),
    );
    expect(newest.status).toBe("queued");
    expect(app.meter.since(m).docsRead).toBe(1);
  });

  test("bad index use throws like Convex", async () => {
    await expect(
      app.inlineRun("query", ctx =>
        ctx.db.query("hermesChat").withIndex("by_nothing").collect(),
      ),
    ).rejects.toThrow(/no index/);
    await expect(
      app.inlineRun("query", ctx =>
        ctx.db
          .query("hermesChat")
          .withIndex("by_status", (q: any) => q.gt("_creationTime", 0))
          .collect(),
      ),
    ).rejects.toThrow(/range/);
    await expect(
      app.inlineRun("query", ctx =>
        ctx.db
          .query("hermesChat")
          .withIndex("by_status", (q: any) => q.eq("status", "queued"))
          .unique(),
      ),
    ).rejects.toThrow(/more than one/);
  });

  test("paginate walks the whole range, one transaction per page", async () => {
    const page = app.define("query", (ctx, { cursor }) =>
      ctx.db.query("hermesChat").paginate({ numItems: 7, cursor }),
    );
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const r: any = await app.run(page, { cursor });
      pages++;
      for (const d of r.page) seen.add(d._id);
      if (r.isDone) break;
      cursor = r.continueCursor;
    }
    expect(seen.size).toBe(23);
    expect(pages).toBe(4);
  });
});

describe("read sets", () => {
  test("take(n) is cut at its last row; a write past the cut re-runs nothing", async () => {
    const [first] = app.seed("hermesChat", [
      chat("queued"),
      chat("queued"),
      chat("queued"),
    ]);
    const firstTwo = app.define("query", ctx =>
      ctx.db
        .query("hermesChat")
        .withIndex("by_status", (q: any) => q.eq("status", "queued"))
        .take(2),
    );
    const w = await app.watch(firstTwo);
    expect(w.runs).toBe(1);

    // Newer queued row: sorts after the cut.
    await app.inlineRun("mutation", ctx =>
      ctx.db.insert("hermesChat", chat("queued")),
    );
    // A row outside the range.
    await app.inlineRun("mutation", ctx =>
      ctx.db.insert("hermesChat", chat("answered")),
    );
    expect(w.triggers).toBe(0);

    // A row inside the cut.
    await app.inlineRun("mutation", ctx =>
      ctx.db.patch(first, { text: "changed" }),
    );
    expect(w.triggers).toBe(1);
    expect(w.runs).toBe(2);
    expect(w.result[0].text).toBe("changed");

    // Moving a row out of the range touches the old position.
    await app.inlineRun("mutation", ctx =>
      ctx.db.patch(first, { status: "sent" }),
    );
    expect(w.triggers).toBe(2);
    expect(app.meter.total.reruns).toBe(2);
  });

  test("a short take covers the whole range, and get(id) covers its id", async () => {
    const [only] = app.seed("hermesChat", [chat("queued")]);
    const [other] = app.seed("hermesChat", [chat("answered")]);
    const ten = app.define("query", ctx =>
      ctx.db
        .query("hermesChat")
        .withIndex("by_status", (q: any) => q.eq("status", "queued"))
        .take(10),
    );
    const byId = app.define("query", (ctx, { id }) => ctx.db.get(id));
    const w1 = await app.watch(ten);
    const w2 = await app.watch(byId, { id: other });
    await app.inlineRun("mutation", ctx =>
      ctx.db.insert("hermesChat", chat("queued")),
    );
    expect(w1.triggers).toBe(1);
    expect(w2.triggers).toBe(0);
    await app.inlineRun("mutation", ctx => ctx.db.patch(other, { text: "x" }));
    expect(w2.triggers).toBe(1);
    expect(w1.triggers).toBe(1);
    const write = app.writeLog.at(-1)!;
    expect(invalidates(w2.readSet, write)).toBe(true);
    expect(invalidates(w1.readSet, write)).toBe(false);
    expect(only).toBeTruthy();
  });

  test("a watch with autoRerun off is only marked stale", async () => {
    const all = app.define("query", ctx =>
      ctx.db.query("hermesChat").collect(),
    );
    const w = await app.watch(all, {}, { autoRerun: false });
    await app.inlineRun("mutation", ctx =>
      ctx.db.insert("hermesChat", chat("queued")),
    );
    expect(w.stale).toBe(true);
    expect(w.runs).toBe(1);
    expect(w.triggers).toBe(1);
  });
});

describe("scheduler, clock and auth", () => {
  test("scheduled calls wait for their time and run signed out", async () => {
    const seen: unknown[] = [];
    const later = app.define("mutation", async ctx => {
      seen.push(await ctx.auth.getUserIdentity());
      await ctx.db.insert("hermesChat", chat("queued", { at: Date.now() }));
    });
    const user = await app.makeUser({ email: "someone@example.test" });
    await app.inlineRun(
      "mutation",
      ctx => ctx.scheduler.runAfter(60_000, later, {}),
      { as: user },
    );
    expect(app.pending()).toHaveLength(1);
    expect(await app.flushScheduled()).toHaveLength(0);
    const ran = await app.flushScheduled(START + 5 * 60_000);
    expect(ran.map(r => r.state)).toEqual(["success"]);
    expect(app.docs("hermesChat")[0].at).toBe(START + 60_000);
    expect(now()).toBe(START + 5 * 60_000);
    expect(seen).toEqual([null]);
  });

  test("Date follows the fake clock", async () => {
    advance(90_000);
    const t = await app.inlineRun("query", () => [
      Date.now(),
      new Date().toISOString(),
    ]);
    expect(t).toEqual([START + 90_000, new Date(START + 90_000).toISOString()]);
  });

  test("the signed-in user reaches nested calls", async () => {
    const user = await app.makeUser({ email: "someone@example.test" });
    const who = app.define(
      "query",
      async ctx => (await ctx.auth.getUserIdentity())?.subject ?? null,
    );
    const outer = app.define("action", ctx => ctx.runQuery(who, {}));
    expect(await app.run(outer, {}, { as: user })).toBe(`${user}|s`);
    expect(await app.run(outer, {})).toBeNull();
  });
});

describe("env and network", () => {
  test("app code sees only this app's fake env", async () => {
    const seen = await app.inlineRun("action", () => ({
      site: process.env.CONVEX_SITE_URL,
      mode: process.env.VIKTOR_SPACES_ACCESS_MODE,
      home: process.env.HOME,
    }));
    expect(seen).toEqual({
      site: FAKE_SITE[app.name],
      mode: "authenticated",
      home: undefined,
    });
  });

  test("fetch never reaches the network; web routes answer and are metered", async () => {
    await expect(
      app.inlineRun("action", () => fetch("https://example.test/x")),
    ).rejects.toThrow(/no fake route/);
    expect(web.unrouted).toEqual(["GET https://example.test/x"]);
    web.on("https://example.test/", () => ({ ok: true }));
    const m = app.meter.mark();
    const body = JSON.stringify({ hello: "world" });
    const out = await app.inlineRun("action", async () => {
      const res = await fetch("https://example.test/y", {
        method: "POST",
        body,
      });
      return await res.json();
    });
    expect(out).toEqual({ ok: true });
    const d = app.meter.since(m);
    expect(d.egressBytes).toBe(Buffer.byteLength(body));
    expect(d.fetches).toBe(1);
  });
});

describe("linked apps", () => {
  test("a bridge call runs the child's /bridge route in the child's ctx", async () => {
    const mb = app.name === "mb" ? app : await makeApp(appDir("mb"));
    const csm = app.name === "csm" ? app : await makeApp(appDir("csm"));
    const creative =
      app.name === "creative" ? app : await makeApp(appDir("creative"));
    const net = linkApps({ mb, csm, creative });
    const mark = net.meter.mark();

    const post = (child: "CSM" | "CREATIVE", token?: string) =>
      mb.inlineRun("action", async () => {
        const res = await fetch(
          `${process.env[`${child}_BRIDGE_URL`]}/bridge`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token ?? process.env[`${child}_BRIDGE_TOKEN`]}`,
            },
            body: JSON.stringify({ fn: "chatPending", args: {} }),
          },
        );
        return { status: res.status, body: await res.text() };
      });

    expect((await post("CSM", "wrong")).status).toBe(401);
    const ok = await post("CSM");
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, data: [] });
    // The creative token is not the CSM one.
    expect((await post("CREATIVE", "fake-csm-bridge-token")).status).toBe(401);
    expect((await post("CREATIVE")).status).toBe(200);

    const d = net.meter.since(mark);
    expect(d.calls["[csm] hermes:pending"]).toBe(1);
    expect(d.calls["[creative] hermes:pending"]).toBe(1);
    expect(d.byApp.mb?.fetches).toBe(4);
    expect(d.byApp.mb?.egressBytes).toBe(
      4 * Buffer.byteLength(JSON.stringify({ fn: "chatPending", args: {} })),
    );
    const httpCall = csm.meter.records.find(r => r.kind === "http");
    expect(httpCall?.via?.app).toBe("mb");
  });
});
