// Runs under `deno test` and `bun test` alike (node:test, node:assert).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountFromTask,
  type Any,
  billingDays,
  CFB,
  columnsOf,
  CRITICAL_FIELDS,
  F,
  humanEdits,
  lastPage,
  LIST_ID,
  missingFields,
  optionsFrom,
  planMirror,
  readProblem,
  redact,
  runNote,
} from "./billing.ts";

const NOW = Date.parse("2026-10-09T08:00:00Z");
const NOW_ISO = new Date(NOW).toISOString();
const ms = (day: string) => Date.parse(`${day}T09:00:00Z`);

// The list's field definitions, as GET list/{id}/field returns them.
const dropdown = (id: string, names: string[]) => ({
  id,
  type_config: { options: names.map((name, i) => ({ id: `${id}-opt-${i}`, name, orderindex: i })) },
});
const FIELDS = {
  fields: [
    dropdown(F.status, ["Active", "Paused", "Stopped", "SALES TEAM TO CONTACT", "Onboarding"]),
    dropdown(F.method, ["Card on file", "Bank transfer", "Tap link", "Whop link", "Check"]),
    dropdown(F.plan, ["Monthly", "Split Pay (2x payments)", "Paid in full (90 days)"]),
    dropdown(F.country, ["Kuwait", "UAE"]),
    dropdown(CFB.contractStatus, ["Signed", "Unsigned"]),
    dropdown(CFB.churnType, ["Voluntary"]),
    ...[F.nextAmount, F.nextDate, F.mrr, F.ltv, F.pausedOn, F.extension, F.churnDate].map(id => ({ id })),
    ...[CFB.nextContractRenewal, CFB.signupDate, CFB.launchDate, CFB.churnReason, CFB.closer, CFB.leadSource].map(id => ({ id })),
  ],
};
const options = optionsFrom(FIELDS);

/** A card as GET list/{id}/task returns it; `fields` maps field id to value. */
function card(id: string, name: string, fields: Record<string, unknown>, extra: Any = {}): Any {
  return {
    id,
    name,
    url: `https://app.clickup.com/t/${id}`,
    date_updated: String(Date.parse("2026-10-08T10:00:00Z")),
    assignees: [{ username: "Sara" }],
    custom_fields: [
      ...FIELDS.fields.map(f => ({ id: f.id, type_config: (f as Any).type_config ?? {} })),
    ].map(f => (f.id in fields ? { ...f, value: fields[f.id] } : f)),
    ...extra,
  };
}

/** A mirror row as PostgREST returns it. */
function mirror(over: Any): Any {
  return {
    clickup_task_id: "t1",
    client_name: "Acme",
    task_url: "https://app.clickup.com/t/t1",
    stage: "Active",
    stage_group: "active",
    client_status: "Active",
    payment_method: "Bank transfer",
    payment_plan: "Monthly",
    country: "Kuwait",
    next_payment_usd: 1500,
    next_payment_date: "2026-10-20",
    mrr_usd: 1500,
    ltv_field_usd: 9000,
    paused_on: null,
    extension_weeks: null,
    churn_date: null,
    csm: "Sara",
    source: "sync",
    synced_at: "2026-10-07T22:30:01.123456+00:00",
    ...over,
  };
}

const acme = (over: Record<string, unknown> = {}, extra: Any = {}) =>
  card(
    "t1",
    "Acme",
    {
      [F.status]: 0,
      [F.method]: "665e5754-b9c6-4776-9386-111ad221dead-opt-1",
      [F.plan]: 0,
      [F.country]: 0,
      [F.nextAmount]: "1500",
      [F.nextDate]: String(ms("2026-10-20")),
      [F.mrr]: 1500,
      [F.ltv]: 9000,
      ...over,
    },
    extra,
  );

