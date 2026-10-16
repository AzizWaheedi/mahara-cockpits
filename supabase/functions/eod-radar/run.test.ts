import { describe, expect, test } from "bun:test";
import { fakeFetch, ok, type Route } from "../cockpit-hours-watch/testkit.ts";
import { makeDoor, readJob } from "./door.ts";
import { CH, makeCsr, makeNextDay, makeUnclosedDate, outboxCsm, PEOPLE } from "./fixtures.ts";
import type { SlackMessage } from "./parse.ts";
import { daysBetween, isFriday } from "./rules.ts";
import { type ReceiptRow, type RunDeps, runRadar } from "./run.ts";

const TOKEN = "xoxb-fixture-not-real";
const kw = (s: string) => new Date(Date.parse(`${s.replace(" ", "T")}:00Z`) - 3 * 3600_000);
/** The tests' fixed clock: every run below stands on 14 Oct, never on the wall clock. */
const NOW = kw("2026-10-14 21:00");
const CHANNELS = [
  { id: CH.tech, name: "tech-eods" }, { id: CH.media, name: "media-eods" }, { id: CH.csms, name: "eods-csms" },
  { id: CH.sales, name: "eods-salesreps" }, { id: CH.csr, name: "eods-csr" },
];

type Call = { name: string; args: Record<string, any> };

function inputs(from: string, to: string, today: string, over: Record<string, unknown> = {}) {
  return {
    now: NOW.toISOString(), today, from, to,
    settings: { digestOn: true, remindersOn: false, strikesOn: false, lateAt: "22:00", closeoutAt: "23:00", digestChannel: "C0B5TL9H370", digestChannelName: "team-management", lookbackDays: 2 },
    channels: CHANNELS,
    people: PEOPLE.filter(p => [7, 18, 26].includes(p.personId)).map(p => ({
      ...p, slackSource: "lookup", slackState: "ok", slackCheckedAt: NOW.toISOString(),
      days: daysBetween(from, to).map(day => ({ day, off: isFriday(day) ? "friday" : null, offNote: null, leave: null })),
    })),
    outbox: [], digests: [], ...over,
  };
}

/** Slack's history from per-channel messages, the lookups, and the one post. */
function slackRoutes(history: Record<string, SlackMessage[]>, opts: { refuse?: Record<string, string>; post?: Response; scopes?: string } = {}): Route[] {
  const headers = { "Content-Type": "application/json", "x-oauth-scopes": opts.scopes ?? "groups:history,users:read,users:read.email,chat:write" };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  return [
    c => {
      if (c.url.pathname !== "/api/conversations.history") return null;
      const ch = c.url.searchParams.get("channel") ?? "";
      if (opts.refuse?.[ch]) return json({ ok: false, error: opts.refuse[ch] });
      return json({ ok: true, messages: history[ch] ?? [], has_more: false });
    },
    c => (c.url.pathname === "/api/users.lookupByEmail" ? json({ ok: true, user: { id: "U0AS90SHMH8" } }) : null),
    c => (c.url.pathname === "/api/chat.postMessage" ? (opts.post ?? json({ ok: true, ts: "1791997503.000100" })) : null),
  ];
}

function setup(o: { now: Date; history?: Record<string, SlackMessage[]>; inputs?: Record<string, unknown>; claim?: unknown; slack?: Parameters<typeof slackRoutes>[1]; token?: string; from?: string; to?: string; today?: string }) {
  const calls: Call[] = [];
  const receipts: ReceiptRow[] = [];
  const from = o.from ?? "2026-10-12";
  const to = o.to ?? "2026-10-14";
  const today = o.today ?? "2026-10-14";
  const f = fakeFetch(slackRoutes(o.history ?? {}, o.slack));
  const deps: RunDeps = {
    rpc: async (name, args) => {
      calls.push({ name, args: args as Record<string, any> });
      if (name === "cockpit_eod_radar_inputs") return inputs(from, to, today, o.inputs);
      if (name === "cockpit_eod_radar_apply") return { ok: true };
      if (name === "cockpit_eod_radar_digest_claim") return o.claim ?? { claimed: true, day: today, channel: "C0B5TL9H370", text: (args as any).p.text, attempt: 1 };
      if (name === "cockpit_eod_radar_digest_result") return { ok: true };
      throw new Error(`unexpected ${name}`);
    },
    insertReceipt: async row => { receipts.push(row); },
    fetch: f.request,
    sleep: async () => {},
    now: () => o.now,
    token: () => o.token ?? TOKEN,
    runId: () => "00000000-0000-4000-8000-000000000001",
  };
  return { deps, calls, receipts, f };
}

