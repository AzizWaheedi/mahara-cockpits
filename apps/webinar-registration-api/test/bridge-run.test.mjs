import test from "node:test";
import assert from "node:assert/strict";
import { trackedBridgeRun, runPipelineBatch } from "../lib/bridge-run.js";
function fixture() {
  const calls = [];
  return {
    calls,
    store: {
      rpc: async (n, a) => {
        calls.push({ n, a });
        return 7;
      },
    },
  };
}
test("idle runs leave a success heartbeat; failed work leaves a durable sanitized failure", async () => {
  const f = fixture();
  await trackedBridgeRun(f.store, "pipeline", async () => ({
    status: "idle",
    processed: 0,
    secret: "hidden",
  }));
  assert.deepEqual(f.calls[1].a, {
    p_id: 7,
    p_ok: true,
    p_counts: { complete: true, status: "idle", processed: 0 },
  });
  await assert.rejects(
    trackedBridgeRun(f.store, "pipeline", async () => {
      throw Error("provider failure");
    }),
    /provider/,
  );
  assert.equal(f.calls.at(-1).a.p_ok, false);
});
test("heartbeat start failure prevents external work; lost completion is not reported as success", async () => {
  let ran = false;
  await assert.rejects(
    trackedBridgeRun(
      {
        rpc: async () => {
          throw Error("offline");
        },
      },
      "pipeline",
      async () => {
        ran = true;
      },
    ),
  );
  assert.equal(ran, false);
  const f = fixture();
  f.store.rpc = async (n) => {
    if (n.includes("finish")) throw Error("offline");
    return 1;
  };
  await assert.rejects(
    trackedBridgeRun(f.store, "pipeline", async () => ({ status: "synced" })),
  );
});
test("batch is bounded and continues past one held record without hiding failures", async () => {
  let t = 0,
    n = 0;
  const result = await runPipelineBatch({
    store: {
      read: async (path) => {
        assert.match(path, /limit=25/);
        return Array.from({ length: 25 }, (_, i) => ({
          registration_id: String(i),
        }));
      },
    },
    now: () => t,
    maxMs: 100,
    sync: async () => {
      n++;
      t += 60;
      return { status: n === 1 ? "uncertain" : "synced" };
    },
  });
  assert.equal(n, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.status, "blocked");
});
