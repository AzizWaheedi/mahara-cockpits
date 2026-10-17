import { describe, expect, test } from "bun:test";
import { TOKEN } from "./fixtures.ts";
import { classify, GRAPH_VERSION, type GraphDeps, MetaError, metaGet, metaPages, type Receipt, scrub } from "./graph.ts";
import { fakeFetch, graphPath, metaError, ok, type Route } from "./testkit.ts";

function graph(routes: Route[], token = TOKEN) {
  const f = fakeFetch(routes);
  const receipts: Receipt[] = [];
  const deps: GraphDeps = { token: () => token, fetch: f.request, health: async r => void receipts.push(r) };
  return { deps, calls: f.calls, receipts };
}

async function caught(p: Promise<unknown>): Promise<MetaError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof MetaError) return e;
    throw e;
  }
  throw new Error("expected a MetaError");
}

describe("one Graph read", () => {
  test("pinned to v25.0, GET, the token in the header only, and a receipt before and after", async () => {
    const g = graph([c => (graphPath(c) === "act_1111111111111" ? ok({ id: "act_1111111111111" }) : null)]);
    const body = await metaGet(g.deps, "act_1111111111111", { fields: "id,name" });
    expect(body.id).toBe("act_1111111111111");
    expect(GRAPH_VERSION).toBe("v25.0");
    const [call] = g.calls;
    expect(call.url.origin + call.url.pathname).toBe("https://graph.facebook.com/v25.0/act_1111111111111");
    expect(call.method).toBe("GET");
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.url.toString()).not.toContain(TOKEN);
    expect(call.url.searchParams.has("access_token")).toBe(false);
    expect(g.receipts).toEqual([
      { provider: "meta", method: "GET", resource: "act_1111111111111", phase: "intent" },
      { provider: "meta", method: "GET", resource: "act_1111111111111", phase: "response", http_status: 200, error: null },
    ]);
  });

  test("no token: nothing is sent and the sentence says which secret", async () => {
    const g = graph([() => ok({})], "");
    const e = await caught(metaGet(g.deps, "me", {}));
    expect(e.kind).toBe("config");
    expect(e.message).toContain("META_SYSTEM_TOKEN is not set");
    expect(g.calls.length).toBe(0);
    expect(g.receipts.length).toBe(0);
  });

  test("only the reads this function makes", async () => {
    const g = graph([() => ok({})]);
    for (const path of [
      "act_1111111111111/ads",
      "act_1111111111111/adsets/x",
      "act_1111111111111/campaigns/x",
      "act_1111111111111/activities/1",
      "120000000000101/campaigns",
      "act_1111111111111/adcreatives",
      "120000000000102",
      "123/owned_ad_accounts",
      "../act_1",
      "act_1111111111111/insights?x=1",
      "https://evil.example/x",
    ]) {
      expect((await caught(metaGet(g.deps, path, {}))).kind).toBe("config");
    }
    expect(g.calls.length).toBe(0);
    // The ad set list (for each lead ad set's destination) is one of them; so are the
    // budgets (campaigns, ad sets nested) and their history (the activity log), GET only.
    await metaGet(g.deps, "act_1111111111111/adsets", { fields: "id,destination_type" });
    await metaGet(g.deps, "act_1111111111111/campaigns", { fields: "id,daily_budget" });
    await metaGet(g.deps, "act_1111111111111/activities", { fields: "event_type", since: 1, until: 2 });
    expect(g.calls.map(c => [c.method, graphPath(c)])).toEqual([
      ["GET", "act_1111111111111/adsets"],
      ["GET", "act_1111111111111/campaigns"],
      ["GET", "act_1111111111111/activities"],
    ]);
  });

  test("Meta's refusals are sorted into what the run does about them", async () => {
    const cases: [Response, string][] = [
      [metaError(190, "Error validating access token"), "token"],
      [metaError(100, "Object does not exist", 400, 33), "permission"],
      [metaError(10, "Permission denied"), "permission"],
      [metaError(17, "User request limit reached"), "rate"],
      [metaError(80004, "Too many calls to this ad-account"), "rate"],
      [metaError(1, "Please reduce the amount of data you're asking for, then retry your request", 500, 99), "heavy"],
      [metaError(2, "Service temporarily unavailable", 503, 1504044), "heavy"],
      [ok({ nope: true }, 502), "heavy"],
      [metaError(100, "Invalid parameter"), "other"],
    ];
    for (const [answer, kind] of cases) {
      const g = graph([() => answer.clone()]);
      const e = await caught(metaGet(g.deps, "act_1111111111111/insights", {}));
      expect({ kind: e.kind }).toEqual({ kind });
      expect(g.receipts.map(r => r.phase)).toEqual(["intent", "response"]);
    }
    expect(classify(null, null, 504, "")).toBe("heavy");
  });

  test("no answer is an unknown receipt, and the read can be split and tried again", async () => {
    const g = graph([() => {
      throw new TypeError("network down");
    }]);
    const e = await caught(metaGet(g.deps, "act_1111111111111/insights", {}));
    expect(e.kind).toBe("heavy");
    expect(g.receipts.map(r => r.phase)).toEqual(["intent", "unknown"]);
  });

  test("a token Meta echoes back never reaches a receipt or a message", async () => {
    const g = graph([() => metaError(190, `Invalid OAuth access token: ${TOKEN} (access_token=${TOKEN})`)]);
    const e = await caught(metaGet(g.deps, "me", {}));
    expect(e.message).not.toContain(TOKEN);
    expect(JSON.stringify(g.receipts)).not.toContain(TOKEN);
    expect(e.message).toContain("[redacted]");
    expect(scrub("Bearer abc.def x", "")).toBe("Bearer [redacted] x");
  });
});

