import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Adjustment,
  ApproveItem,
  ApproveResult,
  HoursAccount,
  HoursInputs,
  HoursMonth,
  HoursSettings,
  HoursStatus,
  PayBasis,
  Provider,
  SourceStatus,
  Tracking,
  Ym,
  Ymd,
} from "../types/ceo/hoursContract";
import { computeMonth, hashMonth } from "../types/ceo/hoursModel";

/**
 * Hours, leave and pay: every CEO action in design section 6, behind
 * `api.ceo.hours.<name>`. Reads go to CEO-gated RPCs; the three actions that
 * call Hubstaff or Timetastic, or store an approval, go to the
 * `cockpit-hours-api` Edge Function, which checks the CEO's login itself.
 * The month is worked out here with the same pure rule the server runs at
 * approval (hoursModel.ts), so what the CEO approves is what he saw.
 *
 * Errors come back as one sentence fit for a toast. No key, and no pay, is
 * ever logged from here.
 */

/** The month as the screens use it: the worked-out month plus the inputs it came from. */
export type HoursView = HoursMonth & { inputs: HoursInputs };

/** The connection status and the accounts read: in the contract, re-exported for the screens. */
export type { HoursAccount, HoursStatus };

export type SaveKeyResult =
  | { ok: true; state: SourceStatus["state"]; text: string; last4: string }
  | { ok: false; state: SourceStatus["state"]; text: string };

export type SyncResult =
  | { ok: true; runId: number | string }
  | { ok: false; busy: true; since: string };

export type CostsApproval = {
  personId: number;
  month: Ym;
  status: "approved" | "paid";
  amount: number;
  currency: string;
  amountUsd: number | null;
  shadow: boolean;
};

type Row = Record<string, unknown>;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PROVIDERS: Provider[] = ["hubstaff", "timetastic"];

/** The server's sentence without Postgres' prefixes, or a plain fallback. */
function sentence(raw: unknown, fallback: string): string {
  const text = String(raw ?? "")
    .split("\n")[0]
    .replace(/^(ERROR|error):\s*/, "")
    .replace(/^\[.*?]\s*/, "")
    .trim();
  return text || fallback;
}

