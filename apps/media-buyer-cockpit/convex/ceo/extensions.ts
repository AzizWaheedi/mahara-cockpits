import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
} from "../_generated/server";
import { clickupCall } from "../dosDonts";
import { authenticatedAction } from "../functions";
import { callTool, unwrap } from "../tools";
import {
  type BillingRow,
  groupOf,
  isInternalCard,
  isOneOffPlan,
} from "./billing";
import type { ClientsPayload } from "./payloads";
import { readSetting, writeSetting } from "./settings";
import { addDays, kuwaitDay, monthStart } from "./time";

declare const process: { env: Record<string, string | undefined> };

type Any = any;

/**
 * Billing extensions, time to first launch and the average retainer for the
 * Client success tab (Aziz's spec of 2026-09-21, points 12 to 15).
 *
 * - An extension is a response on the Client Extension Form (Typeform
 *   gqBcyK6g): the client as typed, and 1, 2 or 4 weeks. The clock starts at
 *   submission, so a late form cannot backdate cover. The typed client is
 *   matched to a ClickUp card the way csmSync's liveExtension matches it:
 *   folded names, either containing the other.
 * - Time to first launch runs from the day the ClickUp card was created to
 *   the card's Launch Date. First launch only: a relaunch after a pause keeps
 *   the original date.
 * - Average retainer is the mean of the MRR field over active cards on a
 *   recurring plan (a Payment Plan that is not paid in full, split pay,
 *   one-off or upfront).
 *
 * The rules are pure functions so scripts/extensions.test.ts can check them
 * without Convex or Typeform. The form read and the ClickUp write are below
 * them, and the write is only ever started from a button on the tab.
 */

export const EXT_FORM = "gqBcyK6g";
const EXT_CLIENT_REF = "5145ff0c-009b-4f51-b3a9-4651efc908be";
const EXT_DURATION_REF = "278c2f80-88bd-428e-b330-8c6b3175d63f";
/** Newest responses the read covers; Typeform returns newest first. */
export const EXT_PAGE = 200;
const EXT_URL = `https://api.typeform.com/forms/${EXT_FORM}/responses?page_size=${EXT_PAGE}`;

const WEEKS_BY_LABEL: Record<string, number> = {
  "1 WEEK": 1,
  "2 WEEKS": 2,
  "4 WEEKS": 4,
};

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mahara's own test submissions and cards (the lifecycle test card, the
 * playing account): never a client's extension. The typed text on a test
 * submission carries no brackets, so this is looser than billing.ts's rule.
 */
const INTERNAL_TEXT = /\binternal test\b|playing account/i;
export const isInternalText = (s: unknown): boolean =>
  INTERNAL_TEXT.test(String(s ?? ""));

/** The Clients - Mahara list, where the extension field has to live. */
export const CLIENTS_LIST = "901816559981";
export const EXTENSION_FIELD_NAME = "Current extension (weeks)";
export const EXTENSION_FIELD_ENV = "CLICKUP_EXTENSION_FIELD";
/** What the screen says until the field exists. ClickUp's API cannot create one. */
export const FIELD_ASK = `Create a Number field '${EXTENSION_FIELD_NAME}' on the Clients - Mahara list (${CLIENTS_LIST}); the cockpit finds it by name at the next sync`;

/**
 * The field id: the deployment override when set, else the field of that
 * name on the Clients list (Aziz, 2026-09-21: "you can make the ClickUp field
 * if you want"; ClickUp's API cannot create one, so whoever makes it, the
 * cockpit finds it by name). Null until it exists, never a throw.
 */
export async function findExtensionField(): Promise<string | null> {
  const id = process.env[EXTENSION_FIELD_ENV]?.trim();
  if (id) return id;
  try {
    const r = await clickupCall("GET", `list/${CLIENTS_LIST}/field`);
    const want = EXTENSION_FIELD_NAME.toLowerCase();
    const f = (r?.fields ?? []).find(
      (f: Any) =>
        String(f?.name ?? "")
          .trim()
          .toLowerCase() === want,
    );
    return f?.id ? String(f.id) : null;
  } catch {
    return null;
  }
}

