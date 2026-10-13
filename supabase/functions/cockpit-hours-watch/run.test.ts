import { describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import type { WatchPerson } from "./inputs.ts";
import { AFTER_SHIFT_MS, applyRefused, CLASSIFY_BUDGET_MS, needsRun, pruneDue, runDoctor, runWatch, type RunDeps, SHOT_BUDGET_MS, type ShotRow } from "./run.ts";
import { fakeFetch, type HubstaffData, hubstaffRoute, kw, ok, person, receiptsRecorder, type Route } from "./testkit.ts";

const LAMA = person();
const DANIYA = person({ personId: 2, name: "Daniya Ziad", hubstaffUserId: "4095165" });
const HUBSTAFF_KEY = { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_fixtureTokenNotReal0001", version: 1, accountId: "705266", state: "connected" };
const GOOGLE_KEY = { provider: "google_ai", secret: "AIzaFixtureKeyNotReal0001", state: "connected", savedAt: "2026-10-12T09:00:00+00:00" };
const OPENAI_KEY = { provider: "openai", secret: "sk-fixtureKeyNotReal0002", state: "connected" };
const S3 = "https://hubstaff-production.s3.amazonaws.com/screenshots";

type Rec = { name: string; args: Record<string, unknown> };
type Env = {
  people?: WatchPerson[];
  open?: Record<string, unknown>[];
  knownShots?: Record<string, unknown>[];
  settings?: Record<string, unknown>;
  hubstaffKey?: unknown;
  aiKey?: unknown;
  openaiKey?: unknown;
  hubstaff?: HubstaffData;
  model?: Route;
  lastPruneOn?: string | null;
  prunePaths?: unknown[];
  replies?: Record<string, unknown>[];
  lastOkRunAt?: string | null;
  rules?: Record<string, unknown>;
  /** The apply refuses, as it does when the lease was lost (RpcError 40001), or throws this error instead. */
  applyThrows?: boolean | Error;
  /** What cockpit_hours_watch_key_mark answers (null by default). */
  markAnswer?: unknown;
};

/** A fake database that behaves like the watch's RPCs, and a fake outside world. */
function setup(env: Env = {}) {
  const calls: Rec[] = [];
  const incidents = new Map<number, Record<string, unknown>>();
  for (const o of [...(env.open ?? []), ...(env.replies ?? [])]) incidents.set(Number(o.id), { ...o });
  let nextId = 11;
  const settings = { on: true, shots: true, channel: "C0B5TL9H370", ...env.settings };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const p = (args.p ?? {}) as Record<string, unknown>;
    switch (name) {
      case "cockpit_hours_watch_inputs":
        return {
          settings, now: args.p_now, people: env.people ?? [LAMA, DANIYA], open: env.open ?? [], knownShots: env.knownShots ?? [], ...(env.lastPruneOn !== undefined ? { lastPruneOn: env.lastPruneOn } : {}),
          ...(env.replies ? { replies: env.replies } : {}), ...(env.lastOkRunAt !== undefined ? { lastOkRunAt: env.lastOkRunAt } : {}), ...(env.rules ? { rules: env.rules } : {}),
        };
      case "cockpit_hours_key_get": return env.hubstaffKey === undefined ? HUBSTAFF_KEY : env.hubstaffKey;
      case "cockpit_hours_watch_key_get": return args.p_provider === "google_ai" ? (env.aiKey === undefined ? GOOGLE_KEY : env.aiKey) : (env.openaiKey ?? null);
      case "cockpit_hours_watch_apply": {
        if (env.applyThrows instanceof Error) throw env.applyThrows;
        if (env.applyThrows) throw new RpcError("This watch run no longer holds the lease; nothing was written.", "40001");
        const opened: number[] = [];
        for (const o of (p.open as Record<string, unknown>[]) ?? []) {
          const id = nextId++;
          incidents.set(id, { id, person_id: o.personId, kind: o.kind, detail: o.detail, slack_state: settings.on ? "pending" : "muted", resolve_state: "none" });
          opened.push(id);
        }
        const closed: number[] = [];
        for (const c of (p.close as Record<string, unknown>[]) ?? []) {
          const inc = incidents.get(Number(c.id));
          if (!inc) continue;
          inc.detail = c.detail;
          inc.resolve_state = inc.slack_state === "posted" ? "pending" : "none";
          closed.push(Number(c.id));
        }
        return { opened, closed };
      }
      case "cockpit_hours_watch_slack_claim": {
        const inc = incidents.get(Number(p.incidentId));
        const key = p.which === "open" ? "slack_state" : "resolve_state";
        if (!inc || inc[key] !== "pending") return null;
        inc[key] = "sending";
        return inc;
      }
      case "cockpit_hours_watch_slack_result": {
        const inc = incidents.get(Number(p.incidentId))!;
        inc[p.which === "open" ? "slack_state" : "resolve_state"] = p.state;
        if (p.ts && p.which === "open") inc.slack_ts = p.ts;
        return null;
      }
      case "cockpit_hours_watch_prune": return { paths: env.prunePaths ?? [] };
      case "cockpit_hours_watch_key_mark": return env.markAnswer ?? null;
      default: return null;
    }
  };
  const rec = receiptsRecorder();
  const slackPosts: Record<string, unknown>[] = [];
  const verdict = { verdict: "not_work", label: "YouTube video", reason: "A video is playing.", confidence: 0.9, category: "video" };
  const f = fakeFetch([
    hubstaffRoute(env.hubstaff ?? {}),
    env.model ?? (c => (c.url.host === "generativelanguage.googleapis.com" ? ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] }, finishReason: "STOP" }] }) : null)),
    c => (c.url.host === "api.openai.com" ? ok({ choices: [{ message: { content: JSON.stringify(verdict) }, finish_reason: "stop" }] }) : null),
    c => {
      if (c.url.host !== "slack.com") return null;
      slackPosts.push(JSON.parse(c.body!));
      return ok({ ok: true, ts: `17603400${slackPosts.length}.000100` });
    },
    c => (c.url.host === "project.supabase.test" ? ok({}) : null),
  ]);
  let tick = 0;
  const deps = (now = Date.parse(kw("10:30"))): RunDeps => ({
    rpc, insertReceipt: rec.insert, fetch: f.request, sleep: async () => {}, now: () => new Date(now + tick++),
    slackToken: () => "xoxb-fixture-not-real", storage: { url: "https://project.supabase.test", serviceKey: "service-fixture" },
  });
  const hosts = () => f.calls.map(c => c.url.host);
  const rpcs = (n: string) => calls.filter(c => c.name === n);
  return { calls, rpcs, rec, f, hosts, deps, slackPosts, incidents };
}

