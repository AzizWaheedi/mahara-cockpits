import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { pipelineSignalHandler } from "../api/ghl-pipeline.js";
import { LOCATION_ID } from "../lib/pipeline.js";
const secret = "synthetic-only-".repeat(4),
  body = { location_id: LOCATION_ID, contact_id: "c123" };
function req(value = body, auth = `Bearer ${secret}`) {
  const r = Readable.from([
    typeof value === "string" ? value : JSON.stringify(value),
  ]);
  r.method = "POST";
  r.headers = { "content-type": "application/json", authorization: auth };
  return r;
}
function res() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}
test("authorized hints store only location and contact, never caller-supplied stages", async () => {
  const calls = [],
    r = res();
  await pipelineSignalHandler({
    env: { WEBINAR_PIPELINE_SIGNAL_SECRET: secret },
    store: { rpc: async (...x) => calls.push(x) },
  })(req({ ...body, stage: "client_won", revenue: 9000 }), r);
  assert.equal(r.code, 202);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.deepEqual(calls, [
    [
      "cockpit_signal_webinar_pipeline",
      { p_location: LOCATION_ID, p_contact: "c123" },
    ],
  ]);
});
test("missing configuration, invalid auth, wrong scope and oversized input never reach storage", async () => {
  for (const [request, env, status] of [
    [req(), {}, 503],
    [req(body, "wrong"), { WEBINAR_PIPELINE_SIGNAL_SECRET: secret }, 401],
    [
      req({ ...body, location_id: "other" }),
      { WEBINAR_PIPELINE_SIGNAL_SECRET: secret },
      400,
    ],
    [req("x".repeat(4097)), { WEBINAR_PIPELINE_SIGNAL_SECRET: secret }, 413],
  ]) {
    let n = 0;
    const r = res();
    await pipelineSignalHandler({ env, store: { rpc: async () => n++ } })(
      request,
      r,
    );
    assert.equal(r.code, status);
    assert.equal(n, 0);
  }
});
test("a database failure never returns a successful ACK or private error details", async () => {
  const r = res();
  await pipelineSignalHandler({
    env: { WEBINAR_PIPELINE_SIGNAL_SECRET: secret },
    store: {
      rpc: async () => {
        throw Error("private database details");
      },
    },
  })(req(), r);
  assert.equal(r.code, 503);
  assert.ok(!JSON.stringify(r.body).includes("private database"));
});
