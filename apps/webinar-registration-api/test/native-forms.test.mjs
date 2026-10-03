import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFormBindings,
  ingestNativeForms,
  WEBINAR_FORM,
} from "../lib/native-forms.js";
import { LOCATION_ID } from "../lib/pipeline.js";
const now = Date.parse("2026-10-01T10:00:00Z"),
  b = {
    location_id: LOCATION_ID,
    form_id: WEBINAR_FORM,
    event_key: "event",
    revision: 1,
    config_sha256: "a".repeat(64),
    opens_at: "2026-10-01T00:00:00Z",
    closes_at: "2026-10-02T00:00:00Z",
  },
  current = { ...b, status: "scheduled", starts_at: b.closes_at };
const submission = {
  id: "source1",
  contactId: "contact1",
  formId: WEBINAR_FORM,
  createdAt: "2026-10-01T09:00:00Z",
};
function deps(rows = [submission]) {
  const calls = [];
  return {
    calls,
    provider: {
      request: async () => ({
        submissions: rows,
        meta: { total: rows.length },
      }),
    },
    store: { rpc: async (n, a) => calls.push({ n, a }) },
    bindings: [b],
    current,
    now,
  };
}
test("unknown dates and overlapping form windows stay held", async () => {
  const d = deps();
  assert.equal(
    (await ingestNativeForms({ ...d, bindings: [] })).status,
    "held",
  );
  assert.equal(d.calls.length, 0);
  assert.throws(() => validateFormBindings([b, b]), /overlap/);
});
test("dry run does not write; apply sends real receipt identity and timestamp without contact PII", async () => {
  const d = deps();
  assert.equal((await ingestNativeForms(d)).eligible, 1);
  assert.equal(d.calls.length, 0);
  await ingestNativeForms({ ...d, apply: true });
  assert.deepEqual(d.calls[0].a.p_payload, {
    contact_id: "contact1",
    submitted_at: submission.createdAt.replace("Z", ".000Z"),
  });
  assert.match(d.calls[0].a.p_source_id, /source1$/);
});
test("schedule changes fail instead of assigning a submission to a different training", async () => {
  await assert.rejects(
    ingestNativeForms({
      ...deps(),
      current: { ...current, revision: 2 },
      apply: true,
    }),
    /schedule_mismatch/,
  );
});
test("malformed and cross-form receipts prevent the whole batch from being accepted", async () => {
  const d = deps([
    submission,
    { ...submission, id: "source2", formId: "other" },
  ]);
  await assert.rejects(
    ingestNativeForms({ ...d, apply: true }),
    /shape_unverified/,
  );
  assert.equal(d.calls.length, 0);
});
test("same-day registrations outside the exact configured window are ignored", async () => {
  const d = deps([{ ...submission, createdAt: "2026-09-30T23:00:00Z" }]);
  assert.equal((await ingestNativeForms({ ...d, apply: true })).accepted, 0);
});
test("failed or partial pagination cannot become an empty successful intake", async () => {
  const d = deps();
  d.provider.request = async () => ({ submissions: [], meta: { total: 1 } });
  await assert.rejects(ingestNativeForms(d), /incomplete/);
});
test("offset form windows read a padded UTC date range and filter by the exact instant", async () => {
  const d = deps([{ ...submission, createdAt: "2026-09-30T22:30:00Z" }]);
  const offset = { ...b, opens_at: "2026-10-01T00:00:00+03:00" };
  let query;
  d.provider.request = async (path) => {
    query = new URL(path, "https://example.invalid").searchParams;
    return {
      submissions: [{ ...submission, createdAt: "2026-09-30T22:30:00Z" }],
      meta: { total: 1 },
    };
  };
  assert.equal(
    (await ingestNativeForms({ ...d, bindings: [offset] })).eligible,
    1,
  );
  assert.equal(query.get("startAt"), "2026-09-29");
  assert.equal(query.get("endAt"), "2026-10-02");
});