const shot = (id: number, user: string, hhmm: string) => ({
  id, user_id: Number(user), recorded_at: kw(hhmm), time_slot: kw(`${hhmm.slice(0, 4)}0`),
  full_url: `${S3}/${id}.jpg?X-Amz-Signature=secret-signature`, thumb_url: `${S3}/${id}_thumb.jpg?X-Amz-Signature=secret-signature`,
});

describe("nobody on shift", () => {
  test("no Hubstaff call at all: statuses only, and the run finishes ok", async () => {
    const s = setup();
    const out = await runWatch(s.deps(Date.parse(kw("20:00"))), { runId: 9, leaseToken: "lease" });
    expect(s.f.calls).toEqual([]);
    expect(s.rec.rows).toEqual([]);
    expect(out).toMatchObject({ ok: true, note: "Nobody on shift", onShift: 0 });
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as Record<string, unknown>;
    expect(apply).toMatchObject({ runId: 9, leaseToken: "lease", slots: [], shots: [], open: [], update: [], close: [] });
    expect(apply.statuses).toEqual([
      { personId: 1, state: "off_shift", since: null, shiftStart: kw("10:00"), shiftEnd: kw("18:00"), detail: { offReason: null } },
      { personId: 2, state: "off_shift", since: null, shiftStart: kw("10:00"), shiftEnd: kw("18:00"), detail: { offReason: null } },
    ]);
    expect(s.rpcs("cockpit_hours_watch_finish")[0].args.p).toMatchObject({ runId: 9, state: "ok", note: "Nobody on shift", rowsSeen: 0, error: null });
    expect(s.rpcs("cockpit_hours_key_get")).toEqual([]);
  });
  test("an open alert still gets a read, so it can close, and the reply goes in its thread", async () => {
    const s = setup({ open: [{ id: 3, person_id: 1, kind: "not_tracking", opened_at: kw("16:00"), detail: { since: kw("16:00"), shiftEnd: kw("18:00") }, slack_state: "posted", slack_ts: "1.1" }] });
    const out = await runWatch(s.deps(Date.parse(kw("18:05"))), { runId: 9, leaseToken: "lease" });
    expect(s.hosts()).toContain("api.hubstaff.com");
    expect(out.closed).toEqual([3]);
    expect(s.slackPosts).toEqual([expect.objectContaining({ thread_ts: "1.1", text: "Shift ended. Hubstaff was off from 16:00 to 18:00 (2 h)." })]);
  });
});