/**
 * The custom fields on the Clients list, for a hand check from the CLI
 * (`npx convex run --prod ceo/extensions:listFields`): names, types and ids only.
 */
export const listFields = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const r = await clickupCall("GET", `list/${CLIENTS_LIST}/field`);
    return (r?.fields ?? []).map((f: Any) => ({
      id: String(f?.id ?? ""),
      name: String(f?.name ?? ""),
      type: String(f?.type ?? ""),
    }));
  },
});

/** Lower case letters and digits only, in any script: csmSync's liveExtension rule. */
export const fold = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

const epochDay = (day: string) =>
  Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
/** Whole days from `from` to `to`. */
const daysBetween = (from: string, to: string) => epochDay(to) - epochDay(from);

// --- Extensions ---------------------------------------------------------------

export type ExtensionGrant = {
  /** Typeform's response id. */
  id: string;
  /** Submission, epoch ms. */
  submittedAt: number;
  /** Kuwait day of submission: the clock starts here. */
  day: string;
  /** The client as typed on the form, trimmed. */
  client: string;
  weeks: number;
  /** The Kuwait day the cover ends: submission plus the weeks. */
  until: string;
};

/**
 * The grants in a Typeform responses page, oldest first. A response with no
 * client text, no recognised duration or no submission time is skipped.
 */
export function parseExtensionResponses(items: unknown[]): ExtensionGrant[] {
  const out: ExtensionGrant[] = [];
  for (const raw of items) {
    const item = raw as Any;
    const answers: Any[] = Array.isArray(item?.answers) ? item.answers : [];
    const client = String(
      answers.find(a => a?.field?.ref === EXT_CLIENT_REF)?.text ?? "",
    ).trim();
    // The duration is a dropdown, which the responses API delivers as a
    // text answer carrying the label (2026-09-21: every response on the form
    // arrives that way), so the label is read from either shape.
    const duration = answers.find(a => a?.field?.ref === EXT_DURATION_REF);
    const label = String(duration?.choice?.label ?? duration?.text ?? "")
      .trim()
      .toUpperCase();
    const weeks = WEEKS_BY_LABEL[label];
    const submittedAt = Date.parse(String(item?.submitted_at ?? ""));
    if (!client || !weeks || !Number.isFinite(submittedAt)) continue;
    out.push({
      id: String(
        item?.response_id ?? item?.token ?? `${submittedAt}:${fold(client)}`,
      ),
      submittedAt,
      day: kuwaitDay(submittedAt),
      client,
      weeks,
      until: kuwaitDay(submittedAt + weeks * 7 * DAY_MS),
    });
  }
  return out.sort((a, b) => a.submittedAt - b.submittedAt);
}

/**
 * Why each response did or did not become a grant, with no client text: the
 * submission day, the answer refs and types, the duration label as chosen.
 */
export function explainResponses(items: unknown[]): {
  day: string | null;
  hasClientText: boolean;
  durationLabel: string | null;
  answers: { ref: string; type: string }[];
  grant: boolean;
}[] {
  return items.map(raw => {
    const item = raw as Any;
    const answers: Any[] = Array.isArray(item?.answers) ? item.answers : [];
    const submittedAt = Date.parse(String(item?.submitted_at ?? ""));
    const client = String(
      answers.find(a => a?.field?.ref === EXT_CLIENT_REF)?.text ?? "",
    ).trim();
    const duration = answers.find(a => a?.field?.ref === EXT_DURATION_REF);
    const label = duration?.choice?.label ?? duration?.text ?? null;
    const weeks =
      WEEKS_BY_LABEL[
        String(label ?? "")
          .trim()
          .toUpperCase()
      ];
    return {
      day: Number.isFinite(submittedAt) ? kuwaitDay(submittedAt) : null,
      hasClientText: client !== "",
      durationLabel: label === null ? null : String(label),
      answers: answers.map(a => ({
        ref: String(a?.field?.ref ?? ""),
        type: String(a?.type ?? ""),
      })),
      grant: client !== "" && !!weeks && Number.isFinite(submittedAt),
    };
  });
}

