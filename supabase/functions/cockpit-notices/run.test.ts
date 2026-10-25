import { describe, expect, test } from "bun:test";
import { runDoctor } from "./doctor";
import { JobError, runDryRun, runNotices, runRehearse } from "./run";
import { NO_SLACK_ID, NO_TOKEN, UNKNOWN, WAITING, WRONG_BOT } from "./send";
import {
  BOT_USER, claimed, CREATIVE, CSM, CSM_GENERAL, deps, FakeClickUp, FakeSlack, fakeRpc, ID, MEDIA_GENERAL, mention, minutesAgo, NOW, receiptsRecorder, ref, SYSTEMS,
} from "./testkit";

// A fake Slack, ClickUp and database stand in for the real ones; the real door code, sender, text and
// receipts run against them. Every client, card and person is invented.

const claimOnce = (...rows: Record<string, unknown>[]) => {
  let given = false;
  return () => {
    if (given) return { busy: false, rows: [] };
    given = true;
    return { busy: false, rows };
  };
};
const blocksText = (detail: unknown) => JSON.stringify((detail as { blocks: unknown }).blocks);
const lastResult = (kit: ReturnType<typeof deps>) => kit.rpc.results().at(-1)!;
const detailOf = (args: Record<string, unknown>) => args.p_detail as Record<string, unknown>;

