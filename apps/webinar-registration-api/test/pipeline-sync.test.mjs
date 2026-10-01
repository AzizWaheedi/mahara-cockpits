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
  assert.equal(desiredStage({ ...e, survey_completed: true }), "registered");
  assert.equal(
    desiredStage({ ...e, attendance_final: true }),
    "webinar_missed",
  );
  assert.equal(
    desiredStage({ ...e, attendance_final: true, attended: true }),
    "attended",
  );
});
const pastCall = {
  id: "a",
  sales_opportunity_id: "sale",
  startTime: "2020-01-01",
};
const showedCall = { ...pastCall, appointmentStatus: "showed" };
test("qualified not booked loses priority to booking and call outcomes", () => {
  for (const status of ["noshow", "cancelled", "showed"]) {
    const past = { ...pastCall, appointmentStatus: status };
    const future = {
      ...pastCall,
      id: "replacement",
      appointmentStatus: "confirmed",
      startTime: "2099-01-01",
    };
    assert.equal(
      desiredStage({ ...e, qualification_status: "qualified" }, [past, future]),
      "call_booked",
    );
  }
  assert.equal(
    desiredStage({ ...e, qualification_status: "qualified" }, [showedCall]),
    "call_attended",
  );
});
test("one sales call has distinct booking, attendance, no-show and cancellation outcomes", () => {
  for (const [status, expected] of [
    ["showed", "call_attended"],
    ["noshow", "call_no_show"],
    ["cancelled", "call_cancelled"],
    ["canceled", "call_cancelled"],
    ["confirmed", "call_follow_up"],
    ["invalid", "call_follow_up"],
  ]) {
    assert.equal(
      desiredStage(e, [{ ...pastCall, appointmentStatus: status }]),
      expected,
    );
  }
  assert.equal(
    desiredStage(e, [
      { ...pastCall, startTime: "2099-01-01", appointmentStatus: "new" },
    ]),
    "call_booked",
  );
});
test("cancelled duplicates do not erase attendance; mixed unknown outcomes require follow-up", () => {
  assert.equal(
    desiredStage(e, [
      showedCall,
      { ...pastCall, appointmentStatus: "cancelled" },
    ]),
    "call_attended",
  );
  assert.equal(
    desiredStage(e, [
      { ...pastCall, appointmentStatus: "noshow" },
      { ...pastCall, appointmentStatus: "cancelled" },
    ]),
    "call_follow_up",
  );
});
test("Showed Won/Lost require attendance for the same bound sales opportunity", () => {
  for (const pipelineId of SALES_PIPELINES) {
    const map = SALES_OUTCOME_STAGES[pipelineId];
    for (const [status, pipelineStageId, expected] of [
      ["open", map.closed, "client_won"],
      ["lost", map.closed, "closed_lost"],
      ["lost", map.disqualified, "disqualified"],
      ["won", map.disqualified, "client_won"],
    ]) {
      assert.equal(
        desiredStage(
          e,
          [showedCall],
          [{ id: "sale", pipelineId, status, pipelineStageId }],
        ),
        expected,
      );
    }
  }
  for (const status of ["won", "lost", "abandoned"]) {
    const sale = { id: "sale", status };
    assert.equal(desiredStage(e, [], [sale]), "call_follow_up");
    assert.equal(
      desiredStage(
        e,
        [{ ...showedCall, sales_opportunity_id: "other" }],
        [sale],
      ),
      "call_attended",
    );
    assert.equal(desiredStage(e, [showedCall], [{ status }]), "call_attended");
    assert.equal(
      desiredStage(e, [{ ...pastCall, appointmentStatus: "noshow" }], [sale]),
      "call_no_show",
    );
    assert.equal(
      desiredStage(
        e,
        [{ ...pastCall, appointmentStatus: "cancelled" }],
        [sale],
      ),
      "call_cancelled",
    );
    assert.equal(
      desiredStage({ ...e, attended: true }, [], [sale]),
      "call_follow_up",
    );
  }
});
test("a lost attempt cannot close another active attempt and a won attended deal stays won", () => {
  assert.equal(
    desiredStage(
      e,
      [showedCall],
      [
        { id: "sale", status: "lost" },
        { id: "active", status: "open" },
      ],
    ),
    "call_attended",
  );
  assert.equal(
    desiredStage(
      e,
      [showedCall],
      [
        { id: "sale", status: "won" },
        { id: "other", status: "lost" },
      ],
    ),
    "client_won",
  );
  const map = SALES_OUTCOME_STAGES[SALES_PIPELINES[0]];
  assert.equal(
    desiredStage(
      e,
      [],
      [
        {
          id: "sale",
          status: "lost",
          pipelineId: SALES_PIPELINES[0],
          pipelineStageId: map.disqualified,
        },
      ],
    ),
    "disqualified",
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
test("each supported calendar projects the same single-call outcome", async () => {
  for (const calendarId of SALES_CALENDARS) {
    const f = fixtures();
    f.store.read = async (path) =>
      path.startsWith("cockpit_webinar_pipeline_evidence")
        ? [f.evidence]
        : [{ appointment_id: "call" }];
    f.provider.appointment = async () => ({
      id: "call",
      contactId: "c",
      locationId: LOCATION_ID,
      calendarId,
      startTime: "2020-01-01",
      appointmentStatus: "noshow",
    });
    assert.equal(
      (await syncPipelineCard({ ...f, enabled: true })).status,
      "synced",
    );
    assert.equal(f.remote.pipelineStageId, f.mapping.stages.call_no_show);
    assert.equal(f.remote.status, "open");
    assert.equal(f.remote.monetaryValue, 0);
  }
});
test("wrong-contact sales opportunity blocks all writes", async () => {
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
    appointmentStatus: "showed",
  });
  f.provider.opportunity = async () => ({
    id: "sale",
    contactId: "other",
    locationId: LOCATION_ID,
    pipelineId: SALES_PIPELINES[1],
    status: "won",
  });
  const result = await syncPipelineCard({ ...f, enabled: true });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "sales_opportunity_scope_mismatch");
  assert.equal(f.mutations, 0);
});
test("verified attended outcomes change only tracking stage and never invent money", async () => {
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
      appointmentStatus: "showed",
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

test("qualification requires an explicit verdict, never gift survey completion or webinar attendance", () => {
  assert.equal(
    desiredStage({ ...e, survey_completed: true, attended: true }),
    "attended",
  );
  assert.equal(
    desiredStage({ ...e, qualification_status: "qualified" }),
    "qualified_not_booked",
  );
  assert.equal(
    desiredStage({ ...e, qualification_status: "disqualified" }),
    "disqualified",
  );
  assert.equal(
    desiredStage({
      ...e,
      qualification_status: "unknown",
      survey_completed: true,
    }),
    "registered",
  );
  assert.equal(
    desiredStage({ ...e, qualification_status: "qualified" }, [
      { ...pastCall, appointmentStatus: "cancelled" },
    ]),
    "call_cancelled",
  );
});
