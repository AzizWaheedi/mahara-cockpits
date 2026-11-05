import { describe, expect, test } from "bun:test";
import { FenceModel } from "./fence-model.ts";

describe("synthetic row-lock state model, not a SQL concurrency test", () => {
  test("reservation release preserves queued state and removes only its attempt", () => {
    const row = new FenceModel("queued", 0, 100);
    expect(row.claim("00000000-0000-4000-8000-000000000001", 200, 1000)).toBe(true);
    expect(row.attempts).toBe(1);
    expect(row.release("00000000-0000-4000-8000-000000000001", 300)).toBe(true);
    expect([row.state, row.attempts, row.updated]).toEqual(["queued", 0, 100]);
    expect(row.release("00000000-0000-4000-8000-000000000001", 301)).toBe(false);
  });
  test("release preserves a previous failed outcome and its retry clock", () => {
    const row = new FenceModel("failed", 2, 100);
    expect(row.claim("00000000-0000-4000-8000-000000000002", 600_099, 900_000)).toBe(false);
    expect(row.claim("00000000-0000-4000-8000-000000000002", 600_100, 900_000)).toBe(true);
    expect(row.attempts).toBe(3);
    expect(row.release("00000000-0000-4000-8000-000000000002", 600_101)).toBe(true);
    expect([row.state, row.attempts, row.updated]).toEqual(["failed", 2, 100]);
  });
  test("only the live matching claim can begin or release", () => {
    const row = new FenceModel("queued", 0, 0);
    expect(row.claim("00000000-0000-4000-8000-000000000003", 10, 20)).toBe(true);
    expect(row.begin("00000000-0000-4000-8000-000000000004", 11)).toBe(false);
    expect(row.release("00000000-0000-4000-8000-000000000004", 11)).toBe(false);
    expect(row.begin("00000000-0000-4000-8000-000000000003", 20)).toBe(false);
    expect(row.release("00000000-0000-4000-8000-000000000003", 20)).toBe(false);
    expect(row.expire(20)).toBe(true);
    expect([row.state, row.attempts]).toEqual(["unknown", 1]);
    expect(row.claim("00000000-0000-4000-8000-000000000005", 30, 50)).toBe(false);
  });
  test("begin wins a serialized race: release cannot undo a possible send", () => {
    const row = new FenceModel("queued", 0, 0);
    expect(row.claim("00000000-0000-4000-8000-000000000006", 1, 100)).toBe(true);
    expect(row.begin("00000000-0000-4000-8000-000000000006", 2)).toBe(true);
    expect(row.release("00000000-0000-4000-8000-000000000006", 2)).toBe(false);
    expect(row.settle("00000000-0000-4000-8000-000000000006", 3, "unknown")).toBe(true);
    expect(row.claim("00000000-0000-4000-8000-000000000007", 4, 100)).toBe(false);
  });
  test("release wins a serialized race: old begin cannot authorize send", () => {
    const row = new FenceModel("queued", 0, 0);
    expect(row.claim("00000000-0000-4000-8000-000000000008", 1, 100)).toBe(true);
    expect(row.release("00000000-0000-4000-8000-000000000008", 2)).toBe(true);
    expect(row.claim("00000000-0000-4000-8000-000000000009", 3, 100)).toBe(true);
    expect(row.begin("00000000-0000-4000-8000-000000000008", 4)).toBe(false);
    expect(row.begin("00000000-0000-4000-8000-000000000009", 4)).toBe(true);
  });
  test("both reserved and started expired claims become unknown, never auto-retried", () => {
    for (const started of [false, true]) {
      const row = new FenceModel("queued", 0, 0);
      expect(row.claim("00000000-0000-4000-8000-000000000006", 1, 10)).toBe(true);
      if (started) expect(row.begin("00000000-0000-4000-8000-000000000006", 2)).toBe(true);
      expect(row.expire(10)).toBe(true);
      expect(row.release("00000000-0000-4000-8000-000000000006", 11)).toBe(false);
      expect(row.settle("00000000-0000-4000-8000-000000000006", 11, "sent")).toBe(false);
      expect(row.claim("00000000-0000-4000-8000-000000000002", 12, 100)).toBe(false);
      expect(row.state).toBe("unknown");
    }
  });
  test("invalid identifiers and times cannot change state", () => {
    const row = new FenceModel("queued", 0, 0);
    const id = "00000000-0000-4000-8000-000000000006";
    expect(row.claim("not-a-uuid", 1, 10)).toBe(false);
    expect(row.claim(id, NaN, 10)).toBe(false);
    expect(row.claim(id, 1, 10)).toBe(true);
    expect(row.begin(id, NaN)).toBe(false);
    expect(row.release(id, NaN)).toBe(false);
    expect(row.expire(NaN)).toBe(false);
    expect(row.state).toBe("claimed");
  });
  test("unstarted claim cannot be settled as sent", () => {
    const row = new FenceModel("queued", 0, 0);
    expect(row.claim("00000000-0000-4000-8000-000000000006", 1, 10)).toBe(true);
    expect(row.settle("00000000-0000-4000-8000-000000000006", 2, "sent")).toBe(false);
    expect(row.state).toBe("claimed");
  });
});