describe("the kickoff notice", () => {
  test("complete: the handoff comment is there, it posts once to #csm-general, tags the creative seat, and stores the permalink", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(claimed()) }) });
    kit.clickup.handoff("task0001", minutesAgo(23));
    const result = await runNotices(kit.deps);
    expect(result).toMatchObject({ ok: true, claimed: 1, posted: 1, requeued: 0, retried: 0, failed: 0, unknown: 0 });
    const posts = kit.slack.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ channel: CSM_GENERAL, unfurl_links: false, unfurl_media: false });
    expect(posts[0].body?.thread_ts).toBeUndefined();
    expect(String(posts[0].body?.text)).toBe(`Kickoff complete: Acme &amp; Sons &lt;Interiors&gt;. Next is the Brand Blueprint call. Ref ${ref(ID(1))}`);
    const r = lastResult(kit);
    const posted = kit.slack.messages.get(CSM_GENERAL)![0];
    expect(r).toMatchObject({ p_id: ID(1), p_outcome: "posted", p_ts: posted.ts, p_channel: CSM_GENERAL, p_error: null });
    const d = detailOf(r);
    expect(d.variant).toBe("complete");
    expect(d.permalink).toBe(`https://example-team.slack.com/archives/${CSM_GENERAL}/p${String(posted.ts).replace(".", "")}`);
    expect(d.facts).toEqual({ commentCheck: "found", handoffAt: minutesAgo(23), filledByRole: "the CSM" });
    expect(blocksText(d)).toContain("<@U0B2SHGS1JA>");
    expect(blocksText(d)).toContain("The card shows Brand Blueprint Booked, and the Brand Blueprint link.");
    expect(blocksText(d)).toContain("Filled by the CSM on Sun 25 Oct, 14:05.");
    expect(d.text).toBe(posts[0].body?.text);
    // A second run has nothing to claim and posts nothing.
    await runNotices(kit.deps);
    expect(kit.slack.posts()).toHaveLength(1);
  });

  test("every call has its intent row and its response row, with the notice id as run_key; no receipt carries a channel, a name or text", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(claimed()) }) });
    kit.clickup.handoff("task0001", minutesAgo(23));
    await runNotices(kit.deps);
    const calls = kit.net.calls.map(c => `${c.url.host}${c.url.pathname}`);
    expect(calls).toEqual([
      "slack.com/api/auth.test",
      "api.clickup.com/api/v2/task/task0001/comment",
      "slack.com/api/chat.postMessage",
      "slack.com/api/chat.getPermalink",
    ]);
    const rows = kit.receipts.rows.filter(r => r.resource !== "notices/mentions");
    expect(rows.map(r => `${r.phase} ${r.provider} ${r.resource} ${r.run_key}`)).toEqual([
      "intent slack slack.com/api/auth.test run",
      "response slack slack.com/api/auth.test run",
      `intent clickup task/task0001/comment ${ID(1)}`,
      `response clickup task/task0001/comment ${ID(1)}`,
      `intent slack slack.com/api/chat.postMessage ${ID(1)}`,
      `response slack slack.com/api/chat.postMessage ${ID(1)}`,
      `intent slack slack.com/api/chat.getPermalink ${ID(1)}`,
      `response slack slack.com/api/chat.getPermalink ${ID(1)}`,
    ]);
    const post = rows.find(r => r.phase === "response" && r.resource === "slack.com/api/chat.postMessage")!;
    expect(post.object_id).toBe(String(kit.slack.messages.get(CSM_GENERAL)![0].ts));
    expect(post.http_status).toBe(200);
    for (const r of kit.receipts.rows) expect(Object.keys(r).sort()).toEqual(["action_id", "http_status", "method", "object_id", "phase", "provider", "resource", "run_key"]);
    const all = JSON.stringify(kit.receipts.rows);
    for (const leak of [CSM_GENERAL, "Acme", "Kickoff complete", "U0B2SHGS1JA", "xoxb", "pk_test"]) expect(all).not.toContain(leak);
    // Every tag resolved: the mentions row says so, which clears an earlier warning.
    expect(kit.receipts.rows.filter(r => r.resource === "notices/mentions")).toEqual([{ provider: "slack", method: "GET", resource: "notices/mentions", phase: "response", http_status: 200, object_id: null, action_id: null, run_key: ID(1) }]);
  });

  test("missing within 20 minutes: back to the queue for a minute, not an attempt, nothing posted", async () => {
    const row = claimed({ facts: { ...claimed().facts as Record<string, unknown>, submittedAt: minutesAgo(5) } });
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(row) }) });
    kit.clickup.handoff("task0001", minutesAgo(60)); // an older kickoff's comment does not count
    const result = await runNotices(kit.deps);
    expect(result).toMatchObject({ posted: 0, requeued: 1 });
    expect(kit.slack.posts()).toHaveLength(0);
    expect(lastResult(kit)).toMatchObject({ p_outcome: "requeue", p_error: WAITING, p_detail: { retryAfterSec: 60 } });
  });

  test("after 20 minutes without the comment: the late notice, tagging the CSM and the systems manager", async () => {
    const row = claimed({ facts: { ...claimed().facts as Record<string, unknown>, submittedAt: minutesAgo(21) } });
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(row) }) });
    await runNotices(kit.deps);
    const r = lastResult(kit);
    expect(r.p_outcome).toBe("posted");
    const d = detailOf(r);
    expect(d.variant).toBe("late");
    expect(d.text).toBe(`Kickoff in, card not updated: Acme &amp; Sons &lt;Interiors&gt;. Open the card and check it. Ref ${ref(ID(1))}`);
    expect(blocksText(d)).toContain("The card has no Kickoff Handoff comment 20 minutes after the kickoff. Open the card and check it. Do not send the kickoff again. <@U0C5JHUCTPG> <@U0AS90SHMH8>");
    expect(blocksText(d)).not.toContain("U0B2SHGS1JA");
    expect(d.facts).toEqual({ commentCheck: "missing", handoffAt: null, filledByRole: "the CSM" });
  });

  test("unread comments: waits within 20 minutes, then posts the late notice with its own line", async () => {
    const early = claimed({ facts: { ...claimed().facts as Record<string, unknown>, submittedAt: minutesAgo(3) } });
    const k1 = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(early) }) });
    k1.clickup.fail = true;
    await runNotices(k1.deps);
    expect(lastResult(k1)).toMatchObject({ p_outcome: "requeue", p_error: WAITING });
    const k2 = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(claimed()) }) });
    k2.clickup.fail = true;
    await runNotices(k2.deps);
    const d = detailOf(lastResult(k2));
    expect(d.variant).toBe("late");
    expect(blocksText(d)).toContain("The cockpit could not read the card's comments 20 minutes after the kickoff.");
    expect((d.facts as Record<string, unknown>).commentCheck).toBe("unread");
    // The ClickUp failure is in the ledger as a response with its status.
    expect(k2.receipts.rows.some(r => r.provider === "clickup" && r.http_status === 500)).toBe(true);
  });

  test("a second kickoff adds the second line and tags the CSM once", async () => {
    const row = claimed({ facts: { ...claimed().facts as Record<string, unknown>, second: true, submittedAt: minutesAgo(22) } });
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(row) }) });
    await runNotices(kit.deps);
    const text = blocksText(detailOf(lastResult(kit)));
    expect(text).toContain("This is the second kickoff for this client. Do not send it a third time.");
    expect(text.match(/<@U0C5JHUCTPG>/g)).toHaveLength(1);
  });
});

describe("the bot check", () => {
  test("a wrong auth.test user requeues every claimed row for 5 minutes and posts nothing", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(claimed(), claimed({ id: ID(2), kind: "blueprint.media", target: MEDIA_GENERAL })) }) });
    kit.slack.authUser = "U0OTHERBOT1";
    const result = await runNotices(kit.deps);
    expect(result).toMatchObject({ ok: false, posted: 0, requeued: 2, note: WRONG_BOT });
    expect(kit.slack.posts()).toHaveLength(0);
    expect(kit.net.calls.filter(c => c.url.host === "api.clickup.com")).toHaveLength(0);
    expect(kit.rpc.results().map(r => [r.p_id, r.p_outcome, r.p_error, (r.p_detail as Record<string, unknown>).retryAfterSec])).toEqual([
      [ID(1), "requeue", WRONG_BOT, 300],
      [ID(2), "requeue", WRONG_BOT, 300],
    ]);
  });
  test("no token: every claimed row fails with the sentence, and Slack is never called", async () => {
    const kit = deps({ token: "", rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(claimed()), cockpit_slack_channel_pending: () => [{ id: "C0NEWCHAN01", name: "new" }] }) });
    const result = await runNotices(kit.deps);
    expect(result.failed).toBe(1);
    expect(lastResult(kit)).toMatchObject({ p_outcome: "failed", p_error: NO_TOKEN });
    expect(kit.net.calls).toHaveLength(0);
    expect(kit.rpc.calls.some(c => c.name === "cockpit_slack_channel_checked")).toBe(false);
  });
  test("no work, no Slack call at all", async () => {
    const kit = deps();
    expect(await runNotices(kit.deps)).toMatchObject({ ok: true, claimed: 0, posted: 0 });
    expect(kit.net.calls).toHaveLength(0);
    expect(kit.receipts.rows).toHaveLength(0);
  });
  test("a busy claim stops the run", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: () => ({ busy: true, rows: [] }) }) });
    expect(await runNotices(kit.deps)).toMatchObject({ busy: true, posted: 0 });
    expect(kit.slack.posts()).toHaveLength(0);
  });
});