test("a card maps to a mirror row by billingCore's rules", () => {
  const row = accountFromTask(acme({ [F.pausedOn]: String(ms("2026-10-01")), [F.extension]: 2 }), options, NOW_ISO);
  assert.deepEqual(row, {
    clickup_task_id: "t1",
    client_name: "Acme",
    task_url: "https://app.clickup.com/t/t1",
    stage: "Active",
    stage_group: "active",
    client_status: "Active",
    payment_method: "Bank transfer", // read by option id
    payment_plan: "Monthly", // read by order index
    country: "Kuwait",
    next_payment_usd: 1500,
    next_payment_date: "2026-10-20",
    mrr_usd: 1500,
    ltv_field_usd: 9000,
    paused_on: "2026-10-01",
    extension_weeks: 2,
    churn_date: null,
    csm: "Sara",
    source: "sync",
    synced_at: NOW_ISO,
  });
  // 23:30 UTC on the 19th is the 20th in Kuwait.
  const late = accountFromTask(acme({ [F.nextDate]: String(Date.parse("2026-10-19T23:30:00Z")) }), options, NOW_ISO);
  assert.equal(late.next_payment_date, "2026-10-20");
  assert.equal(accountFromTask(acme({ [F.status]: 3 }), options, NOW_ISO).stage_group, "sales");
  assert.equal(accountFromTask(acme({ [F.status]: 2 }), options, NOW_ISO).stage_group, "gone");
  assert.equal(accountFromTask(acme({ [F.status]: 4 }), options, NOW_ISO).stage_group, "pipeline");
});

test("a new card is inserted as read; internal and unread cards are left out", () => {
  const plan = planMirror(
    [
      acme(),
      card("t9", "Mahara playing account", { [F.status]: 0 }),
      { id: "t8", name: "No fields", custom_fields: [] },
      acme(), // a page overlap: counted once
    ],
    options,
    [],
    [],
    NOW_ISO,
  );
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].expected_synced_at, null);
  assert.equal(plan.changed[0].isNew, true);
  assert.equal(plan.internal, 1);
  assert.deepEqual(plan.unread, ["t8"]);
});

test("a value is never blanked because ClickUp returned nothing", () => {
  const plan = planMirror(
    [acme({ [F.method]: null, [F.plan]: "no-such-option", [F.ltv]: "" }, { assignees: [] })],
    options,
    [mirror({ payment_method: "Tap link" })],
    [],
    NOW_ISO,
  );
  const row = plan.rows[0].row;
  assert.equal(row.payment_method, "Tap link");
  assert.equal(row.payment_plan, "Monthly");
  assert.equal(row.ltv_field_usd, 9000);
  assert.equal(row.csm, "Sara");
  assert.equal(plan.rows[0].expected_synced_at, "2026-10-07T22:30:01.123456+00:00");
  assert.deepEqual(plan.kept[0].columns.sort(), ["csm", "ltv_field_usd", "payment_method", "payment_plan"]);
  assert.equal(plan.changed.length, 0);
});

test("an unread status keeps its group; it does not fall back to pipeline", () => {
  const plan = planMirror([acme({ [F.status]: null })], options, [mirror({})], [], NOW_ISO);
  const row = plan.rows[0].row;
  assert.equal(row.client_status, "Active");
  assert.equal(row.stage_group, "active");
  assert.deepEqual(plan.kept[0].columns, ["client_status"]);
});

test("Paused On follows the status that was read, so an old pause never restarts the churn clock", () => {
  const old = mirror({ client_status: "Paused", stage: "Paused", stage_group: "paused", paused_on: "2026-08-01" });
  const read = planMirror([acme({ [F.status]: 1 })], options, [old], [], NOW_ISO).rows[0].row;
  assert.equal(read.paused_on, null);
  const unread = planMirror([acme({ [F.status]: null })], options, [old], [], NOW_ISO).rows[0].row;
  assert.equal(unread.paused_on, "2026-08-01");
});

