/**
 * Client billing: one sheet over the ClickUp client cards, shared by the CEO
 * cockpit and the client success cockpit.
 *
 * Aziz, 2026-09-23: "a sheet where we can see all the clients and where
 * they're at with billing, and make decisions on it. It's tied to ClickUp,
 * and it updates in a two-way sync... which type of payment they're going to
 * use, their next payment date, if they need an extension or they need to be
 * paused."
 *
 * This file is the same in both apps (scripts/check-shared.sh holds it to
 * that) and imports nothing from either app, so the rules cannot drift: what
 * counts as late, what an extension does to a date, which field is which.
 *
 * Two rules the whole file is built around.
 *
 * 1. ClickUp is the record. An edit is written to the card first and only
 *    then to the Supabase mirror and the log, so a failed write to ClickUp
 *    leaves nothing claiming a change that did not happen. The mirror is
 *    what the sheet and Maher read; the sync rewrites it from ClickUp.
 *
 * 2. The ladder is the SOP's, not a new one. Three to seven days before a
 *    payment, confirm the method. Three days before, the invoice. Then the
 *    day, day one, day two is a call, day three is a pause, day fifteen is
 *    churn. Maher runs the same ladder; the sheet shows where each client is
 *    on it so the two never disagree about who is late.
 */

// biome-ignore lint/suspicious/noExplicitAny: ClickUp and PostgREST payloads
type Any = Record<string, any>;

/** Clients - Mahara. */
export const LIST_ID = "901816559981";

/** The card fields billing reads and writes. */
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

/** The dropdown options exactly as ClickUp spells them. */
export const METHODS = [
  "Card on file",
  "Bank transfer",
  "Tap link",
  "Whop link",
  "Check",
] as const;
export const PLANS = [
  "Monthly",
  "Split Pay (2x payments)",
  "Paid in full (90 days)",
  "1.0K Start / $2K Months After",
  "Performance ($3k/$3k)",
] as const;

export type Group = "active" | "paused" | "pipeline" | "sales" | "gone";

export type Account = {
  taskId: string;
  name: string;
  url: string | null;
  status: string | null;
  group: Group;
  method: string | null;
  plan: string | null;
  country: string | null;
  nextUsd: number | null;
  nextDate: string | null;
  mrrUsd: number | null;
  ltvFieldUsd: number | null;
  pausedOn: string | null;
  extensionWeeks: number | null;
  churnDate: string | null;
  csm: string | null;
  syncedAt: string | null;
  source: "sync" | "ceo" | "csm" | "maher";
};

const GONE = new Set(["Stopped", "CANCELLED ONBOARDING"]);
const SALES = "SALES TEAM TO CONTACT";
const INTERNAL = /playing account|\[internal test\]/i;

/** The same five groups the money section files cards under. */
export function groupOf(status: string | null | undefined): Group {
  const s = String(status ?? "");
  if (s === "Active") return "active";
  if (s === "Paused") return "paused";
  if (GONE.has(s)) return "gone";
  if (s === SALES) return "sales";
  return "pipeline";
}

export const isInternal = (name: string): boolean => INTERNAL.test(name);

// --- dates -----------------------------------------------------------------