describe("what Slack answers", () => {
  const blueprintRow = (over: Record<string, unknown> = {}) => claimed({
    kind: "blueprint.close",
    facts: { taskId: "task0001", client: "Acme Interiors", source: "cockpit", outboxId: ID(9), settled: "done", closedAt: minutesAgo(1), closedByRole: "the creative director", mapPhase: 4, service: "interior", launchTaskId: "launch01" },
    live: { clientStatus: "Brand Blueprint Booked", launchCallAt: null },
    mentions: { main: [CSM] },
    ...over,
  });
  const run = async (post: FakeSlack["post"], row = blueprintRow()) => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(row) }) });
    kit.slack.post = post;
    const result = await runNotices(kit.deps);
    return { kit, result, r: lastResult(kit) };
  };
  test("a rate limit is a counted retry after Slack's wait", async () => {
    const { r, result } = await run("ratelimited");
    expect(result.retried).toBe(1);
    expect(r).toMatchObject({ p_outcome: "retry", p_error: "Slack asked the cockpit to slow down (try 1 of 3).", p_detail: { retryAfterSec: 7 } });
  });
  test("a break after the request left is unknown, never sent again", async () => {
    for (const post of ["throw", "5xx", "unreadable"] as const) {
      const { r, kit } = await run(post);
      expect(r).toMatchObject({ p_outcome: "unknown", p_error: UNKNOWN });
      expect(kit.slack.posts()).toHaveLength(1);
      expect(kit.receipts.rows.find(x => x.resource === "slack.com/api/chat.postMessage" && x.phase !== "intent")!.phase).toBe("unknown");
    }
  });
  test("a receipt that could not be saved after the post is unknown; one that could not be saved before it is a retry with no post", async () => {
    const after = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(blueprintRow()) }) });
    after.receipts.failWhen(r => r.resource === "slack.com/api/chat.postMessage" && r.phase === "response");
    await runNotices(after.deps);
    expect(lastResult(after)).toMatchObject({ p_outcome: "unknown", p_error: UNKNOWN });
    expect(after.slack.posts()).toHaveLength(1);
    const before = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(blueprintRow()) }) });
    before.receipts.failWhen(r => r.resource === "slack.com/api/chat.postMessage" && r.phase === "intent");
    await runNotices(before.deps);
    expect(lastResult(before)).toMatchObject({ p_outcome: "retry", p_error: "The notices provider receipt could not be saved; no call was made without one." });
    expect(before.slack.posts()).toHaveLength(0);
  });
  test("a tag warning the ledger refuses is a retry before anything is posted", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(blueprintRow()) }) });
    kit.receipts.failWhen(r => r.resource === "notices/mentions");
    await runNotices(kit.deps);
    expect(lastResult(kit)).toMatchObject({ p_outcome: "retry", p_error: "The notices provider receipt could not be saved; no call was made without one." });
    expect(kit.slack.posts()).toHaveLength(0);
  });
  test("an answer for another channel, or without a ts, is unknown", async () => {
    const other = await run({ channel: MEDIA_GENERAL });
    expect(other.r).toMatchObject({ p_outcome: "unknown", p_error: `Slack answered for another channel (${MEDIA_GENERAL}). Look there first; it is not sent again.` });
    const noTs = await run("no-ts");
    expect(noTs.r.p_outcome).toBe("unknown");
  });
  test("a refusal is failed, in a sentence that names the channel", async () => {
    const { r } = await run({ refuse: "not_in_channel" });
    expect(r).toMatchObject({ p_outcome: "failed", p_error: "Slack refused it: mahara-club-bot is not in #csm-general. Invite it there, then ask the tech lead to requeue this notice." });
    expect((await run({ refuse: "is_archived" })).r.p_error).toBe("#csm-general is archived. Choose another channel in Settings, Notices and routing.");
    expect((await run({ refuse: "invalid_blocks" })).r.p_error).toBe("Slack refused the message's layout. The tech lead checks the notice text.");
    expect((await run({ refuse: "token_revoked" })).r.p_error).toBe("Slack refused the bot's token. The tech lead sets SLACK_BOT_TOKEN again.");
    expect((await run({ refuse: "something_new" })).r.p_error).toBe("Slack refused it (something_new).");
  });
  test("the Blueprint close posts its done variant with the three links", async () => {
    const { r } = await run("ok");
    const d = detailOf(r);
    expect(d.variant).toBe("done");
    expect(blocksText(d)).toContain("<@U0C5JHUCTPG> next: send the phase 5 WhatsApp from your comment on the card, then book the launch call.");
    expect(blocksText(d)).toContain("Read the Blueprint");
    expect(blocksText(d)).toContain("Launch call not booked yet.");
  });
  test("the media post to #media-general: new, and already live at map phase 5 or an Active card", async () => {
    const media = (facts: Record<string, unknown>, live: Record<string, unknown> = {}) =>
      blueprintRow({ kind: "blueprint.media", target: MEDIA_GENERAL, facts: { taskId: "task0001", client: "Acme Interiors", outboxId: ID(9), service: "interior", launchTaskId: "launch01", ...facts }, live: { clientStatus: "Brand Blueprint Booked", ...live }, mentions: { main: [] } });
    const fresh = await run("ok", media({ mapPhase: 4 }));
    expect(detailOf(fresh.r).variant).toBe("new");
    expect(fresh.kit.slack.posts()[0].body?.channel).toBe(MEDIA_GENERAL);
    expect(detailOf(fresh.r).text).toBe(`Brand Blueprint completed: Acme Interiors. Scripts and custom creative can start. Ref ${ref(ID(1))}`);
    expect(detailOf((await run("ok", media({ mapPhase: 6 }))).r).variant).toBe("live");
    const active = await run("ok", media({ mapPhase: null }, { clientStatus: " Active " }));
    expect(detailOf(active.r).variant).toBe("live");
    expect(blocksText(detailOf(active.r))).toContain("The client is already live; nothing new starts from this close.");
  });
  test("a reply posts in its parent's thread; without a posted parent it posts at the top", async () => {
    const reply = blueprintRow({ kind: "blueprint.offer", threadTs: "1792900100.000100", parentId: ID(7), facts: { taskId: "task0001", client: "Acme Interiors", outboxId: ID(9), offeredByRole: "the creative director", dnaComplete: false }, mentions: { main: [] } });
    const thread = await run("ok", reply);
    expect(thread.kit.slack.posts()[0].body?.thread_ts).toBe("1792900100.000100");
    expect(detailOf(thread.r)).toMatchObject({ variant: "thread", text: `Offer locked by the creative director. Brand DNA is still missing. Ref ${ref(ID(1))}` });
    const top = await run("ok", { ...reply, threadTs: null });
    expect(top.kit.slack.posts()[0].body?.thread_ts).toBeUndefined();
    expect(detailOf(top.r).variant).toBe("top");
  });
  test("a non-test notice without an ok channel fails without posting", async () => {
    const { r, kit } = await run("ok", blueprintRow({ target: null }));
    expect(r).toMatchObject({ p_outcome: "failed", p_error: "The channel for this notice is not ready (none). Choose one in Settings, Notices and routing." });
    expect(kit.slack.posts()).toHaveLength(0);
  });
});

