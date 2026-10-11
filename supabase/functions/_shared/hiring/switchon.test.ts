// Switching hiring on (2026-10-11): the first intake run is a dry run, a dry
// run can be asked for, nothing is filed twice, and a form another importer
// owns is left alone.
import { headhunt, headhunts } from "./actions.ts";
import { runJob } from "./context.ts";
import { cronDoor } from "./doors.ts";
import { alreadyFiled, type Answer, responseMarker, runIntake, transcript } from "./intake.ts";
import { buildMeta } from "./meta.ts";
import { ROLES } from "./spec.ts";
import { assert, ctxFor, ENV_BASE, FakeStore, fakeFetch, ghlReads, test } from "./testkit.ts";

const typeform = [
  ["GET", /api\.typeform\.com\/forms\/zo1Zm6u6$/, () => ({
    body: { fields: [{ ref: "n", title: "Full name" }, { ref: "e", title: "Email" }] },
  })],
  ["GET", /api\.typeform\.com\/forms\/zo1Zm6u6\/responses/, () => ({
    body: { items: [
      { token: "tok-new-1", submitted_at: "2026-10-09T08:15:00Z", answers: [
        { field: { ref: "n", type: "short_text" }, type: "text", text: "Sara Ali" },
        { field: { ref: "e", type: "email" }, type: "email", email: "sara@example.com" },
      ] },
    ] },
  })],
] as Parameters<typeof fakeFetch>[0];

/** GoHighLevel answering the live writes, with the contact's notes as given. */
const ghlWrites = (notes: unknown[] = [], cards: unknown[] = []) =>
  [
    ["POST", /\/contacts\/upsert$/, () => ({ body: { contact: { id: "c-9" } } })],
    ["GET", /\/contacts\/c-9\/notes$/, () => ({ body: { notes } })],
    ["POST", /\/contacts\/c-9\/notes$/, () => ({ body: {} })],
    ["GET", /\/opportunities\/search\?.*contact_id=c-9/, () => ({ body: { opportunities: cards } })],
    ["POST", /\/opportunities\/$/, () => ({ body: { opportunity: { id: "opp-9" } } })],
  ] as Parameters<typeof fakeFetch>[0];

const writes = (calls: { method: string; url: string }[]) =>
  calls.filter(c => c.method !== "GET" && c.url.includes("leadconnectorhq"));

/** Every role's board, so a whole intake run has somewhere to file. */
const allBoards = [
  ["GET", /\/opportunities\/pipelines\?/, () => ({
    body: {
      pipelines: ROLES.map(r => ({
        id: `p-${r.key}`,
        name: r.pipeline,
        stages: [{ id: `s-${r.key}-app`, name: "Application" }],
      })),
    },
  })],
] as Parameters<typeof fakeFetch>[0];

/** Only the media buyer form has responses; every other form reads empty. */
const otherForms = [
  ["GET", /api\.typeform\.com\/forms\/[A-Za-z0-9]+$/, () => ({ body: { fields: [] } })],
  ["GET", /api\.typeform\.com\/forms\/[A-Za-z0-9]+\/responses/, () => ({ body: { items: [] } })],
] as Parameters<typeof fakeFetch>[0];

test("the first intake run after the switch-on is a dry run even with HIRING_APPLY on", async () => {
  const store = new FakeStore();
  store.meta.set("intake:zo1Zm6u6", { seen: ["tok-seen"] });
  const { fetch, calls } = fakeFetch([...allBoards, ...ghlReads, ...typeform, ...ghlWrites(), ...otherForms]);
  const ctx = ctxFor(store, fetch, { HIRING_APPLY: "true" });

  const first = await runJob(ctx, "intake", "schedule");
  assert.equal(first.ok, true, first.note);
  assert.equal(first.dryRun, true);
  assert.equal(first.firstRun, true);
  assert.match(first.note, /^Dry run on purpose, the first intake run: 1 unseen/);
  const plan = (first.results as { planned: { submittedAt?: string }[] }[]).flatMap(r => r.planned);
  assert.deepEqual(plan.map(x => x.submittedAt), ["2026-10-09T08:15:00Z"], "the plan says when each was sent");
  assert.equal(writes(calls).length, 0, "nothing written to GoHighLevel");
  assert.equal(store.runs[0].apply, false, "the run row says it was a dry run");
  assert.deepEqual(store.meta.get("intake:zo1Zm6u6"), { seen: ["tok-seen"] }, "the cursor does not move");
  assert.equal(ctx.apply, true, "HIRING_APPLY is back on for whatever runs next");

  const second = await runJob(ctx, "intake", "schedule");
  assert.equal(second.ok, true, second.note);
  assert.equal(second.dryRun, false);
  assert.equal(second.added, 1);
  assert.equal(store.runs[1].apply, true);
  assert.ok(writes(calls).some(c => c.url.endsWith("/opportunities/")), "the second run files the card");
});

