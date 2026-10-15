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
import {
  type ShotVerdict,
  type SlackState,
  WATCH_BOUNDS,
  WATCH_CHANNEL,
  WATCH_DEFAULTS,
  WATCH_FIELDS,
  WATCH_MENTION_USER,
  type WatchAiProvider,
  type WatchBoard,
  type WatchIncident,
  type WatchKeyResult,
  type WatchKind,
  type WatchLeave,
  type WatchNowResult,
  type WatchNumberKey,
  type WatchOffReason,
  type WatchPerson,
  type WatchRecent,
  type WatchSettings,
  type WatchShot,
  type WatchSlot,
  type WatchSources,
  type WatchState,
} from "../types/ceo/hoursWatch";

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
  op: "saveKey" | "syncNow" | "approveMany" | "watchNow" | "watchKey",
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

/**
 * The morning Slack note to the CEO (A372, 2026-10-11): who is required to
 * track and did not, yesterday. It ships off; this is the switch and its
 * last run (cockpit_ceo_hours_nudge_get / _set, CEO-gated, the set audited).
 */
export type NudgeState = {
  on: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  last: {
    runAt: string | null;
    okAt: string | null;
    ok: boolean | null;
    note: string | null;
    listed: number | null;
  } | null;
};

export function parseNudge(raw: unknown): NudgeState {
  if (!isObject(raw) || typeof raw.on !== "boolean")
    throw new Error("The morning note setting was not confirmed.");
  const last = isObject(raw.last) ? raw.last : null;
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    on: raw.on,
    updatedAt: text(raw.updatedAt),
    updatedBy: text(raw.updatedBy),
    last: last
      ? {
          runAt: text(last.runAt),
          okAt: text(last.okAt),
          ok: typeof last.ok === "boolean" ? last.ok : null,
          note: text(last.note),
          // A run with no count (rows_seen null) is not "0 listed".
          listed:
            last.listed !== null &&
            last.listed !== undefined &&
            last.listed !== "" &&
            Number.isFinite(Number(last.listed))
              ? Number(last.listed)
              : null,
        }
      : null,
  };
}

export async function readNudge(
  client: SupabaseClient | null,
): Promise<NudgeState> {
  return parseNudge(
    await rpc(
      client,
      "cockpit_ceo_hours_nudge_get",
      {},
      "The morning note setting could not be read.",
    ),
  );
}

export async function setNudge(
  client: SupabaseClient | null,
  args: { on: boolean },
): Promise<NudgeState> {
  if (typeof args?.on !== "boolean") throw new Error("Choose on or off.");
  return parseNudge(
    await rpc(
      client,
      "cockpit_ceo_hours_nudge_set",
      { p_on: args.on },
      "The morning note was not switched.",
    ),
  );
}

// --- Hubstaff watch (docs/hours-watch/SPEC.md, the CEO 2026-10-13) ---

const WATCH_STATES: WatchState[] = [
  "tracking",
  "not_tracking",
  "on_break",
  "idle",
  "not_work",
  "off_shift",
  "on_leave",
  "holiday",
  "no_account",
  "cant_tell",
];
const WATCH_KINDS: WatchKind[] = ["not_tracking", "not_work", "idle", "source"];
const OFF_REASONS: WatchOffReason[] = [
  "day_off",
  "holiday",
  "leave",
  "not_employed",
  "paused",
  "no_schedule",
];
const VERDICTS: ShotVerdict[] = [
  "pending",
  "work",
  "not_work",
  "unclear",
  "error",
  "skipped",
];
const SLACK_STATES: SlackState[] = [
  "pending",
  "sending",
  "posted",
  "failed",
  "unknown",
  "muted",
];
const AI_STATES = ["connected", "missing", "refused", "failing"] as const;
const AI_PROVIDERS: WatchAiProvider[] = ["google_ai", "openai"];
const WATCH_BUCKET = "cockpit-hours-watch";
const WATCH_UNREAD =
  "Hubstaff watch was not confirmed by the server. Open the page again in a minute.";

