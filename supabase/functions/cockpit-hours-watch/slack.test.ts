import { describe, expect, test } from "bun:test";
import { watchHealth } from "./ledger.ts";
import { checkChannel, mentionPrefix, sendPost } from "./slack.ts";
import { fakeFetch, ok, receiptsRecorder, type Route } from "./testkit.ts";

const TOKEN = "xoxb-fixture-not-real";
const CHANNEL = "C0B5TL9H370";
type Rec = { name: string; args: Record<string, unknown> };

/** An incident store that behaves like the claim RPC: pending moves to sending once; anything else is not claimed. */
function setup(routes: Route[], incident: Record<string, unknown> | null, opts: { token?: string } = {}) {
  const calls: Rec[] = [];
  const state = { open: incident ? String(incident.slack_state ?? "pending") : "none", resolve: incident ? String(incident.resolve_state ?? "none") : "none" };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const p = args.p as Record<string, unknown>;
    const which = p.which as "open" | "resolve";
    if (name === "cockpit_hours_watch_slack_claim") {
      if (!incident || state[which] !== "pending") return null;
      state[which] = "sending";
      return incident;
    }
    if (name === "cockpit_hours_watch_slack_result") state[which] = String(p.state);
    return null;
  };
  const rec = receiptsRecorder();
  const f = fakeFetch(routes);
  const deps = { rpc, health: watchHealth(rec.insert, 3).health, fetch: f.request, token: () => opts.token ?? TOKEN };
  return { calls, rec, f, deps, state };
}
const posted: Route = c => (c.url.pathname === "/api/chat.postMessage" ? ok({ ok: true, channel: CHANNEL, ts: "1760340000.000100" }) : null);
const opened = { id: 5, person_id: 1, kind: "not_tracking", detail: { text: "*Lama Harb* (call centre agent) has not had Hubstaff on since 10:12." }, slack_channel: null, slack_ts: null, slack_state: "pending" };