test("a failed first dry run keeps the next run dry too", async () => {
  const store = new FakeStore();
  const { fetch } = fakeFetch([
    ...ghlReads,
    ["GET", /api\.typeform\.com/, () => ({ status: 401, body: { code: "AUTH" } })],
  ]);
  const ctx = ctxFor(store, fetch, { HIRING_APPLY: "true" });
  const out = await runJob(ctx, "intake", "schedule");
  assert.equal(out.ok, false);
  assert.equal(await store.hasDryRun("intake"), false);
});

test("hiring-sync takes {job: intake, dryRun: true} as a dry run with HIRING_APPLY on", async () => {
  const store = new FakeStore();
  // A dry run already happened, so only the flag holds this one back.
  store.runs.push({ id: "run-0", job: "intake", apply: false, status: "ok" });
  const { fetch, calls } = fakeFetch([...allBoards, ...ghlReads, ...typeform, ...ghlWrites(), ...otherForms]);
  const env = (n: string) => ({ ...ENV_BASE, CRON_SECRET: "s", HIRING_APPLY: "true" } as Record<string, string>)[n];
  const res = await cronDoor(
    new Request("https://x", {
      method: "POST",
      headers: { "x-cron-secret": "s" },
      body: JSON.stringify({ job: "intake", dryRun: true }),
    }),
    { env, store, fetch, sleep: () => Promise.resolve(), now: () => new Date("2026-10-11T12:00:00Z") },
  );
  const out = await res.json();
  assert.equal(out.ok, true, out.note);
  assert.equal(out.dryRun, true);
  assert.match(out.note, /^Dry run, as asked/);
  assert.equal(writes(calls).length, 0);
});

test("a form another importer files live is left to it", async () => {
  const store = new FakeStore();
  store.liveForms.add("zo1Zm6u6");
  const { fetch, calls } = fakeFetch([...ghlReads, ...typeform, ...ghlWrites()]);
  const out = await runIntake(ctxFor(store, fetch, { HIRING_APPLY: "true" }), ["media-buyer"]);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.heldBy, ["zo1Zm6u6 (hiring-intake (PR #31))"]);
  assert.equal(out.read, 0);
  assert.ok(!calls.some(c => c.url.includes("typeform")), "its responses are not even read");
  assert.equal(writes(calls).length, 0);
});

test("a response the contact already holds gets no second note, and an existing card is kept", async () => {
  const store = new FakeStore();
  const note = { body: `Application, Media Buyer Application\n\nx\n\n${responseMarker("tok-new-1")}` };
  const { fetch, calls } = fakeFetch([...ghlReads, ...typeform, ...ghlWrites([note], [{ id: "opp-old" }])]);
  const out = await runIntake(ctxFor(store, fetch, { HIRING_APPLY: "true" }), ["media-buyer"]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.added, 0);
  assert.equal(out.skipped, 1);
  assert.equal(out.notesKept, 1);
  assert.ok(!calls.some(c => c.method === "POST" && c.url.endsWith("/notes")), "no second note");
  assert.ok(!calls.some(c => c.method === "POST" && c.url.endsWith("/opportunities/")), "no second card");
  assert.deepEqual((store.meta.get("intake:zo1Zm6u6") as { seen: string[] }).seen, ["tok-new-1"]);
});

test("a notes read that fails stops the application, so the next run tries it again", async () => {
  const store = new FakeStore();
  const { fetch, calls } = fakeFetch([
    ...ghlReads,
    ...typeform,
    ["POST", /\/contacts\/upsert$/, () => ({ body: { contact: { id: "c-9" } } })],
    ["GET", /\/contacts\/c-9\/notes$/, () => ({ status: 403, body: { message: "no" } })],
  ]);
  const out = await runIntake(ctxFor(store, fetch, { HIRING_APPLY: "true" }), ["media-buyer"]);
  assert.equal(out.ok, false);
  assert.ok(!calls.some(c => c.method === "POST" && c.url.endsWith("/opportunities/")));
  assert.deepEqual((store.meta.get("intake:zo1Zm6u6") as { seen: string[] }).seen, [], "still unseen");
});

test("a card search that fails files no card, so the next run tries it again", async () => {
  const store = new FakeStore();
  const { fetch, calls } = fakeFetch([
    ...ghlReads,
    ...typeform,
    ["POST", /\/contacts\/upsert$/, () => ({ body: { contact: { id: "c-9" } } })],
    ["GET", /\/contacts\/c-9\/notes$/, () => ({ body: { notes: [] } })],
    ["POST", /\/contacts\/c-9\/notes$/, () => ({ body: {} })],
    ["GET", /\/opportunities\/search\?/, () => ({ status: 422, body: { message: "bad search" } })],
    ["POST", /\/opportunities\/$/, () => ({ body: { opportunity: { id: "opp-9" } } })],
  ]);
  const out = await runIntake(ctxFor(store, fetch, { HIRING_APPLY: "true" }), ["media-buyer"]);
  assert.equal(out.ok, false);
  assert.equal(out.added, 0);
  assert.ok(!calls.some(c => c.method === "POST" && c.url.endsWith("/opportunities/")), "no card without the search");
  assert.deepEqual((store.meta.get("intake:zo1Zm6u6") as { seen: string[] }).seen, [], "still unseen");
});

