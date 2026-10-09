import { describe, expect, it } from "bun:test";
import { GOLDEN } from "../clickup-writeback/convexGolden";
import { AD_FIELDS, backlogPayload, type Deps, groupIssues, issuesFor, type Provider, readAccountAds, runAudit, weekKey } from "./audit";

const acc = { accountId: "123456789", client: "Castello" };
const ad = (id: string, over: Record<string, any> = {}) => ({ id, name: `Ad ${id}`, creative: { url_tags: "utm_source=fb" }, adset: { destination_type: "WEBSITE" }, ...over });

describe("tracking rules match convex/tracking.ts", () => {
  it("flags a creative without URL parameters", () => {
    expect(issuesFor([ad("1", { creative: {} })], acc)).toEqual([{
      client: "Castello",
      accountId: "123456789",
      adId: "1",
      adName: "Ad 1",
      issue: "No URL parameters",
      detail: "The buildout checklist requires the UTM string on every ad. Without it this ad cannot be told apart from the others in reporting.",
    }]);
  });
  it("flags a missing lead form only on a readable ON_AD creative", () => {
    const onAd = { adset: { destination_type: "ON_AD" } };
    expect(issuesFor([ad("2", { ...onAd, creative: { url_tags: "x", object_story_spec: { link_data: { call_to_action: { value: {} } } } } })], acc).map(i => i.issue)).toEqual(["No lead form attached"]);
    expect(issuesFor([ad("3", { ...onAd, creative: { url_tags: "x", object_story_spec: { video_data: { call_to_action: { value: { lead_gen_form_id: "99" } } } } } })], acc)).toEqual([]);
    // Dynamic creatives expose no object_story_spec: never judged (296 of 296 earlier flags were false alarms).
    expect(issuesFor([ad("4", { ...onAd, creative: { url_tags: "x" } })], acc)).toEqual([]);
    // A website ad is not supposed to have a form.
    expect(issuesFor([ad("5", { creative: { url_tags: "x", object_story_spec: { link_data: {} } } })], acc)).toEqual([]);
  });
  it("can flag both faults on one ad", () => {
    expect(issuesFor([ad("6", { adset: { destination_type: "ON_AD" }, creative: { object_story_spec: { link_data: {} } } })], acc).map(i => i.issue)).toEqual(["No URL parameters", "No lead form attached"]);
  });
  it("uses the same Kuwait week key", () => {
    for (const [iso, key] of GOLDEN.weekKey) expect(weekKey(Date.parse(iso))).toBe(key);
  });
  it("files the same weekly backlog task, worst clients first", () => {
    const groups = groupIssues([
      { client: "B", adName: "x", issue: "No URL parameters" },
      { client: "A", adName: "y", issue: "No URL parameters" },
      { client: "A", adName: "z", issue: "No lead form attached" },
    ]);
    expect(groups.map(g => [g.client, g.count])).toEqual([["A", 2], ["B", 1]]);
    expect(backlogPayload(groups, Date.parse("2026-10-09T10:00:00Z"))).toEqual({
      week: "2026-W41",
      listId: "901816723196",
      priority: 4,
      total: 3,
      name: "Tracking backlog · 3 ads across 2 clients without UTM strings or a lead form (2026-W41)",
      description: "Standing hygiene backlog from the Media Buyer Cockpit, refreshed weekly. The buildout checklist requires the UTM string on every ad and a lead form on every ON_AD ad set.\n\n• A: 2 (No URL parameters, No lead form attached)\n• B: 1 (No URL parameters)",
    });
    expect(backlogPayload([])).toBeNull();
  });
});

type Call = { provider: string; method: string; path: string };
function fakeMeta(pages: Record<string, any[]>): Provider & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async call(provider, method, path) {
      calls.push({ provider, method, path });
      const account = /^act_(\d+)\/ads/.exec(path)?.[1] ?? "";
      const list = pages[account];
      if (!list) throw new Error("meta rejected the request (400 code 200): Ad account owner has NOT grant ads_management or ads_read permission");
      const after = /after=([^&]+)/.exec(path)?.[1];
      const i = after ? Number(decodeURIComponent(after)) : 0;
      const more = i + 1 < list.length;
      return { data: list[i], paging: more ? { cursors: { after: String(i + 1) }, next: "https://graph.facebook.com/next" } : { cursors: {} } };
    },
  };
}