export type Card = { taskId: string; name: string };

/**
 * The card a typed client name points to. The rule is csmSync's liveExtension
 * rule: folded names, either one containing the other, and typed text under
 * four characters matches nothing. When several cards match, an exact fold
 * wins, then the longest card name, so "Nahda" never takes a form that typed
 * "Nahda Clinics" when that card exists.
 */
export function matchCard(client: string, cards: Card[]): Card | null {
  const typed = fold(client);
  if (typed.length < 4) return null;
  let best: { card: Card; key: string } | null = null;
  for (const card of cards) {
    const key = fold(card.name);
    if (!key || !(typed.includes(key) || key.includes(typed))) continue;
    if (!best) {
      best = { card, key };
      continue;
    }
    const exact = key === typed;
    const bestExact = best.key === typed;
    if (exact !== bestExact) {
      if (exact) best = { card, key };
      continue;
    }
    if (key.length > best.key.length) best = { card, key };
  }
  return best?.card ?? null;
}

export type ExtensionsPayload = NonNullable<ClientsPayload["extensions"]>;
export type ExtensionWindow = {
  from: string;
  to: string;
  totalWeeks: number;
  grants: number;
};
/**
 * The payload's extensions block plus last month beside it, for the tile's
 * comparison line. The extra field rides along in the stored payload; the
 * screen reads it when present.
 */
export type ExtensionsWithLastMonth = ExtensionsPayload & {
  lastMonth: ExtensionWindow;
};

export type ExtensionsSummary = Omit<
  ExtensionsPayload,
  "read" | "clickupField"
> & {
  lastMonth: ExtensionWindow;
  /** Responses read whose typed client matched no card. */
  unmatched: number;
  /** Test submissions (an internal test card or the playing account), left out. */
  internalTest: number;
  /** Newest submission read, epoch ms, or null. */
  newestAt: number | null;
};

/**
 * Weeks granted per client, month to date, with last month beside it.
 *
 * A client is listed when it was granted weeks in the window or when a
 * grant from before the window is still running today, so the live count
 * and the list agree. `until` is the latest end day over all of the client's
 * grants, not only the window's. Rows sort by weeks in the window, then by
 * the end day, then by name.
 */
export function summariseExtensions(
  grants: ExtensionGrant[],
  cards: Card[],
  today: string,
): ExtensionsSummary {
  const from = monthStart(today);
  const lastTo = addDays(from, -1);
  const lastFrom = monthStart(lastTo);
  type Acc = {
    client: string;
    clickupTaskId: string | null;
    weeks: number;
    until: string;
  };
  const byKey = new Map<string, Acc>();
  let totalWeeks = 0;
  let count = 0;
  let lastWeeks = 0;
  let lastCount = 0;
  let unmatched = 0;
  let internalTest = 0;
  let newestAt: number | null = null;
  for (const g of grants) {
    const card = matchCard(g.client, cards);
    if (isInternalText(g.client) || (card && isInternalText(card.name))) {
      internalTest += 1;
      continue;
    }
    if (!card) unmatched += 1;
    if (newestAt === null || g.submittedAt > newestAt) newestAt = g.submittedAt;
    const key = card ? `card:${card.taskId}` : `text:${fold(g.client)}`;
    const acc = byKey.get(key) ?? {
      client: card?.name ?? g.client,
      clickupTaskId: card?.taskId ?? null,
      weeks: 0,
      until: g.until,
    };
    if (g.until > acc.until) acc.until = g.until;
    if (g.day >= from && g.day <= today) {
      acc.weeks += g.weeks;
      totalWeeks += g.weeks;
      count += 1;
    } else if (g.day >= lastFrom && g.day <= lastTo) {
      lastWeeks += g.weeks;
      lastCount += 1;
    }
    byKey.set(key, acc);
  }
  const perClient = [...byKey.values()]
    .map(a => ({ ...a, live: a.until >= today }))
    .filter(a => a.weeks > 0 || a.live)
    .sort(
      (a, b) =>
        b.weeks - a.weeks ||
        b.until.localeCompare(a.until) ||
        a.client.localeCompare(b.client),
    );
  return {
    from,
    to: today,
    totalWeeks,
    grants: count,
    perClient,
    lastMonth: {
      from: lastFrom,
      to: lastTo,
      totalWeeks: lastWeeks,
      grants: lastCount,
    },
    unmatched,
    internalTest,
    newestAt,
  };
}