describe("tags", () => {
  const withMentions = (main: Record<string, unknown>[]) => claimed({ mentions: { main, late: [], second: [] } });
  test("an unresolved tag is the role label in plain text, plus the warning row", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(withMentions([mention("seat:creative", "the creative director", null, { email: "creative.seat@example.test" })])) }) });
    kit.clickup.handoff("task0001", minutesAgo(23));
    await runNotices(kit.deps);
    const d = detailOf(lastResult(kit));
    expect(blocksText(d)).toContain("Next is the Brand Blueprint call. The creative director");
    expect(blocksText(d)).not.toContain("<@");
    expect(kit.receipts.rows.filter(r => r.resource === "notices/mentions")).toEqual([{ provider: "slack", method: "GET", resource: "notices/mentions", phase: "response", http_status: null, object_id: null, action_id: null, run_key: ID(1) }]);
    // The lookup was made, and the email never reached a receipt, the text or the result.
    expect(kit.net.calls.some(c => c.url.pathname === "/api/users.lookupByEmail")).toBe(true);
    expect(JSON.stringify([kit.receipts.rows, kit.rpc.calls])).not.toContain("creative.seat@example.test");
  });
  test("a seat without a cached Slack id is found by email and tagged", async () => {
    const slack = new FakeSlack();
    slack.users.set("creative.seat@example.test", "U0FOUNDBYML");
    const kit = deps({ slack, rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(withMentions([mention("seat:creative", "the creative director", null, { email: "creative.seat@example.test" })])) }) });
    kit.clickup.handoff("task0001", minutesAgo(23));
    await runNotices(kit.deps);
    expect(blocksText(detailOf(lastResult(kit)))).toContain("<@U0FOUNDBYML>");
    expect(kit.receipts.rows.find(r => r.resource === "notices/mentions")!.http_status).toBe(200);
  });
  test("a rule that found nobody is its label in plain text, plus the warning row", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_claim: claimOnce(withMentions([{ rule: "seat:creative", missing: true }])) }) });
    kit.clickup.handoff("task0001", minutesAgo(23));
    await runNotices(kit.deps);
    expect(blocksText(detailOf(lastResult(kit)))).toContain("Next is the Brand Blueprint call. The creative director");
    expect(kit.receipts.rows.find(r => r.resource === "notices/mentions")!.http_status).toBeNull();
  });
});

