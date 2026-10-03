// The rules every send shares (the hooks commit, contract v2 sections 3, 9
// and 11), kept apart from index.ts so they can be tested without the
// Supabase runtime:
// - one clock for the lead's hours, the desk's (UAE and Oman UTC+4);
// - the first-message hours and the day off;
// - the read-back that matches the words, not just any outbound message;
// - the duplicate detector (two identical outbound messages within 60 s);
// - WhatsApp health per source;
// - the month's template budget;
// - the two settings saves that keep every key they do not edit.

type Row = Record<string, unknown>;

const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// The lead's clock (followups.py PLUS_FOUR, finding 23: one list, two doors)
// ---------------------------------------------------------------------------

/** Every UAE and Oman place the desk knows, in English and Arabic: UTC+4. Everyone else in the Gulf is UTC+3. */
export const PLUS_FOUR =
  /^\s*(ae|om)\s*$|emirates|\buae\b|u\.a\.e|dubai|abu dhabi|sharjah|ajman|\boman\b|muscat|الإمارات|الامارات|دبي|أبوظبي|ابوظبي|الشارقة|مسقط/i;

export function leadOffsetHours(country: unknown): 3 | 4 {
  return PLUS_FOUR.test(String(country ?? "")) ? 4 : 3;
}
export function leadHour(country: unknown, now: number): number {
  return new Date(now + leadOffsetHours(country) * HOUR).getUTCHours();
}
/** 0 Sunday to 6 Saturday, on the lead's clock. */
export function leadWeekday(country: unknown, now: number): number {
  return new Date(now + leadOffsetHours(country) * HOUR).getUTCDay();
}

export const HOURS_COPY = {
  first: "A first message goes between {from} and {to}, their time.",
  night: "It is night where the lead is. Send it after 9 in the morning, their time.",
  friday: "It is Friday where the lead is, their day off. It goes on Saturday.",
} as const;

function clock(h: number): string {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "noon";
  return String(h > 12 ? h - 12 : h);
}

/** followups.first_hours as [from, to): two whole hours 0 to 24 in order, else [9, 18]. */
export function firstHours(followups: unknown): [number, number] {
  const v = (followups as Row | null)?.first_hours;
  if (Array.isArray(v) && v.length === 2) {
    const [a, b] = v.map(Number);
    if (Number.isInteger(a) && Number.isInteger(b) && (a as number) >= 0 && (b as number) <= 24 && (a as number) < (b as number))
      return [a as number, b as number];
  }
  return [9, 18];
}

/** followups.quiet as the hours a later message may go: from quiet.to (9) until quiet.from (21). */
export function laterHours(followups: unknown): [number, number] {
  const q = ((followups as Row | null)?.quiet ?? {}) as Row;
  const from = Number(q.to ?? 9);
  const to = Number(q.from ?? 21);
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to <= 24 && from < to ? [from, to] : [9, 21];
}

/**
 * Why a follow-up may not go now, on the lead's clock, or null. An answer to
 * a lead who just wrote goes any time; a first message (touch 1, not a reply
 * or a confirmation) only within first_hours; anything else within 9 to 21.
 * `dayOff` adds the Friday rule (the desk's own sends: followup.send_due).
 */
export function hoursRefusal(o: {
  segment: unknown;
  touch: unknown;
  country: unknown;
  now: number;
  followups: unknown;
  dayOff?: boolean;
}): string | null {
  if (o.segment === "reply") return null;
  if (o.dayOff && leadWeekday(o.country, o.now) === 5) return HOURS_COPY.friday;
  const h = leadHour(o.country, o.now);
  const first = o.segment !== "confirm" && Number(o.touch ?? 1) <= 1;
  if (first) {
    const [from, to] = firstHours(o.followups);
    if (h < from || h >= to) return HOURS_COPY.first.replace("{from}", clock(from)).replace("{to}", clock(to));
    return null;
  }
  const [from, to] = laterHours(o.followups);
  return h < from || h >= to ? HOURS_COPY.night : null;
}

// ---------------------------------------------------------------------------
// The read-back and the duplicate detector (C28, C29)
// ---------------------------------------------------------------------------