// --- Time to first launch -----------------------------------------------------

/**
 * The Kuwait day a card was created, from the sync's days-since-created
 * (`clients.signupDays`) and the day that sync ran. Within a day of the
 * card's own date_created, which the sync does not store.
 */
export function createdDayOf(
  signupDays: unknown,
  anchorDay: string,
): string | null {
  const n = Number(signupDays);
  if (
    signupDays === null ||
    signupDays === undefined ||
    !Number.isFinite(n) ||
    n < 0 ||
    !ISO_DAY.test(anchorDay)
  )
    return null;
  return addDays(anchorDay, -Math.round(n));
}

/**
 * Days from the card's creation to its Launch Date, once that date has
 * arrived. Null without a creation day, without a Launch Date, or while the
 * Launch Date is still in the future. Can be negative when the card was made
 * after the launch; the summary leaves those out and names them.
 */
export function daysToLaunchOf(
  createdDay: string | null,
  launchDate: unknown,
  today: string,
): number | null {
  if (
    !createdDay ||
    typeof launchDate !== "string" ||
    !ISO_DAY.test(launchDate) ||
    launchDate > today
  )
    return null;
  return daysBetween(createdDay, launchDate);
}

export type LaunchRow = {
  client: string;
  clickupTaskId: string;
  /** active | onboarding | paused | churned, or null. */
  bucket: string | null;
  /** Mahara's own cards, never a client. */
  internal: boolean;
  createdDay: string | null;
  launchDate: string | null;
};

export type LaunchSummary = NonNullable<ClientsPayload["launch"]> & {
  /** Cards created after their Launch Date, left out of the figures. */
  createdAfterLaunch: string[];
  /** Launched cards with no creation day, so no time to launch. */
  noCreatedDay: number;
};