describe("the reconcile", () => {
  const unknownRow = (over: Record<string, unknown> = {}) => ({ id: ID(5), ref: ref(ID(5)), kind: "kickoff", target: CSM_GENERAL, channel: CSM_GENERAL, threadTs: null, oldest: "1792800000.000000", ...over });
  test("finds the Ref in the channel's history, paging, and records it as posted; never posts", async () => {
    const slack = new FakeSlack();
    for (let i = 0; i < 6; i++) slack.seed(CSM_GENERAL, `Something else ${i}`);
    const ts = slack.seed(CSM_GENERAL, `Kickoff complete: Acme Interiors. Next is the Brand Blueprint call. Ref ${ref(ID(5))}`, { ts: "1792900050.000300" });
    slack.seed(CSM_GENERAL, `A person quoting Ref ${ref(ID(5))}`, { bot: false, ts: "1792900060.000300" });
    for (let i = 0; i < 6; i++) slack.seed(CSM_GENERAL, `Later ${i}`, { ts: `179290007${i}.000300` });
    slack.historyPages = 4;
    const kit = deps({ slack, rpc: fakeRpc({ cockpit_slack_notice_unknowns: () => [unknownRow()] }) });
    const result = await runNotices(kit.deps);
    expect(result.reconciled).toBe(1);
    expect(kit.rpc.results()).toEqual([{ p_id: ID(5), p_outcome: "posted", p_ts: ts, p_channel: CSM_GENERAL, p_error: null, p_detail: { permalink: expect.stringContaining("slack.com/archives/") } }]);
    expect(kit.slack.posts()).toHaveLength(0);
    expect(kit.net.calls.filter(c => c.url.pathname === "/api/conversations.history").length).toBeGreaterThan(1);
  });
  test("finds a reply's Ref in its thread", async () => {
    const slack = new FakeSlack();
    const parent = slack.seed(CSM_GENERAL, `Kickoff in, card not updated: Acme Interiors. Ref ${ref(ID(4))}`, { ts: "1792900010.000100" });
    const reply = slack.seed(CSM_GENERAL, `Card updated at 14:40. Ref ${ref(ID(5))}`, { ts: "1792900020.000100", thread: parent });
    const kit = deps({ slack, rpc: fakeRpc({ cockpit_slack_notice_unknowns: () => [unknownRow({ kind: "kickoff.updated", threadTs: parent })] }) });
    await runNotices(kit.deps);
    expect(kit.rpc.results()[0]).toMatchObject({ p_outcome: "posted", p_ts: reply, p_channel: CSM_GENERAL });
    expect(kit.net.calls.some(c => c.url.pathname === "/api/conversations.replies")).toBe(true);
  });
  test("not found, a person's message only, or no channel to read: nothing is recorded and nothing is resent", async () => {
    const slack = new FakeSlack();
    slack.seed(CSM_GENERAL, `Someone pasted Ref ${ref(ID(5))}`, { bot: false });
    const kit = deps({ slack, rpc: fakeRpc({ cockpit_slack_notice_unknowns: () => [unknownRow(), unknownRow({ id: ID(6), ref: ref(ID(6)), channel: null, target: "U09305KE2KS" })] }) });
    await runNotices(kit.deps);
    expect(kit.rpc.results()).toEqual([]);
    expect(kit.slack.posts()).toHaveLength(0);
    expect(kit.net.calls.filter(c => c.url.pathname === "/api/conversations.history")).toHaveLength(1);
  });
});