describe("a full run", () => {
  const hubstaff: HubstaffData = {
    lastActivities: [
      { user_id: 3616851, online: true, last_client_activity: kw("10:29") },
      { user_id: 4095165, online: false, last_client_activity: "2026-10-12T15:00:00Z" },
    ],
    pageSize: 1,
    activities: [{ user_id: 3616851, time_slot: kw("10:00"), tracked: 600, overall: 400, time_type: "normal" }],
    screenshots: [shot(9002, "3616851", "10:21"), shot(9001, "3616851", "10:12")],
    toolUsages: [{ user_id: 3616851, time_slot: kw("10:10"), name: "youtube.com", tool_type: "url", details: [{ title: "Match highlights" }] }],
    settings: [{ user_id: 3616851, screenshot_frequency: 1 }, { user_id: 4095165, screenshot_frequency: 1 }],
  };
  test("reads Hubstaff, judges the new screenshots, stores the evidence, applies and posts", async () => {
    const s = setup({ hubstaff });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(out.ok).toBe(true);
    // Hubstaff: last_activities over two pages, today's activities, 40 minutes of screenshots and tool usage, screenshot settings.
    const hs = s.f.calls.filter(c => c.url.host === "api.hubstaff.com").map(c => `${c.url.pathname.split("/").pop()}${c.url.searchParams.get("tool_type") ? `:${c.url.searchParams.get("tool_type")}` : ""}`);
    expect(hs).toEqual(["last_activities", "last_activities", "activities", "screenshots", "tool_usages:application", "tool_usages:url", "screenshot_settings"]);
    expect(s.f.calls.find(c => c.url.pathname.endsWith("/screenshots"))!.url.searchParams.get("time_slot[start]")).toBe(kw("09:50").replace(".000Z", "Z"));
    expect(s.f.calls.find(c => c.url.pathname.endsWith("/activities"))!.url.searchParams.get("time_slot[start]")).toBe("2026-10-12T21:00:00Z");
    // Two model calls, oldest screenshot first, with the slot's sites in the prompt.
    const model = s.f.calls.filter(c => c.url.host === "generativelanguage.googleapis.com");
    expect(model.length).toBe(2);
    expect(JSON.parse(model[0].body!).contents[0].parts[1].text).toContain("- site: youtube.com (Match highlights)");
    // Evidence: full and thumbnail of both not-work screenshots.
    expect(s.f.calls.filter(c => c.url.host === "project.supabase.test").map(c => c.url.pathname)).toEqual([
      "/storage/v1/object/cockpit-hours-watch/1/2026-10-13/9001-full.jpg", "/storage/v1/object/cockpit-hours-watch/1/2026-10-13/9001-thumb.jpg",
      "/storage/v1/object/cockpit-hours-watch/1/2026-10-13/9002-full.jpg", "/storage/v1/object/cockpit-hours-watch/1/2026-10-13/9002-thumb.jpg",
    ]);
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[]; open: { personId: number; kind: string }[]; statuses: { personId: number; state: string }[] };
    expect(apply.shots.map(r => [r.shotId, r.verdict, r.attempts, r.fullPath, r.thumbPath])).toEqual([
      [9001, "not_work", 1, "1/2026-10-13/9001-full.jpg", "1/2026-10-13/9001-thumb.jpg"],
      [9002, "not_work", 1, "1/2026-10-13/9002-full.jpg", "1/2026-10-13/9002-thumb.jpg"],
    ]);
    expect(apply.shots[0].apps).toEqual([{ name: "youtube.com", type: "url", titles: ["Match highlights"] }]);
    expect(apply.open.map(o => [o.personId, o.kind])).toEqual([[1, "not_work"], [2, "not_tracking"]]);
    expect(apply.statuses.map(st => [st.personId, st.state])).toEqual([[1, "not_work"], [2, "not_tracking"]]);
    // Slack: one post per incident, claimed then recorded.
    expect(s.slackPosts.length).toBe(2);
    expect(s.slackPosts[0].text).toContain("*Lama Harb* (call centre agent): 2 of the last 2 screenshots do not look like work (YouTube video).");
    expect(s.slackPosts[1].text).toContain("*Daniya Ziad* (call centre agent) has not had Hubstaff on since 10:00, 30 min into the 10:00 to 18:00 shift.");
    expect(s.incidents.get(11)).toMatchObject({ slack_state: "posted", slack_ts: "176034001.000100" });
    expect(out.posts.map(p => p.state)).toEqual(["posted", "posted"]);
    // Receipts: every outside call has one, none carries a key, a signature or a query.
    expect(new Set(s.rec.rows.map(r => r.provider))).toEqual(new Set(["hubstaff", "google-ai", "storage", "slack"]));
    expect(JSON.stringify(s.rec.rows)).not.toMatch(/hsoat_|AIza|xoxb|secret-signature|service-fixture/);
    expect(s.rec.rows.every(r => !/[?#@\s]/.test(r.resource) && r.run_id === 9)).toBe(true);
    expect(s.rpcs("cockpit_hours_watch_finish")[0].args.p).toMatchObject({ state: "ok", rowsSeen: 2, error: null, result: { watched: 2 } });
  });
  test("a screenshot already judged is not sent again; one that failed twice gets its third and last try", async () => {
    const s = setup({
      hubstaff, knownShots: [{ shotId: 9001, personId: 1, recordedAt: kw("10:12"), verdict: "work", confidence: 0.9, attempts: 1 }, { shotId: 9002, verdict: "error", attempts: 2 }],
      model: c => (c.url.host === "generativelanguage.googleapis.com" ? ok({ error: { status: "UNAVAILABLE" } }, 503) : null),
    });
    await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[]; open: { kind: string }[] };
    expect(apply.shots).toEqual([expect.objectContaining({ shotId: 9002, verdict: "error", attempts: 3, error: "Google AI answered 503 UNAVAILABLE." })]);
    expect(s.f.calls.filter(c => c.url.host === "hubstaff-production.s3.amazonaws.com").length).toBe(1);
    // A failure other than "not found" stops the models for that screenshot: one call, not three.
    expect(s.f.calls.filter(c => c.url.host === "generativelanguage.googleapis.com").length).toBe(1);
    expect(apply.open.filter(o => o.kind === "not_work")).toEqual([]);
  });
  test("no AI key: screenshots are recorded as skipped, nothing is sent to a model, nothing counts", async () => {
    const s = setup({ hubstaff, aiKey: null });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(s.hosts()).not.toContain("generativelanguage.googleapis.com");
    expect(s.hosts()).not.toContain("hubstaff-production.s3.amazonaws.com");
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[]; open: { kind: string }[] };
    const missing = "Screenshot check needs an AI key (OpenAI or Google AI). Paste one in Settings.";
    expect(apply.shots.map(r => [r.shotId, r.verdict, r.error])).toEqual([[9001, "skipped", missing], [9002, "skipped", missing]]);
    expect(apply.open.map(o => o.kind)).toEqual(["not_tracking"]);
    expect(out.ai).toEqual({ state: "missing", provider: null });
  });
  test("a dry run reads and plans, and writes nothing", async () => {
    const s = setup({ hubstaff });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease", dryRun: true });
    expect(s.rpcs("cockpit_hours_watch_apply")).toEqual([]);
    expect(s.rpcs("cockpit_hours_watch_slack_claim")).toEqual([]);
    expect(s.rpcs("cockpit_hours_watch_prune")).toEqual([]);
    expect(s.hosts().filter(h => h !== "api.hubstaff.com")).toEqual([]);
    expect(out.plan?.open.map(o => o.kind)).toEqual(["not_tracking"]);
    expect(out.plan?.shots.map(r => r.verdict)).toEqual(["pending", "pending"]);
    expect(out.note).toStartWith("Dry run: nothing written.");
    expect(s.rpcs("cockpit_hours_watch_finish")[0].args.p).toMatchObject({ dryRun: true, state: "ok" });
  });
  test("alerts switched off: recorded, muted, nothing sent", async () => {
    const s = setup({ hubstaff, settings: { on: false } });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(s.slackPosts).toEqual([]);
    expect(s.rpcs("cockpit_hours_watch_slack_claim").length).toBe(2);
    expect(out.posts.map(p => p.state)).toEqual(["muted", "muted"]);
    expect([...s.incidents.values()].map(i => i.slack_state)).toEqual(["muted", "muted"]);
  });
});