const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const numOrNull = (v: unknown) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : null;
/** A time the screen can place; anything else is no time, never "now". */
const isoOrNull = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
const nameOrNull = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const boolOrNull = (v: unknown) => (typeof v === "boolean" ? v : null);
const posId = (v: unknown) =>
  Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const objectOf = (v: unknown): Row => (isObject(v) ? v : {});

export function parseWatchSettings(raw: unknown): WatchSettings {
  if (
    !isObject(raw) ||
    typeof raw.on !== "boolean" ||
    typeof raw.shots !== "boolean" ||
    typeof raw.channel !== "string"
  )
    throw new Error("The watch settings were not confirmed by the server.");
  const out = {
    on: raw.on,
    shots: raw.shots,
    channel: raw.channel,
    channelName: typeof raw.channelName === "string" ? raw.channelName : "",
    // Added in the final round: a row saved before it keeps the seeded default.
    mention:
      typeof raw.mention === "boolean" ? raw.mention : WATCH_DEFAULTS.mention,
    mentionUser:
      typeof raw.mentionUser === "string" &&
      WATCH_MENTION_USER.test(raw.mentionUser)
        ? raw.mentionUser
        : WATCH_DEFAULTS.mentionUser,
  } as WatchSettings;
  for (const key of Object.keys(WATCH_BOUNDS) as WatchNumberKey[]) {
    const v = numOrNull(raw[key]);
    if (v === null)
      throw new Error("The watch settings were not confirmed by the server.");
    out[key] = v;
  }
  return out;
}

function parseSources(raw: unknown): WatchSources {
  const hub = isObject(raw) ? raw.hubstaff : null;
  const ai = isObject(raw) ? raw.ai : null;
  const slack = isObject(raw) ? raw.slack : null;
  if (
    !isObject(hub) ||
    typeof hub.state !== "string" ||
    !isObject(ai) ||
    !AI_STATES.includes(ai.state as never) ||
    !isObject(slack) ||
    !["ok", "failing", "unknown"].includes(String(slack.state))
  )
    throw new Error(WATCH_UNREAD);
  return {
    hubstaff: { state: hub.state, note: strOrNull(hub.note) },
    ai: {
      state: ai.state as WatchSources["ai"]["state"],
      provider: AI_PROVIDERS.includes(ai.provider as WatchAiProvider)
        ? (ai.provider as WatchAiProvider)
        : null,
      note: strOrNull(ai.note),
    },
    slack: {
      state: slack.state as WatchSources["slack"]["state"],
      note: strOrNull(slack.note),
    },
  };
}

function parseSlot(raw: unknown): WatchSlot | null {
  if (!isObject(raw) || typeof raw.start !== "string") return null;
  const trackedS = numOrNull(raw.trackedS);
  if (trackedS === null || Number.isNaN(Date.parse(raw.start))) return null;
  return {
    start: raw.start,
    trackedS,
    overallS: numOrNull(raw.overallS) ?? 0,
    inputTrackedS: numOrNull(raw.inputTrackedS),
    idle: raw.idle === true,
  };
}

function parseShot(raw: unknown): WatchShot | null {
  if (!isObject(raw) || typeof raw.at !== "string") return null;
  const shotId = posId(raw.id);
  if (shotId === null || !VERDICTS.includes(raw.verdict as ShotVerdict))
    return null;
  return {
    id: shotId,
    at: raw.at,
    verdict: raw.verdict as ShotVerdict,
    label: strOrNull(raw.label),
    confidence: numOrNull(raw.confidence),
    thumbPath: strOrNull(raw.thumbPath),
    fullPath: strOrNull(raw.fullPath),
  };
}

/** A part-day leave window; one the screen cannot place is dropped. */
function parseLeave(raw: unknown): WatchLeave | null {
  if (!isObject(raw)) return null;
  const start = isoOrNull(raw.start);
  const end = isoOrNull(raw.end);
  if (!start || !end || Date.parse(end) <= Date.parse(start)) return null;
  return { start, end };
}

