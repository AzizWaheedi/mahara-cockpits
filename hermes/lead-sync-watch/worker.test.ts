import { describe, expect, test } from "bun:test";
import { deliver, loadRoster, run, sumHours, window } from "./worker";

type Row = Record<string, any>;

/** An in-memory stand-in for Supabase + Meta + Slack, enough to drive a whole run. */
function fakeIo(seed: Record<string, Row[]>, opts: { slackFails?: string; slackThrows?: boolean; history?: Row[] } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const posts: Row[] = [];
  let id = 0;
  const match = (r: Row, q: string) =>
    q
      .split("&")
      .filter(p => /=(eq|is)\./.test(p))
      .every(p => {
        const [k, rest] = p.split("=");
        const v = decodeURIComponent(rest.replace(/^(eq|is)\./, ""));
        if (rest.startsWith("is.")) return v === "false" ? r[k] === false : v === "true" ? r[k] === true : r[k] == null;
        return String(r[k]) === v;
      });
  const db = {
    async all(t: string, q: string) {
      return (tables[t] ?? []).filter(r => match(r, q));
    },
    async upsert(t: string, rows: Row[], key: string) {
      tables[t] ??= [];
      for (const row of rows) {
        const i = tables[t].findIndex(r => r[key] === row[key]);
        if (i >= 0) tables[t][i] = { ...tables[t][i], ...row };
        else tables[t].push(row);
      }
    },
    async insert(t: string, row: Row) {
      tables[t] ??= [];
      const r = { id: `id${++id}`, attempts: 0, ...row };
      tables[t].push(r);
      return r;
    },
    async patch(t: string, filter: string, values: Row) {
      for (const r of tables[t] ?? []) if (match(r, filter)) Object.assign(r, values);
    },
  };
  const slack = async (method: string, params: Row) => {
    if (method === "chat.postMessage") {
      if (opts.slackThrows) throw new Error("network down");
      if (opts.slackFails) throw Object.assign(new Error(`slack: ${opts.slackFails}`), { slackError: opts.slackFails });
      const ts = `${1000 + posts.length}.1`;
      posts.push({ ...params, ts });
      return { ok: true, ts };
    }
    if (method === "conversations.history" || method === "conversations.replies") return { ok: true, messages: opts.history ?? [] };
    if (method === "users.lookupByEmail") return { ok: true, user: { id: "UNADA" } };
    if (method === "conversations.info") return { ok: true, channel: { is_member: true } };
    throw new Error(method);
  };
  return { tables, posts, io: { db, slack, meta: async () => ({}), metaNext: async () => ({}) } as any };
}

describe("deliver", () => {
  const client = { key: "loc1", name: "Ocean Home", locationId: "loc1", accounts: ["1"], matchedBy: "x" };
  test("posts once, then never again for the same episode", async () => {
    const f = fakeIo({ cockpit_lead_sync_alerts: [] });
    const a = await deliver(f.io, { episodeId: "e1", kind: "alert", client, body: "hi" }, true);
    const b = await deliver(f.io, { episodeId: "e1", kind: "alert", client, body: "hi" }, true);
    expect(a.status).toBe("sent");
    expect(b.status).toBe("sent");
    expect(f.posts.length).toBe(1);
    expect(f.posts[0].text).toContain("lsw:e1:alert");
  });
  test("a network fault is 'unknown' and is not resent blindly", async () => {
    const f = fakeIo({ cockpit_lead_sync_alerts: [] }, { slackThrows: true });
    expect((await deliver(f.io, { episodeId: "e2", kind: "alert", client, body: "x" }, true)).status).toBe("unknown");
    const g = fakeIo(f.tables);
    expect((await deliver(g.io, { episodeId: "e2", kind: "alert", client, body: "x" }, true)).status).toBe("unknown");
    expect(g.posts.length).toBe(0);
  });
  test("an interrupted send found in Slack history is recorded, not reposted", async () => {
    const f = fakeIo({ cockpit_lead_sync_alerts: [{ id: "a1", episode_id: "e3", kind: "alert", status: "sending", attempts: 0 }] }, { history: [{ ts: "77.7", text: "... _ref lsw:e3:alert_" }] });
    const r = await deliver(f.io, { episodeId: "e3", kind: "alert", client, body: "x" }, true);
    expect(r).toEqual({ ts: "77.7", status: "sent" });
    expect(f.posts.length).toBe(0);
  });
  test("a definite Slack refusal is 'failed' and retried next run", async () => {
    const f = fakeIo({ cockpit_lead_sync_alerts: [] }, { slackFails: "not_in_channel" });
    expect((await deliver(f.io, { episodeId: "e4", kind: "alert", client, body: "x" }, true)).status).toBe("failed");
    const g = fakeIo(f.tables);
    expect((await deliver(g.io, { episodeId: "e4", kind: "alert", client, body: "x" }, true)).status).toBe("sent");
    expect(g.posts.length).toBe(1);
  });
  test("dry run never posts", async () => {
    const f = fakeIo({ cockpit_lead_sync_alerts: [] });
    expect((await deliver(f.io, { episodeId: "e5", kind: "alert", client, body: "x" }, false)).status).toBe("dry");
    expect(f.posts.length).toBe(0);
  });
});