describe("review fixes (2026-10-13)", () => {
  const lamaOn = (extra: Partial<HubstaffData> = {}): HubstaffData => ({
    lastActivities: [{ user_id: 3616851, online: true, last_client_activity: kw("10:29") }, { user_id: 4095165, online: true, last_client_activity: kw("10:29") }],
    activities: [{ user_id: 3616851, time_slot: kw("10:00"), tracked: 600, input_tracked: 600, overall: 400, time_type: "normal" }],
    screenshots: [shot(9002, "3616851", "10:21"), shot(9001, "3616851", "10:12")],
    settings: [], ...extra,
  });
  const modelHosts = (s: ReturnType<typeof setup>) => s.f.calls.filter(c => c.url.host === "api.openai.com" || c.url.host === "generativelanguage.googleapis.com").map(c => c.url.host);

  test("OpenAI first when its key is saved: Google gets no screenshot", async () => {
    const s = setup({ hubstaff: lamaOn(), openaiKey: OPENAI_KEY });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(modelHosts(s)).toEqual(["api.openai.com", "api.openai.com"]);
    expect(out.ai).toEqual({ state: "connected", provider: "openai" });
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[] };
    expect(apply.shots.map(r => [r.verdict, r.model])).toEqual([["not_work", "gpt-4.1-mini"], ["not_work", "gpt-4.1-mini"]]);
  });
  test("the reviewers' probe2: a refused key is marked refused and no other screenshot is checked this run", async () => {
    const s = setup({
      hubstaff: lamaOn({ screenshots: [shot(9003, "3616851", "10:25"), shot(9002, "3616851", "10:21"), shot(9001, "3616851", "10:12")] }),
      knownShots: [{ shotId: 9001, personId: 1, recordedAt: kw("10:12"), verdict: "error", attempts: 1 }],
      model: c => (c.url.host === "generativelanguage.googleapis.com" ? ok({ error: { code: 400, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, 400) : null),
    });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(modelHosts(s).length).toBe(1);
    expect(s.rpcs("cockpit_hours_watch_key_mark").map(c => c.args.p)).toEqual([{ provider: "google_ai", state: "refused", note: "Google AI answered 400 API_KEY_INVALID.", savedAt: "2026-10-12T09:00:00+00:00" }]);
    expect(out.ai).toEqual({ state: "refused", provider: "google_ai" });
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[]; open: { kind: string }[] };
    // The one that errored before keeps its row and its attempts; the new ones wait, skipped, for a key that works.
    const refused = "The saved Google AI key was refused. Paste a new one in Settings.";
    expect(apply.shots.map(r => [r.shotId, r.verdict, r.attempts, r.error])).toEqual([[9002, "skipped", 0, refused], [9003, "skipped", 0, refused]]);
    expect(apply.open.map(o => o.kind)).toEqual([]);
    expect(out.ok).toBe(true);
  });
  test("a key that has not been checked is marked connected once, on its first answer", async () => {
    const s = setup({ hubstaff: lamaOn(), aiKey: { ...GOOGLE_KEY, state: "unchecked" } });
    await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(s.rpcs("cockpit_hours_watch_key_mark").map(c => (c.args.p as Record<string, unknown>).state)).toEqual(["connected"]);
    const known = setup({ hubstaff: lamaOn() });
    await runWatch(known.deps(), { runId: 9, leaseToken: "lease" });
    expect(known.rpcs("cockpit_hours_watch_key_mark")).toEqual([]);
  });
  test("one screenshot never takes more than its minute: the evidence is not stored once it runs out", async () => {
    expect([SHOT_BUDGET_MS, CLASSIFY_BUDGET_MS]).toEqual([60_000, 90_000]);
    const s = setup({ hubstaff: lamaOn({ screenshots: [shot(9001, "3616851", "10:12")] }) });
    let offset = 0;
    const slowModel = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).host === "generativelanguage.googleapis.com") offset += 59_500;
      return s.f.request(input, init);
    }) as typeof fetch;
    await runWatch({ ...s.deps(), fetch: slowModel, now: () => new Date(Date.parse(kw("10:30")) + offset) }, { runId: 9, leaseToken: "lease" });
    expect(s.hosts()).not.toContain("project.supabase.test");
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[] };
    expect(apply.shots[0]).toMatchObject({ verdict: "not_work", fullPath: null, thumbPath: null, error: "The images could not be stored: the screenshot's minute ran out" });
  });
  test("the reviewers' probe2 orphan: when the apply throws, the images stored this run are deleted and the run fails", async () => {
    const s = setup({ hubstaff: lamaOn({ screenshots: [shot(9001, "3616851", "10:12")] }), applyThrows: true });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    const storage = s.f.calls.filter(c => c.url.host === "project.supabase.test");
    expect(storage.map(c => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /storage/v1/object/cockpit-hours-watch/1/2026-10-13/9001-full.jpg", "POST /storage/v1/object/cockpit-hours-watch/1/2026-10-13/9001-thumb.jpg",
      "DELETE /storage/v1/object/cockpit-hours-watch",
    ]);
    expect(JSON.parse(storage[2].body!)).toEqual({ prefixes: ["1/2026-10-13/9001-full.jpg", "1/2026-10-13/9001-thumb.jpg"] });
    expect(out.ok).toBe(false);
    expect(s.rpcs("cockpit_hours_watch_finish")[0].args.p).toMatchObject({ state: "failed", error: "This watch run no longer holds the lease; nothing was written." });
    expect(s.slackPosts).toEqual([]);
  });
  test("thread replies left pending by earlier runs are sent, in a full run and when nobody is on shift", async () => {
    const reply = { id: 4, person_id: 2, kind: "not_tracking", opened_at: kw("09:00"), closed_at: kw("09:40"), detail: { text: "x", resolveText: "Back on Hubstaff at 09:40 (40 min off)." }, slack_state: "posted", slack_ts: "1.4", resolve_state: "pending" };
    const s = setup({ hubstaff: lamaOn(), replies: [reply] });
    await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(s.slackPosts.filter(p => p.thread_ts)).toEqual([expect.objectContaining({ thread_ts: "1.4", text: "Back on Hubstaff at 09:40 (40 min off)." })]);
    expect(s.incidents.get(4)).toMatchObject({ resolve_state: "posted" });
    const night = setup({ replies: [reply] });
    await runWatch(night.deps(Date.parse(kw("20:00"))), { runId: 9, leaseToken: "lease" });
    expect(night.hosts()).toEqual(["slack.com"]);
    expect(night.slackPosts).toEqual([expect.objectContaining({ thread_ts: "1.4" })]);
  });
  test("a shift that ended in the last 30 minutes is still read, so the shift line fills in; after that, no call", async () => {
    expect(AFTER_SHIFT_MS).toBe(30 * 60_000);
    const s = setup({ hubstaff: { lastActivities: [], activities: [{ user_id: 3616851, time_slot: kw("17:40"), tracked: 600, input_tracked: 600, overall: 300, time_type: "normal" }] } });
    const out = await runWatch(s.deps(Date.parse(kw("18:10"))), { runId: 9, leaseToken: "lease" });
    expect(out.note).not.toBe("Nobody on shift");
    expect(s.hosts()).toContain("api.hubstaff.com");
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { slots: { slotStart: string }[]; statuses: { state: string; detail: Record<string, unknown> }[]; open: unknown[] };
    expect(apply.slots.map(sl => sl.slotStart)).toEqual([kw("17:40")]);
    expect(apply.statuses.map(st => st.state)).toEqual(["off_shift", "off_shift"]);
    // readAt is the instant of the Hubstaff read (the fake clock ticks a millisecond per look).
    expect(Date.parse(String(apply.statuses[0].detail.readAt)) - Date.parse(kw("18:10"))).toBeLessThan(10);
    expect(apply.open).toEqual([]);
    expect(s.hosts()).not.toContain("hubstaff-production.s3.amazonaws.com");
    const later = setup();
    expect((await runWatch(later.deps(Date.parse(kw("18:30"))), { runId: 9, leaseToken: "lease" })).note).toBe("Nobody on shift");
    expect(later.f.calls).toEqual([]);
  });
  test("a 'not in Hubstaff' alert left open overnight calls nobody; once the account is linked, the run closes it", async () => {
    const nada = person({ personId: 3, name: "Nada Al Saed", role: "Media Buyer", hubstaffUserId: null, accountStatus: "invited" });
    const open = [{ id: 6, person_id: 3, kind: "not_tracking", opened_at: kw("10:15"), detail: { reason: "no_account", text: "x" }, slack_state: "posted", slack_ts: "1.6" }];
    const night = setup({ people: [nada], open });
    expect((await runWatch(night.deps(Date.parse(kw("22:00"))), { runId: 9, leaseToken: "lease" })).note).toBe("Nobody on shift");
    expect(night.f.calls).toEqual([]);
    const linked = setup({ people: [{ ...nada, hubstaffUserId: "5000001", accountStatus: "active" }], open });
    const out = await runWatch(linked.deps(Date.parse(kw("22:00"))), { runId: 9, leaseToken: "lease" });
    expect(out.closed).toEqual([6]);
    expect(linked.slackPosts).toEqual([expect.objectContaining({ thread_ts: "1.6", text: expect.stringContaining("Now in Hubstaff") })]);
  });
  test("one failed Hubstaff read after an ok run 3 minutes ago opens nothing; the run still finishes failed", async () => {
    const s = setup({ hubstaffKey: null, lastOkRunAt: kw("10:27") });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { open: unknown[]; statuses: { state: string }[] };
    expect(apply.open).toEqual([]);
    expect(apply.statuses.map(st => st.state)).toEqual(["cant_tell", "cant_tell"]);
    expect(s.slackPosts).toEqual([]);
    expect(out.ok).toBe(false);
  });
  test("Hours' break rule comes from the inputs", async () => {
    const lunch: HubstaffData = {
      lastActivities: [{ user_id: 3616851, online: false, last_client_activity: kw("13:00") }],
      activities: Array.from({ length: 18 }, (_, i) => ({ user_id: 3616851, time_slot: new Date(Date.parse(kw("10:00")) + i * 600_000).toISOString(), tracked: 600, input_tracked: 600, overall: 300, time_type: "normal" })),
    };
    const kept = setup({ people: [LAMA], hubstaff: lunch });
    await runWatch(kept.deps(Date.parse(kw("13:40"))), { runId: 9, leaseToken: "lease" });
    expect((kept.rpcs("cockpit_hours_watch_apply")[0].args.p as { open: unknown[] }).open).toEqual([]);
    const none = setup({ people: [LAMA], hubstaff: lunch, rules: { breakMinutes: 0, breakWhenLongerThanHours: 6 } });
    await runWatch(none.deps(Date.parse(kw("13:40"))), { runId: 9, leaseToken: "lease" });
    expect((none.rpcs("cockpit_hours_watch_apply")[0].args.p as { open: { kind: string }[] }).open.map(o => o.kind)).toEqual(["not_tracking"]);
  });
  test("the reviewers' review_2 #3: a site's address keeps nothing after ? or #, in the prompt and in the stored row", async () => {
    const s = setup({ hubstaff: lamaOn({
      screenshots: [shot(9001, "3616851", "10:12")],
      toolUsages: [{ user_id: 3616851, time_slot: kw("10:10"), name: "app.gohighlevel.com/v2/contacts?phone=96550000000", tool_type: "url",
        details: [{ url: "https://app.gohighlevel.com/v2/contacts/abc?phone=96550000000&email=lead@example.com#notes" }] }],
    }) });
    await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[] };
    expect(apply.shots[0].apps).toEqual([{ name: "app.gohighlevel.com/v2/contacts", type: "url", titles: ["https://app.gohighlevel.com/v2/contacts/abc"] }]);
    const prompt = s.f.calls.find(c => c.url.host === "generativelanguage.googleapis.com")!.body!;
    expect(prompt).not.toMatch(/96550000000|lead@example|#notes/);
  });
});