describe("channel checks for new channels", () => {
  const check = async (setup: (s: FakeSlack) => void) => {
    const slack = new FakeSlack();
    setup(slack);
    const kit = deps({ slack, rpc: fakeRpc({ cockpit_slack_channel_pending: () => [{ id: "C0NEWCHAN01", name: "new-desk" }] }) });
    const result = await runNotices(kit.deps);
    return { result, checked: kit.rpc.calls.filter(c => c.name === "cockpit_slack_channel_checked").map(c => c.args) };
  };
  test("member, not a member, not found, a public channel the bot cannot read", async () => {
    const member = await check(s => s.channels.set("C0NEWCHAN01", { name: "new-desk", is_private: true, is_member: true }));
    expect(member.checked).toEqual([{ p_id: "C0NEWCHAN01", p_ok: true, p_name: "new-desk", p_private: true, p_note: "mahara-club-bot is in it." }]);
    expect(member.result.channels).toBe(1);
    const outside = await check(s => s.channels.set("C0NEWCHAN01", { name: "new-desk", is_private: true, is_member: false }));
    expect(outside.checked[0]).toMatchObject({ p_ok: false, p_note: "Invite @mahara-club-bot to #new-desk, then add it again." });
    const missing = await check(() => {});
    expect(missing.checked[0]).toMatchObject({ p_ok: false, p_note: "Slack shows no channel C0NEWCHAN01 to the bot. If it is private, invite @mahara-club-bot first, then add it again." });
    const open = await check(s => s.channels.set("C0NEWCHAN01", { name: "new-desk", is_private: false, is_member: true }));
    expect(open.checked[0]).toMatchObject({ p_ok: false, p_private: false, p_note: "The bot cannot read #new-desk, so its posts cannot be checked. Use a private channel, or add channels:history to the Slack app." });
  });
  test("without the read scope for conversations.info, a readable history counts as a member", async () => {
    const r = await check(s => {
      s.infoCode = "missing_scope";
      s.seed("C0NEWCHAN01", "hello");
    });
    expect(r.checked[0]).toMatchObject({ p_ok: true, p_note: "mahara-club-bot is in it." });
  });
  test("Slack not answering leaves the channel to be checked again", async () => {
    const r = await check(s => { s.infoCode = "ratelimited"; });
    expect(r.checked).toEqual([]);
  });
});

describe("the rehearsal", () => {
  const rehearsal = (over: Record<string, unknown> = {}) => claimed({
    kind: "rehearsal", taskId: null, clientName: null, target: "U0TESTER001",
    facts: { of: "kickoff", variant: null, sample: true, requestedBy: "cron" },
    live: {}, mentions: { main: [] }, rehearsal: { of: "kickoff", lookupEmail: null }, ...over,
  });
  const settings = { cockpit_slack_notice_doctor_inputs: () => ({ channels: [], settings: [{ kind: "kickoff", enabled: true, channel: CSM_GENERAL, mentions: [CREATIVE] }] }) };
  test("posts only to a person, records the D channel Slack returned, tags nobody and says who it would tag", async () => {
    const kit = deps({ rpc: fakeRpc({ ...settings, cockpit_slack_notice_claim: claimOnce(rehearsal()) }) });
    await runNotices(kit.deps);
    expect(kit.slack.posts()[0].body?.channel).toBe("U0TESTER001");
    const r = lastResult(kit);
    expect(r).toMatchObject({ p_outcome: "posted", p_channel: "D0TESTDM001" });
    const d = detailOf(r);
    expect(String(d.text)).toStartWith("[Rehearsal] Kickoff complete: Sample client.");
    expect(String(d.text)).toEndWith(`Ref ${ref(ID(1))}`);
    expect(blocksText(d)).toContain("This would tag the creative director.");
    expect(blocksText(d)).not.toContain("<@");
    expect(blocksText(d)).toContain("Links are left out of a test.");
    expect(kit.net.calls.some(c => c.url.host === "api.clickup.com")).toBe(false);
  });
  test("a test with no target is sent to the requester found by email, and stores that target", async () => {
    const slack = new FakeSlack();
    slack.users.set("editor.seat@example.test", "U0TESTER001");
    const kit = deps({ slack, rpc: fakeRpc({ ...settings, cockpit_slack_notice_claim: claimOnce(rehearsal({ target: null, rehearsal: { of: "kickoff", lookupEmail: "editor.seat@example.test" } })) }) });
    await runNotices(kit.deps);
    expect(lastResult(kit)).toMatchObject({ p_outcome: "posted", p_channel: "D0TESTDM001", p_detail: { target: "U0TESTER001" } });
  });
  test("nobody found by email: failed with the sentence; a channel target: failed; neither posts", async () => {
    const lost = deps({ rpc: fakeRpc({ ...settings, cockpit_slack_notice_claim: claimOnce(rehearsal({ target: null, rehearsal: { of: "kickoff", lookupEmail: "nobody@example.test" } })) }) });
    await runNotices(lost.deps);
    expect(lastResult(lost)).toMatchObject({ p_outcome: "failed", p_error: NO_SLACK_ID });
    const channel = deps({ rpc: fakeRpc({ ...settings, cockpit_slack_notice_claim: claimOnce(rehearsal({ target: CSM_GENERAL })) }) });
    await runNotices(channel.deps);
    expect(lastResult(channel)).toMatchObject({ p_outcome: "failed", p_error: "A test only goes to a person's direct messages." });
    expect([...lost.slack.posts(), ...channel.slack.posts()]).toHaveLength(0);
  });
  test("the rehearse job queues one test, posts it to the DM and finds it again by its Ref", async () => {
    const rpc = fakeRpc({
      ...settings,
      cockpit_slack_notice_rehearse_service: a => ({ id: ID(8), echo: a }),
      cockpit_slack_notice_claim: a => (a.p_only === ID(8) ? { busy: false, rows: [rehearsal({ id: ID(8), target: "U09305KE2KS", rehearsal: { of: "blueprint.close", lookupEmail: null }, facts: { of: "blueprint.close", sample: true, requestedBy: "cron" } })] } : { busy: false, rows: [] }),
    });
    const kit = deps({ rpc });
    const out = await runRehearse(kit.deps, { kind: "blueprint.close", to: null });
    expect(rpc.calls.find(c => c.name === "cockpit_slack_notice_rehearse_service")!.args).toEqual({ p_kind: "blueprint.close", p_target: "U09305KE2KS" });
    expect(rpc.calls.find(c => c.name === "cockpit_slack_notice_claim")!.args).toEqual({ p_limit: 1, p_only: ID(8) });
    expect(out).toMatchObject({ ok: true, id: ID(8), state: "posted", channel: "D0ALERTDM01", reconcileFound: true });
    expect(out.note).toBe(`Posted to the direct message and found again by its Ref ${ref(ID(8))}.`);
    expect(String(kit.slack.messages.get("D0ALERTDM01")![0].text)).toStartWith("[Rehearsal] Brand Blueprint complete: Sample client.");
  });
  test("the rehearse job with the wrong bot posts nothing and says why", async () => {
    const rpc = fakeRpc({ cockpit_slack_notice_rehearse_service: () => ({ id: ID(8) }), cockpit_slack_notice_claim: () => ({ busy: false, rows: [rehearsal({ id: ID(8) })] }) });
    const kit = deps({ rpc });
    kit.slack.authUser = "U0OTHERBOT1";
    const out = await runRehearse(kit.deps, { kind: "kickoff", to: "U0TESTER001" });
    expect(out).toMatchObject({ ok: false, reconcileFound: false, note: WRONG_BOT });
    expect(kit.slack.posts()).toHaveLength(0);
  });
});

