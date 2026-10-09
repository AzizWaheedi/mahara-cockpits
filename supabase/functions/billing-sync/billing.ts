// billing-sync: the pure rules. No Deno, no network, no database.
//
// This ports two Convex jobs that stopped on 2026-10-07 22:47 UTC:
//
// 1. billing.syncMirror (apps/media-buyer-cockpit/convex/billing.ts and
//    billingCore.ts): every card on Clients - Mahara as one row of
//    cockpit_billing_accounts. The field ids, the dropdown reading, the
//    groups and the internal-card filter are billingCore's, unchanged.
//    Three rules are new, because the mirror now also holds edits made in
//    the cockpits that never reached ClickUp:
//      - A value is never blanked because ClickUp returned nothing for it.
//      - A field a person changed in a cockpit (a cockpit_billing_events row
//        from ceo, csm or maher) is kept until the card itself changes after
//        that edit. ClickUp's date_updated is the only clock it has. While
//        the edit's ClickUp write-back (clickup-writeback, migration
//        20261009j) is queued, in flight, retrying or a dry run, the edit is
//        kept whatever the clock says; once it is delivered, the clock rule
//        applies again.
//      - A card the read did not return is left alone, never deleted.
//
// 2. ceoClientBilling (apps/media-buyer-cockpit/convex/ceo/billing.ts
//    billingRows): the billing and lifecycle fields of every card, internal
//    cards included, as one cockpit_client_billing_days row per card per
//    Kuwait day, in the shape the one-off import wrote
//    (scripts/import-cockpit-runtime-sources.py, BILLING_FIELDS).

// biome-ignore lint/suspicious/noExplicitAny: ClickUp and PostgREST payloads
export type Any = Record<string, any>;

/** Clients - Mahara. */
export const LIST_ID = "901816559981";

/** billingCore.ts F: the card fields the billing sheet reads and writes. */
export const F = {
  status: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
  method: "665e5754-b9c6-4776-9386-111ad221dead",
  plan: "17d17129-43c4-441b-a55c-6eca83b9f776",
  nextAmount: "f071ee8f-b7ce-49e8-899b-6bef649d86ba",
  nextDate: "669ae046-bf82-4b59-80d5-bf25d6b57ef3",
  mrr: "48eb6023-8944-4404-9e30-b01fc8a38256",
  ltv: "11d70e58-20e7-4ff0-85c6-51de42f044d2",
  pausedOn: "930c49eb-9374-410c-801f-9aa81fff4944",
  extension: "8cb9d308-5df5-4ea1-b83d-32b5b7eea778",
  churnDate: "42429a6e-5cba-4a3b-964d-2b493315421b",
  country: "e0ca65e7-7656-4113-9aae-9feda834c3f9",
} as const;

/** ceo/billing.ts CFB: the billing and lifecycle fields for the daily snapshot. */
export const CFB = {
  mrr: "48eb6023-8944-4404-9e30-b01fc8a38256",
  ltv: "11d70e58-20e7-4ff0-85c6-51de42f044d2",
  nextPaymentAmount: "f071ee8f-b7ce-49e8-899b-6bef649d86ba",
  nextPaymentDate: "669ae046-bf82-4b59-80d5-bf25d6b57ef3",
  paymentPlan: "17d17129-43c4-441b-a55c-6eca83b9f776",
  paymentMethod: "665e5754-b9c6-4776-9386-111ad221dead",
  contractStatus: "ac976d4a-409b-441c-8c13-4b0e73a0c12f",
  nextContractRenewal: "eaa2caf3-899d-4072-beb3-72ef3c0427f1",
  signupDate: "03968cf6-dac1-43b6-8f02-cef999af2bbb",
  launchDate: "2e744484-f581-4c37-962a-023c4de23729",
  pausedOn: "930c49eb-9374-410c-801f-9aa81fff4944",
  churnDate: "42429a6e-5cba-4a3b-964d-2b493315421b",
  churnReason: "796f25e7-7e63-4d08-9ec4-41c58a5b57ca",
  churnType: "a121f39a-f8a4-41f5-905e-a735ee729071",
  closer: "63af118b-bb16-48ba-9ddb-d0185b32fb23",
  leadSource: "e993c247-2b0e-4543-bcd8-7e1ed02f65fa",
  status: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
} as const;