function isObject(v: unknown): v is Row {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function rpc(
  client: SupabaseClient | null,
  name: string,
  args: Row,
  fallback: string,
): Promise<unknown> {
  if (!client) throw new Error("Sign in before reading or changing hours.");
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(sentence(error.message, fallback));
  return data;
}

/** A write RPC: one `p jsonb`, answered with `{ok: true}` (and an id for some). */
async function write(
  client: SupabaseClient | null,
  name: string,
  p: Row,
  fallback: string,
): Promise<{ ok: true; id?: number }> {
  const data = await rpc(client, name, { p }, fallback);
  if (!isObject(data) || data.ok !== true) throw new Error(fallback);
  return Number.isSafeInteger(Number(data.id))
    ? { ok: true, id: Number(data.id) }
    : { ok: true };
}

/** The Edge Function's error text, from a JSON body, without echoing anything else. */
async function edgeError(
  error: unknown,
  data: unknown,
): Promise<string | null> {
  if (isObject(data) && typeof data.error === "string") return data.error;
  const context =
    error && typeof error === "object" && "context" in error
      ? (error as { context: unknown }).context
      : null;
  if (context instanceof Response) {
    const body: unknown = await context
      .clone()
      .json()
      .catch(() => null);
    if (isObject(body) && typeof body.error === "string") return body.error;
    if (context.status === 403)
      return "Only the CEO can do this. Sign in again as the CEO.";
  }
  return null;
}

/** cockpit-hours-api: JWT on, the CEO verified on the server. Body `{op, ...args}`. */
async function edge(
  client: SupabaseClient | null,
  op: "saveKey" | "syncNow" | "approveMany",
  args: Row,
  fallback: string,
): Promise<Row> {
  if (!client) throw new Error("Sign in before reading or changing hours.");
  const { data, error } = await client.functions.invoke("cockpit-hours-api", {
    body: { op, ...args },
  });
  if (error) throw new Error((await edgeError(error, data)) ?? fallback);
  if (!isObject(data)) throw new Error(fallback);
  if (typeof data.error === "string" && data.ok !== false)
    throw new Error(data.error);
  return data;
}

function checkMonth(month: unknown): Ym {
  if (typeof month !== "string" || !YM.test(month))
    throw new Error("Choose a month, as YYYY-MM.");
  return month;
}
function checkDay(day: unknown, what = "Choose a date"): Ymd {
  if (typeof day !== "string" || !YMD.test(day))
    throw new Error(`${what}, as YYYY-MM-DD.`);
  return day;
}
function checkPerson(id: unknown): number {
  if (!Number.isSafeInteger(id) || Number(id) <= 0)
    throw new Error("Choose a person first.");
  return Number(id);
}
function checkProvider(p: unknown): Provider {
  if (!PROVIDERS.includes(p as Provider))
    throw new Error("Choose Hubstaff or Timetastic.");
  return p as Provider;
}

/** The inputs as the RPC sends them, checked enough that the model can trust the shape. */
export function parseInputs(raw: unknown, month: Ym): HoursInputs {
  if (
    !isObject(raw) ||
    raw.month !== month ||
    typeof raw.today !== "string" ||
    !YMD.test(raw.today) ||
    typeof raw.nowMinute !== "number" ||
    !Array.isArray(raw.people) ||
    !Array.isArray(raw.sources) ||
    !isObject(raw.coverage) ||
    !isObject(raw.closed)
  )
    throw new Error(
      `The hours for ${month} were not confirmed by the server. Open the page again in a minute.`,
    );
  return raw as unknown as HoursInputs;
}

export function parseStatus(raw: unknown): HoursStatus {
  if (!isObject(raw) || !Array.isArray(raw.sources))
    throw new Error("The connection status was not confirmed by the server.");
  const lastRun = isObject(raw.lastRun)
    ? {
        id: Number(raw.lastRun.id),
        mode: String(raw.lastRun.mode ?? ""),
        state: String(raw.lastRun.state ?? ""),
        finishedAt:
          typeof raw.lastRun.finishedAt === "string"
            ? raw.lastRun.finishedAt
            : null,
      }
    : null;
  return {
    sources: raw.sources as SourceStatus[],
    lastRun,
    cronScheduled:
      typeof raw.cronScheduled === "boolean" ? raw.cronScheduled : null,
    accounts: Array.isArray(raw.accounts)
      ? (raw.accounts as HoursAccount[])
      : null,
  };
}

// --- Reads ---

export async function readHoursMonth(
  client: SupabaseClient | null,
  args: { month: Ym },
): Promise<HoursView> {
  const month = checkMonth(args.month);
  const raw = await rpc(
    client,
    "cockpit_ceo_hours_inputs",
    { p_month: `${month}-01` },
    `The hours for ${month} could not be read.`,
  );
  const inputs = parseInputs(raw, month);
  const hashed = await hashMonth(computeMonth(inputs));
  return { ...hashed, inputs };
}

export async function readHoursStatus(
  client: SupabaseClient | null,
): Promise<HoursStatus> {
  return parseStatus(
    await rpc(
      client,
      "cockpit_ceo_hours_status",
      {},
      "The connection status could not be read.",
    ),
  );
}

export async function readHoursCosts(
  client: SupabaseClient | null,
): Promise<CostsApproval[]> {
  const data = await rpc(
    client,
    "cockpit_ceo_hours_costs",
    {},
    "Approved pay could not be read.",
  );
  if (!Array.isArray(data))
    throw new Error("Approved pay was not confirmed by the server.");
  return data
    .filter(isObject)
    .filter(
      r =>
        Number.isSafeInteger(Number(r.personId)) &&
        typeof r.month === "string" &&
        Number.isFinite(Number(r.amount)),
    )
    .map(r => ({
      personId: Number(r.personId),
      month: String(r.month).slice(0, 7),
      status: r.status === "paid" ? "paid" : "approved",
      amount: Number(r.amount),
      currency: String(r.currency ?? "USD").toUpperCase(),
      amountUsd:
        r.amountUsd === null || r.amountUsd === undefined
          ? null
          : Number(r.amountUsd),
      shadow: r.shadow === true,
    }));
}

// --- Edge actions ---

export async function saveHoursKey(
  client: SupabaseClient | null,
  args: { provider: Provider; key: string },
): Promise<SaveKeyResult> {
  const provider = checkProvider(args.provider);
  const key = String(args.key ?? "").trim();
  if (key.length < 10 || key.length > 400 || /\s/.test(key))
    throw new Error(
      "That doesn't look like a key: it should be one line, 10 to 400 characters, with no spaces.",
    );
  const out = await edge(
    client,
    "saveKey",
    { provider, key },
    "The key was not saved. Nothing was changed.",
  );
  const text = typeof out.text === "string" ? out.text : "";
  if (out.ok === true)
    return {
      ok: true,
      state: out.state as SourceStatus["state"],
      text: text || "Saved and connected.",
      last4: String(out.last4 ?? ""),
    };
  return {
    ok: false,
    state: out.state as SourceStatus["state"],
    text: text || "The key was refused. Nothing was changed.",
  };
}

export async function syncHoursNow(
  client: SupabaseClient | null,
  args:
    | { mode: "recent" | "deep" | "doctor"; dryRun?: boolean }
    | { mode: "month"; month: Ym; dryRun?: boolean },
): Promise<SyncResult> {
  if (!["recent", "deep", "doctor", "month"].includes(args.mode))
    throw new Error("Choose what to read.");
  if (args.mode === "month") checkMonth(args.month);
  const out = await edge(
    client,
    "syncNow",
    args as Row,
    "The read did not start. Try again in a minute.",
  );
  if (out.ok === true) return { ok: true, runId: out.runId as number };
  if (out.busy === true)
    return { ok: false, busy: true, since: String(out.since ?? "") };
  throw new Error("The read did not start. Try again in a minute.");
}

export async function approveHoursMany(
  client: SupabaseClient | null,
  args: { month: Ym; items: ApproveItem[] },
): Promise<{ results: ApproveResult[] }> {
  checkMonth(args.month);
  if (!Array.isArray(args.items) || !args.items.length)
    throw new Error("Choose at least one person to approve.");
  if (args.items.length > 50)
    throw new Error("Approve at most 50 people at a time.");
  for (const i of args.items) {
    checkPerson(i.personId);
    if (!i.inputsHash) throw new Error("Open the month again, then approve.");
  }
  const out = await edge(
    client,
    "approveMany",
    { month: args.month, items: args.items },
    "Nothing was approved. Try again in a minute.",
  );
  if (!Array.isArray(out.results))
    throw new Error("The approval was not confirmed. Open the month again.");
  return { results: out.results as ApproveResult[] };
}

// --- CEO writes (one audit row each, on the server) ---

export function setHoursTerms(
  client: SupabaseClient | null,
  args: {
    personId: number;
    tracking?: Tracking | null;
    payBasis?: PayBasis | null;
    hoursPayFrom?: Ym | null;
    termsConfirmed?: true;
    contractCountry?: string | null;
    worksIn?: string | null;
    kwClauseReviewed?: true;
  },
) {
  checkPerson(args.personId);
  if (args.hoursPayFrom) checkMonth(args.hoursPayFrom);
  return write(
    client,
    "cockpit_ceo_hours_terms_save",
    args,
    "The settings were not saved.",
  );
}

export function linkHoursAccount(
  client: SupabaseClient | null,
  args:
    | { provider: Provider; externalId: string; personId: number | null }
    | { provider: Provider; externalId: string; ignored: boolean },
) {
  checkProvider(args.provider);
  if (!args.externalId) throw new Error("Choose an account first.");
  if ("personId" in args && args.personId !== null) checkPerson(args.personId);
  return write(
    client,
    "cockpit_ceo_hours_link",
    args,
    "The link was not saved.",
  );
}

export function setLeaveTypeRule(
  client: SupabaseClient | null,
  args: {
    externalId: string;
    payRule: "paid" | "unpaid" | "part" | "not_leave";
    paidShare?: number;
    fromMonth?: Ym;
  },
) {
  if (!args.externalId) throw new Error("Choose a leave type first.");
  if (
    args.payRule === "part" &&
    !(
      typeof args.paidShare === "number" &&
      args.paidShare > 0 &&
      args.paidShare < 1
    )
  )
    throw new Error("A part-paid type needs a share between 1% and 99%.");
  if (args.fromMonth) checkMonth(args.fromMonth);
  return write(
    client,
    "cockpit_ceo_hours_leave_type_save",
    args,
    "The pay rule was not saved.",
  );
}

export function setHolidayOverride(
  client: SupabaseClient | null,
  args:
    | {
        day: Ymd;
        action: "add" | "remove";
        name: string;
        scope: "all" | "country" | "person";
        scopeValue?: string;
        reason: string;
      }
    | { withdrawId: number; reason: string },
) {
  if ("day" in args) checkDay(args.day, "Choose the holiday's date");
  const reason = String(args.reason ?? "").trim();
  if (reason.length < 3) throw new Error("Say why, in a few words.");
  return write(
    client,
    "cockpit_ceo_hours_holiday_override",
    args,
    "The holiday was not saved.",
  );
}

export function adjustHours(
  client: SupabaseClient | null,
  args: Omit<Adjustment, "id" | "setBy" | "setAt" | "carried" | "snapshot"> & {
    personId: number;
    snapshot?: null;
  },
) {
  checkPerson(args.personId);
  checkMonth(args.month);
  if (args.day) checkDay(args.day);
  const reason = String(args.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 300)
    throw new Error("The reason needs 3 to 300 characters.");
  const { snapshot: _server, ...rest } = args;
  return write(
    client,
    "cockpit_ceo_hours_adjust",
    { ...rest, reason },
    "The decision was not saved.",
  );
}

export function withdrawHoursAdjustment(
  client: SupabaseClient | null,
  args: { id: number; reason: string },
) {
  if (!Number.isSafeInteger(args.id)) throw new Error("Choose a decision.");
  return write(
    client,
    "cockpit_ceo_hours_adjust_withdraw",
    args,
    "The decision was not withdrawn.",
  );
}

export function saveHoursRules(
  client: SupabaseClient | null,
  args: { fromMonth: Ym; settings: Partial<HoursSettings> },
) {
  checkMonth(args.fromMonth);
  return write(
    client,
    "cockpit_ceo_hours_rules_save",
    args,
    "The rules were not saved.",
  );
}

export function setHoursPay(
  client: SupabaseClient | null,
  args: {
    personId: number;
    monthlyCost: number;
    currency: string;
    effectiveFrom: Ymd;
    mode: "dated" | "replace";
  },
) {
  checkPerson(args.personId);
  checkDay(args.effectiveFrom, "Choose the day the pay applies from");
  if (!Number.isFinite(args.monthlyCost) || args.monthlyCost < 0)
    throw new Error("Pay must be a number, 0 or more.");
  return write(
    client,
    "cockpit_ceo_hours_set_pay",
    args,
    "The pay change was not saved.",
  );
}

export function setHoursSchedule(
  client: SupabaseClient | null,
  args: { personId: number; schedule: unknown; effectiveFrom: Ymd },
) {
  checkPerson(args.personId);
  checkDay(args.effectiveFrom, "Choose the day the hours apply from");
  return write(
    client,
    "cockpit_ceo_hours_schedule_save",
    args,
    "The hours were not saved.",
  );
}

export function setEmployment(
  client: SupabaseClient | null,
  args: {
    personId: number;
    event: "left" | "rehired" | "paused" | "resumed";
    on: Ymd;
    why?: string;
  },
) {
  checkPerson(args.personId);
  checkDay(args.on);
  return write(
    client,
    "cockpit_ceo_hours_employment",
    args,
    "The change was not saved.",
  );
}

export function setKeyExpiry(
  client: SupabaseClient | null,
  args: { provider: Provider; expiresOn: Ymd },
) {
  checkProvider(args.provider);
  checkDay(args.expiresOn, "Choose the day the key expires");
  return write(
    client,
    "cockpit_ceo_hours_key_expiry",
    args,
    "The date was not saved.",
  );
}

export function withdrawHoursApproval(
  client: SupabaseClient | null,
  args: { personId: number; month: Ym; reason: string },
) {
  checkPerson(args.personId);
  checkMonth(args.month);
  if (String(args.reason ?? "").trim().length < 3)
    throw new Error("Say why the approval is withdrawn.");
  return write(
    client,
    "cockpit_ceo_hours_withdraw_approval",
    args,
    "The approval was not withdrawn.",
  );
}

export function markHoursPaid(
  client: SupabaseClient | null,
  args: { personId: number; month: Ym; paidOn: Ymd; note?: string },
) {
  checkPerson(args.personId);
  checkMonth(args.month);
  checkDay(args.paidOn, "Choose the day it was paid");
  return write(
    client,
    "cockpit_ceo_hours_mark_paid",
    args,
    "It was not marked paid.",
  );
}

/** The router for `api.ceo.hours.<op>` (cockpitApi.ts). Refusals come back as rejections. */
export async function ceoHoursAction(
  client: SupabaseClient | null,
  op: string,
  args: any = {},
): Promise<unknown> {
  switch (op) {
    case "month":
      return readHoursMonth(client, args);
    case "status":
      return readHoursStatus(client);
    case "costs":
      return readHoursCosts(client);
    case "saveKey":
      return saveHoursKey(client, args);
    case "syncNow":
      return syncHoursNow(client, args);
    case "approveMany":
      return approveHoursMany(client, args);
    case "setTerms":
      return setHoursTerms(client, args);
    case "link":
      return linkHoursAccount(client, args);
    case "setLeaveType":
      return setLeaveTypeRule(client, args);
    case "holiday":
      return setHolidayOverride(client, args);
    case "adjust":
      return adjustHours(client, args);
    case "withdrawAdjustment":
      return withdrawHoursAdjustment(client, args);
    case "saveRules":
      return saveHoursRules(client, args);
    case "setPay":
      return setHoursPay(client, args);
    case "setSchedule":
      return setHoursSchedule(client, args);
    case "employment":
      return setEmployment(client, args);
    case "keyExpiry":
      return setKeyExpiry(client, args);
    case "withdrawApproval":
      return withdrawHoursApproval(client, args);
    case "markPaid":
      return markHoursPaid(client, args);
    default:
      throw new Error(`Unknown hours operation: ${op}`);
  }
}