describe("the dry run", () => {
  const inputs = (over: Record<string, unknown> = {}) => () => ({
    kind: "kickoff", taskId: "task0001", clientName: "Acme Interiors", ref: "CN-dryrun00",
    facts: { taskId: "task0001", client: "Acme Interiors", responseId: "resp00000001", submittedAt: minutesAgo(30), second: false },
    live: { clientStatus: "Brand Blueprint Booked", cardUpdatedAt: minutesAgo(28), blueprintLink: true, looksDone: true, filledByRole: null },
    target: CSM_GENERAL, threadTs: null, mentions: { main: [CREATIVE], late: [CSM, SYSTEMS], second: [CSM] }, ...over,
  });
  test("a kickoff from the mirror: one ClickUp read, the text, the tags; no notice row, no post", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_inputs: inputs() }) });
    kit.clickup.handoff("task0001", minutesAgo(27));
    const out = await runDryRun(kit.deps, { responseId: "resp00000001" });
    expect(kit.rpc.calls.find(c => c.name === "cockpit_slack_notice_inputs")!.args).toEqual({ p: { responseId: "resp00000001" } });
    expect(out).toMatchObject({ ok: true, kind: "kickoff", variant: "complete", target: CSM_GENERAL, threadTs: null, commentCheck: "found", tags: [{ label: "the creative director", tagged: true }] });
    expect(out.text).toBe("Kickoff complete: Acme Interiors. Next is the Brand Blueprint call. Ref CN-dryrun00");
    expect(JSON.stringify(out.blocks)).toContain("Filled in Typeform on");
    expect(kit.rpc.results()).toEqual([]);
    expect(kit.slack.posts()).toHaveLength(0);
    expect(kit.receipts.rows.map(r => r.run_key)).toEqual(["dry-run", "dry-run"]);
    expect(kit.receipts.rows.some(r => r.resource === "notices/mentions")).toBe(false);
  });
  test("given facts for a Blueprint close, with a chosen variant; a variant the kind has no wording for is refused", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_inputs: a => ({ ...inputs()(), kind: "blueprint.close", facts: (a.p as Record<string, unknown>).facts, live: { clientStatus: "Ready For Launch🚀", launchCallAt: null }, mentions: { main: [CSM] } }) }) });
    const out = await runDryRun(kit.deps, { kind: "blueprint.close", taskId: "86ex70t90", facts: { taskId: "86ex70t90", client: "Smmim studio", settled: "done", closedAt: minutesAgo(0), mapPhase: 4 }, variant: "reconcile" });
    expect(out).toMatchObject({ kind: "blueprint.close", variant: "reconcile", commentCheck: null });
    expect(out.text).toBe("Blueprint closed: Smmim studio. The card update needs a check. Ref CN-dryrun00");
    expect(kit.net.calls.some(c => c.url.host === "api.clickup.com")).toBe(false);
    await expect(runDryRun(kit.deps, { kind: "blueprint.close", taskId: "86ex70t90", facts: {}, variant: "complete" as never })).rejects.toBeInstanceOf(JobError);
  });
});

