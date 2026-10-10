// The gates: dry run (HIRING_APPLY), the send gate (HIRING_SEND_ENABLED),
// the CEO gate on hiring-api, and the cron secret on hiring-sync.
import { ActionError, grade, sendDraft, setEngine } from "./actions.ts";
import { summary } from "./context.ts";
import { runIntake } from "./intake.ts";
import { apiDoor, cronDoor } from "./doors.ts";
import { compose, draftText, TEMPLATES, varsFor } from "./engine.ts";
import { GateError, ghlClient } from "./providers.ts";
import { roleByKey } from "./spec.ts";
import { assert, ctxFor, ENV_BASE, FakeStore, fakeFetch, ghlReads, held, test } from "./testkit.ts";

const okHealth = () => Promise.resolve();

test("a GoHighLevel write is blocked in a dry run before any call is made", async () => {
  const { fetch, calls } = fakeFetch([]);
  const rows: unknown[] = [];
  const ghl = ghlClient({ token: "pit-x", location: "l", apply: false, sendEnabled: true, fetch, health: r => {
    rows.push(r);
    return Promise.resolve();
  } });
  await assert.rejects(ghl.write("PUT", "/contacts/c", {}), GateError);
  assert.equal(calls.length, 0);
  assert.deepEqual(rows, [{ provider: "gohighlevel", method: "PUT", resource: "/contacts/c", phase: "blocked" }]);
});

test("a send is blocked unless HIRING_SEND_ENABLED, and a server error is never retried", async () => {
  const { fetch, calls } = fakeFetch([["POST", /conversations\/messages/, () => ({ status: 500, body: {} })]]);
  const off = ghlClient({ token: "t", location: "l", apply: true, sendEnabled: false, fetch, health: okHealth, sleep: okHealth });
  await assert.rejects(off.send("SMS", "c", { message: "hi" }), GateError);
  assert.equal(calls.length, 0);
  const on = ghlClient({ token: "t", location: "l", apply: false, sendEnabled: true, fetch, health: okHealth, sleep: okHealth });
  await assert.rejects(on.send("SMS", "c", { message: "hi" }), /answered 500/);
  assert.equal(calls.length, 1, "one attempt only: the message may already have gone");
});

test("a read retries a server error", async () => {
  let n = 0;
  const { fetch, calls } = fakeFetch([["GET", /x/, () => (++n < 3 ? { status: 502 } : { body: { ok: 1 } })]]);
  const ghl = ghlClient({ token: "t", location: "l", apply: false, sendEnabled: false, fetch, health: okHealth, sleep: okHealth });
  assert.deepEqual(await ghl.readOk("/x"), { ok: 1 });
  assert.equal(calls.length, 3);
});

const typeformRoutes = [
  ["GET", /api\.typeform\.com\/forms\/zo1Zm6u6$/, () => ({
    body: { fields: [{ ref: "n", title: "Full name" }, { ref: "e", title: "Email" }] },
  })],
  ["GET", /api\.typeform\.com\/forms\/zo1Zm6u6\/responses/, () => ({
    body: { items: [
      { token: "tok-new-1", answers: [
        { field: { ref: "n", type: "short_text" }, type: "text", text: "Sara Ali" },
        { field: { ref: "e", type: "email" }, type: "email", email: "sara@example.com" },
      ] },
      { token: "tok-seen", answers: [] },
    ] },
  })],
] as Parameters<typeof fakeFetch>[0];

test("intake in a dry run reads, plans, and writes nothing anywhere", async () => {
  const store = new FakeStore();
  store.meta.set("intake:zo1Zm6u6", { seen: ["tok-seen"] });
  const { fetch, calls } = fakeFetch([...ghlReads, ...typeformRoutes]);
  const out = await runIntake(ctxFor(store, fetch), ["media-buyer"]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.dryRun, true);
  assert.equal(out.read, 1);
  assert.equal(out.added, 0);
  const mb = out.results.find(r => r.role === "media-buyer")!;
  assert.equal(mb.planned.length, 1);
  assert.equal(mb.planned[0].hasEmail, true);
  assert.ok(calls.every(c => c.method === "GET"), "no GoHighLevel write");
  assert.deepEqual(store.meta.get("intake:zo1Zm6u6"), { seen: ["tok-seen"] }, "the cursor does not move");
  assert.equal(store.applications.length, 0);
  assert.ok(summary("intake", out).startsWith("Dry run"));
});