/** Words as compared: no case, no marks, one space. */
export function normText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The same message: equal once normalised, or one starts with the other's
 * first 60 characters (HighLevel can add a template's button or footer).
 */
export function sameText(a: unknown, b: unknown): boolean {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(60, x.length, y.length);
  return n >= 20 && (x.startsWith(y.slice(0, n)) || y.startsWith(x.slice(0, n)));
}

export interface SeenMessage {
  id?: string | null;
  direction?: unknown;
  channel?: unknown;
  body?: unknown;
  at?: unknown;
  status?: unknown;
}

/**
 * The outbound WhatsApp message a send became: after `since` (less 15 s of
 * clock drift), and with the words that were sent when they are known, so a
 * WA Connector copy or another rep's message never counts as this one.
 */
export function matchSent<T extends SeenMessage>(list: T[], since: number, text?: string | null): T | null {
  for (const m of list) {
    const t = Date.parse(String(m.at ?? ""));
    if (m.direction !== "outbound" || m.channel !== "whatsapp" || !Number.isFinite(t) || t < since - 15_000) continue;
    if (text && !sameText(m.body, text)) continue;
    return m;
  }
  return null;
}

/** Two identical outbound WhatsApp messages to one lead within `windowS` seconds: the pair, or null. */
export function duplicatePair<T extends SeenMessage>(list: T[], windowS = 60): [T, T] | null {
  const out = list
    .filter(m => m.direction === "outbound" && m.channel === "whatsapp" && normText(m.body) && Number.isFinite(Date.parse(String(m.at ?? ""))))
    .sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)));
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i] as T;
      const b = out[j] as T;
      if (Date.parse(String(b.at)) - Date.parse(String(a.at)) > windowS * 1000) break;
      if (a.id && a.id === b.id) continue;
      if (normText(a.body) === normText(b.body)) return [a, b];
    }
  return null;
}

/**
 * Whether the duplicate detector watches the sends that just went (C28). It
 * proves the WA Connector is really off, so it watches only once a manager
 * has said so (whatsapp_guard.connector_off), and not while a pause already
 * stands. Before that every send is known to be copied, and a watch would
 * pause WhatsApp for every rep on the first one.
 */
export function duplicateWatchOn(guard: unknown): boolean {
  const g = (guard ?? {}) as Row;
  return g.connector_off === true && !g.dup_paused_at;
}

export const DUPLICATE_PAUSED =
  "WhatsApp sends are paused: two identical messages went to one lead within {seconds} seconds, so the WA Connector may still be on. A manager clears the pause under Follow-ups, How it works, once only one copy goes.";

// ---------------------------------------------------------------------------
// WhatsApp health per source (C27) and the gate
// ---------------------------------------------------------------------------

export type SendSource = "rep" | "followup" | "room" | "thread";

export function healthCfg(guard: unknown, source: SendSource): { window: number; fail_share: number; min_sends: number } {
  const g = (guard ?? {}) as Row;
  const per = (((g.health ?? {}) as Row)[source] ?? {}) as Row;
  const n = (v: unknown, d: number, lo: number, hi: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= lo && x <= hi ? x : d;
  };
  return {
    window: Math.round(n(per.window, 20, 1, 1000)),
    fail_share: n(per.fail_share, 0.3, 0.01, 1),
    min_sends: Math.round(n(per.min_sends ?? g.pause_min_sends, 5, 1, 1000)),
  };
}

/** A source's last `window` WhatsApp sends, newest first: paused when the failed share reaches fail_share. */
export function sourceHealth(
  rows: { state?: unknown; error?: unknown }[],
  cfg: { window: number; fail_share: number; min_sends: number },
  source: SendSource,
): { paused: boolean; why: string; sent: number; failed: number } {
  const last = rows.slice(0, cfg.window);
  const failed = last.filter(r => r.state === "failed");
  const paused = last.length >= cfg.min_sends && failed.length / last.length >= cfg.fail_share;
  const reason = failed.map(r => String(r.error ?? "")).find(Boolean) ?? "no reason given";
  return {
    paused,
    sent: last.length,
    failed: failed.length,
    why: paused
      ? `Automatic WhatsApp sends for ${source === "followup" ? "follow-ups" : `${source} messages`} are paused: ${failed.length} of the last ${last.length} failed (${reason.slice(0, 160)}). A person sends until that clears.`
      : "",
  };
}

/** The WhatsApp gate (glossary 1.4): open only once the WA Connector is off and the single-copy test has passed. */
export function gateOpen(guard: unknown): boolean {
  const g = (guard ?? {}) as Row;
  return g.connector_off === true && typeof g.single_copy_ok_at === "string" && Number.isFinite(Date.parse(g.single_copy_ok_at));
}
export const GATE_SHUT = "WhatsApp sends from the desk are off until the WA Connector is off and the single-copy test passes.";

