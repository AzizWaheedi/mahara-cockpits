import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  pipelineBody,
  verifyPipeline,
  LOCATION_ID,
  PipelineError,
} from "../lib/pipeline.js";
import {
  desiredStage,
  syncPipelineCard,
  SALES_CALENDARS,
} from "../lib/pipeline-sync.js";
const e = {
  registration_status: "confirmed",
  attended: false,
  survey_completed: false,
  attendance_final: false,
};
test("only completed provider registration can create a card", () => {
  assert.equal(
    desiredStage({ ...e, registration_status: "processing", attended: true }),
    null,
  );
  assert.equal(desiredStage(e), "registered");
});
test("branches preserve independent facts: survey is not attendance, late attendance corrects missed", () => {
  assert.equal(
    desiredStage({ ...e, survey_completed: true }),
    "survey_completed",
  );
  assert.equal(
    desiredStage({ ...e, attendance_final: true }),
    "webinar_missed",
  );
  assert.equal(
    desiredStage({ ...e, attendance_final: true, attended: true }),
    "attended",
  );
});
test("current calls beat webinar stages; future rebooking beats a missed call", () => {
  const past = { appointmentStatus: "noshow", startTime: "2020-01-01" },
    future = { appointmentStatus: "confirmed", startTime: "2099-01-01" };
  assert.equal(desiredStage(e, [past]), "call_follow_up");
  assert.equal(desiredStage(e, [past, future]), "call_booked");
  assert.equal(
    desiredStage(e, [{ ...past, appointmentStatus: "showed" }, future]),
    "call_attended",
  );
  assert.equal(desiredStage(e, [past], [{ status: "won" }]), "client_won");
});
function fixtures() {
  const registration = randomUUID(),
    pipeline = {
      ...pipelineBody(),
      id: "p",
      stages: pipelineBody().stages.map((s, i) => ({ ...s, id: `s${i}` })),
    },
    mapping = verifyPipeline(pipeline);
  let remote = null,
    mutations = 0;
  const calls = [];
  const evidence = {
    ...e,
    registration_id: registration,
    event_key: "event",
    contact_id: "c",
    location_id: LOCATION_ID,
  };
  const card = {
    registration_id: registration,
    pipeline_id: "p",
    lease_token: randomUUID(),
    config: { pipeline_id: "p", stage_ids: mapping.stages },
  };
  const store = {
    read: async (path) =>
      path.startsWith("cockpit_webinar_pipeline_evidence") ? [evidence] : [],
    rpc: async (n, a) => {
      calls.push({ n, a });
      return n === "cockpit_claim_webinar_pipeline" ? card : null;
    },
  };
  const provider = {
    list: async () => [pipeline],
    contact: async () => ({ id: "c", locationId: LOCATION_ID }),
    opportunities: async () => (remote ? [remote] : []),
    opportunity: async () => remote,
    create: async (body) => {
      mutations++;
      remote = { ...body, id: "o" };
      return { opportunity: { id: "o" } };
    },
    move: async (id, stage) => {
      mutations++;
      remote.pipelineStageId = stage;
    },
  };
  return {
    registration,
    pipeline,
    mapping,
    evidence,
    card,
    calls,
    store,
    provider,
    get remote() {
      return remote;
    },
    set remote(r) {
      remote = r;
    },
    get mutations() {
      return mutations;
    },
  };
}
test("held worker makes no reads or writes", async () => {
  assert.deepEqual(await syncPipelineCard({}), { status: "held" });
});
test("first card persists intent before create and confirms exact readback with zero monetary value", async () => {
  const f = fixtures();
  f.provider.create = async (body) => {
    assert.equal(f.calls.at(-1).n, "cockpit_mark_webinar_pipeline_mutation");
    f.remote = { ...body, id: "o" };
    return { opportunity: { id: "o" } };
  };
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).status,
    "synced",
  );
  assert.equal(f.remote.monetaryValue, 0);
  assert.match(f.remote.name, new RegExp(f.registration));
  assert.equal(f.calls.at(-1).a.p_opportunity, "o");
});
test("an existing card for another occurrence cannot be reused", async () => {
  const f = fixtures();
  f.card.opportunity_id = "foreign";
  f.remote = {
    id: "foreign",
    name: "previous event",
    contactId: "c",
    locationId: LOCATION_ID,
    pipelineId: "p",
    status: "open",
    monetaryValue: 0,
  };
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).code,
    "opportunity_scope_mismatch",
  );
  assert.equal(f.mutations, 0);
});
test("lookup failure never becomes permission to create", async () => {
  const f = fixtures();
  f.provider.opportunities = async () => {
    throw new PipelineError("opportunity_lookup_incomplete");
  };
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).status,
    "blocked",
  );
  assert.equal(f.mutations, 0);
});
test("a lost create response is uncertain and never retried", async () => {
  const f = fixtures();
  let n = 0;
  f.provider.create = async () => {
    n++;
    throw Error("timeout");
  };
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).status,
    "uncertain",
  );
  assert.equal(n, 1);
  assert.equal(f.calls.at(-1).a.p_state, "uncertain");
});
test("manual stage changes hold; an already applied intended stage needs no repeat PUT", async () => {
  const f = fixtures();
  f.card.opportunity_id = "o";
  f.card.stage_key = "registered";
  f.evidence.attended = true;
  f.remote = {
    id: "o",
    name: `WEBBY | event | ${f.registration}`,
    contactId: "c",
    locationId: LOCATION_ID,
    pipelineId: "p",
    status: "open",
    monetaryValue: 0,
    pipelineStageId: "unknown",
  };
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).code,
    "opportunity_manually_changed",
  );
  f.remote.pipelineStageId = f.mapping.stages.attended;
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).status,
    "synced",
  );
  assert.equal(f.mutations, 0);
});
test("wrong-contact sales booking cannot advance the card", async () => {
  const f = fixtures();
  f.store.read = async (path) =>
    path.startsWith("cockpit_webinar_pipeline_evidence")
      ? [f.evidence]
      : [{ appointment_id: "a" }];
  f.provider.appointment = async () => ({
    id: "a",
    contactId: "other",
    locationId: LOCATION_ID,
    calendarId: SALES_CALENDARS[0],
    startTime: "2099-01-01",
    appointmentStatus: "confirmed",
  });
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).code,
    "sales_appointment_scope_mismatch",
  );
  assert.equal(f.mutations, 0);
});
