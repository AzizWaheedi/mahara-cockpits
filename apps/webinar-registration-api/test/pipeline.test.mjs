import test from "node:test";
import assert from "node:assert/strict";
import {
  pipelineBody,
  verifyPipeline,
  provisionPipeline,
  createPipelineProvider,
  expandPipeline,
  expansionBody,
  LEGACY_STAGE_NAMES,
} from "../lib/pipeline.js";
const row = () => ({
  ...pipelineBody(),
  id: "pipeline",
  stages: pipelineBody().stages.map((s, i) => ({ ...s, id: `stage${i}` })),
});
function legacy() {
  const previous = {
    pipeline_id: "pipeline",
    stages: Object.fromEntries(
      Object.keys(LEGACY_STAGE_NAMES).map((key, i) => [key, `old${i}`]),
    ),
  };
  return {
    previous,
    row: {
      ...pipelineBody(),
      id: "pipeline",
      stages: Object.entries(LEGACY_STAGE_NAMES).map(
        ([key, name], position) => ({
          id: previous.stages[key],
          name,
          position,
        }),
      ),
    },
  };
}
test("expansion plans by default and preserves all eight existing IDs", async () => {
  const x = legacy();
  let writes = 0;
  const p = { list: async () => [x.row], update: async () => writes++ };
  const result = await expandPipeline(p, x.previous);
  assert.equal(result.status, "planned");
  assert.equal(result.body.stages.length, 16);
  assert.equal(writes, 0);
  assert.deepEqual(
    new Set(result.body.stages.filter((s) => s.id).map((s) => s.id)),
    new Set(Object.values(x.previous.stages)),
  );
});
test("expansion verifies once after a lost PUT response and reruns without writing", async () => {
  const x = legacy();
  let remote = x.row,
    writes = 0;
  const p = {
    list: async () => [remote],
    update: async (id, body) => {
      writes++;
      assert.equal(id, "pipeline");
      remote = {
        ...remote,
        ...body,
        stages: body.stages.map((s, i) => ({ ...s, id: s.id || `new${i}` })),
      };
      throw Error("timeout");
    },
  };
  const result = await expandPipeline(p, x.previous, { apply: true });
  assert.equal(result.status, "expanded_and_verified");
  for (const [key, id] of Object.entries(x.previous.stages))
    assert.equal(result.stages[key], id);
  assert.equal(
    (await expandPipeline(p, x.previous, { apply: true })).status,
    "existing",
  );
  assert.equal(writes, 1);
});
test("expansion refuses unknown or changed stages and does not repeat rejected writes", async () => {
  const x = legacy();
  assert.throws(
    () =>
      expansionBody(
        {
          ...x.row,
          stages: [...x.row.stages, { name: "User stage", id: "u" }],
        },
        x.previous,
      ),
    /legacy_pipeline_changed/,
  );
  assert.throws(
    () => expansionBody({ ...x.row, locationId: "wrong" }, x.previous),
    /scope_mismatch/,
  );
  const changed = structuredClone(x.row);
  changed.stages[0].name = "Custom registration";
  let writes = 0;
  await assert.rejects(
    expandPipeline(
      { list: async () => [changed], update: async () => writes++ },
      x.previous,
      { apply: true },
    ),
    /legacy_pipeline_changed/,
  );
  assert.equal(writes, 0);
  await assert.rejects(
    expandPipeline(
      {
        list: async () => [x.row],
        update: async () => {
          writes++;
          throw Error("ghl_http_401");
        },
      },
      x.previous,
      { apply: true },
    ),
    /ghl_http_401/,
  );
  assert.equal(writes, 1);
});
test("expanded readback must retain the original IDs, not just the names", async () => {
  const x = legacy();
  const body = expansionBody(x.row, x.previous);
  const changed = {
    ...x.row,
    ...body,
    stages: body.stages.map((s, i) => ({ ...s, id: `replacement${i}` })),
  };
  await assert.rejects(
    expandPipeline({ list: async () => [changed] }, x.previous),
    /existing_stage_id_changed/,
  );
});
test("display-only stage reordering preserves exact outcome mappings", () => {
  const original = row();
  const reordered = {
    ...original,
    stages: [...original.stages]
      .reverse()
      .map((s, position) => ({ ...s, position })),
  };
  assert.deepEqual(verifyPipeline(reordered), verifyPipeline(original));
  const duplicateName = structuredClone(original);
  duplicateName.stages[1].name = duplicateName.stages[0].name;
  assert.throws(() => verifyPipeline(duplicateName), /stages_changed/);
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