describe("posting an alert", () => {
  test("claim, send, record: plain text, previews off, receipted without the token", async () => {
    const s = setup([posted], opened);
    const out = await sendPost(s.deps, 5, "open", { on: true, channel: CHANNEL });
    expect(out).toEqual({ incidentId: 5, which: "open", state: "posted", ts: "1760340000.000100" });
    expect(s.calls.map(c => c.name)).toEqual(["cockpit_hours_watch_slack_claim", "cockpit_hours_watch_slack_result"]);
    expect(s.calls[1].args).toEqual({ p: { incidentId: 5, which: "open", state: "posted", channel: CHANNEL, ts: "1760340000.000100" } });
    const body = JSON.parse(s.f.calls[0].body!);
    expect(body).toEqual({ channel: CHANNEL, text: opened.detail.text, unfurl_links: false, unfurl_media: false });
    expect(s.f.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(s.rec.rows.map(r => `${r.provider} ${r.method} ${r.resource} ${r.phase} ${r.http_status ?? ""}`)).toEqual([
      "slack POST slack.com/api/chat.postMessage intent ", "slack POST slack.com/api/chat.postMessage response 200",
    ]);
    expect(JSON.stringify(s.rec.rows)).not.toContain(TOKEN);
  });
  test("the resolve reply goes in the alert's thread", async () => {
    const s = setup([posted], { ...opened, slack_state: "posted", slack_ts: "1760339000.000200", resolve_state: "pending", detail: { ...opened.detail, resolveText: "Back on Hubstaff at 10:47 (35 min off)." } });
    const out = await sendPost(s.deps, 5, "resolve", { on: true, channel: CHANNEL });
    expect(out.state).toBe("posted");
    expect(JSON.parse(s.f.calls[0].body!)).toEqual({ channel: CHANNEL, text: "Back on Hubstaff at 10:47 (35 min off).", unfurl_links: false, unfurl_media: false, thread_ts: "1760339000.000200" });
  });
  test("an unknown outcome is recorded and never sent again", async () => {
    for (const route of [(() => { throw new Error("timeout"); }) as Route, (() => new Response("bad gateway", { status: 502 })) as Route, (() => new Response("not json", { status: 200 })) as Route]) {
      const s = setup([route], opened);
      const first = await sendPost(s.deps, 5, "open", { on: true, channel: CHANNEL });
      expect(first.state).toBe("unknown");
      expect(s.state.open).toBe("unknown");
      const again = await sendPost(s.deps, 5, "open", { on: true, channel: CHANNEL });
      expect(again.state).toBe("skipped");
      expect(s.f.calls.length).toBe(1);
    }
  });
  test("a refusal is recorded with Slack's code, to show on the card", async () => {
    const s = setup([() => ok({ ok: false, error: "not_in_channel" })], opened);
    expect(await sendPost(s.deps, 5, "open", { on: true, channel: CHANNEL })).toEqual({ incidentId: 5, which: "open", state: "failed", error: "not_in_channel" });
    expect(s.calls[1].args.p).toMatchObject({ state: "failed", error: "not_in_channel" });
    expect(s.rec.rows[1]).toMatchObject({ phase: "response", http_status: 200, error: "not_in_channel" });
  });
  test("alerts off: the claim mutes the post in the database, nothing is sent", async () => {
    const s = setup([posted], { ...opened, slack_state: "muted" });
    expect(await sendPost(s.deps, 5, "open", { on: false, channel: CHANNEL })).toEqual({ incidentId: 5, which: "open", state: "muted" });
    expect(s.calls.map(c => c.name)).toEqual(["cockpit_hours_watch_slack_claim"]);
    expect(s.f.calls).toEqual([]);
  });
  test("muted or already sent in the database: the claim returns nothing and nothing is sent", async () => {
    const s = setup([posted], { ...opened, slack_state: "muted" });
    expect((await sendPost(s.deps, 5, "open", { on: true, channel: CHANNEL })).state).toBe("skipped");
    expect(s.f.calls).toEqual([]);
  });
  test("no token: recorded as failed with what to do, no call", async () => {
    const s = setup([posted], opened, { token: "" });
    const out = await sendPost(s.deps, 5, "open", { on: true, channel: CHANNEL });
    expect(out).toMatchObject({ state: "failed", error: expect.stringContaining("SLACK_BOT_TOKEN is not set") });
    expect(s.f.calls).toEqual([]);
    expect(s.rec.rows).toEqual([]);
  });
  test("the reviewers' probe1: a break after the claim never leaves the post 'sending'", async () => {
    // The intent receipt cannot be saved: nothing went out, so it is failed.
    const before = setup([posted], opened);
    const noReceipt = { ...before.deps, health: async () => { throw new Error("The receipt could not be saved."); } };
    expect(await sendPost(noReceipt, 5, "open", { on: true, channel: CHANNEL })).toMatchObject({ state: "failed", error: "The message was not sent: The receipt could not be saved." });
    expect(before.state.open).toBe("failed");
    expect(before.f.calls).toEqual([]);
    expect(before.calls.map(c => c.name)).toEqual(["cockpit_hours_watch_slack_claim", "cockpit_hours_watch_slack_result"]);
    // The token cannot be read: failed too.
    const token = setup([posted], opened);
    expect((await sendPost({ ...token.deps, token: () => { throw new Error("env unreadable"); } }, 5, "open", { on: true, channel: CHANNEL })).state).toBe("failed");
    expect(token.state.open).toBe("failed");
    // The request went out, then the response receipt failed: it may have arrived, so unknown, never sent again.
    const after = setup([posted], opened);
    let n = 0;
    const lateReceipt = { ...after.deps, health: async () => { if (++n === 2) throw new Error("The receipt could not be saved."); } };
    const out = await sendPost(lateReceipt, 5, "open", { on: true, channel: CHANNEL });
    expect(out).toMatchObject({ state: "unknown", error: expect.stringContaining("it is not sent again in case it arrived") });
    expect(after.state.open).toBe("unknown");
    expect(after.f.calls.length).toBe(1);
    expect((await sendPost(after.deps, 5, "open", { on: true, channel: CHANNEL })).state).toBe("skipped");
    expect(after.f.calls.length).toBe(1);
  });
  test("a reply without the alert's timestamp is not sent to the channel", async () => {
    const s = setup([posted], { ...opened, slack_state: "posted", resolve_state: "pending", detail: { resolveText: "Shift ended at 18:00." } });
    expect((await sendPost(s.deps, 5, "resolve", { on: true, channel: CHANNEL })).state).toBe("failed");
    expect(s.f.calls).toEqual([]);
  });
});

describe("the doctor's channel check", () => {
  test("conversations.info, read only", async () => {
    const s = setup([c => (c.url.pathname === "/api/conversations.info" ? ok({ ok: true, channel: { id: CHANNEL, name: "team-management", is_member: false } }) : null)], null);
    expect(await checkChannel(s.deps, CHANNEL)).toEqual({ state: "ok", note: "#team-management found; the bot posts without joining (chat:write.public)." });
    expect(s.f.calls[0].method).toBe("GET");
    expect(s.f.calls[0].url.searchParams.get("channel")).toBe(CHANNEL);
    expect(s.rec.rows[0].resource).toBe("slack.com/api/conversations.info");
    const refused = setup([() => ok({ ok: false, error: "missing_scope" })], null);
    expect(await checkChannel(refused.deps, CHANNEL)).toEqual({ state: "failing", note: "Slack refused the channel check: missing_scope." });
  });
});

describe("the mention (final round)", () => {
  test("an opening post starts with <@user> while the mention is on; a thread reply never does", async () => {
    const mention = { on: true, channel: CHANNEL, mention: true, mentionUser: "U09305KE2KS" };
    const s = setup([posted], opened);
    await sendPost(s.deps, 5, "open", mention);
    expect(JSON.parse(s.f.calls[0].body!).text).toBe("<@U09305KE2KS> *Lama Harb* (call centre agent) has not had Hubstaff on since 10:12.");
    const r = setup([posted], { ...opened, slack_state: "posted", slack_ts: "1.5", resolve_state: "pending", detail: { ...opened.detail, resolveText: "Back on Hubstaff at 10:47 (35 min off)." } });
    await sendPost(r.deps, 5, "resolve", mention);
    expect(JSON.parse(r.f.calls[0].body!).text).toBe("Back on Hubstaff at 10:47 (35 min off).");
    expect(mentionPrefix({ mention: false, mentionUser: "U09305KE2KS" })).toBe("");
    expect(mentionPrefix({ mention: true, mentionUser: "<!channel>" })).toBe("");
    expect(mentionPrefix({ mention: true })).toBe("");
    expect(mentionPrefix({ mention: true, mentionUser: "W0123ABCDE" })).toBe("<@W0123ABCDE> ");
  });
});