test("a cockpit edit newer than the card is kept, an older one gives way to ClickUp", () => {
  const edit = {
    clickup_task_id: "t1",
    kind: "method",
    from_value: "Bank transfer",
    to_value: "Tap link",
    source: "ceo",
    at: "2026-10-09T07:00:00+00:00",
  };
  const existing = [mirror({ payment_method: "Tap link", source: "ceo" })];
  const kept = planMirror([acme()], options, existing, [edit], NOW_ISO);
  assert.equal(kept.rows[0].row.payment_method, "Tap link");
  assert.equal(kept.rows[0].row.source, "ceo");
  assert.deepEqual(kept.held, [
    { taskId: "t1", name: "Acme", column: "payment_method", mirror: "Tap link", card: "Bank transfer" },
  ]);
  const moved = planMirror(
    [acme({}, { date_updated: String(Date.parse("2026-10-09T07:30:00Z")) })],
    options,
    existing,
    [edit],
    NOW_ISO,
  );
  assert.equal(moved.rows[0].row.payment_method, "Bank transfer");
  assert.equal(moved.rows[0].row.source, "sync");
  assert.deepEqual(moved.changed[0].changes, [{ column: "payment_method", from: "Tap link", to: "Bank transfer" }]);
});

test("a held pause keeps the whole status with it", () => {
  const pause = { clickup_task_id: "t1", kind: "pause", source: "csm", at: "2026-10-09T07:00:00Z", detail: { on: "2026-10-09" } };
  const existing = [mirror({ client_status: "Paused", stage: "Paused", stage_group: "paused", paused_on: "2026-10-09", source: "csm" })];
  const row = planMirror([acme()], options, existing, [pause], NOW_ISO).rows[0].row;
  assert.equal(row.client_status, "Paused");
  assert.equal(row.stage, "Paused");
  assert.equal(row.stage_group, "paused");
  assert.equal(row.paused_on, "2026-10-09");
  assert.equal(row.source, "csm");
});

test("which columns an event holds", () => {
  const e = (kind: string, over: Any = {}) => ({ kind, source: "csm", ...over });
  assert.deepEqual(columnsOf(e("extension", { detail: { weeks: 2, movedDate: false } })), ["extension_weeks"]);
  assert.deepEqual(columnsOf(e("extension", { detail: { weeks: 2, movedDate: true } })), ["extension_weeks", "next_payment_date"]);
  assert.deepEqual(columnsOf(e("extension", { detail: { weeksAdded: 2, movedDateTo: "2026-11-01" } })), ["extension_weeks", "next_payment_date"]);
  assert.deepEqual(columnsOf(e("payment", { from_value: "2026-10-01", to_value: "2026-11-01" })), ["next_payment_date"]);
  assert.deepEqual(columnsOf(e("payment", { from_value: "2026-10-01", to_value: "2026-10-01" })), []);
  assert.deepEqual(columnsOf(e("resume", { detail: { nextDate: "2026-11-01" } })), ["client_status", "paused_on", "next_payment_date"]);
  assert.deepEqual(columnsOf(e("note")), []);
  assert.deepEqual(columnsOf(e("method", { source: "clickup" })), []);
  const edits = humanEdits([
    { ...e("date"), clickup_task_id: "t1", at: "2026-10-01T00:00:00Z" },
    { ...e("date", { source: "ceo" }), clickup_task_id: "t1", at: "2026-10-05T00:00:00Z" },
    { ...e("date"), clickup_task_id: "t1", at: "not a time" },
  ]);
  assert.deepEqual(edits.get("t1")?.get("next_payment_date"), { at: Date.parse("2026-10-05T00:00:00Z"), source: "ceo" });
});

test("mirror rows the read did not return are reported and left alone", () => {
  const plan = planMirror([acme()], options, [mirror({}), mirror({ clickup_task_id: "gone1", client_name: "Old" })], [], NOW_ISO);
  assert.deepEqual(plan.notOnList, [{ taskId: "gone1", name: "Old" }]);
  assert.deepEqual(plan.rows.map(r => r.row.clickup_task_id), ["t1"]);
});

