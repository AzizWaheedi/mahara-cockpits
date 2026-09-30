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
  SALES_PIPELINES,
  SALES_OUTCOME_STAGES,
  callNumber,
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
  const past = {
      callNumber: 1,
      appointmentStatus: "noshow",
      startTime: "2020-01-01",
    },
    future = {
      callNumber: 1,
      appointmentStatus: "confirmed",
      startTime: "2099-01-01",
    };
  assert.equal(desiredStage(e, [past]), "call_1_no_show");
  assert.equal(desiredStage(e, [past, future]), "call_booked");
  assert.equal(
    desiredStage(e, [{ ...past, appointmentStatus: "showed" }, future]),
    "call_booked",
  );
  assert.equal(desiredStage(e, [past], [{ status: "won" }]), "client_won");
});
test("each round has distinct showed, no-show, cancellation and booking outcomes", () => {
  for (const n of [1, 2]) {
    const call = { callNumber: n, startTime: "2020-01-01" };
    const prefix = n === 1 ? "call" : "call_2";
    assert.equal(
      desiredStage(e, [{ ...call, appointmentStatus: "showed" }]),
      `${prefix}_attended`,
    );
    assert.equal(
      desiredStage(e, [{ ...call, appointmentStatus: "noshow" }]),
      `call_${n}_no_show`,
    );
    for (const status of ["cancelled", "canceled"])
      assert.equal(
        desiredStage(e, [{ ...call, appointmentStatus: status }]),
        `call_${n}_cancelled`,
      );
    assert.equal(
      desiredStage(e, [
        { ...call, startTime: "2099-01-01", appointmentStatus: "new" },
      ]),
      `${prefix}_booked`,
    );
    assert.equal(
      desiredStage(e, [{ ...call, appointmentStatus: "confirmed" }]),
      "call_follow_up",
    );
  }
});
test("first-call attendance cannot hide second-call outcomes and second-call rebooking wins", () => {
  const first = {
    callNumber: 1,
    appointmentStatus: "showed",
    startTime: "2020-01-01",
  };
  for (const [status, expected] of [
    ["showed", "call_2_attended"],
    ["noshow", "call_2_no_show"],
    ["cancelled", "call_2_cancelled"],
  ]) {
    const second = {
      callNumber: 2,
      appointmentStatus: status,
      startTime: "2020-02-01",
    };
    assert.equal(desiredStage(e, [first, second]), expected);
    assert.equal(desiredStage(e, [second, first]), expected);
    assert.equal(
      desiredStage(e, [
        first,
        second,
        { ...second, startTime: "2099-01-01", appointmentStatus: "confirmed" },
      ]),
      "call_2_booked",
    );
  }
});
test("cancelled duplicates do not erase attendance; mixed unknown outcomes require follow-up", () => {
  const call = { callNumber: 2, startTime: "2020-01-01" };
  assert.equal(
    desiredStage(e, [
      { ...call, appointmentStatus: "cancelled" },
      { ...call, appointmentStatus: "showed" },
    ]),
    "call_2_attended",
  );
  assert.equal(
    desiredStage(e, [
      { ...call, appointmentStatus: "noshow" },
      { ...call, appointmentStatus: "cancelled" },
    ]),
    "call_follow_up",
  );
  assert.equal(
    desiredStage(e, [{ ...call, appointmentStatus: "invalid" }]),
    "call_follow_up",
  );
});
test("direct demos are call one; two-call demos require the exact bound sales pipeline", () => {
  assert.equal(callNumber({ calendarId: SALES_CALENDARS[0] }), 1);
  assert.equal(
    callNumber(
      { calendarId: SALES_CALENDARS[2] },
      { pipelineId: SALES_PIPELINES[0] },
    ),
    1,
  );
  assert.equal(
    callNumber(
      { calendarId: SALES_CALENDARS[3] },
      { pipelineId: SALES_PIPELINES[1] },
    ),
    2,
  );
  assert.throws(
    () => callNumber({ calendarId: SALES_CALENDARS[2] }),
    /sequence_unverified/,
  );
  assert.throws(
    () =>
      callNumber({ calendarId: "unknown" }, { pipelineId: SALES_PIPELINES[1] }),
    /sequence_unverified/,
  );
  assert.throws(
    () => desiredStage(e, [{ appointmentStatus: "showed" }]),
    /sequence_unverified/,
  );
});
test("explicit sales outcomes distinguish won, lost and disqualified without closing another active attempt", () => {
  for (const pipelineId of SALES_PIPELINES) {
    const map = SALES_OUTCOME_STAGES[pipelineId];
    assert.equal(
      desiredStage(
        e,
        [],
        [{ pipelineId, status: "open", pipelineStageId: map.closed }],
      ),
      "client_won",
    );
    assert.equal(
      desiredStage(
        e,
        [],
        [{ pipelineId, status: "lost", pipelineStageId: map.closed }],
      ),
      "closed_lost",
    );
    assert.equal(
      desiredStage(
        e,
        [],
        [{ pipelineId, status: "lost", pipelineStageId: map.disqualified }],
      ),
      "disqualified",
    );
    assert.equal(
      desiredStage(
        e,
        [],
        [{ pipelineId, status: "won", pipelineStageId: map.disqualified }],
      ),
      "client_won",
    );
  }
  for (const status of ["lost", "abandoned"])
    assert.equal(desiredStage(e, [], [{ status }]), "closed_lost");
  assert.equal(
    desiredStage(e, [], [{ status: "lost" }, { status: "open" }]),
    "registered",
  );
  assert.equal(
    desiredStage(e, [], [{ status: "lost" }, { status: "won" }]),
    "client_won",
  );
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
test("verified first and second appointment receipts move to the second-call no-show stage", async () => {
  const f = fixtures();
  f.store.read = async (path) =>
    path.startsWith("cockpit_webinar_pipeline_evidence")
      ? [f.evidence]
      : [
          { appointment_id: "intro" },
          { appointment_id: "demo", sales_opportunity_id: "sale" },
        ];
  f.provider.appointment = async (id) => ({
    id,
    contactId: "c",
    locationId: LOCATION_ID,
    calendarId: SALES_CALENDARS[id === "intro" ? 0 : 2],
    startTime: "2020-01-01",
    appointmentStatus: id === "intro" ? "showed" : "noshow",
  });
  f.provider.opportunity = async (id) =>
    id === "sale"
      ? {
          id,
          contactId: "c",
          locationId: LOCATION_ID,
          pipelineId: SALES_PIPELINES[1],
          status: "open",
        }
      : f.remote;
  assert.equal(
    (await syncPipelineCard({ ...f, enabled: true })).status,
    "synced",
  );
  assert.equal(f.remote.pipelineStageId, f.mapping.stages.call_2_no_show);
  assert.equal(f.remote.status, "open");
  assert.equal(f.remote.monetaryValue, 0);
});
test("an unbound demo sequence or wrong-contact sales deal blocks all writes", async () => {
  for (const sale of [
    null,
    {
      id: "sale",
      contactId: "other",
      locationId: LOCATION_ID,
      pipelineId: SALES_PIPELINES[1],
      status: "won",
    },
  ]) {
    const f = fixtures();
    f.store.read = async (path) =>
      path.startsWith("cockpit_webinar_pipeline_evidence")
        ? [f.evidence]
        : [
            {
              appointment_id: "demo",
              ...(sale ? { sales_opportunity_id: "sale" } : {}),
            },
          ];
    f.provider.appointment = async () => ({
      id: "demo",
      contactId: "c",
      locationId: LOCATION_ID,
      calendarId: SALES_CALENDARS[2],
      startTime: "2020-01-01",
      appointmentStatus: "showed",
    });
    f.provider.opportunity = async () => sale;
    const result = await syncPipelineCard({ ...f, enabled: true });
    assert.equal(result.status, "blocked");
    assert.equal(
      result.code,
      sale
        ? "sales_opportunity_scope_mismatch"
        : "sales_call_sequence_unverified",
    );
    assert.equal(f.mutations, 0);
  }
});
test("verified closed outcomes change only tracking stage and never invent money or appointment attendance", async () => {
  for (const [status, stage] of [
    ["won", "client_won"],
    ["lost", "closed_lost"],
  ]) {
    const f = fixtures();
    f.store.read = async (path) =>
      path.startsWith("cockpit_webinar_pipeline_evidence")
        ? [f.evidence]
        : [{ appointment_id: "demo", sales_opportunity_id: "sale" }];
    f.provider.appointment = async () => ({
      id: "demo",
      contactId: "c",
      locationId: LOCATION_ID,
      calendarId: SALES_CALENDARS[2],
      startTime: "2020-01-01",
      appointmentStatus: "cancelled",
    });
    f.provider.opportunity = async (id) =>
      id === "sale"
        ? {
            id,
            contactId: "c",
            locationId: LOCATION_ID,
            pipelineId: SALES_PIPELINES[0],
            status,
            monetaryValue: 25000,
          }
        : f.remote;
    assert.equal(
      (await syncPipelineCard({ ...f, enabled: true })).status,
      "synced",
    );
    assert.equal(f.remote.pipelineStageId, f.mapping.stages[stage]);
    assert.equal(f.remote.monetaryValue, 0);
    assert.equal(f.remote.status, "open");
  }
});