describe("Hubstaff cannot be read", () => {
  test("no key: the source incident opens and posts once, no person alert, the run finishes failed", async () => {
    const s = setup({ hubstaffKey: null });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(s.hosts().filter(h => h === "api.hubstaff.com")).toEqual([]);
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { open: { kind: string; personId: number | null }[]; statuses: { state: string }[] };
    expect(apply.open).toEqual([expect.objectContaining({ kind: "source", personId: null })]);
    expect(apply.statuses.map(st => st.state)).toEqual(["cant_tell", "cant_tell"]);
    expect(s.slackPosts.map(p => p.text)).toEqual([expect.stringContaining("Hubstaff watch cannot read Hubstaff: Hubstaff isn't connected. Nobody is being watched until it can.")]);
    expect(out.ok).toBe(false);
    expect(s.rpcs("cockpit_hours_watch_finish")[0].args.p).toMatchObject({ state: "failed", error: "Hubstaff cannot be read: Hubstaff isn't connected." });
  });
  test("refused mid-read: the same, with Hubstaff's own sentence", async () => {
    const s = setup();
    const refusing = fakeFetch([c => (c.url.host === "api.hubstaff.com" ? new Response('{"error":"invalid_token"}', { status: 401 }) : null), c => (c.url.host === "slack.com" ? ok({ ok: true, ts: "1.2" }) : null)]);
    await runWatch({ ...s.deps(), fetch: refusing.request }, { runId: 9, leaseToken: "lease" });
    const apply = s.rpcs("cockpit_hours_watch_apply")[0].args.p as { open: { kind: string }[] };
    expect(apply.open).toEqual([expect.objectContaining({ kind: "source", detail: expect.objectContaining({ note: "Hubstaff refused the key (401)." }) })]);
  });
});