describe("window", () => {
  test("counts whole hours, end of the current hour", () => {
    const now = Date.parse("2026-10-14T12:20:00Z");
    const w = window(now, 6);
    expect(new Date(w.end).toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(new Date(w.start).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    const hours = [
      { at: Date.parse("2026-10-14T06:00:00Z"), leads: 5 },
      { at: Date.parse("2026-10-14T07:00:00Z"), leads: 1 },
      { at: Date.parse("2026-10-14T12:00:00Z"), leads: 2 },
    ];
    expect(sumHours(hours, w)).toBe(3);
  });
});

describe("roster", () => {
  const seed = {
    cockpit_campaigns: [
      { client_name: "Ocean Home", meta_account_id: "568262692064148", source_deleted: false },
      { client_name: "City Wood", meta_account_id: "927741509922733", source_deleted: false },
      { client_name: "City Wood", meta_account_id: "912269544891805", source_deleted: false },
      { client_name: "No CRM Co", meta_account_id: "111111111", source_deleted: false },
      { client_name: "A", meta_account_id: "222222222", source_deleted: false },
      { client_name: "B", meta_account_id: "333333333", source_deleted: false },
      { client_name: "C", meta_account_id: "444444444", source_deleted: false },
    ],
    clients: [
      { id: "c1", name: "ocean home", meta_ad_account_id: "act_568262692064148", ghl_location_id: null },
      { id: "c2", name: " City wood", meta_ad_account_id: "act_927741509922733", ghl_location_id: "LOC_CW" },
      { id: "c3", name: "City Wood", meta_ad_account_id: "act_912269544891805", ghl_location_id: null },
    ],
    ghl_client_ad_accounts: [
      { location_id: "LOC_OCEAN", client_id: "c1" },
      { location_id: "LOC_CW", client_id: "c3" },
    ],
    ghl_clients: [{ location_id: "LOC_A", client_name: "A", status: "Active" }],
  };
  test("joins accounts to sub-accounts and merges two accounts of one client", async () => {
    const f = fakeIo(seed);
    const r = await loadRoster(f.io);
    const cw = r.find(c => c.key === "LOC_CW")!;
    expect(cw.accounts.sort()).toEqual(["912269544891805", "927741509922733"]);
    expect(r.find(c => c.key === "LOC_OCEAN")?.matchedBy).toBe("ghl_client_ad_accounts");
    expect(r.find(c => c.key === "LOC_A")?.matchedBy).toBe("ghl_clients name");
    expect(r.find(c => c.name === "No CRM Co")?.locationId).toBe(null);
  });
  test("refuses a roster that looks empty", async () => {
    const f = fakeIo({ ...seed, cockpit_campaigns: seed.cockpit_campaigns.slice(0, 2) });
    await expect(loadRoster(f.io)).rejects.toThrow(/refusing/);
  });
});