function median(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : round1((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Time to first launch over launched clients (a Launch Date on or before
 * today), slowest first. Internal cards are left out. `notLaunched` counts
 * live clients (active or onboarding) with no launch yet, a future Launch
 * Date included.
 */
export function summariseLaunch(
  rows: LaunchRow[],
  today: string,
): LaunchSummary {
  const out: LaunchSummary["rows"] = [];
  const createdAfterLaunch: string[] = [];
  let noCreatedDay = 0;
  let notLaunched = 0;
  for (const r of rows) {
    if (r.internal) continue;
    const launched =
      typeof r.launchDate === "string" &&
      ISO_DAY.test(r.launchDate) &&
      r.launchDate <= today;
    if (!launched) {
      if (r.bucket === "active" || r.bucket === "onboarding") notLaunched += 1;
      continue;
    }
    if (!r.createdDay) {
      noCreatedDay += 1;
      continue;
    }
    const days = daysBetween(r.createdDay, r.launchDate as string);
    if (days < 0) {
      createdAfterLaunch.push(r.client);
      continue;
    }
    out.push({
      client: r.client,
      clickupTaskId: r.clickupTaskId,
      days,
      launchDate: r.launchDate as string,
    });
  }
  out.sort((a, b) => b.days - a.days || a.client.localeCompare(b.client));
  const days = out.map(r => r.days).sort((a, b) => a - b);
  return {
    averageDays: days.length
      ? round1(days.reduce((s, d) => s + d, 0) / days.length)
      : null,
    medianDays: median(days),
    clients: out.length,
    rows: out,
    notLaunched,
    createdAfterLaunch: createdAfterLaunch.sort(),
    noCreatedDay,
  };
}

// --- Average retainer ---------------------------------------------------------

/** A Payment Plan that is monthly money: set, and not a one-off plan. */
export const isRecurringPlan = (plan: unknown): boolean =>
  typeof plan === "string" && plan.trim() !== "" && !isOneOffPlan(plan);

/**
 * The mean of the MRR field over active cards on a recurring plan. A card
 * with a blank plan or a blank MRR is left out, as is an internal card, so
 * this is a figure over the cards that carry both, typed by hand.
 */
export function averageRetainer(
  rows: Pick<BillingRow, "name" | "stage" | "mrrUsd" | "paymentPlan">[],
): { averageUsd: number | null; cards: number } {
  const kept = rows.filter(
    r =>
      groupOf(r.stage) === "active" &&
      !isInternalCard(r.name) &&
      typeof r.mrrUsd === "number" &&
      Number.isFinite(r.mrrUsd) &&
      isRecurringPlan(r.paymentPlan),
  );
  if (kept.length === 0) return { averageUsd: null, cards: 0 };
  const total = kept.reduce((s, r) => s + (r.mrrUsd as number), 0);
  return { averageUsd: round2(total / kept.length), cards: kept.length };
}

// --- The ClickUp write, planned ----------------------------------------------

export type FieldWrite = {
  taskId: string;
  client: string;
  /** The live grant's weeks, or 0 once the last grant has ended. */
  weeks: number;
  /** The latest grant's end day. */
  until: string;
  /** The latest grant's submission day. */
  grantedDay: string;
};

/**
 * What the field should say on every card the form has ever named: the live
 * grant's weeks, or 0 once it has ended. A card the form never named is not
 * touched, and a card that has gone (stopped, cancelled) is skipped rather
 * than rewritten.
 */
export function planWrites(
  grants: ExtensionGrant[],
  cards: (Card & { stage?: string })[],
  today: string,
): { writes: FieldWrite[]; skipped: number } {
  const latest = new Map<
    string,
    { card: Card & { stage?: string }; grant: ExtensionGrant }
  >();
  for (const g of grants) {
    const card = matchCard(g.client, cards);
    if (!card || isInternalText(g.client) || isInternalText(card.name))
      continue;
    const cur = latest.get(card.taskId);
    if (
      !cur ||
      g.until > cur.grant.until ||
      (g.until === cur.grant.until && g.submittedAt > cur.grant.submittedAt)
    )
      latest.set(card.taskId, { card, grant: g });
  }
  const writes: FieldWrite[] = [];
  let skipped = 0;
  for (const { card, grant } of latest.values()) {
    if (groupOf(card.stage) === "gone") {
      skipped += 1;
      continue;
    }
    writes.push({
      taskId: card.taskId,
      client: card.name,
      weeks: grant.until >= today ? grant.weeks : 0,
      until: grant.until,
      grantedDay: grant.day,
    });
  }
  writes.sort((a, b) => a.client.localeCompare(b.client));
  return { writes, skipped };
}

// --- Reading the form ---------------------------------------------------------

export type ExtensionRead =
  | {
      ok: true;
      grants: ExtensionGrant[];
      responses: number;
      cached: boolean;
      /** The raw responses, for the doctor's shape report only. */
      items: unknown[];
    }
  | { ok: false; error: string };

const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .replace(/https?:\/\/\S+:?\s*/g, "")
    .trim()
    .slice(0, 160);

/**
 * Every response on the Client Extension Form (the newest EXT_PAGE), the
 * same read csmSync makes: the bridge's cached body when one is fresh, else
 * Typeform through the deployment's own token. Never throws; the caller says
 * what a failed read leaves out.
 */
export async function readExtensionForm(
  ctx: ActionCtx,
): Promise<ExtensionRead> {
  try {
    let body: Any = null;
    let cached = false;
    const raw: string | null = await ctx.runQuery(internal.rawFetch.get, {
      url: EXT_URL,
    });
    if (raw) {
      try {
        body = JSON.parse(raw);
        cached = true;
      } catch {
        body = null;
      }
    }
    if (!body)
      body = unwrap(await callTool("pd_typeform_proxy_get", { url: EXT_URL }));
    const items: unknown[] | null = Array.isArray(body?.items)
      ? body.items
      : null;
    if (!items) throw new Error("the form read came back without responses");
    return {
      ok: true,
      grants: parseExtensionResponses(items),
      responses: items.length,
      cached,
      items,
    };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/**
 * A hand check from the CLI (`npx convex run --prod ceo/extensions:doctor`):
 * how much of the form was read and how it landed, as counts only. No client
 * name leaves it.
 */
export const doctor = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Record<string, unknown>> => {
    const fieldConfigured = (await findExtensionField()) !== null;
    const read = await readExtensionForm(ctx);
    if (!read.ok) return { ok: false, error: read.error, fieldConfigured };
    const cards: BillingRow[] = await ctx.runQuery(
      internal.ceo.billing.allBilling,
      {},
    );
    const today = kuwaitDay();
    const s = summariseExtensions(
      read.grants,
      cards.map(c => ({ taskId: c.taskId, name: c.name })),
      today,
    );
    const byMonth: Record<string, number> = {};
    for (const g of read.grants)
      byMonth[g.day.slice(0, 7)] = (byMonth[g.day.slice(0, 7)] ?? 0) + 1;
    const days = read.grants.map(g => g.day).sort();
    return {
      ok: true,
      today,
      cached: read.cached,
      responses: read.responses,
      grants: read.grants.length,
      oldestDay: days[0] ?? null,
      newestDay: days[days.length - 1] ?? null,
      byMonth,
      cards: cards.length,
      matched: read.grants.length - s.unmatched - s.internalTest,
      unmatched: s.unmatched,
      internalTest: s.internalTest,
      monthToDate: { totalWeeks: s.totalWeeks, grants: s.grants },
      lastMonth: s.lastMonth,
      liveToday: s.perClient.filter(p => p.live).length,
      fieldConfigured,
      // The newest ten responses' shape, so a form change shows up here.
      shapes: explainResponses(read.items.slice(0, 10)),
    };
  },
});

// --- Writing the current extension to the card --------------------------------

export type ApplyResult = {
  /** Cards set to the live extension's weeks. */
  written: number;
  /** Cards set to 0 because their last extension has ended. */
  cleared: number;
  /** Cards the form named that have gone, left alone. */
  skipped: number;
  errors: string[];
  /** One plain sentence for the screen. */
  note: string;
};

const shortDay = (day: string) => {
  const m = Number(day.slice(5, 7));
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${Number(day.slice(8, 10))} ${names[m - 1] ?? ""}`.trim();
};

/** What the field said after the last write, per card, so an unchanged value is not sent again. */
const WRITTEN_KEY = "extension_field_written";

/**
 * Write the field on every card the form has named. `force` sends every
 * value (the button); otherwise only the values that differ from the last
 * write go out, which is what the automatic pass after each form sync does.
 */
async function writeExtensionField(
  ctx: ActionCtx,
  by: string,
  force: boolean,
): Promise<ApplyResult> {
  const none = { written: 0, cleared: 0, skipped: 0, errors: [] as string[] };
  const fieldId = await findExtensionField();
  if (!fieldId) return { ...none, note: FIELD_ASK };

  const read = await readExtensionForm(ctx);
  if (!read.ok)
    return {
      ...none,
      note: `The Client Extension Form could not be read (${read.error}), so nothing was written.`,
    };
  const cards: BillingRow[] = await ctx.runQuery(
    internal.ceo.billing.allBilling,
    {},
  );
  if (cards.length === 0)
    return {
      ...none,
      note: "The client cards have not been read by the CSM sync yet, so there is nothing to match the form against.",
    };
  const today = kuwaitDay();
  const { writes, skipped } = planWrites(
    read.grants,
    cards.map(c => ({ taskId: c.taskId, name: c.name, stage: c.stage })),
    today,
  );
  const last = ((await readSetting(WRITTEN_KEY)) ?? {}) as Record<
    string,
    number
  >;
  const due = force ? writes : writes.filter(w => last[w.taskId] !== w.weeks);
  const errors: string[] = [];
  const done: FieldWrite[] = [];
  for (const w of due) {
    try {
      unwrap(
        await callTool("pd_clickup_proxy_post", {
          url: `https://api.clickup.com/api/v2/task/${w.taskId}/field/${fieldId}`,
          json_body: { value: w.weeks },
        }),
      );
      done.push(w);
    } catch (e) {
      errors.push(`${w.client}: ${errText(e)}`);
    }
  }
  if (done.length) {
    await ctx.runMutation(internal.ceo.extensions.recordWrite, {
      rows: done,
      by,
    });
    const next = { ...last };
    for (const w of done) next[w.taskId] = w.weeks;
    try {
      await writeSetting(WRITTEN_KEY, next, by);
    } catch {
      // The memory is a courtesy; the audit rows are the record.
    }
  }
  const written = done.filter(w => w.weeks > 0).length;
  const cleared = done.length - written;
  const note = done.length
    ? `Written to the '${EXTENSION_FIELD_NAME}' field on each card the form has named: the live extension's weeks, or 0 once it has ended.`
    : writes.length
      ? due.length
        ? "Nothing was written."
        : "Every card already says what the form says; nothing to write."
      : "No response on the Client Extension Form matches a client card, so there was nothing to write.";
  return { written, cleared, skipped, errors, note };
}