describe("the daily prune", () => {
  test("the first run after 03:00 Kuwait, by the last prune's day when known", () => {
    expect(pruneDue(new Date(kw("02:55")), null)).toBe(false);
    expect(pruneDue(new Date(kw("03:05")), null)).toBe(true);
    expect(pruneDue(new Date(kw("03:20")), null)).toBe(false);
    expect(pruneDue(new Date(kw("09:00")), "2026-10-12")).toBe(true);
    expect(pruneDue(new Date(kw("09:00")), "2026-10-13")).toBe(false);
  });
  test("runs even when nobody is on shift, and deletes only the watch's own paths", async () => {
    const s = setup({ prunePaths: ["1/2026-07-01/9001-full.jpg", "1/2026-07-01/9001-thumb.jpg", "../other-bucket/x.jpg", 42] });
    const out = await runWatch(s.deps(Date.parse(kw("03:05"))), { runId: 9, leaseToken: "lease" });
    expect(out.pruned).toBe(2);
    const del = s.f.calls.filter(c => c.method === "DELETE");
    expect(del.map(c => [c.url.pathname, JSON.parse(c.body!)])).toEqual([["/storage/v1/object/cockpit-hours-watch", { prefixes: ["1/2026-07-01/9001-full.jpg", "1/2026-07-01/9001-thumb.jpg"] }]]);
    expect(s.rec.rows.map(r => `${r.provider} ${r.method} ${r.phase}`)).toEqual(["storage DELETE intent", "storage DELETE response"]);
  });
});

