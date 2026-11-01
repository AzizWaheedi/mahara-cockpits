/**
 * The staff forms' rules and words (docs/forms/WAVE12-CONTRACT.md 4.12): the
 * shapes FormSheet renders, the check that runs before a send, the after-send
 * trail made from cockpit_form_trail, and the date and money words. It
 * imports nothing, so the client success cockpit and the CEO cockpit hold
 * the same file byte for byte (scripts/check-shared.sh) and a test can run it
 * without React.
 *
 * The date and money words copy the CEO kit's format.ts (shortDate, money,
 * time) exactly; a test compares the outputs on a fixed table, so this file
 * never formats a day or a dollar its own way. One difference on purpose: a
 * money value nobody holds reads "missing", never "$0" or "n/a".
 */

export type Answers = Record<string, unknown>;

export type FieldType =
  | "choice"
  | "multi"
  | "text"
  | "longtext"
  | "date"
  | "number"
  | "yesno"
  | "call"
  | "tick"
  | "readonly";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean | ((a: Answers) => boolean);
  /** Text: the fewest characters. Number: the lowest value. */
  min?: number;
  hint?: string;
  showIf?: (a: Answers) => boolean;
  /** The sentence for a missing or too short answer (the SQL refusal, word for word). */
  message?: string;
  /** Any other rule, as the sentence to show, or null when the answer is fine. */
  check?: (value: unknown, a: Answers, today: string) => string | null;
  /** A multi choice whose pick clears the others ("No limitations"). */
  exclusive?: string;
  /** A tick drawn in bold when this is true (the over-14-days consent). */
  emphasis?: (a: Answers, today: string) => boolean;
  /** The value a fresh sheet starts from when nothing was prefilled. */
  initial?: (today: string) => unknown;
  placeholder?: string;
  /** An optional call pick's way back to none ("No exit call"). */
  noneLabel?: string;
};

export type FormKey =
  | "extension"
  | "pause"
  | "resume"
  | "churn_confirm"
  | "mrr";

export type FormDef = {
  key: FormKey;
  version: 1;
  title: string;
  fields: FieldDef[];
  submitLabel: (a: Answers) => string;
  doneLabel: string;
  /** One line under the title (an extension that already runs). */
  lede?: string;
  /** The primary action's tone: red only for Pause and Confirm churn. */
  tone?: "primary" | "destructive";
  /** The card writes, as the held step names them: "extensions". */
  cardWords: string;
  /** The ticket a person opens after this decision, or null: its action and, until opened, the step's sentence. */
  ticket: { type: string; label: string; waiting: string } | null;
  /** The trail's line when there is no ticket. */
  ticketNone: string;
  /** False when the form posts no Slack notice (Set MRR). */
  notice: boolean;
};

/**
 * The card's latest pause consent (cockpit_pause_consent_for through
 * cockpit_form_prefill, WAVE34-CONTRACT.md 4.3.4): signed only when answered
 * within 14 days, the dates not marked wrong, and no pause after it.
 */
export type PauseConsent = {
  state: "none" | "sent" | "signed" | "dates_wrong" | "expired";
  inviteId: string | null;
  sentAt: string | null;
  responseId: string | null;
  signedAt: string | null;
  via: "portal" | "link" | null;
  /** "the client admin", or the typed name on a link. */
  signer: string | null;
  start: string | null;
  restart: string | null;
  datesNote: string | null;
};

/** The consent row's state line (5.2), word for word. */
export function consentLine(c: PauseConsent | null): string {
  const day = (v: string | null) => kuwaitDay(v) || "a day not recorded";
  switch (c?.state ?? "none") {
    case "sent":
      return `Waiting for the client's signed consent. Sent ${day(c?.sentAt ?? null)}.`;
    case "signed":
      return c?.via === "link"
        ? `Signed by link by ${c.signer ?? "someone with the link"} on ${day(c.signedAt)}. Check the name, then confirm the pause.`
        : `Signed by the client admin in the portal on ${day(c?.signedAt ?? null)}. Confirm the pause.`;
    case "dates_wrong":
      return `The client says the dates are wrong: "${c?.datesNote ?? "no note"}". Change the restart and send a new consent.`;
    case "expired":
      return "The client has not signed the pause consent in the last 14 days. Send it again.";
    default:
      return "Not sent yet.";
  }
}

/** Confirm's hint while the consent is not signed (5.2). */
export const CONSENT_WAIT = "Confirm opens once the client signs.";

/** One prefilled value and where it came from ("the ClickUp card"). NULL is a sentence, never 0. */
export type Prefill = { key: string; value: unknown; source: string };

/** A call the decision can point to, from cockpit_form_prefill's calls. */
export type CallPick = { id: string; at: string; kind: string; source: string };

