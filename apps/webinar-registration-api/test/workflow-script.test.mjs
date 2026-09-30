import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const source = readFileSync(
  new URL("../scripts/ghl/webinar-workflows-console.js", import.meta.url),
  "utf8",
);
async function run({
  apply = false,
  existing = [],
  failPut = false,
  previous,
  blankData,
} = {}) {
  let files = [],
    writes = [],
    rows = structuredClone(existing),
    workflows = new Map(
      existing.map((r) => [
        r.id,
        { ...r, workflowData: { templates: [] }, version: 1 },
      ]),
    ),
    triggers = new Map();
  if (previous) {
    rows = previous.rows;
    workflows = previous.workflows;
    triggers = previous.triggers;
  }
  const token =
    "eyJfake." +
    Buffer.from(
      JSON.stringify({
        aud: "highlevel-backend",
        exp: Date.now() / 1000 + 3600,
      }),
    ).toString("base64") +
    ".secret";
  const context = {
    Date,
    JSON,
    Set,
    Map,
    String,
    Error,
    console: { log() {}, error() {} },
    crypto: { randomUUID },
    atob: (x) => Buffer.from(x, "base64").toString(),
    indexedDB: {
      open() {
        const all = {
          result: [{ value: { stsTokenManager: { accessToken: token } } }],
        };
        const r = {
          result: {
            transaction: () => ({
              objectStore: () => ({
                getAll: () => {
                  setTimeout(() => all.onsuccess(), 0);
                  return all;
                },
              }),
            }),
          },
        };
        setTimeout(() => r.onsuccess(), 0);
        return r;
      },
    },
    Blob: class {
      constructor(parts) {
        files.push(parts.join(""));
      }
    },
    URL: { createObjectURL: () => "", revokeObjectURL() {} },
    document: {
      createElement: () => ({ click() {}, remove() {} }),
      body: { appendChild() {} },
    },
    fetch: async (url, options) => {
      const path = new URL(url).pathname,
        query = new URL(url).searchParams,
        method = options.method,
        body = options.body ? JSON.parse(options.body) : null;
      if (method !== "GET") writes.push({ path, method, body });
      let data;
      if (path.endsWith("/list"))
        data = { rows: Number(query.get("offset")) === 0 ? rows : [] };
      else if (path.endsWith("/trigger")) {
        const id = query.get("workflowId") || body?.workflow_id;
        if (method === "GET") data = triggers.get(id) || [];
        else {
          data = { ...body, id: randomUUID() };
          triggers.set(id, [...(triggers.get(id) || []), data]);
        }
      } else if (path.endsWith("/7NI8yyJtwsh2OOWA5Icr")) {
        const id = randomUUID();
        data = {
          ...body,
          id,
          status: "draft",
          version: 1,
          workflowData: blankData === undefined ? { templates: [] } : blankData,
        };
        rows.push(data);
        workflows.set(id, data);
      } else {
        const id = path.split("/").pop();
        data = workflows.get(id);
        if (method === "PUT") {
          if (failPut) return { ok: false, status: 409 };
          data = { ...data, ...body, version: data.version + 1 };
          workflows.set(id, data);
        }
      }
      return {
        ok: !!data,
        status: data ? 200 : 404,
        json: async () => structuredClone(data),
      };
    },
  };
  await vm.runInNewContext(
    apply
      ? source.replace("const AUDIT_ONLY = true", "const AUDIT_ONLY = false")
      : source,
    context,
  );
  return {
    out: JSON.parse(files.at(-1)),
    writes,
    files,
    token,
    rows,
    workflows,
    triggers,
  };
}
test("audit mode makes no writes and exports no credentials", async () => {
  const x = await run();
  assert.equal(x.out.complete, true);
  assert.equal(x.writes.length, 0);
  assert.ok(!x.files.join("").includes(x.token));
});
test("installer creates only a draft with one authenticated internal step and twenty-two triggers", async () => {
  const x = await run({ apply: true });
  assert.equal(x.out.result, "draft_verified");
  assert.equal(x.out.draft.triggers, 22);
  assert.ok(
    x.writes.every(
      (x) => !x.path.includes("change-status") && x.method !== "DELETE",
    ),
  );
  const put = x.writes.find((x) => x.method === "PUT");
  assert.equal(put.body.status, "draft");
  assert.equal(put.body.workflowData.templates[0].type, "custom_webhook");
});
test("published same-name workflow is never edited or republished", async () => {
  const x = await run({
    apply: true,
    existing: [
      {
        id: "existing",
        name: "WEBBY - P1 Reconcile Webinar Journey",
        status: "published",
        type: "workflow",
      },
    ],
  });
  assert.match(x.out.error, /not draft/);
  assert.ok(!x.writes.some((x) => x.path.endsWith("/existing")));
});
test("stale write aborts before trigger creation and never publishes", async () => {
  const x = await run({ apply: true, failPut: true });
  assert.match(x.out.error, /409/);
  assert.ok(!x.writes.some((x) => x.path.endsWith("/trigger")));
});

test("rerunning installer verifies the same draft without duplicating triggers or steps", async () => {
  const first = await run({ apply: true });
  const second = await run({ apply: true, previous: first });
  assert.equal(second.out.result, "draft_verified");
  assert.equal(second.writes.length, 0);
  assert.equal(second.out.draft.id, first.out.draft.id);
});

test("GHL null and empty draft graphs can be initialized; unknown graphs are preserved", async () => {
  for (const blankData of [null, {}]) {
    const x = await run({ apply: true, blankData });
    assert.equal(x.out.result, "draft_verified");
  }
  const x = await run({
    apply: true,
    blankData: { unexpectedGraph: { nodes: [] } },
  });
  assert.match(x.out.error, /Unknown workflow graph/);
  assert.ok(!x.writes.some((w) => w.method === "PUT"));
});

test("expanding the old ten-trigger draft adds only missing appointment outcomes", async () => {
  const first = await run({ apply: true });
  const id = first.out.draft.id;
  first.triggers.set(
    id,
    first.triggers
      .get(id)
      .filter(
        (t) =>
          t.type !== "appointment" ||
          t.conditions.some(
            (c) => c.field === "appointment.status" && c.value === "confirmed",
          ),
      ),
  );
  assert.equal(first.triggers.get(id).length, 10);
  const next = await run({ apply: true, previous: first });
  assert.equal(next.out.result, "draft_verified");
  assert.equal(next.out.draft.triggers, 22);
  assert.equal(next.writes.length, 12);
  assert.ok(
    next.writes.every(
      (w) => w.path.endsWith("/trigger") && w.method === "POST",
    ),
  );
});