/**
 * Write the current extension onto the client cards, from the button on the
 * Client success tab. Sends every value. The field cannot be created through
 * ClickUp's API; until it exists the action writes nothing and says what to do.
 */
export const applyToClickUp = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<ApplyResult> => {
    // The CEO gate, and the email the audit rows name.
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    return await writeExtensionField(ctx, by, true);
  },
});

/**
 * The automatic pass, scheduled by the clients section after each read of
 * the form (Aziz, 2026-09-21: "tie it to the extension scenario"): only the
 * values that changed since the last write go to ClickUp, each with an audit
 * row. Nothing happens until the field exists.
 */
export const applyAuto = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<ApplyResult> =>
    await writeExtensionField(
      ctx,
      "the cockpit, after the extension form sync",
      false,
    ),
});

/** One audit line per card written, so a figure on ClickUp can always be traced. */
export const recordWrite = internalMutation({
  args: { rows: v.array(v.any()), by: v.string() },
  returns: v.null(),
  handler: async (ctx, { rows, by }) => {
    const at = Date.now();
    for (const r of rows as FieldWrite[])
      await ctx.db.insert("ceoAudit", {
        action: "extension.write",
        table: "ceoClientBilling",
        rowId: String(r.taskId),
        what:
          r.weeks > 0
            ? `Set ${r.client}'s current extension to ${r.weeks} ${r.weeks === 1 ? "week" : "weeks"} on ClickUp: granted ${shortDay(r.grantedDay)} on the Client Extension Form, cover to ${shortDay(r.until)}.`
            : `Cleared ${r.client}'s current extension on ClickUp (set to 0): the last one, granted ${shortDay(r.grantedDay)}, ended ${shortDay(r.until)}.`,
        after: { extensionWeeks: r.weeks, extendedUntil: r.until },
        by,
        at,
      });
    return null;
  },
});