test("intake with HIRING_APPLY files the contact, the note and the card, then moves the cursor", async () => {
  const store = new FakeStore();
  store.meta.set("intake:zo1Zm6u6", { seen: ["tok-seen"] });
  const { fetch, calls } = fakeFetch([
    ...ghlReads,
    ...typeformRoutes,
    ["POST", /\/contacts\/upsert$/, () => ({ body: { contact: { id: "c-9" } } })],
    ["POST", /\/contacts\/c-9\/notes$/, () => ({ body: {} })],
    ["GET", /\/opportunities\/search\?.*contact_id=c-9/, () => ({ body: { opportunities: [] } })],
    ["POST", /\/opportunities\/$/, () => ({ body: { opportunity: { id: "opp-9" } } })],
  ]);
  const out = await runIntake(ctxFor(store, fetch, { HIRING_APPLY: "true" }), ["media-buyer"]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.added, 1);
  const upsert = calls.find(c => c.url.endsWith("/contacts/upsert"))!;
  assert.equal((upsert.body as { email: string }).email, "sara@example.com");
  assert.ok(calls.some(c => c.method === "POST" && c.url.endsWith("/opportunities/")));
  assert.deepEqual((store.meta.get("intake:zo1Zm6u6") as { seen: string[] }).seen, ["tok-seen", "tok-new-1"]);
  assert.equal(store.applications[0].contact_id, "c-9");
  assert.ok(!calls.some(c => c.url.includes("/conversations/")), "intake never messages anyone");
});

test("a dry-run grade returns its plan, audits it, and changes nothing", async () => {
  const store = new FakeStore();
  store.cands.set("opp-1", held());
  const { fetch, calls } = fakeFetch(ghlReads);
  const ctx = ctxFor(store, fetch);
  const out = await grade(ctx, { candidateId: "opp-1", stage: "application", score: 7, moveTo: "loom" }) as { dryRun: boolean; message: string };
  assert.equal(out.dryRun, true);
  assert.match(out.message, /^Dry run: .*Application to 7 out of 10 and move them to Loom request\.$/);
  assert.ok(!out.message.includes("\n"));
  assert.ok(calls.every(c => c.method === "GET"));
  assert.equal(store.events.length, 0);
  assert.equal(store.cands.get("opp-1")!.score_application, null);
  assert.equal(store.audits.length, 1);
  assert.equal(store.audits[0].action, "hiring.grade");
  assert.equal(store.audits[0].metadata?.dryRun, true);
});

test("a live grade writes the contact and the card, the history and the mirror", async () => {
  const store = new FakeStore();
  store.cands.set("opp-1", held({ score_loom: 9 }));
  const { fetch, calls } = fakeFetch([
    ...ghlReads,
    ["PUT", /\/contacts\/c-1$/, () => ({ body: {} })],
    ["PUT", /\/opportunities\/opp-1$/, () => ({ body: {} })],
  ]);
  const out = await grade(ctxFor(store, fetch, { HIRING_APPLY: "true" }), {
    candidateId: "opp-1", stage: "application", score: 7, note: "clear writer", moveTo: "loom",
  }) as { total: number; moved: string };
  assert.equal(out.total, 8);
  assert.equal(out.moved, "Loom request");
  const put = calls.find(c => c.url.endsWith("/contacts/c-1"))!;
  assert.deepEqual((put.body as { customFields: { id: string }[] }).customFields.map(f => f.id).sort(), ["f-notes", "f-s1", "f-total"]);
  assert.deepEqual((calls.find(c => c.url.endsWith("/opportunities/opp-1"))!.body), { pipelineStageId: "s-loom" });
  const c = store.cands.get("opp-1")!;
  assert.equal(c.stage, "loom");
  assert.ok(String(c.notes).includes("Application, 7/10 by aziz@maharamedia.com: clear writer"));
  assert.deepEqual(store.events.map(e => e.kind), ["score", "stage"]);
  // A move made by the CEO is a real move, so the engine will draft for it.
  assert.equal(store.events[1].from_stage, "application");
});

