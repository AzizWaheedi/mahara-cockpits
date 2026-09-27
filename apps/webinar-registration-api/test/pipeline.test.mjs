import test from "node:test";
import assert from "node:assert/strict";
import {
  pipelineBody,
  verifyPipeline,
  provisionPipeline,
  createPipelineProvider,
} from "../lib/pipeline.js";
const row = () => ({
  ...pipelineBody(),
  id: "pipeline",
  stages: pipelineBody().stages.map((s, i) => ({ ...s, id: `stage${i}` })),
});
test("provision only plans by default and excludes tracking cards from revenue charts", async () => {
  let writes = 0;
  const p = { list: async () => [], create: async () => writes++ };
  assert.equal((await provisionPipeline(p)).status, "planned");
  assert.equal(writes, 0);
  assert.equal(pipelineBody().showInFunnel, false);
  assert.equal(pipelineBody().showInPieChart, false);
});
test("existing exact pipeline is verified without POST; drift fails closed", async () => {
  const p = {
    list: async () => [row()],
    create: async () => {
      throw Error("must not write");
    },
  };
  assert.equal(
    (await provisionPipeline(p, { apply: true })).status,
    "existing",
  );
  const bad = row();
  bad.stages[0].name = "Edited";
  assert.throws(() => verifyPipeline(bad), /stages_changed/);
  const wrong = row();
  wrong.locationId = "other";
  assert.throws(() => verifyPipeline(wrong), /scope_mismatch/);
});
test("lost create response is reconciled by readback, not a second POST", async () => {
  let rows = [],
    writes = 0;
  const p = {
    list: async () => rows,
    create: async () => {
      writes++;
      rows = [row()];
      throw Error("timeout");
    },
  };
  assert.equal(
    (await provisionPipeline(p, { apply: true })).status,
    "created_and_verified",
  );
  assert.equal(writes, 1);
});
test("ambiguous or incomplete lists cannot create", async () => {
  await assert.rejects(
    provisionPipeline({ list: async () => [row(), row()] }),
    /ambiguous/,
  );
  await assert.rejects(
    createPipelineProvider({
      env: { GHL_TOKEN: "test" },
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
    }).list(),
    /incomplete/,
  );
});
test("public provider is pinned to v3 and exact account, rejects redirects and redacts failures", async () => {
  let req;
  const p = createPipelineProvider({
    env: { GHL_TOKEN: "test" },
    fetcher: async (url, options) => {
      req = { url, ...options };
      return { ok: false, status: 403 };
    },
  });
  await assert.rejects(p.list(), /ghl_http_403/);
  assert.equal(req.headers.Version, "v3");
  assert.equal(req.redirect, "error");
  assert.match(req.url, /7NI8yyJtwsh2OOWA5Icr/);
});