// ---------------------------------------------------------------------------
// The month's template budget (D18, finding 27)
// ---------------------------------------------------------------------------

/** Kuwait's first of the month that holds `now`, as an instant. */
export function kuwaitMonthStart(now: number): string {
  const k = new Date(now + 3 * HOUR);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 3 * HOUR).toISOString();
}

export function budgetOf(guard: unknown): { budget: number; rate: number } {
  const g = (guard ?? {}) as Row;
  const b = Number(g.template_budget_usd_month);
  const r = Number(g.template_rate_usd);
  return { budget: Number.isFinite(b) && b >= 0 ? b : 100, rate: Number.isFinite(r) && r > 0 && r <= 1 ? r : 0.0792 };
}

/** This month's spend estimate, and the refusal when it has reached the budget. */
export function budgetCheck(sentThisMonth: number, guard: unknown): { spend: number; budget: number; refusal: string | null } {
  const { budget, rate } = budgetOf(guard);
  const spend = Math.round(sentThisMonth * rate * 100) / 100;
  return {
    spend,
    budget,
    refusal:
      spend >= budget
        ? `This month's WhatsApp template budget of $${budget} is spent: about $${spend.toFixed(2)} so far (estimate). A manager raises it under Follow-ups, How it works, after checking the wallet.`
        : null,
  };
}

// ---------------------------------------------------------------------------
// Settings saves that keep every key (lc-db and lc-desk finding 17)
// ---------------------------------------------------------------------------

type Check<T> = { ok: true; value: T } | { ok: false; error: string };

function whole(x: unknown, lo: number, hi: number, name: string): number | string {
  const n = Number(x);
  if (!Number.isInteger(n) || n < lo || n > hi) return `${name} has to be a whole number from ${lo} to ${hi}.`;
  return n;
}

/**
 * The `followups` setting as a manager's save leaves it. Only what was sent
 * changes; every other key, including those this screen does not know
 * (waves, first_hours, stop_pause_days, graduation, reply_alerts,
 * untagged_every_days), keeps its value. The new keys are checked with the
 * desk's bounds. Openers go only by batch, so autosend.reactivate is false.
 */
export function followupSettingsValue(before: Row, v: Row, segments: readonly string[]): Check<Row> {
  const given = (k: string) => (v[k] !== undefined ? v[k] : before[k]);
  const map = (k: string) => ({ ...((before[k] ?? {}) as Row), ...((v[k] ?? {}) as Row) });
  const errs: string[] = [];
  const int = (x: unknown, lo: number, hi: number, name: string) => {
    const r = whole(x, lo, hi, name);
    if (typeof r === "string") {
      errs.push(r);
      return lo;
    }
    return r;
  };
  const quiet = (given("quiet") ?? {}) as Row;
  const quietFrom = int(quiet.from ?? 21, 0, 23, "The quiet hours' start");
  const quietTo = int(quiet.to ?? 9, 0, 23, "The quiet hours' end");
  const auto = map("autosend");
  const takeover = map("takeover");
  const fallback = map("email_fallback");
  const replaces = (before.replaces ?? {}) as Row;
  const days = given("quiet_days");
  const value: Row = {
    ...before,
    enabled: given("enabled") !== false,
    autosend: Object.fromEntries(segments.map(s => [s, s !== "reactivate" && auto[s] === true])),
    takeover: Object.fromEntries(Object.keys(replaces).map(s => [s, takeover[s] === true])),
    replaces,
    email_fallback: Object.fromEntries(segments.map(s => [s, fallback[s] !== false])),
    cadence: before.cadence ?? {},
    automation_gap_hours: int(given("automation_gap_hours") ?? 20, 0, 72, "Hours to wait after an automation's message"),
    quiet_days: (Array.isArray(days) ? days : ["friday"])
      .map(d => String(d).toLowerCase())
      .filter(d => ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].includes(d)),
    per_run: int(given("per_run") ?? 12, 1, 50, "Drafts per run"),
    per_day: int(given("per_day") ?? 60, 1, 400, "Drafts per day"),
    quiet: { from: quietFrom, to: quietTo },
    nurture_every_days: int(given("nurture_every_days") ?? 7, 2, 60, "Days between nurture messages"),
    nurture_per_day: int(given("nurture_per_day") ?? 20, 0, 200, "Long-term messages a day"),
  };
  if (given("waves") !== undefined) {
    const w = { ...((before.waves ?? {}) as Row), ...((v.waves ?? {}) as Row) };
    const share = Number(w.holdout_share ?? 0.1);
    if (!Number.isFinite(share) || share < 0 || share > 0.5) errs.push("The holdout share is between 0 and 0.5.");
    value.waves = {
      ...w,
      per_day: int(w.per_day ?? 40, 0, 200, "Openers a day"),
      holdout_share: share,
      batch_gap_s: int(w.batch_gap_s ?? 45, 30, 3600, "Seconds between openers"),
      salt: typeof w.salt === "string" && w.salt.trim() ? w.salt.trim().slice(0, 40) : "waves",
    };
  }
  if (given("first_hours") !== undefined) {
    const f = given("first_hours");
    const ok = Array.isArray(f) && f.length === 2 && f.every(n => Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 24);
    if (!ok || Number((f as unknown[])[0]) >= Number((f as unknown[])[1]))
      errs.push("First-message hours are two whole hours from 0 to 24, the first before the second.");
    else value.first_hours = (f as unknown[]).map(Number);
  }
  if (given("stop_pause_days") !== undefined)
    value.stop_pause_days = int(given("stop_pause_days"), 1, 90, "Days a stop word pauses the agent");
  return errs.length ? { ok: false, error: errs[0] as string } : { ok: true, value };
}