export type TrailState =
  | "done"
  | "waiting"
  | "held"
  | "failed"
  | "skipped"
  | "none";

export type TrailStep = {
  key: "stored" | "card" | "notice" | "ticket";
  state: TrailState;
  label: string;
  detail?: string;
  action?: { label: string; href: string; type?: string };
};

/** cockpit_form_trail's answer (WAVE12-CONTRACT.md 3.1). */
export type FormTrailRow = {
  stored?: { state?: string | null; at?: string | null } | null;
  card?: {
    state?: string | null;
    mode?: string | null;
    error?: string | null;
    at?: string | null;
  } | null;
  notice?: {
    kind?: string | null;
    state?: string | null;
    channelName?: string | null;
    error?: string | null;
    permalink?: string | null;
  } | null;
};

/** What a send names, so the trail can be read for it. */
export type SubmitRef = {
  eventId?: number;
  responseId?: string;
  departureId?: number;
};

// --- Dates and money (the CEO kit's format.ts, copied) -----------------------

const KUWAIT_OFFSET_MS = 3 * 3600_000;
const MONTHS_SHORT = [
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
const pad = (n: number) => String(n).padStart(2, "0");
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Kuwait calendar parts of a day, a timestamp or a Date; null when it is none of those. */
function kuwaitParts(d: string | Date | number | null | undefined) {
  if (d === null || d === undefined || d === "") return null;
  if (typeof d === "string") {
    const day = ISO_DAY.exec(d.trim());
    if (day) {
      const at = new Date(Date.UTC(+day[1], +day[2] - 1, +day[3]));
      return Number.isNaN(at.getTime()) ? null : at;
    }
  }
  const ms =
    d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + KUWAIT_OFFSET_MS);
}

/** "2026-11-16" (or a timestamp, or a Date) as "16 Nov", the Kuwait day. Empty when it is not a date. */
export function kuwaitDay(d: string | Date | null | undefined): string {
  const at = kuwaitParts(d);
  return at ? `${at.getUTCDate()} ${MONTHS_SHORT[at.getUTCMonth()]}` : "";
}