function draftStore(sender: "cockpit" | "gohighlevel" = "cockpit") {
  const store = new FakeStore();
  store.cands.set("opp-1", held({ stage: "loom" }));
  store.meta.set("engine", { sender });
  const msg = compose(TEMPLATES.loom_request, varsFor(roleByKey("media-buyer")!, "Sara Ali", new Map()));
  store.events.push({
    id: 1, candidate_id: "opp-1", role: "media-buyer", kind: "action", action: "loom_request",
    to_stage: "loom", ok: false, detail: draftText("the engine is disarmed", msg),
  });
  return store;
}
const sendRoutes = (status = 200) =>
  fakeFetch([["POST", /\/conversations\/messages$/, () => ({ status, body: {} })]]);

test("sendDraft refuses without HIRING_SEND_ENABLED and records the attempt", async () => {
  const store = draftStore();
  const { fetch, calls } = sendRoutes();
  await assert.rejects(
    sendDraft(ctxFor(store, fetch, { HIRING_APPLY: "true" }), { eventId: 1 }),
    (e: ActionError) => /HIRING_SEND_ENABLED/.test(e.message) && e.status === 409,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(store.sends.map(s => s.status), ["refused"]);
  assert.equal(store.audits[0].action, "hiring.sendDraft.refused");
  assert.equal(store.events[0].ok, false);
});

test("sendDraft refuses when GoHighLevel is the sender, even with sending on", async () => {
  const store = draftStore("gohighlevel");
  const { fetch, calls } = sendRoutes();
  await assert.rejects(sendDraft(ctxFor(store, fetch, { HIRING_SEND_ENABLED: "true" }), { eventId: 1 }), /GoHighLevel is the sender/);
  assert.equal(calls.length, 0);
});

test("sendDraft sends once on email and SMS when the CEO presses Send and sending is on", async () => {
  const store = draftStore();
  const { fetch, calls } = sendRoutes();
  const ctx = ctxFor(store, fetch, { HIRING_SEND_ENABLED: "true" });
  const out = await sendDraft(ctx, { eventId: 1 });
  assert.deepEqual(out.sentOn, ["email", "SMS"]);
  assert.deepEqual(calls.map(c => (c.body as { type: string }).type), ["Email", "SMS"]);
  assert.equal(store.events[0].ok, true);
  assert.ok(String(store.events[0].detail).startsWith("Sent by aziz@maharamedia.com on email and SMS."));
  assert.deepEqual(store.sends.map(s => s.status), ["sent"]);
  assert.equal(store.audits.at(-1)!.action, "hiring.sendDraft");
  // A second press finds the message sent and sends nothing.
  await assert.rejects(sendDraft(ctx, { eventId: 1 }), /already sent/);
  assert.equal(calls.length, 2);
});

test("sendDraft refuses a draft another send already holds", async () => {
  const store = draftStore();
  store.sendConflict = true;
  const { fetch, calls } = sendRoutes();
  await assert.rejects(sendDraft(ctxFor(store, fetch, { HIRING_SEND_ENABLED: "true" }), { eventId: 1 }), /already being sent/);
  assert.equal(calls.length, 0);
});

test("sendDraft sends nothing when the audit row cannot be written", async () => {
  const store = draftStore();
  store.failAudit = true;
  const { fetch, calls } = sendRoutes();
  await assert.rejects(sendDraft(ctxFor(store, fetch, { HIRING_SEND_ENABLED: "true" }), { eventId: 1 }));
  assert.equal(calls.length, 0);
});

test("setEngine stores a switch with its audit row and refuses to arm", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store, fakeFetch([]).fetch);
  await assert.rejects(setEngine(ctx, { armed: true }), /cannot be armed/);
  const next = await setEngine(ctx, { action: "offer", on: true });
  assert.equal((next.actions as Record<string, boolean>).offer, true);
  assert.equal((store.meta.get("engine") as { actions: Record<string, boolean> }).actions.offer, true);
  assert.equal(store.audits[0].action, "hiring.setEngine");
});

// --- The doors ---------------------------------------------------------------

