// Dedupe and merge: what the mirror keeps, and which moves the engine
// drafts for exactly once.
import { runJob } from "./context.ts";
import { DRAFT_PREFIX, pendingFrom } from "./engine.ts";
import { eventsFor, mergeCandidate, type Opp } from "./mirror.ts";
import { ROLES } from "./spec.ts";
import { assert, ctxFor, FakeStore, fakeFetch, ghlReads, held, test } from "./testkit.ts";

const role = ROLES.find(r => r.key === "media-buyer")!;
const NOW = "2026-10-09T12:00:00.000Z";
const opp: Opp = { id: "opp-1", contactId: "c-1", name: "Sara Ali", stageId: "s-app", createdAt: "2026-10-01T00:00:00Z", updatedAt: null };
const merge = (over: Partial<Parameters<typeof mergeCandidate>[0]>) =>
  mergeCandidate({ opp, role, location: "loc-1", pipelineId: "p-mb", stage: "application", contact: {}, prev: undefined, now: NOW, ...over });

test("a new card starts its clock now and says it was first seen", () => {
  const r = merge({});
  assert.equal(r.isNew, true);
  assert.equal(r.row.stage_since, NOW);
  assert.deepEqual(eventsFor(r, null).map(e => e.detail), ["First seen on the board."]);
});

test("an unchanged stage keeps its clock; a move resets it and is recorded", () => {
  const same = merge({ prev: held() });
  assert.equal(same.moved, false);
  assert.equal(same.row.stage_since, "2026-10-01T00:00:00.000Z");
  assert.deepEqual(eventsFor(same, "application"), []);
  const moved = merge({ prev: held(), stage: "loom" });
  assert.equal(moved.moved, true);
  assert.equal(moved.row.stage_since, NOW);
  const [e] = eventsFor(moved, "application");
  assert.equal(e.from_stage, "application");
  assert.equal(e.to_stage, "loom");
});

test("a contact that was not read keeps every human field the mirror holds", () => {
  const prev = held({ score_application: 8, notes: "2026-10-02, strong", bench_reason: "no seat" });
  const r = merge({ prev, contact: undefined });
  assert.equal(r.row.score_application, 8);
  assert.equal(r.row.notes, "2026-10-02, strong");
  assert.equal(r.row.bench_reason, "no seat");
  assert.equal(r.row.score_total, 8);
  assert.deepEqual(r.kept, [], "an unread contact is not drift");
});

test("an empty GoHighLevel field never wipes a score or a note; it is counted", () => {
  const prev = held({ score_application: 8, notes: "keep me" });
  const r = merge({ prev, contact: { scoreApplication: "", scoreLoom: "6" } });
  assert.equal(r.row.score_application, 8);
  assert.equal(r.row.score_loom, 6);
  assert.equal(r.row.notes, "keep me");
  assert.equal(r.row.score_total, 7);
  assert.deepEqual(r.kept.sort(), ["notes", "score_application"]);
});

test("a GoHighLevel value wins over the mirror's, and agent columns are never written", () => {
  const r = merge({ prev: held({ score_application: 8, agent_score: 9 }), contact: { scoreApplication: "5" } });
  assert.equal(r.row.score_application, 5);
  assert.ok(!Object.keys(r.row).some(k => k.startsWith("agent_")));
});

test("an exit keeps the day it happened", () => {
  const prev = held({ stage: "disqualified", exited_at: "2026-10-03T00:00:00.000Z" });
  assert.equal(merge({ prev, stage: "disqualified" }).row.exited_at, "2026-10-03T00:00:00.000Z");
  assert.equal(merge({ prev: held(), stage: "disqualified" }).row.exited_at, NOW);
  assert.equal(merge({ prev: held() }).row.exited_at, null);
});