/** The Kuwait day as "YYYY-MM-DD", for date inputs and comparisons. */
export function kuwaitIso(d: string | Date | number = Date.now()): string {
  const at = kuwaitParts(d);
  return at
    ? `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
    : "";
}

/** "10:42" in Kuwait; empty when it is not a time. */
export function kuwaitTime(d: string | Date | null | undefined): string {
  if (typeof d === "string" && ISO_DAY.test(d.trim())) return "";
  const at = kuwaitParts(d);
  return at ? `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}` : "";
}

/** Whole days from a to b, both "YYYY-MM-DD" (b later is positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** The day n days after a "YYYY-MM-DD" day. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
// U+2212, the typographic minus the CEO kit uses.
const MINUS = "−";
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fils = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** $12,450; cents only under $100 when there are any ($84.50). NULL reads "missing", never "$0". */
export function usd(n: number | null): string {
  if (!isNum(n)) return "missing";
  const abs = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  if (abs < 100 && Math.round(abs * 100) % 100 !== 0)
    return `${sign}$${cents.format(abs)}`;
  const rounded = Math.round(abs);
  return `${rounded === 0 ? "" : sign}$${int.format(rounded)}`;
}

/** "1,500 KWD ($4,890)": the amount as paid, then its dollars. Either side missing is said, never 0. */
export function kwdWithUsd(
  kwd: number | null,
  usdValue: number | null,
): string {
  if (!isNum(kwd)) return usd(usdValue);
  const paid = `${kwd < 0 ? MINUS : ""}${fils.format(Math.abs(kwd))} KWD`;
  return isNum(usdValue)
    ? `${paid} (${usd(usdValue)})`
    : `${paid} (dollars missing)`;
}

// --- Answers ------------------------------------------------------------------

/** True when a field has no answer (an empty text, no pick, an unticked box). */
export function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "boolean") return v === false;
  if (typeof v === "number") return !Number.isFinite(v);
  return false;
}

/** Shown on screen: a field is shown unless its showIf says no. */
export function shown(f: FieldDef, a: Answers): boolean {
  return f.showIf ? f.showIf(a) : true;
}

export function required(f: FieldDef, a: Answers): boolean {
  return typeof f.required === "function" ? f.required(a) : f.required === true;
}

function generic(f: FieldDef): string {
  if (f.type === "choice" || f.type === "yesno" || f.type === "call")
    return `Pick ${f.label.toLowerCase()}.`;
  if (f.type === "tick") return "Tick this to go on.";
  if (f.type === "date") return `Pick ${f.label.toLowerCase()}.`;
  return `Fill in ${f.label.toLowerCase()}.`;
}

/**
 * Every answer the sheet would send, checked the way the database checks it.
 * Returns field key -> sentence; empty when the form can be sent. The
 * sentences are the SQL refusals of WAVE12-CONTRACT.md 3.1 and 3.5 word for
 * word, so a refusal reads the same before and after the press.
 */
export function validate(
  def: FormDef,
  a: Answers,
  today: string = kuwaitIso(),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    if (!shown(f, a) || f.type === "readonly") continue;
    const v = a[f.key];
    if (isEmpty(v)) {
      if (required(f, a)) out[f.key] = f.message ?? generic(f);
      continue;
    }
    if (f.min !== undefined) {
      if (
        (f.type === "text" || f.type === "longtext") &&
        String(v).trim().length < f.min
      ) {
        out[f.key] = f.message ?? `Write at least ${f.min} characters.`;
        continue;
      }
      if (f.type === "number" && !(Number(v) >= f.min)) {
        out[f.key] = f.message ?? `Use a number of ${f.min} or more.`;
        continue;
      }
    }
    if (f.type === "number" && !Number.isFinite(Number(v))) {
      out[f.key] = "Type a number, digits only.";
      continue;
    }
    if (f.type === "date" && !ISO_DAY.test(String(v))) {
      out[f.key] = f.message ?? generic(f);
      continue;
    }
    const said = f.check ? f.check(v, a, today) : null;
    if (said) out[f.key] = said;
  }
  return out;
}

/** The answer key that keeps a prefilled value as it came: "_fromMrrUsd". Never sent, never checked. */
export const fromKey = (key: string) =>
  `_from${key.charAt(0).toUpperCase()}${key.slice(1)}`;

/**
 * The answers a fresh sheet starts from: a prefill value for a field of the
 * same key (a NULL value seeds nothing), else the field's own start value.
 * Each prefilled value is also kept under fromKey(key), so a rule can compare
 * the new answer with the card's ("a lower MRR needs a reason").
 */
export function seedAnswers(
  def: FormDef,
  prefill: Prefill[],
  today: string,
): Answers {
  const out: Answers = {};
  for (const f of def.fields) {
    const hit = prefill.find(p => p.key === f.key);
    if (hit && hit.value !== null && hit.value !== undefined) {
      out[f.key] =
        typeof hit.value === "number" && f.type === "choice"
          ? String(hit.value)
          : hit.value;
      out[fromKey(f.key)] = hit.value;
    } else if (f.initial) out[f.key] = f.initial(today);
  }
  return out;
}

/** "2 weeks · from the ClickUp card"; a value nobody holds is its source sentence alone. */
export function prefillLine(p: Prefill): string {
  if (p.value === null || p.value === undefined || p.value === "")
    return p.source;
  // A sentence value drops its full stop before the source: "… an extension · from …".
  return `${prefillValue(p).replace(/\.$/, "")} · from ${p.source}`;
}

/** A prefilled value in words: dollars for *Usd keys, "16 Nov" for days, "yes"/"no" for flags. */
export function prefillValue(p: Prefill): string {
  const v = p.value;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number")
    return /usd$/i.test(p.key) ? usd(v) : int.format(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string" && ISO_DAY.test(v)) return kuwaitDay(v);
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}

/** The draft's localStorage key: one per form, version and client. */
export function draftKey(def: FormDef, taskId: string): string {
  return `mahara.formsheet.${def.key}.v${def.version}.${taskId}`;
}

/** "Due in 3 days", "Due today", "4 days late"; null when the date is more than a week away or missing. */
export function dueHint(daysLate: number | null | undefined): string | null {
  if (!isNum(daysLate)) return null;
  if (daysLate >= 1)
    return `${daysLate} ${daysLate === 1 ? "day" : "days"} late`;
  if (daysLate === 0) return "Due today";
  if (daysLate >= -7) {
    const n = -daysLate;
    return `Due in ${n} ${n === 1 ? "day" : "days"}`;
  }
  return null;
}

// --- The after-send trail -------------------------------------------------------

const NETWORK =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed/i;

/** True when an error means the press never reached the server. */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return NETWORK.test(msg);
}

/** The sentence under a failed press: the server's own words, or the connection line. */
export function sendError(e: unknown, submitLabel: string): string {
  if (isNetworkError(e))
    return `Not saved. Check your connection and press ${submitLabel} again.`;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return msg.trim() || `Not saved. Press ${submitLabel} again in a minute.`;
}

function cardStep(t: FormTrailRow, def: FormDef | null): TrailStep {
  const card = t.card ?? null;
  const state = String(card?.state ?? "none");
  const at = card?.at ? kuwaitTime(card.at) : "";
  const err = String(card?.error ?? "").trim();
  const words = def?.cardWords ?? "this kind";
  switch (state) {
    case "delivered":
      return {
        key: "card",
        state: "done",
        label: "Card shows it",
        detail: at || undefined,
      };
    case "queued":
      return {
        key: "card",
        state: "waiting",
        label: "Queued for the ClickUp card",
      };
    case "sending":
    case "retry":
      return {
        key: "card",
        state: "waiting",
        label: "Waiting for ClickUp to confirm",
      };
    case "held":
      return {
        key: "card",
        state: "held",
        label: `Held: card writes for ${words} are off. When the CEO turns them on, this edit is reviewed and sent or closed.`,
      };
    case "failed":
      return {
        key: "card",
        state: "failed",
        label: `ClickUp refused it: ${err || "no reason given"}. It stays in the cockpit; tell the systems manager.`,
      };
    case "skipped":
      // A void or a close at a kind's opening says why in its own words.
      if (/^(voided|closed)\b/i.test(err))
        return {
          key: "card",
          state: "skipped",
          label: err.endsWith(".") ? err : `${err}.`,
        };
      return {
        key: "card",
        state: "skipped",
        label: "ClickUp already showed this, so nothing was written.",
      };
    default:
      return {
        key: "card",
        state: "none",
        label: "No card change recorded yet",
      };
  }
}

function noticeStep(t: FormTrailRow, def: FormDef | null): TrailStep {
  if (def && !def.notice)
    return {
      key: "notice",
      state: "none",
      label: "No Slack notice for this form",
    };
  const n = t.notice ?? null;
  const state = String(n?.state ?? "none");
  const channel = String(n?.channelName ?? "").replace(/^#/, "");
  const err = String(n?.error ?? "").trim();
  switch (state) {
    case "posted":
      return {
        key: "notice",
        state: "done",
        label: channel ? `Posted in #${channel}` : "Posted in Slack",
        action: n?.permalink
          ? { label: "Open the post", href: String(n.permalink) }
          : undefined,
      };
    case "queued":
      return { key: "notice", state: "waiting", label: "Posting…" };
    case "failed":
      return {
        key: "notice",
        state: "failed",
        label:
          err ||
          (channel
            ? `Not posted: the bot is not in #${channel}. Ask the CEO to invite it.`
            : "Not posted."),
      };
    case "muted":
      return {
        key: "notice",
        state: "skipped",
        label: "Not posted: this notice is switched off in Settings.",
      };
    case "skipped":
      return {
        key: "notice",
        state: "skipped",
        label: err
          ? `Not posted: ${err.replace(/^not posted:\s*/i, "").replace(/\.?$/, ".")}`
          : "Not posted.",
      };
    default:
      return { key: "notice", state: "none", label: "No notice queued yet" };
  }
}