function parsePerson(raw: unknown): WatchPerson {
  const personId = isObject(raw) ? posId(raw.personId) : null;
  if (
    !isObject(raw) ||
    personId === null ||
    typeof raw.name !== "string" ||
    !WATCH_STATES.includes(raw.state as WatchState)
  )
    throw new Error(WATCH_UNREAD);
  return {
    personId,
    name: raw.name,
    role: strOrNull(raw.role),
    state: raw.state as WatchState,
    since: strOrNull(raw.since),
    shiftStart: strOrNull(raw.shiftStart),
    shiftEnd: strOrNull(raw.shiftEnd),
    online: boolOrNull(raw.online),
    lastActivityAt: strOrNull(raw.lastActivityAt),
    trackedTodayS: numOrNull(raw.trackedTodayS),
    activePct30m: numOrNull(raw.activePct30m),
    screenshotsOn: boolOrNull(raw.screenshotsOn),
    offReason: OFF_REASONS.includes(raw.offReason as WatchOffReason)
      ? (raw.offReason as WatchOffReason)
      : null,
    readAt: isoOrNull(raw.readAt),
    onBreak: raw.onBreak === true || raw.state === "on_break",
    leave: (Array.isArray(raw.leave) ? raw.leave : [])
      .map(parseLeave)
      .filter((l): l is WatchLeave => l !== null),
    slots: (Array.isArray(raw.slots) ? raw.slots : [])
      .map(parseSlot)
      .filter((s): s is WatchSlot => s !== null),
    shots: (Array.isArray(raw.shots) ? raw.shots : [])
      .map(parseShot)
      .filter((s): s is WatchShot => s !== null),
  };
}

function parseIncident(raw: unknown): WatchIncident {
  const incidentId = isObject(raw) ? posId(raw.id) : null;
  if (
    !isObject(raw) ||
    incidentId === null ||
    !WATCH_KINDS.includes(raw.kind as WatchKind) ||
    typeof raw.openedAt !== "string" ||
    !SLACK_STATES.includes(raw.slackState as SlackState)
  )
    throw new Error(WATCH_UNREAD);
  return {
    id: incidentId,
    personId: posId(raw.personId),
    name: nameOrNull(raw.name),
    kind: raw.kind as WatchKind,
    openedAt: raw.openedAt,
    lastSeenAt: strOrNull(raw.lastSeenAt),
    detail: objectOf(raw.detail),
    slackState: raw.slackState as SlackState,
    slackError: strOrNull(raw.slackError),
    reviewedAt: strOrNull(raw.reviewedAt),
  };
}

function parseRecent(raw: unknown): WatchRecent {
  const incidentId = isObject(raw) ? posId(raw.id) : null;
  if (
    !isObject(raw) ||
    incidentId === null ||
    !WATCH_KINDS.includes(raw.kind as WatchKind) ||
    typeof raw.openedAt !== "string" ||
    typeof raw.closedAt !== "string"
  )
    throw new Error(WATCH_UNREAD);
  return {
    id: incidentId,
    personId: posId(raw.personId),
    name: nameOrNull(raw.name),
    kind: raw.kind as WatchKind,
    openedAt: raw.openedAt,
    closedAt: raw.closedAt,
    closeReason: strOrNull(raw.closeReason),
    detail: objectOf(raw.detail),
    reviewedAt: strOrNull(raw.reviewedAt),
  };
}

/** The whole card's payload. A shape the screen cannot trust is refused, never guessed. */
export function parseWatchBoard(raw: unknown): WatchBoard {
  if (
    !isObject(raw) ||
    typeof raw.now !== "string" ||
    typeof raw.cronOn !== "boolean" ||
    !Array.isArray(raw.people) ||
    !Array.isArray(raw.open) ||
    !Array.isArray(raw.recent)
  )
    throw new Error(WATCH_UNREAD);
  // A run row without a time or an outcome is no run to show, not a failure.
  const last =
    isObject(raw.lastRun) &&
    typeof raw.lastRun.at === "string" &&
    typeof raw.lastRun.ok === "boolean"
      ? raw.lastRun
      : null;
  return {
    settings: parseWatchSettings(raw.settings),
    sources: parseSources(raw.sources),
    lastRun: last
      ? {
          at: String(last.at),
          ok: last.ok === true,
          note: strOrNull(last.note),
        }
      : null,
    cronOn: raw.cronOn,
    now: raw.now,
    people: raw.people.map(parsePerson),
    open: raw.open.map(parseIncident),
    recent: raw.recent.map(parseRecent),
  };
}