test("the daily snapshot has the import's shape and ceo/billing.ts's money rules", () => {
  const kwd = (value: unknown) => ({ value, type_config: { currency_type: "KWD" } });
  const t = card("t1", "Acme", {
    [CFB.status]: 1,
    [CFB.paymentPlan]: 2,
    [CFB.contractStatus]: "ac976d4a-409b-441c-8c13-4b0e73a0c12f-opt-0",
    [CFB.signupDate]: String(ms("2026-01-05")),
    [CFB.closer]: "  Hamad ",
    [CFB.churnReason]: "",
    [CFB.nextPaymentAmount]: 0,
  });
  // Money fields that declare their own currency.
  t.custom_fields = t.custom_fields.map((f: Any) =>
    f.id === CFB.mrr ? { id: f.id, ...kwd("460.125") } : f.id === CFB.ltv ? { id: f.id, value: 50, type_config: { currency_type: "EUR" } } : f,
  );
  const internal = card("t9", "[internal test] lifecycle", { [CFB.churnDate]: String(ms("2026-09-30")) });
  const { rows, unknownCurrencies, unread } = billingDays(
    [t, internal, { id: "t8", name: "x" }],
    options,
    Date.parse("2026-10-09T22:00:00Z"), // already the 10th in Kuwait
  );
  assert.deepEqual(unread, ["t8"]);
  assert.deepEqual(unknownCurrencies, ["EUR"]);
  assert.equal(rows.length, 2, "internal cards are kept in the snapshot, as Convex kept them");
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "captured_at", "churn_date", "churn_reason", "churn_type", "clickup_task_id", "client_name", "closer",
    "contract_status", "day", "launch_date", "lead_source", "ltv_usd", "mrr_usd", "next_payment_date",
    "next_payment_usd", "next_renewal_date", "paused_on", "payment_method", "payment_plan", "signup_date",
    "source_currency", "source_deployment", "source_id", "source_record", "stage",
  ]);
  assert.equal(rows[0].day, "2026-10-10");
  assert.equal(rows[0].captured_at, "2026-10-09T22:00:00.000Z");
  assert.equal(rows[0].stage, "Paused");
  assert.equal(rows[0].payment_plan, "Paid in full (90 days)");
  assert.equal(rows[0].contract_status, "Signed");
  assert.equal(rows[0].mrr_usd, 1500.01); // 460.125 KWD at 3.26
  assert.equal(rows[0].source_currency, "KWD");
  assert.equal(rows[0].ltv_usd, null, "an unknown currency is no number, never a figure at rate 1");
  assert.equal(rows[0].next_payment_usd, null, "a zero is an unfilled field, as in ceo/billing.ts");
  assert.equal(rows[0].signup_date, "2026-01-05");
  assert.equal(rows[0].closer, "Hamad");
  assert.equal(rows[0].churn_reason, null);
  assert.equal(rows[0].source_deployment, "billing-sync");
  assert.equal(rows[1].churn_date, "2026-09-30");
});

test("a read that cannot be trusted is never written", () => {
  const ok = { tasks: 120, pagesCapped: false, missingFields: [], accounts: 110, mirrorRows: 100 };
  assert.equal(readProblem(ok), null);
  assert.match(readProblem({ ...ok, tasks: 0 })!, /no cards/);
  assert.match(readProblem({ ...ok, pagesCapped: true })!, /incomplete/);
  assert.match(readProblem({ ...ok, accounts: 40 })!, /40 client cards but the mirror holds 100/);
  assert.match(readProblem({ ...ok, missingFields: [F.method] })!, /no longer has field/);
  assert.deepEqual(missingFields(options), []);
  assert.deepEqual(missingFields(optionsFrom({ fields: FIELDS.fields.filter(f => f.id !== F.extension) })), [F.extension]);
  assert.equal(LIST_ID, "901816559981");
});

test("only the fields the readers depend on stop a run; pages end when ClickUp says so", () => {
  assert.ok(CRITICAL_FIELDS.includes(F.status) && CRITICAL_FIELDS.includes(F.mrr));
  assert.ok(!CRITICAL_FIELDS.includes(CFB.closer) && !CRITICAL_FIELDS.includes(F.country));
  const full = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  assert.equal(lastPage({ last_page: false }, full), false);
  assert.equal(lastPage({ last_page: true }, full), true);
  assert.equal(lastPage({}, full), false, "no last_page and a full page: read on");
  assert.equal(lastPage({}, full.slice(0, 40)), true);
  assert.equal(lastPage({ last_page: false }, []), true);
});