describe("reading Meta", () => {
  it("asks for the Convex fields and follows the cursor", async () => {
    const meta = fakeMeta({ "123456789": [[ad("1")], [ad("2")]] });
    const ads = await readAccountAds(meta, "123456789");
    expect(ads.map(a => a.id)).toEqual(["1", "2"]);
    expect(meta.calls[0].path).toBe(`act_123456789/ads?fields=${encodeURIComponent(AD_FIELDS)}&effective_status=${encodeURIComponent('["ACTIVE"]')}&limit=200`);
    expect(meta.calls.every(c => c.method === "GET")).toBe(true);
  });
});

describe("the daily audit run", () => {
  function deps(env: Record<string, string>, meta: Provider, accounts: any[]) {
    const rpcs: { name: string; params: any }[] = [];
    const d: Deps = {
      env: k => env[k],
      now: () => Date.parse("2026-10-09T23:30:00Z"),
      providerFor: () => meta,
      rpc: async (name, params = {}) => {
        rpcs.push({ name, params });
        if (name === "cockpit_media_tracking_inputs") return { ready: true, accounts };
        if (name === "cockpit_media_tracking_begin") return { id: "run-9" };
        if (name === "cockpit_media_tracking_publish") return { note: "published", current: params.p_issues.map((i: any) => ({ client: i.client, adName: i.adName, issue: i.issue })) };
        if (name === "cockpit_clickup_writeback_enqueue") return true;
        return null;
      },
    };
    return { d, rpcs };
  }

  it("publishes issues for the accounts it read and keeps a refused account's earlier issues", async () => {
    const meta = fakeMeta({ "123456789": [[ad("1", { creative: {} }), ad("2")]] });
    const { d, rpcs } = deps({ META_SYSTEM_TOKEN: "x" }, meta, [acc, { accountId: "act_987654321", client: "Ardon" }]);
    const out = await runAudit(d);
    expect(out.ok).toBe(true);
    const publish = rpcs.find(r => r.name === "cockpit_media_tracking_publish")!.params;
    expect(publish.p_read).toEqual(["123456789"]);
    expect(publish.p_failed).toEqual([{ accountId: "987654321", client: "Ardon", error: expect.stringContaining("(400") }]);
    expect(publish.p_issues.map((i: any) => [i.adId, i.issue])).toEqual([["1", "No URL parameters"]]);
    expect(publish.p_checked).toBe(2);
    // The weekly ClickUp task goes through the gated queue, keyed by Kuwait week
    // (23:30 UTC on 9 Oct is Saturday 10 Oct in Kuwait, the first day of week 42).
    const enqueue = rpcs.find(r => r.name === "cockpit_clickup_writeback_enqueue")!.params;
    expect(enqueue).toMatchObject({ p_dedupe_key: "tracking-backlog:2026-W42", p_kind: "tracking_backlog", p_source_id: "run-9" });
    expect(enqueue.p_payload.name).toBe("Tracking backlog · 1 ads across 1 clients without UTM strings or a lead form (2026-W42)");
    expect(out.counts).toMatchObject({ read: 1, failed: 1, issues: 1, backlogQueued: true });
    // Reads only: no Meta write of any kind.
    expect(meta.calls.every(c => c.method === "GET")).toBe(true);
  });

  it("when Meta refuses every account the issues are left as they were", async () => {
    const { d, rpcs } = deps({ META_SYSTEM_TOKEN: "x" }, fakeMeta({}), [acc]);
    const out = await runAudit(d);
    expect(out.ok).toBe(false);
    expect(rpcs.map(r => r.name)).toEqual(["cockpit_media_tracking_inputs", "cockpit_media_tracking_begin", "cockpit_media_tracking_fail"]);
  });

  it("without the Meta token or the account list it says so and changes nothing", async () => {
    const noToken = deps({}, fakeMeta({}), [acc]);
    expect((await runAudit(noToken.d)).note).toContain("META_SYSTEM_TOKEN is not set");
    expect(noToken.rpcs.map(r => r.name)).toEqual(["cockpit_media_tracking_idle"]);
    const notReady = deps({ META_SYSTEM_TOKEN: "x" }, fakeMeta({}), [acc]);
    notReady.d.rpc = async (name, params) => { notReady.rpcs.push({ name, params }); return name === "cockpit_media_tracking_inputs" ? { ready: false, accounts: [] } : null; };
    expect((await runAudit(notReady.d)).note).toContain("marketPlays source has not been imported");
  });
});