/** The answer to a settings change: `{ok: true, settings?}` or the settings themselves. */
export function parseWatchSet(raw: unknown): {
  ok: true;
  settings: WatchSettings | null;
} {
  if (isObject(raw) && raw.ok === true)
    return {
      ok: true,
      settings: isObject(raw.settings)
        ? parseWatchSettings(raw.settings)
        : null,
    };
  if (isObject(raw) && typeof raw.on === "boolean")
    return { ok: true, settings: parseWatchSettings(raw) };
  throw new Error("The change was not confirmed by the server.");
}

/** The answer to Mark reviewed: `{ok: true}`, with the time when the server sends it. */
export function parseWatchReview(raw: unknown): {
  ok: true;
  reviewedAt: string | null;
} {
  if (isObject(raw) && (raw.ok === true || typeof raw.reviewedAt === "string"))
    return { ok: true, reviewedAt: strOrNull(raw.reviewedAt) };
  throw new Error("The review was not confirmed by the server.");
}

export function parseWatchNow(raw: unknown): WatchNowResult {
  if (isObject(raw) && raw.ok === true) return { ok: true };
  if (isObject(raw) && raw.busy === true)
    return { ok: false, busy: true, since: strOrNull(raw.since) };
  throw new Error("The check was not confirmed by the server.");
}

export function parseWatchKey(raw: unknown): WatchKeyResult {
  if (!isObject(raw) || typeof raw.ok !== "boolean")
    throw new Error("The key was not confirmed by the server.");
  const state = AI_STATES.includes(raw.state as never)
    ? (raw.state as WatchSources["ai"]["state"])
    : null;
  const said = strOrNull(raw.text);
  if (raw.ok === true)
    return {
      ok: true,
      state: state ?? "connected",
      text: said ?? "Saved and connected. The screenshot check is on.",
    };
  return {
    ok: false,
    state,
    text: said ?? "The key was refused. Nothing was changed.",
  };
}

/** A settings patch, checked against the server's bounds before it is sent. */
export function checkWatchPatch(patch: unknown): Partial<WatchSettings> {
  if (!isObject(patch)) throw new Error("Change a setting first.");
  const out: Row = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "on" || key === "shots" || key === "mention") {
      if (typeof value !== "boolean") throw new Error("Choose on or off.");
      out[key] = value;
    } else if (key === "channel") {
      const v = String(value ?? "").trim();
      if (!WATCH_CHANNEL.test(v))
        throw new Error(
          "The Slack channel id starts with C or G and has 9 to 13 capitals and digits, like C0B5TL9H370.",
        );
      out[key] = v;
    } else if (key === "mentionUser") {
      const v = String(value ?? "").trim();
      if (!WATCH_MENTION_USER.test(v))
        throw new Error(
          "The Slack user id starts with U or W and has 9 to 13 capitals and digits, like U09305KE2KS.",
        );
      out[key] = v;
    } else if (key === "channelName") {
      const v = String(value ?? "")
        .trim()
        .replace(/^#/, "");
      if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v))
        throw new Error(
          "The channel name is lower case, without spaces, like team-management.",
        );
      out[key] = v;
    } else if (key in WATCH_BOUNDS) {
      const k = key as WatchNumberKey;
      const { min, max } = WATCH_BOUNDS[k];
      const v = Number(value);
      if (
        typeof value !== "number" ||
        !Number.isFinite(v) ||
        v < min ||
        v > max
      )
        throw new Error(watchBoundsText(k));
      out[k] = v;
    } else {
      throw new Error("That is not a watch setting. Nothing was changed.");
    }
  }
  if (!Object.keys(out).length) throw new Error("Change a setting first.");
  return out as Partial<WatchSettings>;
}