describe("the doctor", () => {
  const inputs = (settings: Record<string, unknown>[] = [{ kind: "kickoff", enabled: true, channel: CSM_GENERAL, mentions: [CREATIVE] }, { kind: "kickoff.late", enabled: true, channel: null, mentions: [CSM, SYSTEMS] }]) =>
    () => ({ channels: [{ id: CSM_GENERAL, name: "csm-general", private: true, state: "ok" }, { id: MEDIA_GENERAL, name: "media-general", private: true, state: "ok" }], settings });
  test("all in place: the right bot, both channels, every tag; the channels are recorded", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_doctor_inputs: inputs() }) });
    const d = await runDoctor(kit.deps);
    expect(d).toMatchObject({ ok: true, bot: { userId: BOT_USER, ok: true }, missingScopes: [], note: "Everything the notices need is in place." });
    expect(d.channels.map(c => [c.id, c.ok, c.member])).toEqual([[CSM_GENERAL, true, true], [MEDIA_GENERAL, true, true]]);
    expect(d.mentions).toEqual([
      { kind: "kickoff", rule: "seat:creative", people: [{ label: "the creative director", slack: "ok" }], ok: true },
      { kind: "kickoff.late", rule: "seat:csm", people: [{ label: "the CSM", slack: "ok" }], ok: true },
      { kind: "kickoff.late", rule: "seat:systems_manager", people: [{ label: "the systems manager", slack: "ok" }], ok: true },
    ]);
    expect(kit.rpc.calls.filter(c => c.name === "cockpit_slack_channel_checked").map(c => c.args.p_id)).toEqual([CSM_GENERAL, MEDIA_GENERAL]);
    expect(kit.receipts.rows.every(r => r.run_key === "doctor")).toBe(true);
    expect(kit.slack.posts()).toHaveLength(0);
  });
  test("refuses a wrong bot: checks no channel, looks nobody up, records nothing", async () => {
    const kit = deps({ rpc: fakeRpc({ cockpit_slack_notice_doctor_inputs: inputs() }) });
    kit.slack.authUser = "U0OTHERBOT1";
    const d = await runDoctor(kit.deps);
    expect(d.ok).toBe(false);
    expect(d.bot).toEqual({ userId: "U0OTHERBOT1", ok: false });
    expect(d.note).toContain("not mahara-club-bot");
    expect(d.channels.every(c => !c.ok && c.note === "Not checked: the token is not mahara-club-bot.")).toBe(true);
    expect(kit.rpc.calls.some(c => c.name === "cockpit_slack_channel_checked")).toBe(false);
    expect(kit.net.calls.map(c => c.url.pathname)).toEqual(["/api/auth.test"]);
  });
  test("a missing scope, a channel the bot is not in, a seat nobody holds, and a person Slack cannot find each fail it", async () => {
    const slack = new FakeSlack();
    slack.scopes = "chat:write,users:read.email";
    slack.channels.set(MEDIA_GENERAL, { name: "media-general", is_private: true, is_member: false });
    const kit = deps({ slack, rpc: fakeRpc({ cockpit_slack_notice_doctor_inputs: inputs([
      { kind: "kickoff", enabled: true, channel: CSM_GENERAL, mentions: [{ rule: "seat:creative", missing: true }] },
      { kind: "blueprint.close", enabled: true, channel: CSM_GENERAL, mentions: [mention("seat:csm", "the CSM", null, { email: "csm.seat@example.test" })] },
      { kind: "blueprint.media", enabled: false, channel: MEDIA_GENERAL, mentions: [{ rule: "seat:csm", missing: true }] },
    ]) }) });
    const d = await runDoctor(kit.deps);
    expect(d.ok).toBe(false);
    expect(d.missingScopes).toEqual(["groups:history"]);
    expect(d.channels.find(c => c.id === MEDIA_GENERAL)).toMatchObject({ ok: false, member: false, note: "Invite @mahara-club-bot to #media-general, then add it again." });
    expect(d.mentions).toEqual([
      { kind: "kickoff", rule: "seat:creative", people: [], ok: false },
      { kind: "blueprint.close", rule: "seat:csm", people: [{ label: "the CSM", slack: "not_found" }], ok: false },
      { kind: "blueprint.media", rule: "seat:csm", people: [], ok: true },
    ]);
    expect(d.note).toContain("The Slack app lacks groups:history.");
    expect(d.note).toContain("Nobody is in the seat the kickoff notice tags (seat:creative).");
    expect(JSON.stringify(d)).not.toContain("csm.seat@example.test");
  });
  test("no token: says so and checks nothing", async () => {
    const kit = deps({ token: "", rpc: fakeRpc({ cockpit_slack_notice_doctor_inputs: inputs() }) });
    const d = await runDoctor(kit.deps);
    expect(d).toMatchObject({ ok: false, bot: { userId: null, ok: false } });
    expect(d.note).toContain(NO_TOKEN);
    expect(d.secrets.SLACK_BOT_TOKEN).toBe(false);
    expect(kit.net.calls).toHaveLength(0);
  });
});

test("the clock the tests use is a Sunday afternoon in Kuwait", () => {
  expect(NOW.toISOString()).toBe("2026-10-25T11:30:00.000Z");
  expect(new FakeClickUp().comments.size).toBe(0);
  expect(receiptsRecorder().rows).toEqual([]);
});