test("pendingFrom drafts once per move, for real moves, where the candidate still is", () => {
  const moves = [
    { candidate_id: "a", role: "media-buyer", from_stage: "application", to_stage: "loom" },
    { candidate_id: "a", role: "media-buyer", from_stage: "application", to_stage: "loom" },
    { candidate_id: "b", role: "media-buyer", from_stage: null, to_stage: "loom" },
    { candidate_id: "c", role: "media-buyer", from_stage: "application", to_stage: "loom" },
    { candidate_id: "d", role: "media-buyer", from_stage: "loom", to_stage: "group" },
    { candidate_id: "e", role: "media-buyer", from_stage: "loom", to_stage: "hired" },
  ];
  const cands = [
    held({ id: "a", stage: "loom" }),
    held({ id: "b", stage: "loom" }),
    held({ id: "c", stage: "group" }),
    held({ id: "d", stage: "group" }),
    held({ id: "e", stage: "hired" }),
  ];
  const done = [{ candidate_id: "d", action: "group_invite" }];
  const p = pendingFrom(moves, done, cands);
  assert.deepEqual(p.map(x => `${x.candidateId}:${x.action}`), ["a:loom_request"]);
});

test("the engine writes drafts only, once, and stands down when GoHighLevel sends", async () => {
  const store = new FakeStore();
  store.cands.set("opp-1", held({ stage: "loom" }));
  store.events.push({ id: 1, candidate_id: "opp-1", role: "media-buyer", kind: "stage", from_stage: "application", to_stage: "loom", ok: true });
  const { fetch, calls } = fakeFetch(ghlReads);

  // Default settings: GoHighLevel is the sender.
  const stood = await runJob(ctxFor(store, fetch), "engine", "schedule");
  assert.equal(stood.ok, true);
  assert.equal(stood.drafted, 0);
  assert.equal(store.events.length, 1);

  store.meta.set("engine", { sender: "cockpit", armed: true });
  const first = await runJob(ctxFor(store, fetch, { HIRING_SEND_ENABLED: "true", HIRING_APPLY: "true" }), "engine", "schedule");
  assert.equal(first.drafted, 1);
  assert.equal(first.sent, 0);
  const draft = store.events.at(-1)!;
  assert.equal(draft.kind, "action");
  assert.equal(draft.ok, false);
  assert.ok(String(draft.detail).startsWith(DRAFT_PREFIX));

  const second = await runJob(ctxFor(store, fetch), "engine", "schedule");
  assert.equal(second.drafted, 0, "a draft counts as done");
  assert.equal(store.events.length, 2);
  assert.ok(!calls.some(c => c.url.includes("/conversations/messages")), "the schedule never sends");
  assert.ok(calls.every(c => c.method === "GET"), "the engine only reads GoHighLevel");
  assert.equal(store.state.get("hiring-sync:engine")?.ok, true);
});

test("a held run lock stops a second run of the same job", async () => {
  const store = new FakeStore();
  store.runs.push({ id: "run-x", job: "mirror", status: "running" });
  const { fetch, calls } = fakeFetch(ghlReads);
  const out = await runJob(ctxFor(store, fetch), "mirror", "schedule");
  assert.equal(out.ok, false);
  assert.equal(out.busy, true);
  assert.equal(calls.length, 0);
});

test("the mirror upserts, records moves and keeps what people wrote", async () => {
  const store = new FakeStore();
  store.cands.set("opp-1", held({ score_application: 8, notes: "keep" }));
  const { fetch, calls } = fakeFetch([
    ...ghlReads,
    ["GET", /\/contacts\/\?/, () => ({ body: { contacts: [{ id: "c-1", contactName: "Sara Ali", customFields: [{ id: "f-s2", value: "6" }] }] } })],
    ["GET", /\/opportunities\/search\?/, () => ({
      body: { opportunities: [
        { id: "opp-1", contact: { id: "c-1", name: "Sara Ali" }, pipelineStageId: "s-loom" },
        { id: "opp-2", contact: { id: "c-2", name: "Omar" }, pipelineStageId: "s-app" },
      ] },
    })],
  ]);
  const out = await runJob(ctxFor(store, fetch), "mirror", "schedule");
  assert.equal(out.ok, true, String(out.note));
  assert.equal(out.added, 1);
  assert.equal(out.moved, 1);
  const sara = store.cands.get("opp-1")!;
  assert.equal(sara.stage, "loom");
  assert.equal(sara.score_application, 8);
  assert.equal(sara.score_loom, 6);
  assert.equal(sara.notes, "keep");
  assert.equal(sara.score_total, 7);
  assert.deepEqual(store.events.map(e => e.detail).sort(), ["First seen on the board.", "Moved to Loom request."]);
  assert.ok(calls.every(c => c.method === "GET"), "the mirror never writes to GoHighLevel");
  assert.equal(store.state.get("hiring-sync:mirror")?.rows_seen, 2);
});