/** "Grace after the shift starts: choose 0 to 120 minutes." */
export function watchBoundsText(key: WatchNumberKey): string {
  const { min, max } = WATCH_BOUNDS[key];
  const { label, unit } = WATCH_FIELDS[key];
  if (key === "minConfidence")
    return `${label}: choose ${Math.round(min * 100)}% to ${Math.round(max * 100)}%.`;
  if (unit === "percent") return `${label}: choose ${min}% to ${max}%.`;
  return `${label}: choose ${min} to ${max} ${unit}.`;
}

export async function readWatchBoard(
  client: SupabaseClient | null,
): Promise<WatchBoard> {
  return parseWatchBoard(
    await rpc(
      client,
      "cockpit_ceo_hours_watch_board",
      {},
      "Hubstaff watch could not be read.",
    ),
  );
}

export async function setWatch(
  client: SupabaseClient | null,
  args: Partial<WatchSettings>,
): Promise<{ ok: true; settings: WatchSettings | null }> {
  const p = checkWatchPatch(args);
  return parseWatchSet(
    await rpc(
      client,
      "cockpit_ceo_hours_watch_set",
      { p },
      "The watch settings were not saved.",
    ),
  );
}

export async function reviewWatch(
  client: SupabaseClient | null,
  args: { incidentId: number; note?: string },
): Promise<{ ok: true; reviewedAt: string | null }> {
  if (posId(args?.incidentId) === null)
    throw new Error("Choose an alert first.");
  const note = String(args.note ?? "").trim();
  if (note.length > 300) throw new Error("Keep the note to 300 characters.");
  return parseWatchReview(
    await rpc(
      client,
      "cockpit_ceo_hours_watch_review",
      {
        p: note
          ? { incidentId: args.incidentId, note }
          : { incidentId: args.incidentId },
      },
      "The alert was not marked reviewed.",
    ),
  );
}

export async function watchNow(
  client: SupabaseClient | null,
): Promise<WatchNowResult> {
  return parseWatchNow(
    await edge(
      client,
      "watchNow",
      {},
      "The check did not start. Try again in a minute.",
    ),
  );
}

export async function saveWatchKey(
  client: SupabaseClient | null,
  args: { provider: WatchAiProvider; key: string },
): Promise<WatchKeyResult> {
  if (!AI_PROVIDERS.includes(args?.provider))
    throw new Error("Choose Google AI or OpenAI.");
  const key = String(args.key ?? "").trim();
  if (key.length < 10 || key.length > 400 || /\s/.test(key))
    throw new Error(
      "That doesn't look like a key: it should be one line, 10 to 400 characters, with no spaces.",
    );
  return parseWatchKey(
    await edge(
      client,
      "watchKey",
      { provider: args.provider, key },
      "The key was not saved. Nothing was changed.",
    ),
  );
}

/**
 * A 10-minute link to one stored screenshot. The bucket is private and its
 * read policy checks the CEO and that the path belongs to a screenshot row,
 * so a path from anywhere else signs nothing.
 */
export async function watchShotUrl(
  client: SupabaseClient | null,
  args: { path: string },
): Promise<{ url: string }> {
  if (!client) throw new Error("Sign in before reading or changing hours.");
  const path = String(args?.path ?? "");
  if (!path || path.length > 300 || path.includes("..") || path.startsWith("/"))
    throw new Error("That screenshot is not one the cockpit keeps.");
  const { data, error } = await client.storage
    .from(WATCH_BUCKET)
    .createSignedUrl(path, 600);
  if (error || !data?.signedUrl)
    throw new Error(
      "The screenshot could not be opened. Stored screenshots are kept 90 days.",
    );
  return { url: data.signedUrl };
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
    case "nudge":
      return readNudge(client);
    case "setNudge":
      return setNudge(client, args);
    case "watchBoard":
      return readWatchBoard(client);
    case "watchSet":
      return setWatch(client, args);
    case "watchReview":
      return reviewWatch(client, args);
    case "watchNow":
      return watchNow(client);
    case "watchKey":
      return saveWatchKey(client, args);
    case "watchShotUrl":
      return watchShotUrl(client, args);
    default:
      throw new Error(`Unknown hours operation: ${op}`);
  }
}