const HISTORY = { [CH.tech]: [makeUnclosedDate], [CH.media]: [makeNextDay], [CH.csr]: [makeCsr] };
const job = (over: Partial<Parameters<typeof runRadar>[1]> = {}) => ({ job: "run" as const, dryRun: false, requestedBy: "cron", ...over });

describe("a run", () => {
  test("a dry run reads Slack, writes nothing and posts nothing", async () => {
    const s = setup({ now: kw("2026-10-14 23:05"), history: HISTORY });
    const r = await runRadar(s.deps, job({ dryRun: true }));
    expect(s.calls.map(c => c.name)).toEqual(["cockpit_eod_radar_inputs"]);
    expect(s.f.calls.some(c => c.url.pathname === "/api/chat.postMessage")).toBe(false);
    const status = (id: number, day: string) => r.rows!.find(x => x.personId === id && x.day === day)!.status;
    expect(status(7, "2026-10-14")).toBe("on_time");
    expect(status(18, "2026-10-14")).toBe("late");
    expect(status(26, "2026-10-13")).toBe("late");
    expect(status(26, "2026-10-14")).toBe("missed");
    expect(r.digest).toEqual({ day: "2026-10-14", state: "would_post", text: "EOD Radar, Wed 14 Oct: 1 on time, 1 late, 1 missed (Ali), 0 on leave." });
    expect(r.ok).toBe(true);
  });

  test("a run writes every person-day, then claims, posts and records the closeout once", async () => {
    const s = setup({ now: kw("2026-10-14 23:01"), history: HISTORY });
    const r = await runRadar(s.deps, job());
    expect(s.calls.map(c => c.name)).toEqual(["cockpit_eod_radar_inputs", "cockpit_eod_radar_apply", "cockpit_eod_radar_digest_claim", "cockpit_eod_radar_digest_result"]);
    const apply = s.calls[1].args.p;
    expect(apply.rows).toHaveLength(9);
    expect(apply.ok).toBe(true);
    expect(apply.channels.every((c: any) => c.ok)).toBe(true);
    const posts = s.f.calls.filter(c => c.url.pathname === "/api/chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].body!)).toMatchObject({ channel: "C0B5TL9H370", unfurl_links: false });
    expect(s.calls[3].args.p).toEqual({ day: "2026-10-14", state: "posted", ts: "1791997503.000100" });
    expect(r.digest?.state).toBe("posted");
  });

  test("before the closeout nothing is posted and nobody is missed today", async () => {
    const s = setup({ now: kw("2026-10-14 21:00"), history: HISTORY });
    await runRadar(s.deps, job());
    expect(s.calls.map(c => c.name)).toEqual(["cockpit_eod_radar_inputs", "cockpit_eod_radar_apply"]);
    const ali = s.calls[1].args.p.rows.find((x: any) => x.personId === 26 && x.day === "2026-10-14");
    expect(ali.status).toBe("pending");
  });

  test("a day already posted is not claimed again; a refused claim posts nothing", async () => {
    const posted = setup({ now: kw("2026-10-14 23:31"), history: HISTORY, inputs: { digests: [{ day: "2026-10-14", state: "posted", attempts: 1 }] } });
    const r = await runRadar(posted.deps, job());
    expect(posted.calls.map(c => c.name)).toEqual(["cockpit_eod_radar_inputs", "cockpit_eod_radar_apply"]);
    expect(r.digest?.state).toBe("already posted");
    const refused = setup({ now: kw("2026-10-14 23:31"), history: HISTORY, claim: { claimed: false, reason: "done", state: "sending" } });
    await runRadar(refused.deps, job());
    expect(refused.f.calls.some(c => c.url.pathname === "/api/chat.postMessage")).toBe(false);
  });

  test("the digest switched off: written, not posted", async () => {
    const s = setup({ now: kw("2026-10-14 23:05"), history: HISTORY, inputs: { settings: { ...inputs("2026-10-12", "2026-10-14", "2026-10-14").settings, digestOn: false } } });
    const r = await runRadar(s.deps, job());
    expect(s.calls.map(c => c.name)).toEqual(["cockpit_eod_radar_inputs", "cockpit_eod_radar_apply"]);
    expect(r.digest?.state).toBe("off");
  });

  test("a post Slack refuses is failed; one with no answer is unknown and never sent again", async () => {
    const failed = setup({ now: kw("2026-10-14 23:05"), history: HISTORY, slack: { post: ok({ ok: false, error: "not_in_channel" }) } });
    await runRadar(failed.deps, job());
    expect(failed.calls.at(-1)!.args.p).toEqual({ day: "2026-10-14", state: "failed", error: "not_in_channel" });
    const unknown = setup({ now: kw("2026-10-14 23:05"), history: HISTORY, slack: { post: ok({ ok: false }, 503) } });
    await runRadar(unknown.deps, job());
    expect(unknown.calls.at(-1)!.args.p.state).toBe("unknown");
  });

  test("a channel Slack will not let the radar read: not read, never missed, and named", async () => {
    const s = setup({ now: kw("2026-10-14 23:05"), history: HISTORY, slack: { refuse: { [CH.csr]: "missing_scope" } } });
    const r = await runRadar(s.deps, job());
    const apply = s.calls[1].args.p;
    expect(apply.ok).toBe(false);
    expect(apply.rows.some((x: any) => x.status === "missed")).toBe(false);
    expect(apply.rows.find((x: any) => x.personId === 26 && x.day === "2026-10-14").status).toBe("not_read");
    expect(apply.note).toContain("Could not read #eods-csr (missing_scope)");
    expect(r.digest?.text).toBe("EOD Radar, Wed 14 Oct: 0 on time, 1 late, 0 missed, 0 on leave.\nCould not read #eods-csr (the Slack app needs the groups:history scope), so 2 people are not counted.");
  });

  test("no token: nothing read, nobody missed, the note says what to set", async () => {
    const s = setup({ now: kw("2026-10-14 23:05"), history: HISTORY, token: "" });
    await runRadar(s.deps, job());
    expect(s.f.calls.filter(c => c.url.pathname === "/api/conversations.history")).toHaveLength(0);
    const apply = s.calls[1].args.p;
    expect(apply.rows.some((x: any) => x.status === "missed")).toBe(false);
    expect(apply.note).toContain("SLACK_BOT_TOKEN is not set on eod-radar");
  });

  test("a scope the token lacks is named", async () => {
    const s = setup({ now: kw("2026-10-14 21:00"), history: HISTORY, slack: { scopes: "channels:history,chat:write" } });
    await runRadar(s.deps, job());
    expect(s.calls[1].args.p.note).toContain("The Slack token lacks groups:history, users:read.email");
  });

  test("Slack ids: looked up when a week old; a missing scope stops the lookups and keeps the saved ids", async () => {
    const old = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    const stale = (p: any) => ({ ...p, slackCheckedAt: old });
    const base = inputs("2026-10-12", "2026-10-14", "2026-10-14");
    const s = setup({ now: kw("2026-10-14 21:00"), history: HISTORY, inputs: { people: base.people.map(stale) } });
    await runRadar(s.deps, job());
    const asked = s.f.calls.filter(c => c.url.pathname === "/api/users.lookupByEmail");
    expect(asked).toHaveLength(2); // Ali has no email
    expect(s.calls[1].args.p.slackIds).toHaveLength(2);
    const refusing: Route = c => (c.url.pathname === "/api/users.lookupByEmail" ? ok({ ok: false, error: "missing_scope" }) : null);
    const t = setup({ now: kw("2026-10-14 21:00"), history: HISTORY, inputs: { people: base.people.map(stale) } });
    t.deps.fetch = fakeFetch([refusing, ...slackRoutes(HISTORY)]).request;
    await runRadar(t.deps, job());
    expect(t.calls[1].args.p.slackIds).toEqual([{ personId: 7, slackUserId: null, state: "refused", note: "Slack refused the lookup (missing_scope)" }]);
    expect(t.calls[1].args.p.note).toContain("the Slack app needs users:read.email");
  });

  test("a CSM EOD from the cockpit (outbox channel #eods-csms) is one credit under the channel's id, and the run writes", async () => {
    const base = inputs("2026-10-12", "2026-10-14", "2026-10-14");
    const rasem = PEOPLE.find(p => p.personId === 28)!;
    const people = [...base.people, { ...base.people[0], ...rasem, slackSource: "lookup", slackState: "ok", slackCheckedAt: NOW.toISOString() }];
    // The database names the channel's id; an older shape (or a row it could not resolve) still says #eods-csms.
    const outbox = [{ id: 9, role: "csm", day: "2026-10-14", person: "Rasem Abdel All", slackId: "U0C5JHUCTPG", channel: "#eods-csms", slackTs: outboxCsm.ts, createdAt: "2026-10-14T16:58:00Z" }];
    const s = setup({ now: kw("2026-10-14 23:05"), history: { ...HISTORY, [CH.csms]: [outboxCsm] }, inputs: { people, outbox } });
    const r = await runRadar(s.deps, job());
    const apply = s.calls[1].args.p;
    expect(apply.rows.find((x: any) => x.personId === 28 && x.day === "2026-10-14")).toMatchObject({
      status: "on_time", creditedBy: "cockpit_outbox", postedChannel: CH.csms, slackTs: outboxCsm.ts, posts: 1,
    });
    for (const x of apply.rows) if (x.postedChannel !== null) expect(x.postedChannel).toMatch(/^[CG][A-Z0-9]{8,12}$/);
    expect(r.digest?.state).toBe("posted");
  });

  test("every Slack call is receipted, with no token, email or channel in the ledger", async () => {
    const s = setup({ now: kw("2026-10-14 23:05"), history: HISTORY, inputs: { people: inputs("2026-10-12", "2026-10-14", "2026-10-14").people.map(p => ({ ...p, slackSource: "migration" })) } });
    await runRadar(s.deps, job());
    expect(s.receipts.length).toBe(2 * s.f.calls.length);
    const text = JSON.stringify(s.receipts);
    for (const secret of [TOKEN, "maharamedia.com", CH.csr, "U0AS90SHMH8"]) expect(text).not.toContain(secret);
    expect(s.receipts.every(r => r.run_id === "00000000-0000-4000-8000-000000000001")).toBe(true);
  });
});

describe("the door", () => {
  test("the body is read strictly", () => {
    expect(readJob({ job: "run" })).toEqual({ job: "run", dryRun: false, requestedBy: "cron" });
    expect(readJob({ job: "backfill", days: 45, dryRun: true })).toEqual({ job: "backfill", days: 45, dryRun: true, requestedBy: "cron" });
    expect(readJob({ job: "run", day: "2026-10-14" })).toMatchObject({ day: "2026-10-14" });
    expect(readJob({ job: "backfill", days: 46 })).toContain("1 to 45");
    expect(readJob({ job: "run", days: 3 })).toContain("days goes with a backfill");
    expect(readJob({ job: "post" })).toContain('Send {"job": "run"}');
    expect(readJob({ job: "run", extra: 1 })).toContain("Unknown field extra");
  });

  test("only the cron secret gets in; a run answers 202 and works in the background", async () => {
    let started: Promise<unknown> | null = null;
    const s = setup({ now: kw("2026-10-14 21:00"), history: HISTORY });
    const door = makeDoor({ ...s.deps, cronSecret: () => "s3cret", waitUntil: w => { started = w; } });
    const post = (body: unknown, secret?: string) => door(new Request("https://x/eod-radar", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {}, body: JSON.stringify(body) }));
    expect((await post({ job: "run" })).status).toBe(401);
    expect((await post({ job: "run" }, "wrong")).status).toBe(401);
    expect((await post({ job: "nope" }, "s3cret")).status).toBe(400);
    expect((await door(new Request("https://x/eod-radar", { method: "GET" }))).status).toBe(405);
    const res = await post({ job: "run" }, "s3cret");
    expect(res.status).toBe(202);
    await started;
    expect(s.calls.map(c => c.name)).toContain("cockpit_eod_radar_apply");
  });

  test("a run that breaks says so on the sync-state row", async () => {
    const s = setup({ now: kw("2026-10-14 21:00") });
    const calls: Call[] = [];
    let started: Promise<unknown> | null = null;
    const door = makeDoor({
      ...s.deps,
      rpc: async (name, args) => {
        calls.push({ name, args: args as any });
        if (name === "cockpit_eod_radar_inputs") throw new Error("Database answered 503");
        return { ok: true };
      },
      cronSecret: () => "s3cret",
      waitUntil: w => { started = w; },
    });
    await door(new Request("https://x/eod-radar", { method: "POST", headers: { "x-cron-secret": "s3cret" }, body: JSON.stringify({ job: "run" }) }));
    await started;
    expect(calls[1]).toMatchObject({ name: "cockpit_eod_radar_apply", args: { p: { rows: [], ok: false, note: "The radar run broke before it wrote anything: Database answered 503" } } });
  });
});