test("stored sentences carry no credentials", () => {
  const token = "pk_123456_ABCDEFGHIJKLMNOP";
  assert.equal(redact(`ClickUp said ${token} was wrong`, [token]), "ClickUp said [key] was wrong");
  assert.equal(redact("auth pk_99_XYZ and Bearer abc.def"), "auth [key] and Bearer [key]");
  assert.equal(redact("key eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl here"), "key [key] here");
});

test("the run note says what a dry run would do and how to turn it on", () => {
  const plan = planMirror([acme()], options, [mirror({ payment_method: "Tap link" })], [], NOW_ISO);
  const note = runNote({
    apply: false,
    plan,
    days: 1,
    unknownCurrencies: [],
    inbox: { ready: true, pending: 2, ingested: 1, duplicate: 1, rejected: 0, waiting: 0 },
  });
  assert.equal(
    note,
    "Dry run, nothing written: 1 card read, 1 changed; 1 day snapshot; inbox would take 1 in, 1 already there, 0 refused; set BILLING_SYNC_APPLY=true to write",
  );
  assert.match(
    runNote({ apply: true, plan, days: 1, unknownCurrencies: ["EUR"], inbox: { ready: false, pending: 3 } }),
    /^1 card mirrored, 1 changed; 1 day snapshot; no rate for EUR; inbox waits: manual payment history is not reconciled \(3 payments pending\)$/,
  );
});

test("an edit whose ClickUp write-back is still waiting stays held; once delivered, the card's clock decides", () => {
  // The cockpit set Tap link at 07:00; somebody touched the card at 07:30 (a comment, another field).
  const edit = { id: 41, clickup_task_id: "t1", kind: "method", from_value: "Bank transfer", to_value: "Tap link", source: "csm", at: "2026-10-09T07:00:00Z" };
  const existing = [mirror({ payment_method: "Tap link", source: "csm" })];
  const touched = [acme({}, { date_updated: String(Date.parse("2026-10-09T07:30:00Z")) })];
  // Queued, retrying or a dry run: the write has not reached ClickUp, so the mirror keeps the edit.
  const waiting = planMirror(touched, options, existing, [edit], NOW_ISO, new Set(["41"]));
  assert.equal(waiting.rows[0].row.payment_method, "Tap link");
  assert.equal(waiting.rows[0].row.source, "csm");
  assert.deepEqual(waiting.held, [{ taskId: "t1", name: "Acme", column: "payment_method", mirror: "Tap link", card: "Bank transfer" }]);
  // Delivered (no longer waiting) and the card changed after the edit: ClickUp's value is the record again.
  const delivered = planMirror(touched, options, existing, [edit], NOW_ISO, new Set(["99"]));
  assert.equal(delivered.rows[0].row.payment_method, "Bank transfer");
  assert.equal(delivered.rows[0].row.source, "sync");
  // Delivered, but the card has not changed since the edit: still held by the clock, as before.
  assert.equal(planMirror([acme()], options, existing, [edit], NOW_ISO, new Set()).rows[0].row.payment_method, "Tap link");
});

test("a waiting write-back holds the column even when a newer delivered edit is on it", () => {
  const older = { id: 1, clickup_task_id: "t1", kind: "date", source: "csm", to_value: "2026-10-25", at: "2026-10-09T06:00:00Z" };
  const newer = { id: 2, clickup_task_id: "t1", kind: "date", source: "ceo", to_value: "2026-10-27", at: "2026-10-09T07:00:00Z" };
  for (const events of [[older, newer], [newer, older]]) {
    const edits = humanEdits(events, new Set(["1"]));
    assert.deepEqual(edits.get("t1")?.get("next_payment_date"), { at: Date.parse("2026-10-09T07:00:00Z"), source: "ceo", waiting: true });
  }
  assert.deepEqual(humanEdits([older, newer]).get("t1")?.get("next_payment_date"), { at: Date.parse("2026-10-09T07:00:00Z"), source: "ceo" });
});