describe("paging", () => {
  const pages: Route = c => {
    if (graphPath(c) !== "act_1111111111111/insights") return null;
    const after = c.url.searchParams.get("after");
    if (!after) return ok({ data: [{ n: 1 }, { n: 2 }], paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/v25.0/x?access_token=LEAK" } });
    if (after === "c1") return ok({ data: [{ n: 3 }], paging: { cursors: { after: "c2" }, next: "https://graph.facebook.com/v25.0/x" } });
    if (after === "c2") return ok({ data: [{ n: 4 }], paging: { cursors: { after: "c3" } } });
    return null;
  };

  test("every page, by the after cursor on the same path, never by following Meta's next link", async () => {
    const g = graph([pages]);
    const rows = await metaPages(g.deps, "act_1111111111111/insights", { level: "ad", limit: 2 });
    expect(rows.map(r => r.n)).toEqual([1, 2, 3, 4]);
    expect(g.calls.map(c => c.url.searchParams.get("after"))).toEqual([null, "c1", "c2"]);
    expect(g.calls.every(c => c.url.pathname === "/v25.0/act_1111111111111/insights" && c.url.searchParams.get("level") === "ad")).toBe(true);
    expect(g.calls.some(c => c.url.toString().includes("LEAK"))).toBe(false);
  });

  test("a next page without a cursor, a repeated cursor or too many pages keeps nothing partial", async () => {
    const noCursor = graph([() => ok({ data: [{ n: 1 }], paging: { next: "https://graph.facebook.com/v25.0/x" } })]);
    expect((await caught(metaPages(noCursor.deps, "act_1111111111111/insights", {}))).message).toContain("gave no cursor");
    const loop = graph([() => ok({ data: [{ n: 1 }], paging: { cursors: { after: "same" }, next: "x" } })]);
    expect((await caught(metaPages(loop.deps, "act_1111111111111/insights", {}))).message).toContain("same cursor twice");
    let i = 0;
    const endless = graph([() => ok({ data: [{ n: 1 }], paging: { cursors: { after: `c${++i}` }, next: "x" } })]);
    expect((await caught(metaPages(endless.deps, "act_1111111111111/insights", {}, 3))).message).toContain("more than 3 pages");
    const noData = graph([() => ok({ paging: {} })]);
    expect((await caught(metaPages(noData.deps, "act_1111111111111/insights", {}))).message).toContain("without a data list");
  });
});
