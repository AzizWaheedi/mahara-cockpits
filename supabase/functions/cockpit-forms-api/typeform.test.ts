import { beforeEach, describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { clearTypeformCache, sentAt, typeformSent } from "./typeform.ts";
import { answer, fakeDeps, NOW, opOf } from "./testkit.ts";

const SINCE = "2026-10-28T07:00:00.000Z";
const CLIENT_ID = "c484f390-9695-4ffa-9693-9cc219592713";
const response = (over: Record<string, unknown>) => ({ token: "t", landed_at: "2026-10-28T07:40:00Z", submitted_at: "2026-10-28T07:45:00Z", hidden: {}, answers: [], ...over });

function setup(pages: Record<string, unknown[]> = {}, o: { status?: number; token?: boolean; gate?: (a: Record<string, any>) => unknown; now?: Date } = {}) {
  return fakeDeps({
    rpc: { cockpit_csm_client_gate_for_actor: o.gate ?? { taskId: "x" } },
    env: o.token === false ? {} : { TYPEFORM_TOKEN: "tfp-token-for-tests" },
    now: o.now,
    routes: [
      url => {
        if (url.host !== "api.typeform.com") return null;
        if (o.status) return answer({}, o.status);
        return answer({ total_items: 1, page_count: 1, items: pages[url.searchParams.get("query") ?? ""] ?? [] });
      },
    ],
  });
}

beforeEach(() => clearTypeformCache());

describe("checkin.typeformSent", () => {
  test("sent with its time when a response since the call carries the card in its hidden task_id or its Client ID answer", async () => {
    const f = setup({
      "86exCITYW": [response({ hidden: { task_id: "86exCITYW" } })],
      "86exMARBL": [response({ submitted_at: "2026-10-28T08:10:00Z", answers: [{ field: { ref: CLIENT_ID, type: "short_text" }, type: "text", text: " 86exMARBL " }] })],
    });
    const out = await typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: SINCE }, { taskId: "86exMARBL", since: SINCE }] });
    expect(out).toEqual({
      items: [
        { taskId: "86exCITYW", sent: true, at: "2026-10-28T07:45:00Z" },
        { taskId: "86exMARBL", sent: true, at: "2026-10-28T08:10:00Z" },
      ],
      now: NOW.toISOString(),
    });
    const url = new URL(f.sent[0].url);
    expect(url.pathname).toBe("/forms/fRokTITH/responses");
    // Typeform's documented form: ISO 8601 UTC to the second, no fraction.
    expect(Object.fromEntries(url.searchParams)).toEqual({ since: "2026-10-28T07:00:00Z", query: "86exCITYW", page_size: "5" });
    expect(f.sent[0].url).toContain("since=2026-10-28T07%3A00%3A00Z&");
    expect(f.sent[0].headers.authorization).toBe("Bearer tfp-token-for-tests");
  });

  test("since goes to the second it began, never later: milliseconds and an offset are dropped, a response in that second still counts", async () => {
    const f = setup({ "86exCITYW": [response({ hidden: { task_id: "86exCITYW" }, submitted_at: "2026-10-28T07:00:00.200Z" })] });
    const out = await typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: "2026-10-28T10:00:00.789+03:00" }] });
    expect(new URL(f.sent[0].url).searchParams.get("since")).toBe("2026-10-28T07:00:00Z");
    expect(out.items).toEqual([{ taskId: "86exCITYW", sent: true, at: "2026-10-28T07:00:00.200Z" }]);
  });

  test("not sent: a response before the call, or another card's that only the free-text query matched", async () => {
    const f = setup({
      "86exCITYW": [
        response({ hidden: { task_id: "86exCITYW" }, submitted_at: "2026-10-28T06:00:00Z" }),
        response({ hidden: { task_id: "86exOTHER" }, answers: [{ field: { ref: "another-ref" }, type: "text", text: "86exCITYW" }] }),
      ],
    });
    const out = await typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: SINCE }] });
    expect(out.items).toEqual([{ taskId: "86exCITYW", sent: false, at: null }]);
    expect(sentAt(response({ answers: [{ field: { ref: CLIENT_ID }, text: "86exCITYW" }] }), "86exCITYW")).toBe("2026-10-28T07:45:00Z");
  });

  test("Typeform unreadable or no token: sent null, and nothing of a response but its time ever leaves", async () => {
    const down = await typeformSent(opOf(setup({}, { status: 503 }).deps), { items: [{ taskId: "86exCITYW", since: SINCE }] });
    expect(down.items).toEqual([{ taskId: "86exCITYW", sent: null, at: null }]);
    const f = setup({}, { token: false });
    const none = await typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: SINCE }] });
    expect(none.items[0].sent).toBeNull();
    expect(f.sent).toHaveLength(0);
    const leak = setup({ "86exCITYW": [response({ hidden: { task_id: "86exCITYW" }, answers: [{ field: { ref: "x" }, type: "text", text: "Private client note" }] })] });
    expect(JSON.stringify(await typeformSent(opOf(leak.deps), { items: [{ taskId: "86exCITYW", since: SINCE }] }))).not.toContain("Private client note");
  });

  test("each answer is kept 60 s per card and call start; receipts carry provider typeform", async () => {
    const f = setup({ "86exCITYW": [response({ hidden: { task_id: "86exCITYW" } })] });
    await typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: SINCE }] });
    await typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: SINCE }] });
    expect(f.sent).toHaveLength(1);
    await typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: "2026-10-28T07:30:00.000Z" }] });
    expect(f.sent).toHaveLength(2);
    const later = setup({ "86exCITYW": [] }, { now: new Date(NOW.getTime() + 61_000) });
    later.deps.fetch = f.deps.fetch;
    await typeformSent(opOf(later.deps), { items: [{ taskId: "86exCITYW", since: SINCE }] });
    expect(f.sent).toHaveLength(3);
    expect(f.health.map(r => `${r.provider} ${r.method} ${r.resource} ${r.phase}`)).toEqual([
      "typeform GET forms/fRokTITH/responses intent",
      "typeform GET forms/fRokTITH/responses response",
      "typeform GET forms/fRokTITH/responses intent",
      "typeform GET forms/fRokTITH/responses response",
    ]);
    expect(f.health.every(r => String(r.run_key).startsWith("typeform:") && r.action_id === null)).toBe(true);
  });

  test("1 to 6 items, each with a card and a time", async () => {
    const f = setup();
    await expect(typeformSent(opOf(f.deps), { items: [] })).rejects.toThrow("Ask about 1 to 6 clients at a time.");
    await expect(typeformSent(opOf(f.deps), { items: Array.from({ length: 7 }, () => ({ taskId: "86exCITYW", since: SINCE })) })).rejects.toThrow("Ask about 1 to 6 clients at a time.");
    await expect(typeformSent(opOf(f.deps), { items: [{ taskId: "bad id!", since: SINCE }] })).rejects.toThrow("Each client needs its card");
    await expect(typeformSent(opOf(f.deps), { items: [{ taskId: "86exCITYW", since: "yesterday-ish" }] })).rejects.toThrow("Each client needs its card");
  });

  test("the client gate per item: a client outside the seat's list answers nothing and Typeform is not asked for it", async () => {
    const f = setup(
      { "86exCITYW": [response({ hidden: { task_id: "86exCITYW" } })] },
      {
        gate: a => {
          if (a.p_task_id === "86exMARBL") throw new RpcError("That client is not on your access list", "42501");
          return { taskId: a.p_task_id };
        },
      },
    );
    const out = await typeformSent(opOf(f.deps), { items: [{ taskId: "86exMARBL", since: SINCE }, { taskId: "86exCITYW", since: SINCE }] });
    expect(out.items).toEqual([
      { taskId: "86exMARBL", sent: null, at: null },
      { taskId: "86exCITYW", sent: true, at: "2026-10-28T07:45:00Z" },
    ]);
    expect(f.sent.map(s => new URL(s.url).searchParams.get("query"))).toEqual(["86exCITYW"]);
    expect(f.service.named("cockpit_csm_client_gate_for_actor").map(c => c.args.p_task_id)).toEqual(["86exMARBL", "86exCITYW"]);
  });
});