/** Today in Kuwait, "YYYY-MM-DD". */
export function kuwaitToday(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`; positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** ClickUp keeps a date as milliseconds; a Kuwait day is what people mean. */
function dayOf(ms: unknown): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n + 3 * 3600_000).toISOString().slice(0, 10);
}

/** Noon Kuwait on that day, so no timezone can move it to the day before. */
function msOf(day: string): number {
  return Date.parse(`${day}T09:00:00Z`);
}

// --- the ladder ------------------------------------------------------------

export type Rung =
  | "none"
  | "later"
  | "confirm"
  | "invoice"
  | "today"
  | "day1"
  | "call"
  | "pause"
  | "paused"
  | "day7"
  | "day14"
  | "churn";

export type Ladder = {
  rung: Rung;
  /** What to do, in the SOP's words. */
  label: string;
  /** Days until the payment (positive) or since it was due (negative). */
  days: number | null;
  tone: "neutral" | "good" | "warning" | "serious" | "critical";
};

/**
 * Where a client stands on the chasing ladder today.
 *
 * A paused client is measured from Paused On, not from the payment date,
 * because the fifteen-day rule is fifteen days in this pause (Maher's
 * pitfall: a client paused, resumed and paused again was once churned on day
 * one of the second pause, measured from the first).
 */
export function ladderOf(a: Account, today = kuwaitToday()): Ladder {
  if (a.group === "gone" || a.group === "sales")
    return {
      rung: "none",
      label: "Not a paying client",
      days: null,
      tone: "neutral",
    };
  // Paused with no date on the card: the fifteen-day clock cannot start, and
  // a payment date on a paused card means nothing, so neither is used. It is
  // the one thing to fix first (AIVE designs and Greystone, 2026-09-23).
  if (a.group === "paused" && !a.pausedOn)
    return {
      rung: "paused",
      label: "Paused with no pause date: stamp one",
      days: null,
      tone: "serious",
    };
  if (a.group === "paused" && a.pausedOn) {
    const inPause = daysBetween(a.pausedOn, today);
    if (inPause >= 15)
      return {
        rung: "churn",
        label: "Fifteen days paused: churn",
        days: -inPause,
        tone: "critical",
      };
    if (inPause >= 11)
      return {
        rung: "day14",
        label: "Ask where they stand",
        days: -inPause,
        tone: "serious",
      };
    if (inPause >= 4)
      return {
        rung: "day7",
        label: "Paused, leads unfollowed",
        days: -inPause,
        tone: "serious",
      };
    return { rung: "paused", label: "Paused", days: -inPause, tone: "warning" };
  }
  if (!a.nextDate)
    return {
      rung: "none",
      label: "No payment date",
      days: null,
      tone: "neutral",
    };
  const d = daysBetween(today, a.nextDate);
  if (d > 7)
    return {
      rung: "later",
      label: "Nothing to do yet",
      days: d,
      tone: "neutral",
    };
  if (d > 3)
    return {
      rung: "confirm",
      label: "Confirm how they pay",
      days: d,
      tone: "good",
    };
  // The SOP sends the invoice three days out (Maher's scan fires on that
  // day); the two days after it are for checking it went.
  if (d > 0)
    return {
      rung: "invoice",
      label: d === 3 ? "Send the invoice" : "Check the invoice went out",
      days: d,
      tone: "warning",
    };
  if (d === 0)
    return { rung: "today", label: "Due today", days: 0, tone: "warning" };
  if (d === -1)
    return {
      rung: "day1",
      label: "Ask for the receipt",
      days: d,
      tone: "serious",
    };
  if (d === -2)
    return {
      rung: "call",
      label: "Call, do not write",
      days: d,
      tone: "serious",
    };
  if (d <= -15)
    return {
      rung: "churn",
      label: "Fifteen days late: churn",
      days: d,
      tone: "critical",
    };
  return {
    rung: "pause",
    label: "Pause the account, call first",
    days: d,
    tone: "critical",
  };
}

// --- reading ClickUp -------------------------------------------------------

export type Options = Map<string, Map<string, { id: string; index: number }>>;

/**
 * Where each outside call's outcome goes. The CEO deployment points this at
 * its health ledger (health.ts `note`), so a ClickUp or Supabase failure from
 * the billing sheet reaches the Machine tab like every other call. The client
 * success deployment has no ledger of its own and leaves it quiet.
 */
type Noter = (source: string, ok: boolean, error?: string) => void;
let noter: Noter = () => {};
export function reportCallsTo(fn: Noter): void {
  noter = fn;
}
/** A rate limit or a blip is not a system down. */
const blip = (status: number) =>
  status === 429 ||
  status === 408 ||
  status === 502 ||
  status === 503 ||
  status === 504;

async function clickup(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://api.clickup.com/api/v2/${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (e) {
      noter("clickup", false, `network: ${String(e).slice(0, 120)}`);
      throw new Error("ClickUp did not answer. Try again in a minute.");
    }
    const text = await res.text();
    if (res.ok) {
      noter("clickup", true);
      return text ? JSON.parse(text) : {};
    }
    // ClickUp rate-limits at a hundred calls a minute per token.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    noter(
      "clickup",
      blip(res.status),
      `HTTP ${res.status} ${text.slice(0, 160)}`,
    );
    throw new Error(`ClickUp ${res.status}: ${text.slice(0, 200)}`);
  }
}

/** Every dropdown on the list, name to option id, for writes. */
export async function fieldOptions(token: string): Promise<Options> {
  const res = await clickup(token, `list/${LIST_ID}/field`);
  const out: Options = new Map();
  for (const f of (res.fields ?? []) as Any[]) {
    const opts = new Map<string, { id: string; index: number }>();
    for (const o of (f.type_config?.options ?? []) as Any[])
      opts.set(String(o.name), {
        id: String(o.id),
        index: Number(o.orderindex),
      });
    out.set(String(f.id), opts);
  }
  return out;
}

/** A dropdown read returns the option's index; this turns it back into its name. */
function dropdownName(
  options: Options,
  fieldId: string,
  value: unknown,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  for (const [name, o] of options.get(fieldId) ?? [])
    if (o.index === Number(value) || o.id === String(value)) return name;
  return null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** One card as a billing row, read fresh, for an edit to start from the truth. */
export async function readAccount(
  token: string,
  taskId: string,
): Promise<Account> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(taskId))
    throw new Error("That is not a ClickUp card id.");
  const [options, t] = await Promise.all([
    fieldOptions(token),
    clickup(token, `task/${taskId}`),
  ]);
  if (String(t.list?.id ?? "") !== LIST_ID)
    throw new Error("That card is not on the Clients - Mahara list.");
  return toAccount(t, options, new Date().toISOString());
}

function toAccount(t: Any, options: Options, now: string): Account {
  const cf = new Map<string, Any>(
    ((t.custom_fields ?? []) as Any[]).map(f => [String(f.id), f]),
  );
  const val = (id: string) => cf.get(id)?.value;
  const status = dropdownName(options, F.status, val(F.status));
  return {
    taskId: String(t.id),
    name: String(t.name ?? "").trim(),
    url: t.url ? String(t.url) : null,
    status,
    group: groupOf(status),
    method: dropdownName(options, F.method, val(F.method)),
    plan: dropdownName(options, F.plan, val(F.plan)),
    country: dropdownName(options, F.country, val(F.country)),
    nextUsd: num(val(F.nextAmount)),
    nextDate: dayOf(val(F.nextDate)),
    mrrUsd: num(val(F.mrr)),
    ltvFieldUsd: num(val(F.ltv)),
    pausedOn: dayOf(val(F.pausedOn)),
    extensionWeeks: num(val(F.extension)),
    churnDate: dayOf(val(F.churnDate)),
    csm:
      ((t.assignees ?? []) as Any[])
        .map(a => String(a.username ?? a.email ?? ""))
        .filter(Boolean)
        .join(", ") || null,
    syncedAt: now,
    source: "sync",
  };
}

/** Every card on the list, closed ones included, as billing rows. */
export async function readAccounts(token: string): Promise<Account[]> {
  const options = await fieldOptions(token);
  const tasks: Any[] = [];
  for (let page = 0; page < 20; page++) {
    const res = await clickup(
      token,
      `list/${LIST_ID}/task?include_closed=true&subtasks=false&page=${page}`,
    );
    const batch = (res.tasks ?? []) as Any[];
    tasks.push(...batch);
    if (res.last_page !== false || batch.length === 0) break;
  }
  const now = new Date().toISOString();
  return tasks
    .filter(t => !isInternal(String(t.name ?? "")))
    .map(t => toAccount(t, options, now));
}

// --- writing ClickUp -------------------------------------------------------

async function setValue(
  token: string,
  taskId: string,
  fieldId: string,
  value: unknown,
  dateField = false,
): Promise<void> {
  if (value === null) {
    // Clearing: ClickUp takes a DELETE on the field value.
    await clickup(token, `task/${taskId}/field/${fieldId}`, {
      method: "DELETE",
    });
    return;
  }
  await clickup(token, `task/${taskId}/field/${fieldId}`, {
    method: "POST",
    body: dateField ? { value, value_options: { time: false } } : { value },
  });
}

async function setDropdown(
  token: string,
  options: Options,
  taskId: string,
  fieldId: string,
  name: string,
): Promise<void> {
  const o = options.get(fieldId)?.get(name);
  if (!o) throw new Error(`"${name}" is not an option on that ClickUp field.`);
  await setValue(token, taskId, fieldId, o.id);
}

export async function comment(
  token: string,
  taskId: string,
  text: string,
): Promise<void> {
  await clickup(token, `task/${taskId}/comment`, {
    method: "POST",
    body: { comment_text: text, notify_all: false },
  });
}

// --- edits -----------------------------------------------------------------

export type Edit =
  | { kind: "method"; value: string }
  | { kind: "plan"; value: string }
  | { kind: "amount"; value: number }
  | { kind: "date"; value: string; reason?: string }
  | {
      kind: "extension";
      weeks: number;
      reason: string;
      /** Whether what caused it was ours to control, the old audit's question. */
      ours: boolean;
      /** Move the next payment date by the same weeks. */
      moveDate: boolean;
    }
  | { kind: "pause"; reason: string; on?: string }
  | { kind: "resume"; nextDate?: string }
  | { kind: "note"; text: string };

export type EventRow = {
  clickup_task_id: string;
  client_name: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  reason: string | null;
  detail: Any | null;
  source: "ceo" | "csm" | "maher" | "clickup";
  by_whom: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function clean(s: string, max = 400): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Apply one decision: ClickUp first, then what the mirror should now say, and
 * the log row. Throws with a sentence a person can act on; writes nothing to
 * the mirror or the log unless ClickUp took it.
 */
export async function applyEdit(
  token: string,
  a: Account,
  edit: Edit,
  who: { by: string; source: "ceo" | "csm" | "maher" },
  today = kuwaitToday(),
): Promise<{ next: Account; event: EventRow }> {
  const options = await fieldOptions(token);
  const next: Account = {
    ...a,
    source: who.source,
    syncedAt: new Date().toISOString(),
  };
  const base = {
    clickup_task_id: a.taskId,
    client_name: a.name,
    source: who.source,
    by_whom: who.by,
    detail: null as Any | null,
    reason: null as string | null,
  };
  switch (edit.kind) {
    case "method": {
      if (!(METHODS as readonly string[]).includes(edit.value))
        throw new Error("Pick one of the payment methods on the card.");
      await setDropdown(token, options, a.taskId, F.method, edit.value);
      next.method = edit.value;
      return {
        next,
        event: {
          ...base,
          kind: "method",
          from_value: a.method,
          to_value: edit.value,
        },
      };
    }
    case "plan": {
      if (!(PLANS as readonly string[]).includes(edit.value))
        throw new Error("Pick one of the payment plans on the card.");
      await setDropdown(token, options, a.taskId, F.plan, edit.value);
      next.plan = edit.value;
      return {
        next,
        event: {
          ...base,
          kind: "plan",
          from_value: a.plan,
          to_value: edit.value,
        },
      };
    }
    case "amount": {
      const v = Math.round(edit.value * 100) / 100;
      if (!(v > 0) || v > 100_000)
        throw new Error("The amount has to be a real payment in dollars.");
      await setValue(token, a.taskId, F.nextAmount, v);
      next.nextUsd = v;
      return {
        next,
        event: {
          ...base,
          kind: "amount",
          from_value: a.nextUsd === null ? null : String(a.nextUsd),
          to_value: String(v),
        },
      };
    }
    case "date": {
      if (!DAY.test(edit.value)) throw new Error("That is not a date.");
      if (edit.value < addDays(today, -60))
        throw new Error(
          "A payment date two months back is almost certainly a typo.",
        );
      await setValue(token, a.taskId, F.nextDate, msOf(edit.value), true);
      next.nextDate = edit.value;
      return {
        next,
        event: {
          ...base,
          kind: "date",
          from_value: a.nextDate,
          to_value: edit.value,
          reason: edit.reason ? clean(edit.reason) : null,
        },
      };
    }
    case "extension": {
      if (![1, 2, 4].includes(edit.weeks))
        throw new Error(
          "An extension is one, two or four weeks, as on the extension form.",
        );
      const reason = clean(edit.reason);
      if (reason.length < 4)
        throw new Error("Say why, so the extension log reads back.");
      await setValue(token, a.taskId, F.extension, edit.weeks);
      next.extensionWeeks = edit.weeks;
      let moved: string | null = null;
      if (edit.moveDate) {
        // Cover runs from today or from the date already set, whichever is
        // later, so an extension granted early does not shorten the month.
        const from = a.nextDate && a.nextDate > today ? a.nextDate : today;
        moved = addDays(from, edit.weeks * 7);
        await setValue(token, a.taskId, F.nextDate, msOf(moved), true);
        next.nextDate = moved;
      }
      return {
        next,
        event: {
          ...base,
          kind: "extension",
          from_value: a.nextDate,
          to_value: moved ?? a.nextDate,
          reason,
          detail: {
            weeks: edit.weeks,
            ours: edit.ours,
            movedDate: Boolean(moved),
          },
        },
      };
    }
    case "pause": {
      const reason = clean(edit.reason);
      if (reason.length < 4)
        throw new Error("Say why, so the pause reads back in a month.");
      const on = edit.on && DAY.test(edit.on) ? edit.on : today;
      await setDropdown(token, options, a.taskId, F.status, "Paused");
      await setValue(token, a.taskId, F.pausedOn, msOf(on), true);
      next.status = "Paused";
      next.group = "paused";
      next.pausedOn = on;
      return {
        next,
        event: {
          ...base,
          kind: "pause",
          from_value: a.status,
          to_value: "Paused",
          reason,
        },
      };
    }
    case "resume": {
      await setDropdown(token, options, a.taskId, F.status, "Active");
      // Paused On is cleared, or the next pause is measured from this one.
      await setValue(token, a.taskId, F.pausedOn, null);
      next.status = "Active";
      next.group = "active";
      next.pausedOn = null;
      if (edit.nextDate && DAY.test(edit.nextDate)) {
        await setValue(token, a.taskId, F.nextDate, msOf(edit.nextDate), true);
        next.nextDate = edit.nextDate;
      }
      return {
        next,
        event: {
          ...base,
          kind: "resume",
          from_value: a.status,
          to_value: "Active",
        },
      };
    }
    case "note": {
      const text = clean(edit.text, 1000);
      if (text.length < 2) throw new Error("Write the note first.");
      await comment(token, a.taskId, `Billing note (${who.by}): ${text}`);
      return {
        next: a,
        event: {
          ...base,
          kind: "note",
          from_value: null,
          to_value: null,
          reason: text,
        },
      };
    }
  }
}

// --- the Supabase side -----------------------------------------------------

export async function sb(
  url: string,
  key: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Any[]> {
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    noter("supabase", false, `network: ${String(e).slice(0, 120)}`);
    throw new Error("Supabase did not answer. Try again in a minute.");
  }
  const text = await res.text();
  if (!res.ok) {
    noter(
      "supabase",
      blip(res.status),
      `HTTP ${res.status} ${text.slice(0, 160)}`,
    );
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  noter("supabase", true);
  return text ? JSON.parse(text) : [];
}

export function accountRow(a: Account): Any {
  return {
    clickup_task_id: a.taskId,
    client_name: a.name,
    task_url: a.url,
    stage: a.status,
    stage_group: a.group,
    client_status: a.status,
    payment_method: a.method,
    payment_plan: a.plan,
    country: a.country,
    next_payment_usd: a.nextUsd,
    next_payment_date: a.nextDate,
    mrr_usd: a.mrrUsd,
    ltv_field_usd: a.ltvFieldUsd,
    paused_on: a.pausedOn,
    extension_weeks: a.extensionWeeks,
    churn_date: a.churnDate,
    csm: a.csm,
    source: a.source,
    synced_at: a.syncedAt ?? new Date().toISOString(),
  };
}

export function accountFrom(r: Any): Account {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    taskId: String(r.clickup_task_id),
    name: String(r.client_name ?? ""),
    url: r.task_url ? String(r.task_url) : null,
    status: r.client_status ? String(r.client_status) : null,
    group: (r.stage_group as Group) ?? groupOf(r.client_status),
    method: r.payment_method ?? null,
    plan: r.payment_plan ?? null,
    country: r.country ?? null,
    nextUsd: n(r.next_payment_usd),
    nextDate: r.next_payment_date ? String(r.next_payment_date) : null,
    mrrUsd: n(r.mrr_usd),
    ltvFieldUsd: n(r.ltv_field_usd),
    pausedOn: r.paused_on ? String(r.paused_on) : null,
    extensionWeeks: n(r.extension_weeks),
    churnDate: r.churn_date ? String(r.churn_date) : null,
    csm: r.csm ?? null,
    syncedAt: r.synced_at ? String(r.synced_at) : null,
    source: r.source ?? "sync",
  };
}

/** Write the whole list's mirror in one call. */
export async function mirrorAccounts(
  url: string,
  key: string,
  accounts: Account[],
): Promise<void> {
  if (!accounts.length) return;
  await sb(url, key, "cockpit_billing_accounts?on_conflict=clickup_task_id", {
    method: "POST",
    body: accounts.map(accountRow),
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

export async function logEvent(
  url: string,
  key: string,
  e: EventRow,
): Promise<void> {
  await sb(url, key, "cockpit_billing_events", {
    method: "POST",
    body: e,
    prefer: "return=minimal",
  });
}

// --- the sheet -------------------------------------------------------------

export type SheetRow = Account & { ladder: Ladder };

export type Sheet = {
  today: string;
  rows: SheetRow[];
  /** How the book stands, in the numbers the header shows. */
  totals: {
    dueThisWeek: { count: number; usd: number };
    overdue: { count: number; usd: number };
    paused: number;
    extended: number;
    noMethod: number;
    noDate: number;
  };
  /** The newest decisions, newest first. */
  events: (EventRow & { id: number; at: string })[];
  /** Payments logged outside the CEO cockpit, not yet in the ledger. */
  inbox: Any[];
  /** Every client card, gone ones too, for tying money to a client. */
  cards: { taskId: string; name: string; group: Group }[];
  syncedAt: string | null;
};

/** Everybody the sheet shows: a client on the books, not the sales list and not gone. */
export function onTheBooks(a: Account): boolean {
  return a.group === "active" || a.group === "paused" || a.group === "pipeline";
}

export function buildSheet(
  accounts: Account[],
  events: Any[],
  inbox: Any[],
  today = kuwaitToday(),
): Sheet {
  const rows = accounts
    .filter(onTheBooks)
    .map(a => ({ ...a, ladder: ladderOf(a, today) }))
    .sort((x, y) => {
      // The ones that need somebody today first, then by date.
      const rank = (r: SheetRow) =>
        ({
          churn: 0,
          pause: 1,
          call: 2,
          day1: 3,
          today: 4,
          day14: 5,
          day7: 6,
          invoice: 7,
          confirm: 8,
          paused: 9,
          later: 10,
          none: 11,
        })[r.ladder.rung] ?? 12;
      return (
        rank(x) - rank(y) ||
        String(x.nextDate ?? "9999").localeCompare(
          String(y.nextDate ?? "9999"),
        ) ||
        x.name.localeCompare(y.name)
      );
    });
  const late = rows.filter(
    r => r.ladder.days !== null && r.ladder.days < 0 && r.group !== "paused",
  );
  const week = rows.filter(
    r =>
      r.ladder.days !== null &&
      r.ladder.days >= 0 &&
      r.ladder.days <= 7 &&
      r.group !== "paused",
  );
  const sum = (list: SheetRow[]) =>
    Math.round(list.reduce((t, r) => t + (r.nextUsd ?? 0), 0) * 100) / 100;
  return {
    today,
    rows,
    totals: {
      dueThisWeek: { count: week.length, usd: sum(week) },
      overdue: { count: late.length, usd: sum(late) },
      paused: rows.filter(r => r.group === "paused").length,
      extended: rows.filter(r => (r.extensionWeeks ?? 0) > 0).length,
      noMethod: rows.filter(r => r.group === "active" && !r.method).length,
      noDate: rows.filter(r => r.group === "active" && !r.nextDate).length,
    },
    events: events.map(
      e =>
        ({ ...e, id: Number(e.id), at: String(e.at) }) as EventRow & {
          id: number;
          at: string;
        },
    ),
    inbox,
    cards: accounts
      .filter(a => a.group !== "sales" && !isInternal(a.name))
      .map(a => ({ taskId: a.taskId, name: a.name, group: a.group })),
    syncedAt:
      accounts
        .map(a => a.syncedAt)
        .filter((x): x is string => Boolean(x))
        .sort()
        .pop() ?? null,
  };
}

/** Read the sheet from the mirror, the log and the inbox. */
export async function readSheet(url: string, key: string): Promise<Sheet> {
  const [accounts, events, inbox] = await Promise.all([
    sb(url, key, "cockpit_billing_accounts?select=*"),
    sb(url, key, "cockpit_billing_events?select=*&order=at.desc&limit=60"),
    sb(
      url,
      key,
      "cockpit_billing_inbox?select=*&status=eq.pending&order=logged_at.desc&limit=50",
    ),
  ]);
  return buildSheet(accounts.map(accountFrom), events, inbox);
}