describe("the doctor", () => {
  test("names missing secrets and checks each provider once, writing nothing but receipts", async () => {
    const s = setup({
      hubstaff: { settings: [{ user_id: 3616851, screenshot_frequency: 1 }, { user_id: 3603105, screenshot_frequency: 0 }] },
      model: c => (c.url.host === "generativelanguage.googleapis.com" ? ok({ models: [] }) : null),
    });
    const slack = fakeFetch([c => (c.url.host === "slack.com" ? ok({ ok: true, channel: { name: "team-management", is_member: true } }) : null)]);
    const both = (async (input: RequestInfo | URL, init?: RequestInit) => (new URL(String(input)).host === "slack.com" ? slack.request(input, init) : s.f.request(input, init))) as typeof fetch;
    const out = await runDoctor({ ...s.deps(), fetch: both, secrets: () => ({ SLACK_BOT_TOKEN: true, CRON_SECRET: false }) });
    expect(out).toMatchObject({
      ok: false, job: "doctor", secrets: { SLACK_BOT_TOKEN: true, CRON_SECRET: false },
      hubstaff: { state: "connected", note: "Hubstaff answered: screenshots are on for 1 person." },
      ai: { state: "connected", provider: "google_ai" }, slack: { state: "ok", channel: "C0B5TL9H370" },
    });
    expect(out.note).toStartWith("Missing secrets: CRON_SECRET.");
    expect(s.calls.map(c => c.name).filter(n => !/_get$|_inputs$/.test(n))).toEqual([]);
    expect(s.rec.rows.every(r => r.run_id === null)).toBe(true);
  });
});

