import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  checkPlan,
  type PayCostRow,
  type PayMonth,
  type PayPlansList,
} from "../types/ceo/payPlan";

/**
 * Pay plans on Team & payroll (docs/pay/PAY-PLANS.md section 7), behind
 * `api.ceo.pay.<op>`. Every call is a CEO-gated RPC of
 * supabase/migrations/20261018a_ceo_pay_plans.sql, named literally here so
 * the RPC inventory finds it. The server works out every amount and refuses
 * with a sentence; this file checks the shape of what comes back (unknown
 * fields pass through) and returns the server's sentence on a refusal.
 * No pay figure is ever logged from here.
 */

type Row = Record<string, unknown>;
const YM = /^\d{4}-(0[1-9]|1[0-2])(-01)?$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The server's sentence without Postgres' prefixes, or a plain fallback. */
function sentence(raw: unknown, fallback: string): string {
  const text = String(raw ?? "")
    .split("\n")[0]
    .replace(/^(ERROR|error):\s*/, "")
    .replace(/^\[.*?]\s*/, "")
    .trim();
  return text || fallback;
}

function signedIn(client: SupabaseClient | null): SupabaseClient {
  if (!client) throw new Error("Sign in before reading or changing pay.");
  return client;
}

/** The data of an RPC answer, or the server's sentence as the error. */
function answer(
  res: { data: unknown; error: { message?: string } | null },
  fallback: string,
): unknown {
  if (res.error) throw new Error(sentence(res.error.message, fallback));
  return res.data;
}

function checkMonth(month: unknown): string {
  if (typeof month !== "string" || !YM.test(month))
    throw new Error("Choose a month, as YYYY-MM.");
  return month.slice(0, 7);
}
function checkPerson(id: unknown): number {
  if (!Number.isSafeInteger(id) || Number(id) <= 0)
    throw new Error("Choose a person first.");
  return Number(id);
}
/** The payload without the keys left undefined; the server refuses unknown keys. */
function only(args: Row, allowed: readonly string[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined) continue;
    if (!allowed.includes(k)) throw new Error(`Unknown field: ${k}`);
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error("Amounts must be finite numbers.");
    out[k] = v;
  }
  return out;
}

// --- Shapes (the fields screens rely on; anything else passes through) ---

const num = z.number().finite();
const numOrNull = num.nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

const planRowSchema = z
  .object({
    id: z.number().int().positive(),
    role: z.string().nullable(),
    personId: z.number().int().positive().nullable(),
    fromMonth: day,
    plan: z
      .object({ version: z.literal(1), parts: z.array(z.any()) })
      .passthrough()
      .nullable(),
    note: z.string().nullable(),
    setBy: z.string(),
    setAt: z.string(),
  })
  .passthrough();

const listSchema = z
  .object({
    plans: z.array(planRowSchema),
    roles: z.array(z.string()),
    people: z.array(
      z
        .object({
          id: z.number().int().positive(),
          name: z.string(),
          role: z.string().nullable(),
          active: z.boolean(),
        })
        .passthrough(),
    ),
    lastApproved: z.array(
      z
        .object({ personId: z.number().int().positive(), month: day })
        .passthrough(),
    ),
    approvedPlanIds: z.array(z.number().int().positive()),
  })
  .passthrough();

const inputSchema = z
  .object({
    value: numOrNull,
    unit: z.enum(["usd", "pct", "count", "cash"]),
    state: z.enum([
      "measured",
      "confirmed",
      "typed",
      "missing",
      "not_met",
      "waiting",
    ]),
    source: z.string(),
  })
  .passthrough();

