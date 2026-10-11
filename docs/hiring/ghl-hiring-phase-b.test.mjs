// Dry run of ghl-hiring-phase-b.js (v4) against a mock GoHighLevel, seeded
// like MaharaMedia Hiring on 2026-10-11: 36 draft workflows from the third run,
// one trigger each, no WhatsApp templates. No network, no browser.
//
//   node docs/hiring/ghl-hiring-phase-b.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(join(here, "ghl-hiring-phase-b.js"), "utf8");
const CFG = JSON.parse(
  SCRIPT.slice(SCRIPT.indexOf("const CFG = ") + 12, SCRIPT.indexOf("\n  const LOC = CFG.location;")).trim().replace(/;$/, ""),
);
const LOC = CFG.location;
const B64 = s => Buffer.from(JSON.stringify(s)).toString("base64url");
const JWT = `${B64({ alg: "none" })}.${B64({ aud: "highlevel-backend", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
const PHONE = "phone-number-id-1";

/** GoHighLevel's internal API as the console script sees it. */
function account({ connected = true, phone = PHONE, published = [], templates = [], dropStatus = false } = {}) {
  const wf = new Map();
  const triggers = new Map();
  const rows = [];
  let n = 0;
  for (const f of new Set(CFG.plan.map(p => p.folder))) rows.push({ _id: `dir-${f}`, name: `Hiring, ${f}`, type: "directory" });
  for (const p of CFG.plan) {
    // The third run's names: stage 5 was "· 5 One to one".
    const old = p.aka?.find(a => / One to one$/.test(a)) ?? p.name;
    const id = `wf-${++n}`;
    const status = published.includes(p.name) ? "published" : "draft";
    rows.push({ _id: id, name: old, type: "workflow", status });
    wf.set(id, {
      name: old, status, version: 3, allowMultiple: false,
      workflowData: { templates: [
        { id: `e-${id}`, order: 0, type: "email", name: "Email", next: `s-${id}`, attributes: {} },
        { id: `s-${id}`, order: 1, type: "sms", name: "SMS", parentKey: `e-${id}`, attributes: { body: "old" } },
      ] },
    });
    const stage = p.stageName === "One-to-one interview" ? "One to one interview" : p.stageName;
    triggers.set(id, [{ id: `t-${id}`, name: `Moved to ${stage}`, conditions: [
      { field: "opportunity.pipelineId", value: p.pipelineId },
      { field: "opportunity.pipelineStageId", value: p.stageId },
    ] }]);
  }
  const tpls = templates.map(t => ({ ...t }));
  const calls = [];
  const reply = (status, json) => ({ status, json: async () => json });
  const fetch = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const u = new URL(url);
    const path = u.pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: path + u.search, body, headers: init.headers });
    assert.equal(u.origin, "https://backend.leadconnectorhq.com");
    assert.match(String(init.headers?.["token-id"]), /^ey/, "the token goes in its header");
    if (path === `/phone-system/whatsapp/location/${LOC}/is-configured`)
      return reply(200, connected ? { isConfigured: true, whatsAppBusinessAccountId: "waba", ...(phone ? { phoneNumberId: phone } : {}) } : { isConfigured: false });
    if (path === `/phone-system/whatsapp/location/${LOC}/template`) {
      if (method === "GET") return reply(200, tpls);
      const t = { id: `tpl-${tpls.length + 1}`, name: body.name, status: "PENDING", category: body.category, components: body.components };
      tpls.push(t);
      return reply(201, { id: t.id, status: "PENDING", category: body.category });
    }
    if (path === `/workflow/${LOC}/list`) return reply(200, { rows: rows.map(r => ({ ...r, ...(wf.get(r._id) ? { name: wf.get(r._id).name } : {}) })) });
    if (path === `/workflow/${LOC}/trigger`) {
      if (method === "GET") return reply(200, triggers.get(u.searchParams.get("workflowId")) ?? []);
      const id = body.workflowId;
      triggers.set(id, [...(triggers.get(id) ?? []), { id: `t-new-${calls.length}`, ...body }]);
      return reply(201, { id: `t-new-${calls.length}` });
    }
    const tm = path.match(new RegExp(`^/workflow/${LOC}/trigger/(.+)$`));
    if (tm && method === "DELETE") {
      for (const [k, list] of triggers) triggers.set(k, list.filter(t => t.id !== tm[1]));
      return reply(200, {});
    }
    const wm = path.match(new RegExp(`^/workflow/${LOC}/([^/]+)$`));
    if (wm) {
      const w = wf.get(wm[1]);
      if (!w) return reply(404, { message: "no such workflow" });
      if (method === "GET") return reply(200, structuredClone(w));
      if (method === "PUT") {
        if (body.version !== w.version) return reply(409, { message: "version mismatch" });
        Object.assign(w, { name: body.name, status: dropStatus ? "draft" : body.status, workflowData: body.workflowData, version: w.version + 1 });
        return reply(200, { version: w.version });
      }
    }
    return reply(404, { message: `unrouted ${method} ${path}` });
  };
  return { fetch, calls, wf, triggers, tpls };
}

/** Run the console script as the browser would, with this account behind fetch. */
async function run(acct, { phoneInScript = "" } = {}) {
  const logs = [];
  let downloaded = null;
  const fakeIdb = {
    open: () => {
      const req = {};
      setTimeout(() => {
        req.result = { transaction: () => ({ objectStore: () => ({ getAll: () => {
          const all = { result: [{ value: { stsTokenManager: { accessToken: JWT } } }] };
          setTimeout(() => all.onsuccess?.(), 0);
          return all;
        } }) }) };
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  const store = { length: 0, key: () => null, getItem: () => null };
  const ctx = vm.createContext({
    fetch: acct.fetch, indexedDB: fakeIdb, localStorage: store, sessionStorage: store, atob, crypto,
    // The script waits 400 ms between template submissions; the mock does not need it.
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 100 ? 0 : ms),
    console: { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) },
    document: { createElement: () => ({ click() {} }), body: { appendChild() {} } },
    URL: { createObjectURL: () => "blob:x" },
    Blob: class { constructor(parts) { downloaded = parts.join(""); } },
  });
  const code = phoneInScript ? SCRIPT.replace('const WA_PHONE = "";', `const WA_PHONE = ${JSON.stringify(phoneInScript)};`) : SCRIPT;
  const result = await vm.runInContext(code, ctx);
  return { result, logs, downloaded: downloaded ? JSON.parse(downloaded) : null };
}

const writes = calls => calls.filter(c => c.method !== "GET");
const approveAll = acct => { for (const t of acct.tpls) t.status = "APPROVED"; };

test("the plan: 36 workflows, 36 templates, words Meta accepts, custom values for every changeable word", () => {
  assert.equal(CFG.plan.length, 36);
  const names = CFG.plan.map(p => p.whatsapp.template);
  assert.equal(new Set(names).size, 36);
  for (const p of CFG.plan) {
    const w = p.whatsapp;
    assert.match(w.template, /^[a-z0-9_]+$/, w.template);
    assert.ok(!/^\s*\{\{\d+\}\}/.test(w.text) && !/\{\{\d+\}\}[\s.]*$/.test(w.text), `${w.template} starts or ends on a variable`);
    const used = [...w.text.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    assert.deepEqual(used, used.map((_, i) => i + 1), `${w.template} numbers its variables in order`);
    assert.equal(w.variables.length, used.length);
    assert.equal(w.examples.length, used.length);
    assert.ok(w.variables.every(v => /^\{\{(contact\.first_name|custom_values\.[a-z0-9_]+)\}\}$/.test(v)), w.template);
    assert.ok(w.variables.includes("{{custom_values.hiring__owner_name}}"), "signed by the owner's custom value");
    assert.ok(!/—/.test(w.text + p.sms + p.html), "no em-dashes");
    assert.ok(w.changed, "every template says how it differs from the SMS");
    assert.ok(!/one to one/i.test(p.sms + p.html + p.subject + p.name), `${p.name} still says one to one`);
  }
  const five = CFG.plan.filter(p => /· 5 /.test(p.name));
  assert.equal(five.length, 6);
  for (const p of five) {
    assert.match(p.name, / · 5 One-to-one$/);
    assert.ok(p.aka.some(a => / · 5 One to one$/.test(a)), "found under the old name");
    assert.equal(p.stageName, "One-to-one interview");
  }
});

test("WhatsApp not connected: it stops before writing anything and says so", async () => {
  const acct = account({ connected: false });
  const { result, logs, downloaded } = await run(acct);
  assert.match(result.stopped, /WhatsApp is not connected on MaharaMedia Hiring/);
  assert.equal(writes(acct.calls).length, 0);
  assert.ok(logs.some(l => l.includes("Nothing was changed")));
  assert.equal(downloaded.stopped, result.stopped);
});

test("no sender number anywhere: it stops before writing anything and says where to find it", async () => {
  const acct = account({ phone: null });
  const { result } = await run(acct);
  assert.match(result.stopped, /phone number ID/);
  assert.equal(writes(acct.calls).length, 0);
});

test("first run: templates go to Meta, workflows keep email and SMS, all stay drafts, nothing is published", async () => {
  const acct = account();
  const { result, logs } = await run(acct);
  assert.equal(result.stopped, null);
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  const posts = acct.calls.filter(c => c.method === "POST" && c.path.endsWith("/template"));
  assert.equal(posts.length, 36);
  for (const c of posts) {
    assert.equal(c.body.category, "UTILITY");
    assert.equal(c.body.language, "en");
    assert.equal(c.body.components[0].customVariables.length, c.body.components[0].example.body_text[0].length);
  }
  assert.equal(result.built.length, 36);
  for (const b of result.built) {
    assert.equal(b.steps, 2, b.name);
    assert.equal(b.chainOk, true);
    assert.equal(b.statusAfter, "draft");
    assert.match(b.whatsapp, /waiting for template \(PENDING\)/);
  }
  assert.ok(!acct.calls.some(c => /change-status|publish/i.test(c.path)), "never publishes");
  assert.ok(logs.at(-1).includes("Nothing was published by this script"));
  assert.ok(!JSON.stringify(result).includes(JWT), "the token never reaches the result");
});

test("after Meta approves: WhatsApp follows the SMS, a published workflow stays published, re-runs build nothing twice", async () => {
  const pub = CFG.plan[0].name;
  const acct = account({ published: [pub] });
  await run(acct);
  approveAll(acct);
  const { result } = await run(acct);
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.equal(acct.calls.filter(c => c.method === "POST" && c.path.endsWith("/template")).length, 36, "templates are made once");
  for (const b of result.built) {
    assert.equal(b.steps, 3, b.name);
    assert.equal(b.whatsapp, "added");
    assert.equal(b.chainOk, true);
    assert.equal(b.triggers, 1, `${b.name} has one trigger`);
    assert.equal(b.statusAfter, b.name === pub ? "published" : "draft");
  }
  for (const [, w] of acct.wf) {
    const [email, sms, wa] = w.workflowData.templates;
    assert.equal(email.next, sms.id);
    assert.equal(sms.next, wa.id);
    assert.equal(wa.parentKey, sms.id);
    assert.equal(wa.type, "whatsapp_v2");
    assert.equal(wa.attributes.from_phone_number, PHONE);
    assert.equal(wa.attributes["{{contact.first_name}}"], "{{contact.first_name}}");
    assert.ok(!/\{\{\d+\}\}/.test(wa.attributes.message), "every numbered variable is filled with its merge field");
    assert.ok(wa.attributes.message.includes("{{custom_values.hiring__owner_name}}"));
  }
  const again = await run(acct);
  assert.equal(again.result.templates.filter(t => t.action === "created").length, 0);
  assert.equal(again.result.built.every(b => b.triggers === 1 && b.staleTriggersRemoved === 0), true);
  assert.ok(!acct.calls.some(c => /change-status|publish/i.test(c.path)));
});

test("stage 5 is renamed in place and its trigger still points at the same stage", async () => {
  const acct = account();
  await run(acct);
  for (const p of CFG.plan.filter(x => /· 5 /.test(x.name))) {
    const [id, w] = [...acct.wf].find(([, w]) => w.name === p.name) ?? [];
    assert.ok(id, `${p.name} exists`);
    assert.equal(w.name, p.name);
    const trigs = acct.triggers.get(id);
    assert.equal(trigs.length, 1);
    assert.equal(trigs[0].name, "Moved to One-to-one interview");
    assert.equal(trigs[0].conditions.find(c => c.field === "opportunity.pipelineStageId").value, p.stageId);
  }
  assert.equal([...acct.wf.values()].length, 36, "no workflow was built twice");
});

test("a status the account changes on save is reported, never hidden", async () => {
  const pub = CFG.plan[1].name;
  const acct = account({ published: [pub], dropStatus: true });
  const { result, logs } = await run(acct);
  const b = result.built.find(x => x.name === pub);
  assert.equal(b.warning, "status changed from published to draft");
  assert.ok(logs.some(l => l.startsWith("STATUS CHANGED")));
});

test("a sender number typed at the top is used as it is", async () => {
  const acct = account({ phone: null });
  await run(acct, { phoneInScript: "typed-id" });
  approveAll(acct);
  await run(acct, { phoneInScript: "typed-id" });
  const [, w] = [...acct.wf][0];
  assert.equal(w.workflowData.templates[2].attributes.from_phone_number, "typed-id");
});