/**
 * The `whatsapp_guard` setting as a manager's save leaves it, keeping every
 * key it does not edit (one save used to drop connector_off and
 * single_copy_ok_at and shut the gate). Only a manager sets connector_off
 * and single_copy_ok_at; the duplicate detector's pause is cleared here.
 */
export function whatsappGuardValue(before: Row, v: Row, now: number): Check<Row> {
  const given = (k: string) => (v[k] !== undefined ? v[k] : before[k]);
  const perDay = Number(given("templates_per_day") ?? 250);
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 5000)
    return { ok: false, error: "Templates a day is a whole number from 1 to 5,000." };
  const share = Number(given("pause_fail_share") ?? 0.3);
  if (!Number.isFinite(share) || share <= 0 || share > 1) return { ok: false, error: "The pause share is between 0 and 1." };
  const value: Row = {
    ...before,
    templates_per_day: perDay,
    pause_fail_share: share,
    pause_min_sends: Math.max(1, Math.round(Number(given("pause_min_sends") ?? 5))),
  };
  if (v.connector_off !== undefined) {
    if (typeof v.connector_off !== "boolean") return { ok: false, error: "Say whether the WA Connector is off (yes or no)." };
    value.connector_off = v.connector_off;
  }
  if (v.single_copy_ok_at !== undefined) {
    const s = v.single_copy_ok_at;
    if (s === null) value.single_copy_ok_at = null;
    else if (s === true) value.single_copy_ok_at = new Date(now).toISOString();
    else if (typeof s === "string" && Number.isFinite(Date.parse(s)) && Date.parse(s) <= now + 60_000)
      value.single_copy_ok_at = new Date(Date.parse(s)).toISOString();
    else return { ok: false, error: "The single-copy test's time is not a time that has passed." };
  }
  if (v.dup_window_s !== undefined) {
    const n = whole(v.dup_window_s, 10, 600, "The duplicate window");
    if (typeof n === "string") return { ok: false, error: n };
    value.dup_window_s = n;
  }
  if (v.template_budget_usd_month !== undefined) {
    const n = Number(v.template_budget_usd_month);
    if (!Number.isFinite(n) || n < 0 || n > 100_000) return { ok: false, error: "The month's template budget is a dollar amount of 0 or more." };
    value.template_budget_usd_month = Math.round(n * 100) / 100;
  }
  if (v.template_rate_usd !== undefined) {
    const n = Number(v.template_rate_usd);
    if (!Number.isFinite(n) || n <= 0 || n > 1) return { ok: false, error: "The rate per template is a dollar amount above 0 and at most 1." };
    value.template_rate_usd = n;
  }
  // The duplicate detector's pause is only ever cleared by a person.
  if (v.dup_paused_at === null) {
    value.dup_paused_at = null;
    value.dup_reason = null;
  }
  return { ok: true, value };
}