/** The cockpit's fixed rates (convex/ceo/data/tap.ts), so a dollar means the same everywhere. */
export const USD_PER: Record<string, number> = {
  USD: 1,
  KWD: 3.26,
  AED: 0.2723,
  SAR: 0.2666,
  QAR: 0.2747,
};

export type Group = "active" | "paused" | "pipeline" | "sales" | "gone";
type Source = "sync" | "ceo" | "csm" | "maher";

const GONE = new Set(["Stopped", "CANCELLED ONBOARDING"]);
const SALES = "SALES TEAM TO CONTACT";
const INTERNAL = /playing account|\[internal test\]/i;

export function groupOf(status: string | null | undefined): Group {
  const s = String(status ?? "");
  if (s === "Active") return "active";
  if (s === "Paused") return "paused";
  if (GONE.has(s)) return "gone";
  if (s === SALES) return "sales";
  return "pipeline";
}

export const isInternal = (name: string): boolean => INTERNAL.test(name);

/** Today in Kuwait, "YYYY-MM-DD". */
export const kuwaitDay = (ms: number): string =>
  new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

/** A ClickUp date (epoch ms) as the Kuwait day people mean. */
function dayOf(ms: unknown): string | null {
  const n = Number(ms);
  if (ms === null || ms === undefined || ms === "" || !Number.isFinite(n) || n <= 0) return null;
  return kuwaitDay(n);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// --- the list's fields ------------------------------------------------------

export type Options = Map<string, Map<string, { id: string; index: number }>>;

/** GET list/{id}/field, name to option, per dropdown field (billingCore.fieldOptions). */
export function optionsFrom(res: unknown): Options {
  const out: Options = new Map();
  for (const f of ((res as Any)?.fields ?? []) as Any[]) {
    const opts = new Map<string, { id: string; index: number }>();
    for (const o of (f?.type_config?.options ?? []) as Any[])
      opts.set(String(o.name), { id: String(o.id), index: Number(o.orderindex) });
    out.set(String(f?.id), opts);
  }
  return out;
}

/**
 * The field ids this job reads that the list no longer has. A renamed field
 * keeps its id; a deleted or replaced one does not, and reading it would
 * quietly turn every card's value into "not filled".
 */
export function missingFields(options: Options): string[] {
  const wanted = new Set<string>([...Object.values(F), ...Object.values(CFB)]);
  return [...wanted].filter(id => !options.has(id)).sort();
}

/**
 * The fields the readers depend on: the group a card is in, what it pays and
 * when. Without one of these the run stops; any other missing field is named
 * in the run note and reads as not filled, as it did in Convex.
 */
export const CRITICAL_FIELDS: readonly string[] = [
  F.status,
  F.method,
  F.plan,
  F.nextAmount,
  F.nextDate,
  F.mrr,
  F.ltv,
  F.pausedOn,
];

/** Whether this page of GET list/{id}/task is the last one. */
export const lastPage = (res: Any, batch: unknown[]): boolean =>
  res?.last_page === true || batch.length === 0 || (res?.last_page !== false && batch.length < 100);

/** A dropdown read is an option index or id; this is its name (billingCore.dropdownName). */
function dropdownName(options: Options, fieldId: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  for (const [name, o] of options.get(fieldId) ?? [])
    if (o.index === Number(value) || o.id === String(value)) return name;
  return null;
}

const fieldOf = (t: Any, id: string): Any | undefined =>
  ((t?.custom_fields ?? []) as Any[]).find(c => String(c?.id) === id);

/** A card whose payload carries no custom fields at all was not read, not emptied. */
export const fieldsRead = (t: Any): boolean =>
  Array.isArray(t?.custom_fields) && t.custom_fields.length > 0;

// --- 1. the mirror: cockpit_billing_accounts --------------------------------

export type AccountRow = {
  clickup_task_id: string;
  client_name: string;
  task_url: string | null;
  stage: string | null;
  stage_group: Group;
  client_status: string | null;
  payment_method: string | null;
  payment_plan: string | null;
  country: string | null;
  next_payment_usd: number | null;
  next_payment_date: string | null;
  mrr_usd: number | null;
  ltv_field_usd: number | null;
  paused_on: string | null;
  extension_weeks: number | null;
  churn_date: string | null;
  csm: string | null;
  source: Source;
  synced_at: string;
};

/** billingCore.toAccount then accountRow, in one step. */
export function accountFromTask(t: Any, options: Options, nowIso: string): AccountRow {
  const val = (id: string) => fieldOf(t, id)?.value;
  const status = dropdownName(options, F.status, val(F.status));
  return {
    clickup_task_id: String(t.id),
    client_name: String(t.name ?? "").trim(),
    task_url: t.url ? String(t.url) : null,
    stage: status,
    stage_group: groupOf(status),
    client_status: status,
    payment_method: dropdownName(options, F.method, val(F.method)),
    payment_plan: dropdownName(options, F.plan, val(F.plan)),
    country: dropdownName(options, F.country, val(F.country)),
    next_payment_usd: num(val(F.nextAmount)),
    next_payment_date: dayOf(val(F.nextDate)),
    mrr_usd: num(val(F.mrr)),
    ltv_field_usd: num(val(F.ltv)),
    paused_on: dayOf(val(F.pausedOn)),
    extension_weeks: num(val(F.extension)),
    churn_date: dayOf(val(F.churnDate)),
    csm:
      ((t.assignees ?? []) as Any[])
        .map(a => String(a?.username ?? a?.email ?? ""))
        .filter(Boolean)
        .join(", ") || null,
    source: "sync",
    synced_at: nowIso,
  };
}

/** Columns the sync owns. The three status columns move as one. */
const STATUS = ["stage", "stage_group", "client_status"] as const;
const PLAIN = [
  "client_name",
  "task_url",
  "payment_method",
  "payment_plan",
  "country",
  "next_payment_usd",
  "next_payment_date",
  "mrr_usd",
  "ltv_field_usd",
  "paused_on",
  "extension_weeks",
  "churn_date",
  "csm",
] as const;
type Column = (typeof PLAIN)[number] | "client_status";

const HUMAN = new Set(["ceo", "csm", "maher"]);

/** Which mirror columns one cockpit_billing_events row changed. */
export function columnsOf(e: Any): Column[] {
  if (!HUMAN.has(String(e?.source))) return [];
  const d = (e?.detail ?? {}) as Any;
  switch (String(e?.kind)) {
    case "method":
      return ["payment_method"];
    case "plan":
      return ["payment_plan"];
    case "amount":
      return ["next_payment_usd"];
    case "date":
      return ["next_payment_date"];
    case "extension":
      return d.movedDate === true || (d.movedDateTo !== undefined && d.movedDateTo !== null)
        ? ["extension_weeks", "next_payment_date"]
        : ["extension_weeks"];
    case "pause":
      return ["client_status", "paused_on"];
    case "resume":
      return d.nextDate ? ["client_status", "paused_on", "next_payment_date"] : ["client_status", "paused_on"];
    case "payment":
      return e?.to_value && e.to_value !== e.from_value ? ["next_payment_date"] : [];
    default:
      return [];
  }
}

/** waiting: an edit to this column still has its ClickUp write-back pending or held as a dry run. */
export type Edits = Map<Column, { at: number; source: Source; waiting?: true }>;

/**
 * The newest cockpit edit per card and column: when (epoch ms) and from which
 * cockpit. `waiting` holds the ids of events whose ClickUp write-back is not
 * delivered yet (queue states queued, sending, retry, unknown, dry_run).
 */
export function humanEdits(events: Any[], waiting?: Set<string>): Map<string, Edits> {
  const out = new Map<string, Edits>();
  for (const e of events) {
    const at = Date.parse(String(e?.at ?? ""));
    const task = String(e?.clickup_task_id ?? "");
    if (!task || !Number.isFinite(at)) continue;
    const pending = waiting?.has(String(e?.id)) === true;
    for (const c of columnsOf(e)) {
      const m: Edits = out.get(task) ?? new Map();
      const prev = m.get(c);
      const next = !prev || at > prev.at ? { at, source: e.source as Source } : { at: prev.at, source: prev.source };
      m.set(c, pending || prev?.waiting ? { ...next, waiting: true } : next);
      out.set(task, m);
    }
  }
  return out;
}

/** PostgREST hands numerics back as numbers or strings; compare them as values. */
function norm(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return String(v);
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
}
const same = (a: unknown, b: unknown) => norm(a) === norm(b);

export type FieldChange = { column: string; from: unknown; to: unknown };
export type Merge = {
  row: AccountRow;
  isNew: boolean;
  changes: FieldChange[];
  /** Blank on the card, kept from the mirror. Could be a real clear; a person decides. */
  kept: string[];
  /** A cockpit edit newer than the card that ClickUp does not show yet. */
  held: { column: string; mirror: unknown; card: unknown }[];
};

/**
 * One card: what ClickUp says, merged onto what the mirror holds.
 *
 * `edits` is this card's newest cockpit edit per column; `cardUpdatedMs` is
 * the card's date_updated. A column edited in a cockpit at or after the
 * card's last change keeps the mirror's value, and so does a column whose
 * edit is still waiting for its ClickUp write-back (`edits` marks it waiting).
 *
 * Paused On is read with the status, not on its own: when ClickUp's status
 * was read, an empty Paused On is a real reading. Keeping an old pause date
 * on a card paused again without one would start the fifteen-day churn clock
 * from the first pause (Maher's pitfall in billingCore.ladderOf).
 */
export function mergeAccount(
  existing: Any | undefined,
  incoming: AccountRow,
  edits: Edits | undefined,
  cardUpdatedMs: number | null,
): Merge {
  if (!existing) return { row: { ...incoming }, isNew: true, changes: [], kept: [], held: [] };
  const row: AccountRow = { ...incoming };
  const r = row as unknown as Any;
  const changes: FieldChange[] = [];
  const kept: string[] = [];
  const held: Merge["held"] = [];
  // No card clock is no evidence the card moved on: keep the person's edit.
  // Nor is a clock that moved while the edit's ClickUp write still waits.
  const isHeld = (c: Column) => {
    const e = edits?.get(c);
    return e !== undefined && (e.waiting === true || cardUpdatedMs === null || e.at >= cardUpdatedMs);
  };
  const hold = (c: Column, mirror: unknown, card: unknown) => {
    if (!same(mirror, card)) held.push({ column: c, mirror: mirror ?? null, card });
  };
  const statusRead = incoming.client_status !== null && !isHeld("client_status");
  for (const c of PLAIN) {
    const blank = incoming[c] === null || (c === "client_name" && incoming[c] === "");
    if (isHeld(c)) {
      hold(c, existing[c], incoming[c]);
      r[c] = existing[c] ?? null;
    } else if (blank && !(c === "paused_on" && statusRead)) {
      if (norm(existing[c]) !== null) kept.push(c);
      r[c] = existing[c] ?? (c === "client_name" ? incoming[c] : null);
    }
  }
  // Status is one decision: an unread or held status keeps its group with it.
  if (isHeld("client_status")) {
    hold("client_status", existing.client_status, incoming.client_status);
    for (const c of STATUS) r[c] = existing[c] ?? null;
    r.stage_group = existing.stage_group ?? groupOf(existing.client_status);
  } else if (incoming.client_status === null && norm(existing.client_status) !== null) {
    kept.push("client_status");
    for (const c of STATUS) r[c] = existing[c] ?? null;
    r.stage_group = existing.stage_group ?? groupOf(existing.client_status);
  }
  for (const c of [...PLAIN, ...STATUS])
    if (!same(existing[c], r[c])) changes.push({ column: c, from: existing[c] ?? null, to: r[c] });
  // The row says who last wrote a value ClickUp does not show yet.
  if (held.length) {
    const newest = held
      .map(h => edits?.get(h.column as Column))
      .filter((e): e is { at: number; source: Source } => Boolean(e))
      .sort((a, b) => b.at - a.at)[0];
    row.source = newest?.source ?? "csm";
  }
  return { row, isNew: false, changes, kept, held };
}

export type MirrorPlan = {
  rows: { row: AccountRow; expected_synced_at: string | null }[];
  changed: { taskId: string; name: string; isNew: boolean; changes: FieldChange[] }[];
  kept: { taskId: string; name: string; columns: string[] }[];
  held: { taskId: string; name: string; column: string; mirror: unknown; card: unknown }[];
  /** Mirror rows the read did not return: left as they are. */
  notOnList: { taskId: string; name: string }[];
  /** Cards whose payload carried no fields: left as they are. */
  unread: string[];
  internal: number;
};

export function planMirror(
  tasks: Any[],
  options: Options,
  existing: Any[],
  events: Any[],
  nowIso: string,
  waiting?: Set<string>,
): MirrorPlan {
  const byId = new Map(existing.map(r => [String(r.clickup_task_id), r]));
  const edits = humanEdits(events, waiting);
  const plan: MirrorPlan = { rows: [], changed: [], kept: [], held: [], notOnList: [], unread: [], internal: 0 };
  const seen = new Set<string>();
  for (const t of tasks) {
    const id = String(t?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (isInternal(String(t.name ?? ""))) {
      plan.internal += 1;
      continue;
    }
    if (!fieldsRead(t)) {
      plan.unread.push(id);
      continue;
    }
    const before = byId.get(id);
    const updated = num(t.date_updated);
    const m = mergeAccount(before, accountFromTask(t, options, nowIso), edits.get(id), updated);
    plan.rows.push({ row: m.row, expected_synced_at: before ? (before.synced_at ?? null) : null });
    const name = m.row.client_name;
    if (m.isNew || m.changes.length) plan.changed.push({ taskId: id, name, isNew: m.isNew, changes: m.changes });
    if (m.kept.length) plan.kept.push({ taskId: id, name, columns: m.kept });
    for (const h of m.held) plan.held.push({ taskId: id, name, ...h });
  }
  for (const r of existing) {
    const id = String(r.clickup_task_id);
    if (!seen.has(id)) plan.notOnList.push({ taskId: id, name: String(r.client_name ?? "") });
  }
  return plan;
}

// --- 2. the daily snapshot: cockpit_client_billing_days ---------------------

export type DayRow = {
  day: string;
  clickup_task_id: string;
  client_name: string;
  stage: string | null;
  mrr_usd: number | null;
  ltv_usd: number | null;
  next_payment_usd: number | null;
  source_currency: string | null;
  next_payment_date: string | null;
  signup_date: string | null;
  launch_date: string | null;
  paused_on: string | null;
  churn_date: string | null;
  next_renewal_date: string | null;
  payment_plan: string | null;
  payment_method: string | null;
  contract_status: string | null;
  churn_reason: string | null;
  churn_type: string | null;
  closer: string | null;
  lead_source: string | null;
  captured_at: string;
  source_deployment: string;
  source_id: null;
  source_record: null;
};

/** ceo/billing.ts label: the task's own options first, then the list's. */
function label(t: Any, id: string, options: Options): string | null {
  const f = fieldOf(t, id);
  if (!f || f.value === undefined || f.value === null || f.value === "") return null;
  const opts = (f.type_config?.options ?? []) as Any[];
  const hit =
    opts.find(o => o.id === f.value) ?? opts.find(o => String(o.orderindex) === String(f.value));
  return hit?.name ? String(hit.name) : dropdownName(options, id, f.value);
}

function text(t: Any, id: string): string | null {
  const raw = fieldOf(t, id)?.value;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s === "" ? null : s;
}

function day(t: Any, id: string): string | null {
  return dayOf(fieldOf(t, id)?.value);
}

/** ceo/billing.ts money: the field's own currency, the fixed rate, never a guess. */
function money(t: Any, id: string): { usd?: number; currency?: string; unknown?: string } {
  const f = fieldOf(t, id);
  if (!f) return {};
  const n = Number(f.value);
  if (f.value === null || f.value === undefined || f.value === "" || !Number.isFinite(n) || n === 0) return {};
  const currency = String(f.type_config?.currency_type ?? "USD").toUpperCase();
  const rate = USD_PER[currency];
  if (rate === undefined) return { currency, unknown: currency };
  return { usd: Math.round(n * rate * 100) / 100, currency };
}

export function billingDays(
  tasks: Any[],
  options: Options,
  nowMs: number,
): { rows: DayRow[]; unknownCurrencies: string[]; unread: string[] } {
  const rows: DayRow[] = [];
  const unknown = new Set<string>();
  const unread: string[] = [];
  const seen = new Set<string>();
  const today = kuwaitDay(nowMs);
  const at = new Date(nowMs).toISOString();
  for (const t of tasks) {
    const taskId = String(t?.id ?? "");
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);
    if (!fieldsRead(t)) {
      unread.push(taskId);
      continue;
    }
    const mrr = money(t, CFB.mrr);
    const ltv = money(t, CFB.ltv);
    const next = money(t, CFB.nextPaymentAmount);
    for (const c of [mrr, ltv, next]) if (c.unknown) unknown.add(c.unknown);
    const currency = mrr.currency ?? ltv.currency ?? next.currency ?? null;
    rows.push({
      day: today,
      clickup_task_id: taskId,
      client_name: String(t?.name ?? "").trim() || `ClickUp card ${taskId}`,
      stage: label(t, CFB.status, options),
      mrr_usd: mrr.usd ?? null,
      ltv_usd: ltv.usd ?? null,
      next_payment_usd: next.usd ?? null,
      source_currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      next_payment_date: day(t, CFB.nextPaymentDate),
      signup_date: day(t, CFB.signupDate),
      launch_date: day(t, CFB.launchDate),
      paused_on: day(t, CFB.pausedOn),
      churn_date: day(t, CFB.churnDate),
      next_renewal_date: day(t, CFB.nextContractRenewal),
      payment_plan: label(t, CFB.paymentPlan, options),
      payment_method: label(t, CFB.paymentMethod, options),
      contract_status: label(t, CFB.contractStatus, options),
      churn_reason: label(t, CFB.churnReason, options) ?? text(t, CFB.churnReason),
      churn_type: label(t, CFB.churnType, options),
      closer: label(t, CFB.closer, options) ?? text(t, CFB.closer),
      lead_source: label(t, CFB.leadSource, options) ?? text(t, CFB.leadSource),
      captured_at: at,
      source_deployment: "billing-sync",
      source_id: null,
      source_record: null,
    });
  }
  return { rows, unknownCurrencies: [...unknown].sort(), unread };
}

// --- guards and the run note ---------------------------------------------------

/**
 * Why this read must not be written, or null. An empty or truncated read
 * would otherwise look like "every client pays nothing".
 */
export function readProblem(r: {
  tasks: number;
  pagesCapped: boolean;
  missingFields: string[];
  accounts: number;
  mirrorRows: number;
}): string | null {
  if (r.missingFields.length)
    return `The Clients - Mahara list no longer has ${r.missingFields.length === 1 ? "field" : "fields"} ${r.missingFields.join(", ")}. Nothing was written. Check the field ids in billing-sync/billing.ts.`;
  if (r.tasks === 0) return "ClickUp returned no cards on Clients - Mahara. Nothing was written.";
  if (r.pagesCapped) return "ClickUp returned more pages than billing-sync reads, so the read may be incomplete. Nothing was written.";
  if (r.mirrorRows >= 10 && r.accounts < r.mirrorRows * 0.5)
    return `ClickUp returned ${r.accounts} client cards but the mirror holds ${r.mirrorRows}. Nothing was written. Check the list before the next run.`;
  return null;
}

/** Remove anything that could be a credential from a sentence that is stored. */
export function redact(s: string, secrets: string[] = []): string {
  let out = s;
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join("[key]");
  return out
    .replace(/\bpk_\d+_[A-Za-z0-9]+/g, "[key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [key]")
    .slice(0, 300);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line kept in cockpit_sync_state. */
export function runNote(r: {
  apply: boolean;
  plan: MirrorPlan;
  days: number;
  unknownCurrencies: string[];
  inbox: { pending?: number; ingested?: number; duplicate?: number; rejected?: number; waiting?: number; ready?: boolean } | null;
  skipped?: number;
  missingFields?: string[];
}): string {
  const p = r.plan;
  const parts = [
    `${r.apply ? "" : "Dry run, nothing written: "}${plural(p.rows.length, "card")} ${r.apply ? "mirrored" : "read"}, ${p.changed.length} changed`,
    plural(r.days, "day snapshot"),
  ];
  if (p.held.length) parts.push(`${plural(p.held.length, "cockpit edit")} not on the ClickUp card yet`);
  if (p.kept.length) parts.push(`${plural(p.kept.length, "card")} with blank ClickUp fields kept from the mirror`);
  if (p.notOnList.length) parts.push(`${plural(p.notOnList.length, "mirror row")} not on the list, left as is`);
  if (p.unread.length) parts.push(`${plural(p.unread.length, "card")} returned without fields, left as is`);
  if (r.skipped) parts.push(`${plural(r.skipped, "row")} edited during the run, left for the next run`);
  if (r.unknownCurrencies.length) parts.push(`no rate for ${r.unknownCurrencies.join(", ")}`);
  if (r.missingFields?.length) parts.push(`not on the list, read as not filled: ${r.missingFields.join(", ")}`);
  const i = r.inbox;
  if (i && i.ready === false) parts.push(`inbox waits: manual payment history is not reconciled (${plural(i.pending ?? 0, "payment")} pending)`);
  else if (i)
    parts.push(
      `inbox ${r.apply ? "" : "would take "}${i.ingested ?? 0} in, ${i.duplicate ?? 0} already there, ${i.rejected ?? 0} refused${i.waiting ? `, ${i.waiting} waiting` : ""}`,
    );
  if (!r.apply) parts.push("set BILLING_SYNC_APPLY=true to write");
  return parts.join("; ").slice(0, 600);
}