const personSchema = z
  .object({
    personId: z.number().int().positive(),
    name: z.string(),
    role: z.string().nullable(),
    currency: z.string(),
    base: z.object({ usd: numOrNull, source: z.string() }).passthrough(),
    plan: z
      .object({
        source: z.enum(["own", "role", "none"]),
        planId: z.number().nullable(),
      })
      .passthrough(),
    commission: z.array(
      z
        .object({
          line: z.number().int(),
          basis: z.string(),
          rate: numOrNull,
          amountUsd: numOrNull,
          state: z.enum(["measured", "missing", "waiting", "not_here"]),
        })
        .passthrough(),
    ),
    parts: z.array(
      z
        .object({
          key: z.string(),
          kind: z.string(),
          label: z.string(),
          input: inputSchema.nullable(),
          amountUsd: numOrNull,
          state: z.enum(["known", "missing", "not_met", "waiting"]),
        })
        .passthrough(),
    ),
    entries: z.array(
      z
        .object({ id: z.number().int().positive(), partKey: z.string() })
        .passthrough(),
    ),
    knownUsd: num,
    lowestUsd: num,
    totalUsd: numOrNull,
    missing: z.array(z.string()),
    notPriced: z.array(z.string()),
    status: z.enum(["in_progress", "waiting", "ready", "approved"]),
    resultHash: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .passthrough();

const monthSchema = z
  .object({
    month: day,
    today: day,
    closed: z.boolean(),
    settleDay: day,
    facts: z.record(z.string(), z.unknown()).nullable().optional(),
    people: z.array(personSchema),
    notOnAPlan: z.array(
      z
        .object({ personId: z.number(), name: z.string(), why: z.string() })
        .passthrough(),
    ),
    notes: z.array(z.string()),
  })
  .passthrough();

const costsSchema = z
  .object({
    months: z.array(
      z
        .object({
          personId: z.number().int().positive(),
          month: day,
          commissionUsd: numOrNull,
          partsUsd: num,
          notPriced: z.array(z.string()),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const okSchema = z.object({ ok: z.literal(true) }).passthrough();

function parsed<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success)
    throw new Error(
      `${what} was not confirmed by the server. Open the page again in a minute.`,
    );
  return r.data;
}

// --- Reads ---

/** Every stored plan, the roles, the people and who is approved up to when. */
export async function readPayPlans(
  client: SupabaseClient | null,
): Promise<PayPlansList> {
  const res = await signedIn(client).rpc("cockpit_ceo_pay_plans_list");
  const data = answer(res, "The pay plans could not be read.");
  return parsed(listSchema, data, "The pay plans") as unknown as PayPlansList;
}

/** One month for everyone (section 6): fresh figures, approved people from their frozen result. */
export async function readPayMonth(
  client: SupabaseClient | null,
  args: { month: string },
): Promise<PayMonth> {
  const month = checkMonth(args?.month);
  const res = await signedIn(client).rpc("cockpit_ceo_pay_month", {
    p_month: `${month}-01`,
  });
  const data = answer(res, `Pay for ${month} could not be read.`);
  const out = parsed(monthSchema, data, `Pay for ${month}`);
  if (out.month.slice(0, 7) !== month)
    throw new Error(`Pay for ${month} was not confirmed by the server.`);
  return out as unknown as PayMonth;
}

/** Approved commission and parts of the last 3 months, for Costs; months as YYYY-MM. */
export async function readPayCosts(
  client: SupabaseClient | null,
): Promise<PayCostRow[]> {
  const res = await signedIn(client).rpc("cockpit_ceo_pay_costs");
  const data = answer(
    res,
    "Approved commission and bonuses could not be read.",
  );
  return parsed(
    costsSchema,
    data,
    "Approved commission and bonuses",
  ).months.map(m => ({
    personId: m.personId,
    month: m.month.slice(0, 7),
    commissionUsd: m.commissionUsd,
    partsUsd: m.partsUsd,
    notPriced: [...m.notPriced],
  }));
}

// --- Writes (each one `p jsonb`, answered {ok: true, ...}) ---

function confirmed<T extends Row>(data: unknown, fallback: string): T {
  const r = okSchema.safeParse(data);
  if (!r.success) throw new Error(fallback);
  return r.data as unknown as T;
}

/**
 * Save a plan for a role or one person from a month. The plan is checked
 * here first with the server's own sentences (checkPlan); null on a person
 * means "follow the role plan from this month". → {ok, id}
 */
export async function savePayPlan(
  client: SupabaseClient | null,
  args: {
    role?: string;
    personId?: number;
    fromMonth: string;
    plan: unknown;
    note?: string | null;
  },
): Promise<{ ok: true; id: number }> {
  const p = only(args as Row, [
    "role",
    "personId",
    "fromMonth",
    "plan",
    "note",
  ]);
  const role = typeof p.role === "string" ? p.role.trim() : null;
  const person = p.personId ?? null;
  if ((role ? 1 : 0) + (person !== null ? 1 : 0) !== 1)
    throw new Error("Choose a role or one person.");
  // One scope only: the server reads a role key, even null, as a role.
  delete p.role;
  delete p.personId;
  if (role) p.role = role;
  else p.personId = checkPerson(person);
  p.fromMonth = `${checkMonth(p.fromMonth)}-01`;
  if (!Object.hasOwn(p, "plan"))
    throw new Error("Send the plan, or null to follow the role plan.");
  if (p.plan === null) {
    if (role) throw new Error("A role plan needs its parts.");
  } else {
    const fault = checkPlan(p.plan, { isRole: Boolean(role) });
    if (fault) throw new Error(fault);
  }
  const res = await signedIn(client).rpc("cockpit_ceo_pay_plan_save", { p });
  const out = confirmed<{ ok: true; id: number }>(
    answer(res, "The pay plan was not saved."),
    "The pay plan was not saved.",
  );
  return { ok: true, id: Number(out.id) };
}

/** A count, cash or an adjustment the data cannot see, typed by the CEO. → {ok, id} */
export async function savePayEntry(
  client: SupabaseClient | null,
  args: Row,
): Promise<{ ok: true; id: number }> {
  const p = only(args, [
    "personId",
    "month",
    "partKey",
    "quantity",
    "cashUsd",
    "amountUsd",
    "engagementMonth",
    "client",
    "product",
    "clearedOn",
    "postedOn",
    "cancelledOn",
    "evidenceRef",
    "evidence",
    "note",
    "fromMonth",
  ]);
  p.personId = checkPerson(p.personId);
  p.month = checkMonth(p.month);
  if (typeof p.partKey !== "string" || !p.partKey.trim())
    throw new Error("Choose the part of the plan.");
  for (const k of ["clearedOn", "postedOn", "cancelledOn"])
    if (
      p[k] !== undefined &&
      p[k] !== null &&
      (typeof p[k] !== "string" || !YMD.test(p[k] as string))
    )
      throw new Error("Type dates as YYYY-MM-DD.");
  if (p.fromMonth !== undefined && p.fromMonth !== null)
    p.fromMonth = checkMonth(p.fromMonth);
  const res = await signedIn(client).rpc("cockpit_ceo_pay_entry_save", { p });
  const out = confirmed<{ ok: true; id: number }>(
    answer(res, "The entry was not saved."),
    "The entry was not saved.",
  );
  return { ok: true, id: Number(out.id) };
}

/** Remove an entry (it is kept, voided, with why). → {ok} */
export async function voidPayEntry(
  client: SupabaseClient | null,
  args: { id: number; reason: string },
): Promise<{ ok: true }> {
  const p = only(args as Row, ["id", "reason"]);
  if (!Number.isSafeInteger(p.id) || Number(p.id) <= 0)
    throw new Error("Choose the entry.");
  if (typeof p.reason !== "string" || p.reason.trim().length < 3)
    throw new Error("Say why, in a few words.");
  const res = await signedIn(client).rpc("cockpit_ceo_pay_entry_void", { p });
  confirmed(
    answer(res, "The entry was not removed."),
    "The entry was not removed.",
  );
  return { ok: true };
}

/** "Nothing else for [month]": a zero for every typed part still waiting. → {ok, parts} */
export async function payNoneRest(
  client: SupabaseClient | null,
  args: { personId: number; month: string },
): Promise<{ ok: true; parts: number }> {
  const p = only(args as Row, ["personId", "month"]);
  p.personId = checkPerson(p.personId);
  p.month = checkMonth(p.month);
  const res = await signedIn(client).rpc("cockpit_ceo_pay_none_rest", { p });
  const out = confirmed<{ ok: true; parts: number }>(
    answer(res, "Nothing was set."),
    "Nothing was set.",
  );
  return { ok: true, parts: Number(out.parts ?? 0) };
}

/**
 * Confirm a measure the sources disagree on (churn, qualifying clients, owned
 * creative, ramp start, a close, a setter, a paid-in-full); `value: null`
 * removes it. → {ok, id, removed}
 */
export async function confirmPay(
  client: SupabaseClient | null,
  args: { month: string; key: string; value: unknown; note?: string | null },
): Promise<{ ok: true; id: number | null; removed: boolean }> {
  const p = only(args as Row, ["month", "key", "value", "note"]);
  p.month = checkMonth(p.month);
  if (typeof p.key !== "string" || !/^[a-z_]+(:[A-Za-z0-9_.-]+)?$/.test(p.key))
    throw new Error("Choose what to confirm.");
  if (!Object.hasOwn(p, "value"))
    throw new Error("Send a value, or null to remove it.");
  const res = await signedIn(client).rpc("cockpit_ceo_pay_confirm", { p });
  const out = confirmed<{ ok: true; id?: number | null; removed?: boolean }>(
    answer(res, "It was not confirmed."),
    "It was not confirmed.",
  );
  return {
    ok: true,
    id: Number.isSafeInteger(out.id) ? Number(out.id) : null,
    removed: out.removed === true,
  };
}

/**
 * Approve a month for the people the CEO saw ready, with the totals and
 * hashes he saw: the server recomputes and refuses anyone whose figures
 * changed. → {ok, approved, existing, refused: [{personId, sentence}]}
 */
export async function approvePayMonth(
  client: SupabaseClient | null,
  args: {
    month: string;
    people: { personId: number; totalUsd: number; resultHash: string }[];
  },
): Promise<{
  ok: true;
  approved: number;
  existing: number;
  refused: { personId: number; sentence: string }[];
}> {
  const month = checkMonth(args?.month);
  if (!Array.isArray(args.people) || args.people.length === 0)
    throw new Error("Choose who to approve.");
  const people = args.people.map(x => {
    if (
      !Number.isFinite(x?.totalUsd) ||
      !/^[0-9a-f]{32}$/.test(String(x?.resultHash))
    )
      throw new Error(
        "Each approval needs a total and the figures it rests on.",
      );
    return {
      personId: checkPerson(x.personId),
      totalUsd: x.totalUsd,
      resultHash: x.resultHash,
    };
  });
  const res = await signedIn(client).rpc("cockpit_ceo_pay_month_approve", {
    p: { month, people },
  });
  const out = confirmed<Row>(
    answer(res, "Nothing was approved."),
    "Nothing was approved.",
  );
  return {
    ok: true,
    approved: Number(out.approved ?? 0),
    existing: Number(out.existing ?? 0),
    refused: Array.isArray(out.refused)
      ? (out.refused as Row[]).map(r => ({
          personId: Number(r.personId),
          sentence: String(r.sentence ?? ""),
        }))
      : [],
  };
}

/** Withdraw an approved month, with why. → {ok} */
export async function withdrawPayMonth(
  client: SupabaseClient | null,
  args: { personId: number; month: string; reason: string },
): Promise<{ ok: true }> {
  const p = only(args as Row, ["personId", "month", "reason"]);
  p.personId = checkPerson(p.personId);
  p.month = checkMonth(p.month);
  if (typeof p.reason !== "string" || p.reason.trim().length < 3)
    throw new Error("Say why, in a few words.");
  const res = await signedIn(client).rpc("cockpit_ceo_pay_month_withdraw", {
    p,
  });
  confirmed(
    answer(res, "The approval was not withdrawn."),
    "The approval was not withdrawn.",
  );
  return { ok: true };
}

/** `api.ceo.pay.<op>`: list, month and costs read; the rest write. */
export async function ceoPayAction(
  client: SupabaseClient | null,
  op: string,
  args: any = {},
): Promise<unknown> {
  switch (op) {
    case "list":
      return readPayPlans(client);
    case "month":
      return readPayMonth(client, args);
    case "costs":
      return readPayCosts(client);
    case "savePlan":
      return savePayPlan(client, args);
    case "entry":
      return savePayEntry(client, args);
    case "voidEntry":
      return voidPayEntry(client, args);
    case "noneRest":
      return payNoneRest(client, args);
    case "confirm":
      return confirmPay(client, args);
    case "approve":
      return approvePayMonth(client, args);
    case "withdraw":
      return withdrawPayMonth(client, args);
    default:
      throw new Error(`Unknown pay operation: ${op}`);
  }
}
