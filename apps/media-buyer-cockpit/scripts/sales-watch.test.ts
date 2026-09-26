import { describe, expect, test } from "bun:test";
import { DESK_LIMITS, salesProblems } from "../convex/salesWatch";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const fresh = Object.keys(DESK_LIMITS).map(job => ({
  job,
  ok: true,
  at: ago(1),
  detail: "fine",
}));
const mirrorOk = [
  { started_at: ago(2), ok: true, error: null },
  { started_at: ago(5), ok: true, error: null },
  { started_at: ago(8), ok: true, error: null },
];

describe("the sales watch", () => {
  test("all fresh and fine: nothing to say", () => {
    expect(salesProblems(fresh, mirrorOk, NOW)).toEqual([]);
  });

  test("the desk's heartbeat stops: the VPS is named", () => {
    const desk = fresh.map(r => (r.job === "requests" ? { ...r, at: ago(40) } : r));
    expect(salesProblems(desk, mirrorOk, NOW)).toEqual([
      'sales desk "requests" last ran 40 min ago (the VPS or its cron is down)',
    ]);
  });

  test("a job that failed, one that never reported, a stale digest", () => {
    const desk = fresh
      .filter(r => r.job !== "notes")
      .map(r =>
        r.job === "followups"
          ? { ...r, ok: false, detail: "OPENAI_API_KEY refused" }
          : r.job === "digest"
            ? { ...r, at: ago(27 * 60) }
            : r,
      );
    expect(salesProblems(desk, mirrorOk, NOW)).toEqual([
      'sales desk "followups" failed: OPENAI_API_KEY refused',
      'sales desk "notes" has never reported',
      'sales desk "digest" last ran 1620 min ago',
    ]);
  });

  test("the mirror late, or failing three runs in a row", () => {
    expect(
      salesProblems(fresh, [{ started_at: ago(20), ok: true, error: null }], NOW),
    ).toEqual([
      "the sales mirror last ran 20 min ago (pg_cron job mahara-sales-mirror)",
    ]);
    const failing = mirrorOk.map(m => ({ ...m, ok: false, error: "B2B 401" }));
    expect(salesProblems(fresh, failing, NOW)).toEqual([
      "the sales mirror failed three runs in a row: B2B 401",
    ]);
    // A run still going (ok null) is not a failure.
    expect(
      salesProblems(fresh, [{ ...mirrorOk[0], ok: null }, ...mirrorOk.slice(1)], NOW),
    ).toEqual([]);
  });
});