const API_ENV: Record<string, string> = {
  ...ENV_BASE,
  SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  SUPABASE_ANON_KEY: "anon",
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://x/functions/v1/hiring-api", { method: "POST", headers, body: JSON.stringify(body) });

function authFetch(isCeo: boolean) {
  return fakeFetch([
    ["GET", /\/auth\/v1\/user$/, () => ({ body: { email: isCeo ? "Aziz@maharamedia.com" : "csm@maharamedia.com" } })],
    ["POST", /\/rest\/v1\/rpc\/cockpit_is_ceo$/, () => ({ body: isCeo })],
  ]);
}

test("hiring-api refuses a caller with no token", async () => {
  const store = new FakeStore();
  const res = await apiDoor(post({ operation: "drafts" }), { env: n => API_ENV[n], store, fetch: authFetch(true).fetch });
  assert.equal(res.status, 401);
});

test("hiring-api refuses a signed-in seat that is not the CEO, before any work", async () => {
  const store = draftStore();
  const { fetch, calls } = authFetch(false);
  const res = await apiDoor(post({ operation: "sendDraft", args: { eventId: 1 } }, { Authorization: "Bearer user-jwt" }), {
    env: n => ({ ...API_ENV, HIRING_SEND_ENABLED: "true" })[n], store, fetch,
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "The hiring tab is the CEO's only.");
  assert.equal(store.sends.length, 0);
  assert.equal(store.audits.length, 0);
  assert.ok(!calls.some(c => c.url.includes("leadconnectorhq")));
  // The founder check runs with the caller's own token.
  assert.equal(
    (calls.find(c => c.url.endsWith("/rpc/cockpit_is_ceo"))!).method,
    "POST",
  );
});

test("hiring-api runs an operation for the CEO and turns a dry run into a message", async () => {
  const store = draftStore();
  store.cands.set("opp-1", held());
  const { fetch } = fakeFetch([
    ["GET", /\/auth\/v1\/user$/, () => ({ body: { email: "aziz@maharamedia.com" } })],
    ["POST", /\/rpc\/cockpit_is_ceo$/, () => ({ body: true })],
    ...ghlReads,
  ]);
  const deps = { env: (n: string) => API_ENV[n], store, fetch };
  const list = await apiDoor(post({ operation: "drafts" }, { Authorization: "Bearer jwt" }), deps);
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.result.length, 1);
  assert.deepEqual(Object.keys(body.result[0]).sort(), ["action", "at", "candidateId", "id", "name", "role", "stage", "text"]);
  const dry = await apiDoor(post({ operation: "grade", args: { candidateId: "opp-1", stage: "loom", score: 6 } }, { Authorization: "Bearer jwt" }), deps);
  const d = await dry.json();
  assert.equal(d.dryRun, true);
  assert.match(d.message, /^Dry run/);
  assert.equal(store.audits.at(-1)!.actor_email, "aziz@maharamedia.com");
  const bad = await apiDoor(post({ operation: "deleteEverything" }, { Authorization: "Bearer jwt" }), deps);
  assert.equal(bad.status, 400);
});

test("hiring-sync opens only for the cron secret, and doctor names keys without values", async () => {
  const env = (n: string) => ({ ...ENV_BASE, CRON_SECRET: "s3cret" })[n];
  const req = (secret: string, job: string) =>
    new Request("https://x", { method: "POST", headers: { "x-cron-secret": secret }, body: JSON.stringify({ job }) });
  assert.equal((await cronDoor(req("wrong", "mirror"), { env, store: new FakeStore() })).status, 401);
  const doc = await (await cronDoor(req("s3cret", "doctor"), { env, store: new FakeStore() })).json();
  assert.equal(doc.keys.GHL_HIRING_PIT, true);
  assert.equal(doc.apply, false);
  assert.ok(!JSON.stringify(doc).includes("pit-0000"), "no secret value leaves");
});

test("a missing hiring key stops a job with a sentence, never a zero", async () => {
  const store = new FakeStore();
  const env = (n: string) => ({ CRON_SECRET: "s", TYPEFORM_TOKEN: "t" } as Record<string, string>)[n];
  const res = await cronDoor(
    new Request("https://x", { method: "POST", headers: { "x-cron-secret": "s" }, body: JSON.stringify({ job: "mirror" }) }),
    { env, store },
  );
  const out = await res.json();
  assert.equal(out.ok, false);
  assert.match(out.note, /GHL_HIRING_PIT and GHL_HIRING_LOCATION/);
  assert.equal(store.state.get("hiring-sync:mirror")?.rows_seen, null);
  assert.equal(store.runs.length, 0);
});