describe("final round (2026-10-13 evening)", () => {
  const lamaOn = (extra: Partial<HubstaffData> = {}): HubstaffData => ({
    lastActivities: [{ user_id: 3616851, online: true, last_client_activity: kw("10:29") }, { user_id: 4095165, online: true, last_client_activity: kw("10:29") }],
    activities: [{ user_id: 3616851, time_slot: kw("10:00"), tracked: 600, input_tracked: 600, overall: 400, time_type: "normal" }],
    screenshots: [shot(9002, "3616851", "10:21"), shot(9001, "3616851", "10:12")],
    settings: [], ...extra,
  });
  const applied = (s: ReturnType<typeof setup>) => s.rpcs("cockpit_hours_watch_apply")[0].args.p as { shots: ShotRow[]; open: { kind: string; detail: Record<string, unknown> }[]; slots: Record<string, unknown>[]; statuses: { state: string; detail: Record<string, unknown> }[] };

  test("each opening post mentions the CEO; thread replies and the stored sentence never do; the switch turns it off", async () => {
    const reply = { id: 4, person_id: 2, kind: "not_tracking", opened_at: kw("09:00"), closed_at: kw("09:40"), detail: { text: "x", resolveText: "Back on Hubstaff at 09:40 (40 min off)." }, slack_state: "posted", slack_ts: "1.4", resolve_state: "pending" };
    const s = setup({ hubstaff: lamaOn(), replies: [reply] });
    await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    const open = s.slackPosts.find(p => !p.thread_ts)!;
    expect(String(open.text)).toStartWith("<@U09305KE2KS> *Lama Harb* (call centre agent): 2 of the last 2 screenshots do not look like work");
    expect(s.slackPosts.find(p => p.thread_ts)!.text).toBe("Back on Hubstaff at 09:40 (40 min off).");
    expect(String(applied(s).open[0].detail.text)).toStartWith("*Lama Harb*");
    const off = setup({ hubstaff: lamaOn(), settings: { mention: false } });
    await runWatch(off.deps(), { runId: 9, leaseToken: "lease" });
    expect(String(off.slackPosts[0].text)).toStartWith("*Lama Harb*");
    // A user id that is not one is never sent (the default stands).
    const odd = setup({ hubstaff: lamaOn(), settings: { mentionUser: "<!channel>" } });
    await runWatch(odd.deps(), { runId: 9, leaseToken: "lease" });
    expect(String(odd.slackPosts[0].text)).toStartWith("<@U09305KE2KS> *Lama Harb*");
  });

  test("screenshots recorded before the shift starts or inside part-day leave are dropped before classification", async () => {
    const early = setup({ hubstaff: lamaOn({ screenshots: [shot(9001, "3616851", "09:55"), shot(9002, "3616851", "10:21")] }) });
    await runWatch(early.deps(), { runId: 9, leaseToken: "lease" });
    expect(applied(early).shots.map(r => r.shotId)).toEqual([9002]);
    expect(early.f.calls.filter(c => c.url.host === "hubstaff-production.s3.amazonaws.com").map(c => c.url.pathname)).toEqual(["/screenshots/9002.jpg", "/screenshots/9002_thumb.jpg"]);
    expect(early.f.calls.some(c => c.url.pathname.includes("9001"))).toBe(false);
    const onLeave = setup({ people: [person({ leave: [{ start: kw("10:00"), end: kw("10:15") }] }), DANIYA], hubstaff: lamaOn() });
    await runWatch(onLeave.deps(), { runId: 9, leaseToken: "lease" });
    expect(applied(onLeave).shots.map(r => r.shotId)).toEqual([9002]);
  });

  test("a failed download is category 'download', a model failure 'model'", async () => {
    const s = setup({ hubstaff: lamaOn(), model: c => (c.url.host === "generativelanguage.googleapis.com" ? ok({ error: { status: "UNAVAILABLE" } }, 503) : null) });
    const expired = (async (input: RequestInfo | URL, init?: RequestInit) =>
      (String(input).includes("/9001.jpg") ? new Response("expired", { status: 403 }) : s.f.request(input, init))) as typeof fetch;
    await runWatch({ ...s.deps(), fetch: expired }, { runId: 9, leaseToken: "lease" });
    expect(applied(s).shots.map(r => [r.shotId, r.verdict, r.category, r.error])).toEqual([
      [9001, "error", "download", "Hubstaff's screenshot storage answered 403; the link may have expired."],
      [9002, "error", "model", "Google AI answered 503 UNAVAILABLE."],
    ]);
    // The expired one never reached a model.
    expect(s.f.calls.filter(c => c.url.host === "generativelanguage.googleapis.com").length).toBe(1);
  });

  test("evidence is kept on a lost answer: deleted only when the database refused on purpose (40001, 22023, 54000)", async () => {
    for (const code of ["40001", "22023", "54000"]) expect(applyRefused(new RpcError("refused", code))).toBe(true);
    for (const e of [new RpcError("Database answered 504", null), new RpcError("deadlock", "40P01"), new TypeError("fetch failed"), new Error("x")]) expect(applyRefused(e)).toBe(false);
    // The reviewers' recheck2: a gateway 504 after the commit kept the rows; the images must stay.
    for (const lost of [new RpcError("Database answered 504", null), new TypeError("fetch failed")]) {
      const s = setup({ hubstaff: lamaOn({ screenshots: [shot(9001, "3616851", "10:12")] }), applyThrows: lost });
      const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
      expect(s.f.calls.filter(c => c.method === "DELETE")).toEqual([]);
      expect(s.f.calls.filter(c => c.url.host === "project.supabase.test").length).toBe(2);
      expect(out.ok).toBe(false);
    }
    const tooBig = setup({ hubstaff: lamaOn({ screenshots: [shot(9001, "3616851", "10:12")] }), applyThrows: new RpcError("The watch payload is over 1 MB; nothing was written", "54000") });
    await runWatch(tooBig.deps(), { runId: 9, leaseToken: "lease" });
    expect(tooBig.f.calls.filter(c => c.method === "DELETE").length).toBe(1);
  });

  test("provider choice skips a refused key: a refused OpenAI key with a working Google AI key checks with Google", async () => {
    const s = setup({ hubstaff: lamaOn(), openaiKey: { ...OPENAI_KEY, state: "refused" } });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(out.ai).toEqual({ state: "connected", provider: "google_ai" });
    expect(s.f.calls.filter(c => c.url.host === "api.openai.com")).toEqual([]);
    expect(applied(s).shots.map(r => r.model)).toEqual(["gemini-flash-latest", "gemini-flash-latest"]);
  });

  test("a key changed during the run is not marked: the note says so and the run carries on", async () => {
    const s = setup({
      hubstaff: lamaOn(), markAnswer: { ok: false, note: "The key changed during the run" },
      model: c => (c.url.host === "generativelanguage.googleapis.com" ? ok({ error: { status: "UNAUTHENTICATED" } }, 401) : null),
    });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(s.rpcs("cockpit_hours_watch_key_mark").map(c => (c.args.p as Record<string, unknown>).savedAt)).toEqual(["2026-10-12T09:00:00+00:00"]);
    expect(out.notes).toContain("The refused AI key was not marked: The key changed during the run");
    expect(out.ok).toBe(true);
  });

  test("slots carry inputTrackedS to the apply", async () => {
    const s = setup({ hubstaff: lamaOn({ activities: [{ user_id: 3616851, time_slot: kw("10:00"), tracked: 600, input_tracked: 420, overall: 300, time_type: "normal" }], screenshots: [] }) });
    await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(applied(s).slots).toEqual([{ personId: 1, slotStart: kw("10:00"), trackedS: 600, inputTrackedS: 420, overallS: 300, idle: false }]);
  });

  test("a 'not in Hubstaff' alert for someone who left needs a run, which closes it as not_watched", async () => {
    const left = person({ personId: 3, name: "Nada Al Saed", hubstaffUserId: null, accountStatus: "invited", offReason: "not_employed", shift: null });
    const inc = { id: 6, person_id: 3, kind: "not_tracking", opened_at: kw("10:15"), detail: { reason: "no_account", text: "x" }, slack_state: "posted", slack_ts: "1.6" };
    expect(needsRun({ id: 6, personId: 3, kind: "not_tracking", openedAt: kw("10:15"), detail: { reason: "no_account" }, slackState: "posted" }, [left])).toBe(true);
    expect(needsRun({ id: 6, personId: 3, kind: "not_tracking", openedAt: kw("10:15"), detail: { reason: "no_account" }, slackState: "posted" }, [{ ...left, offReason: "day_off" }])).toBe(false);
    const s = setup({ people: [left], open: [inc] });
    const out = await runWatch(s.deps(Date.parse(kw("22:00"))), { runId: 9, leaseToken: "lease" });
    expect(out.closed).toEqual([6]);
    expect(s.incidents.get(6)?.detail).toMatchObject({ resolveText: "No longer watched: this person no longer has to track time." });
    expect(s.slackPosts).toEqual([expect.objectContaining({ thread_ts: "1.6", text: "No longer watched: this person no longer has to track time." })]);
  });

  test("no_schedule rests as off_shift with the reason in the detail", async () => {
    const s = setup({ people: [person({ offReason: "no_schedule", shift: null })] });
    const out = await runWatch(s.deps(), { runId: 9, leaseToken: "lease" });
    expect(out.note).toBe("Nobody on shift");
    expect(applied(s).statuses).toEqual([{ personId: 1, state: "off_shift", since: null, shiftStart: null, shiftEnd: null, detail: { offReason: "no_schedule" } }]);
  });
});