/**
 * cockpit_form_trail made into the four steps the sheet shows (5.1's
 * words): saved, the card, the Slack notice, the ticket. `ticketHref`
 * builds the request form's address for the ticket step; without it the
 * step still names the ticket, as a button the sheet wires.
 */
export function trailFrom(
  t: FormTrailRow,
  def: FormDef | null = null,
  ticketHref?: (type: string) => string,
): TrailStep[] {
  const stored: TrailStep =
    t.stored?.state === "done"
      ? {
          key: "stored",
          state: "done",
          label: "Saved in the cockpit",
          detail: t.stored?.at
            ? kuwaitTime(t.stored.at) || undefined
            : undefined,
        }
      : { key: "stored", state: "waiting", label: "Saving in the cockpit" };
  // The step says where the ticket stands; opening it is the action, said once.
  const ticket: TrailStep = def?.ticket
    ? {
        key: "ticket",
        state: "none",
        label: def.ticket.waiting,
        action: {
          label: def.ticket.label,
          href: ticketHref ? ticketHref(def.ticket.type) : "",
          type: def.ticket.type,
        },
      }
    : {
        key: "ticket",
        state: "none",
        label: def?.ticketNone ?? "No ticket for this form",
      };
  return [stored, cardStep(t, def), noticeStep(t, def), ticket];
}

/** True while a step can still change, so the sheet keeps reading the trail. */
export function trailSettled(steps: TrailStep[]): boolean {
  return steps.every(s => s.state !== "waiting");
}

/** The StatusChip tone a step's ring copies, so a step and a chip read alike. */
export function stepTone(
  s: TrailState,
): "good" | "warning" | "critical" | "neutral" {
  if (s === "done") return "good";
  if (s === "waiting" || s === "held") return "warning";
  if (s === "failed") return "critical";
  return "neutral";
}
