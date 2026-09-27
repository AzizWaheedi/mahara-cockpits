import { expect, test } from "bun:test";
import { collectionHealth } from "../convex/ceo/webinarCollectionHealth";

const now = Date.parse("2026-09-27T12:00:00Z");
const recent = "2026-09-27T11:30:00Z";
const data = {
  pulls: ["zoom", "typeform", "reminders", "pipeline", "native_forms"].map(
    (source) => ({
      source,
      last_ok: ["pipeline", "native_forms"].includes(source)
        ? "2026-09-27T11:59:00Z"
        : recent,
      started_at: recent,
      finished_at: recent,
      ok: true,
      counts: { complete: true, received: 0, source_total: 0 },
    }),
  ),
  queue: { pending: 0, uncertain: 0, blocked: 0, oldest: null },
  unmatched_surveys: 0,
  enabled_pipelines: 1,
  pipeline: { blocked: 0, uncertain: 0 },
};
test("empty complete source reads are healthy without claiming a customer journey", () => {
  expect(
    collectionHealth(data, now).checks.every((c) => c.status === "verified"),
  ).toBe(true);
  expect(collectionHealth(data, now).checks[0].detail).toContain(
    "does not prove",
  );
});
test("fresh page cannot hide two missed hourly collection windows", () => {
  const old = {
    ...data,
    pulls: data.pulls.map((p) => ({ ...p, last_ok: "2026-09-27T09:00:00Z" })),
  };
  expect(
    collectionHealth(old, now)
      .checks.slice(0, 2)
      .every((c) => c.status === "needs_attention"),
  ).toBe(true);
  expect(collectionHealth(old, now).checks[2].status).toBe("verified");
  expect(
    collectionHealth({ ...old, reminder_interval_minutes: 60 }, now).checks[2]
      .status,
  ).toBe("needs_attention");
});
test("failed latest read, unfinished heartbeat and incomplete pagination stay visible", () => {
  const rows = [
    { ...data.pulls[0], ok: false },
    {
      ...data.pulls[1],
      counts: { complete: false, received: 2, source_total: 3 },
    },
    { ...data.pulls[2], finished_at: null, ok: null },
  ];
  expect(
    collectionHealth({ ...data, pulls: rows }, now)
      .checks.slice(0, 3)
      .every((c) => c.status === "needs_attention"),
  ).toBe(true);
});
test("recovery supersedes old failure without hiding uncertain mutations", () => {
  expect(
    collectionHealth(
      { ...data, queue: { pending: 0, uncertain: 1, blocked: 0 } },
      now,
    ).checks[5].status,
  ).toBe("needs_attention");
  expect(
    collectionHealth(
      {
        ...data,
        queue: {
          pending: 1,
          uncertain: 0,
          blocked: 0,
          oldest: "2026-09-27T11:55:00Z",
        },
      },
      now,
    ).checks[5].status,
  ).toBe("processing");
});
test("missing storage or malformed counts cannot look like zero", () => {
  expect(
    collectionHealth(null, now).checks.every((c) => c.status === "unavailable"),
  ).toBe(true);
  expect(
    collectionHealth({ ...data, queue: {}, unmatched_surveys: null }, now)
      .checks.slice(5)
      .every((c) => c.status === "unavailable"),
  ).toBe(true);
});

test("pipeline disabled, stale worker and uncertain provider writes remain distinct", () => {
  const pipeline = (x: unknown) =>
    collectionHealth(x, now).checks.find((c) => c.key === "webinar-pipeline")!;
  expect(pipeline({ ...data, enabled_pipelines: 0 }).status).toBe(
    "unavailable",
  );
  expect(pipeline(data).status).toBe("verified");
  expect(pipeline({ ...data, pipeline: null }).status).toBe("unavailable");
  expect(
    pipeline({ ...data, pipeline: { blocked: 0, uncertain: 1 } }).status,
  ).toBe("needs_attention");
  expect(
    pipeline({
      ...data,
      pulls: data.pulls.map((p) => ({ ...p, last_ok: recent })),
    }).status,
  ).toBe("needs_attention");
});