const answers: Answer[] = [
  { ref: "n", title: "Your full name", type: "short_text", shape: "text", text: "Sara Ali" },
  { ref: "w", title: "Why this role", type: "long_text", shape: "text", text: "I ran GCC accounts for three years." },
];

test("alreadyFiled knows a response by its marker, and a Convex note by its words", () => {
  const whole = transcript(answers, "Media Buyer Application", "tok-1");
  assert.ok(whole.endsWith(responseMarker("tok-1")));
  assert.equal(alreadyFiled([{ body: `old\n\n${responseMarker("tok-1")}` }], "tok-1", whole), true);
  // Convex filed the same questionnaire with no marker, and spacing may differ.
  const convex = transcript(answers, "Media Buyer Application").replace(/\n\n/g, "\n");
  assert.equal(alreadyFiled([{ body: convex }], "tok-1", whole), true);
  // A second application with new answers is a new note.
  const other = transcript([{ ...answers[1], text: "Something else entirely, written later." }], "Media Buyer Application");
  assert.equal(alreadyFiled([{ body: other }], "tok-1", whole), false);
  assert.equal(alreadyFiled([], "tok-1", whole), false);
});

test("the one-to-one stage and score field match the old and the new names", () => {
  const stages = (name: string) => ({
    pipelines: [{ id: "p-mb", name: "Media buyer", stages: [{ id: "s-121", name }] }],
  });
  for (const name of ["One to one interview", "One-to-one interview"]) {
    const m = buildMeta("loc", stages(name).pipelines, [], 0);
    assert.equal(m.stageIdByKey["media-buyer"]["one-to-one"], "s-121", name);
  }
  for (const name of ["Score 4, one to one", "Score 4, one-to-one"]) {
    const m = buildMeta("loc", [], [{ id: "f-4", name }], 0);
    assert.equal(m.fields.scoreOneToOne, "f-4", name);
  }
});

test("headhunt queues one request per role, audited, and refuses a second while it waits", async () => {
  const store = new FakeStore();
  const { fetch } = fakeFetch([]);
  const ctx = ctxFor(store, fetch);
  const out = await headhunt(ctx, { role: "csm", note: "Arabic speakers in Kuwait" });
  assert.equal(out.request.status, "queued");
  assert.equal(out.request.by, "aziz@maharamedia.com");
  assert.deepEqual(store.meta.get("headhunt-request:csm"), out.request);
  assert.equal(store.audits.at(-1)!.action, "hiring.headhunt");
  await assert.rejects(headhunt(ctx, { role: "csm" }), /^Already asked at 15:00\. The agent answers within 5 minutes\.$/);
  await assert.rejects(headhunt(ctx, { role: "astronaut" }), /There is no role called astronaut/);
  assert.equal(store.audits.length, 1, "a refused ask leaves no audit of a change");
});

test("headhunt can be asked again once the request is answered, failed or stale", async () => {
  const store = new FakeStore();
  const { fetch } = fakeFetch([]);
  const ctx = ctxFor(store, fetch);
  for (const held of [
    { status: "done", requestedAt: "2026-10-09T11:00:00Z" },
    { status: "failed", requestedAt: "2026-10-09T11:59:00Z" },
    { status: "running", requestedAt: "2026-10-09T10:00:00Z", startedAt: "2026-10-09T11:00:00Z" },
  ]) {
    store.meta.set("headhunt-request:media-buyer", held);
    const out = await headhunt(ctx, { role: "media-buyer" });
    assert.equal(out.request.status, "queued", held.status);
  }
});

test("headhunts returns every role with its request and the agent's answer", async () => {
  const store = new FakeStore();
  store.meta.set("headhunt-request:csm", { status: "done", requestedAt: "2026-10-09T11:00:00Z" });
  store.meta.set("headhunt:csm", {
    at: "2026-10-09T11:04:00Z",
    model: "deepseek",
    searches: ["LinkedIn: client success Kuwait", ""],
    signals: "not a list",
    disqualifiers: ["No GCC clients"],
    opener: "Hi",
    followUp: "Still keen?",
  });
  const { fetch } = fakeFetch([]);
  const rows = await headhunts(ctxFor(store, fetch));
  assert.equal(rows.length, ROLES.length);
  const csm = rows.find(r => r.role === "csm")!;
  assert.equal(csm.request.status, "done");
  assert.deepEqual(csm.answer.searches, ["LinkedIn: client success Kuwait"]);
  assert.deepEqual(csm.answer.signals, []);
  assert.equal(rows.find(r => r.role === "media-buyer")!.answer, null);
});

test("every GoHighLevel call carries a browser-like agent, so Cloudflare does not refuse it (1010)", async () => {
  const store = new FakeStore();
  const { fetch, calls } = fakeFetch([...allBoards, ...ghlReads, ...typeform, ...ghlWrites(), ...otherForms]);
  await runIntake(ctxFor(store, fetch, { HIRING_APPLY: "true" }));
  const ghl = calls.filter(c => c.url.includes("leadconnectorhq"));
  assert.ok(ghl.length > 0);
  assert.ok(ghl.every(c => /^Mozilla\/5\.0/.test(String(c.headers?.["User-Agent"] ?? ""))), "User-Agent on every call");
});
