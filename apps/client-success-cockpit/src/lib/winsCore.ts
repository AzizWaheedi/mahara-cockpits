/**
 * The wins ledger's words and rules for the screens
 * (docs/forms/WAVE56-CONTRACT.md 3.1, 3.3, 4.2, 4.3, 5.0 to 5.4, 5.11,
 * 5.12): every kind and stage word, the proof each kind needs, the SQL
 * refusals word for word, the win ribbon's stops, the door lines and the
 * Today bands. Pure: no React, no I/O, so the tests read it
 * without a browser and a missing amount reads "not known", never "$0".
 * Its one import is the staff forms' import-free core (the door words).
 */

// --- Kinds and stages (3.1) ----------------------------------------------------

export type WinKind =
  | "review"
  | "video_testimonial"
  | "podcast"
  | "referral"
  | "renewal"
  | "reactivation"
  | "upsell_website"
  | "upsell_smm"
  | "upsell_backend"
  | "upsell_seo_geo"
  | "upsell_second_campaign";

export type WinStage = "logged" | "quote_given" | "signed" | "paid" | "void";

export type PayState =
  | "none"
  | "waiting"
  | "proposed"
  | "confirmed"
  | "declined";

export const WIN_KINDS: { kind: WinKind; label: string; upsell: boolean }[] = [
  { kind: "review", label: "Google review", upsell: false },
  { kind: "video_testimonial", label: "Video testimonial", upsell: false },
  { kind: "podcast", label: "Podcast case study", upsell: false },
  { kind: "referral", label: "Referral", upsell: false },
  { kind: "renewal", label: "Renewal", upsell: false },
  { kind: "reactivation", label: "Reactivation", upsell: false },
  { kind: "upsell_website", label: "Website", upsell: true },
  { kind: "upsell_smm", label: "Social media management", upsell: true },
  { kind: "upsell_backend", label: "Back-end programme", upsell: true },
  { kind: "upsell_seo_geo", label: "SEO and AI search", upsell: true },
  { kind: "upsell_second_campaign", label: "Second campaign", upsell: true },
];

export const STAGE_WORDS: Record<WinStage, string> = {
  logged: "Logged",
  quote_given: "Offered",
  signed: "Accepted",
  paid: "Paid",
  void: "Voided",
};

export function isUpsell(kind: string | null | undefined): boolean {
  return /^upsell_/.test(String(kind ?? ""));
}

export function kindLabel(kind: string | null | undefined): string {
  return WIN_KINDS.find(k => k.kind === kind)?.label ?? "Win";
}

export function stageWord(stage: string | null | undefined): string {
  return STAGE_WORDS[stage as WinStage] ?? "Logged";
}

// --- The SQL's sentences, word for word (3.3, 4.2, 4.12) -------------------------

export const SAY = {
  doorClosed: "Log a win opens after its switch-on.",
  draft: "Send the proposal first. A draft is not a win.",
  reviewProof: "Add the review link or a screenshot link.",
  videoProof: "Add the video link.",
  podcastProof: "Add the episode link.",
  referralDeal: "Pick the referred client's signed deal.",
  agreementLater: "Add the agreement link to clear it for pay.",
  quoted: "Add the quoted price.",
  belowList: "Say why the price is below the list price.",
  winDate: "The win date is today or within the last 30 days.",
  acceptNeeds: "Add the signed agreement link to mark it accepted.",
  voidReason: "Say why in 3 to 300 characters.",
  paidVoid: "Clear the payment tie first. Only the CEO voids a paid win.",
  tieNeedsSigned: "Mark it accepted first.",
  tieSent: "Sent to the CEO to confirm.",
  notChecked:
    "This transfer is not checked yet. Check it first, then confirm the tie.",
  closerReason:
    "This payment counts for the closer now. Say why it is the upsell's.",
  alreadyTied: "This payment is already tied. Clear that tie first.",
  tied: "Tied. The win is paid.",
  logged: "Logged.",
  offered: "Marked as offered.",
  voided: "Voided.",
  accepted: "Marked as accepted.",
  network: "Not saved. Check your connection and press Log the win again.",
  proposalsOff: "Pay proposals open after their switch-on.",
  reactivateClosed: "Reactivate opens after its switch-on.",
  reactivateWhy: "Say why they came back in 10 to 500 characters.",
  reactivateDate:
    "The return date is on or after the day they left, and within 14 days from now.",
  reactivated: "Reopened. The card updates within a few minutes.",
  kickoffClosed:
    "The kickoff opens here after its switch-on. Until then use the kickoff form as before.",
  kickoffMoves: "The kickoff moves into the cockpit after its switch-on.",
} as const;

export const reviewWarning = (client: string, day: string) =>
  `A Google review was logged for ${client} on ${day}. Log this one too?`;
export const renewalWarning = (client: string, day: string) =>
  `A renewal was logged for ${client} on ${day}. Log this one too?`;
export const referralRefused = (day: string) =>
  `That deal is already logged as a referral win on ${day}.`;
export const reactivationRefused = (client: string, day: string) =>
  `${client} was reopened on ${day} and that return already has its win.`;
export const closerPaid = (month: string) =>
  `This payment was paid to the closer in ${month}. It stays with the deal.`;
export const clearRefused = (month: string, next: string) =>
  `The CSM was paid for this upsell in ${month}. It stays tied; add an adjustment in ${next} if it was wrong.`;
export const clearDone = (n: number) =>
  `Tie cleared. ${n} pay ${n === 1 ? "entry" : "entries"} came from this win; check ${n === 1 ? "it" : "them"} on Team & payroll.`;
export const notLeft = (client: string) =>
  `${client} is not marked as left. Nothing to reactivate.`;
export const noConfirmedChurn = (client: string) =>
  `${client} has no confirmed churn. Confirm the churn first with Client is leaving, then reopen.`;
export const CONFIRM_CHURN_FIRST =
  "Confirm the churn first with Client is leaving, then reopen.";
export const kickoffAgain = (day: string) =>
  `A kickoff was sent on ${day}. Say why you are sending it again.`;
export const addedTo = (open: string, month: string) =>
  `Added to ${open}: ${month} is approved.`;

/** The proof field each kind asks for (5.1), its SQL sentence, and whether it is required. */
export function proofOf(kind: string | null | undefined): {
  label: string;
  message: string;
  required: boolean;
} | null {
  switch (kind) {
    case "review":
      return {
        label: "Review link or screenshot link",
        message: SAY.reviewProof,
        required: true,
      };
    case "video_testimonial":
      return { label: "Video link", message: SAY.videoProof, required: true };
    case "podcast":
      return {
        label: "Episode link",
        message: SAY.podcastProof,
        required: true,
      };
    case "renewal":
    case "reactivation":
      return {
        label: "Agreement link",
        message: SAY.agreementLater,
        required: false,
      };
    case "referral":
      return null;
    default:
      return isUpsell(kind)
        ? { label: "Proof link", message: SAY.quoted, required: false }
        : null;
  }
}

// --- Doors (3.10): the staff forms' shared words ---------------------------------------

export {
  ALL_CLOSED,
  CLOSED,
  type Door,
  type DoorWhy,
  doorLine,
  NOT_ON,
  NOT_YET,
  readDoorsW56,
  W56_KEYS,
  type W56DoorKey,
  type W56Doors,
} from "@/forms/staff/formSheetCore";

// --- Money words -----------------------------------------------------------------------

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** "$1,500"; cents only when there are any under $100; a missing amount is "not known". */
export function money(n: number | null | undefined): string {
  if (!isNum(n)) return "not known";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs < 100 && Math.round(abs * 100) % 100 !== 0)
    return `${sign}$${cents.format(abs)}`;
  return `${sign}$${int.format(Math.round(abs))}`;
}

const MONTHS = [
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
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-11-02" (or a timestamp) as "2 Nov" on the Kuwait clock; "" when it is not a day. */
export function day(v: string | null | undefined): string {
  if (!v) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (iso) return `${Number(iso[3])} ${MONTHS[Number(iso[2]) - 1] ?? ""}`;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return "";
  const k = new Date(ms + 3 * 3600_000);
  return `${k.getUTCDate()} ${MONTHS[k.getUTCMonth()]}`;
}

/** "2026-11-01" or "2026-11" as "November 2026". */
export function monthWords(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}` : String(v ?? "");
}

/** The Kuwait day as "YYYY-MM-DD". */
export function kuwaitToday(now: number = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

// --- A win as the screens read it (3.3 WinRow) -------------------------------------------

export type WinRow = {
  id: string;
  taskId: string | null;
  client: string | null;
  kind: WinKind | string;
  kindLabel: string;
  stage: WinStage;
  wonOn: string | null;
  proofUrl: string | null;
  quotedUsd: number | null;
  recurring: boolean;
  monthlyUsd: number | null;
  agreementUrl: string | null;
  tiedUsd: number | null;
  tiedCheckedUsd: number | null;
  tiePending: {
    id: number | null;
    usd: number | null;
    paidOn: string | null;
  } | null;
  invoiceId: string | null;
  pay: { state: PayState; why: string | null; amountUsd: number | null };
  loggedByRole: string | null;
  loggedAt: string | null;
  voidReason: string | null;
  /** Optional stage days a newer read may carry. */
  offeredOn: string | null;
  acceptedOn: string | null;
  paidOn: string | null;
  proposalId: string | null;
  offerName: string | null;
};

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const STAGES: WinStage[] = ["logged", "quote_given", "signed", "paid", "void"];
const PAYS: PayState[] = [
  "none",
  "waiting",
  "proposed",
  "confirmed",
  "declined",
];

/** One WinRow read defensively; null when it has no id or no known stage. */
export function toWinRow(raw: unknown): WinRow | null {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  if (!r || !text(r.id) || !STAGES.includes(r.stage)) return null;
  const p = r.pay && typeof r.pay === "object" ? r.pay : {};
  const t =
    r.tiePending && typeof r.tiePending === "object" ? r.tiePending : null;
  return {
    id: String(r.id),
    taskId: text(r.taskId),
    client: text(r.client ?? r.clientName),
    kind: String(r.kind ?? ""),
    kindLabel: text(r.kindLabel) ?? kindLabel(r.kind),
    stage: r.stage,
    wonOn: text(r.wonOn),
    proofUrl: text(r.proofUrl),
    quotedUsd: num(r.quotedUsd),
    recurring: r.recurring === true,
    monthlyUsd: num(r.monthlyUsd),
    agreementUrl: text(r.agreementUrl),
    tiedUsd: num(r.tiedUsd),
    tiedCheckedUsd: num(r.tiedCheckedUsd),
    tiePending: t
      ? { id: num(t.id), usd: num(t.usd), paidOn: text(t.paidOn) }
      : null,
    invoiceId: text(r.invoiceId),
    pay: {
      state: PAYS.includes(p.state) ? p.state : "none",
      why: text(p.why),
      amountUsd: num(p.amountUsd),
    },
    loggedByRole: text(r.loggedByRole),
    loggedAt: text(r.loggedAt),
    voidReason: text(r.voidReason),
    offeredOn: text(r.offeredOn),
    acceptedOn: text(r.acceptedOn),
    paidOn: text(r.paidOn),
    proposalId: text(r.proposalId),
    offerName: text(r.offerName),
  };
}

// --- The win ribbon (5.0, the signature element) ------------------------------------------

export type StopState = "done" | "waiting" | "todo" | "declined";
export type Stop = {
  key: "logged" | "offered" | "accepted" | "paid" | "pay";
  label: string;
  state: StopState;
  /** "2 Nov" when done and the day is known. */
  date: string;
  /** The waiting sentence (amber) or the declined reason. */
  sentence: string | null;
};
export type Ribbon = {
  stops: Stop[];
  voided: { reason: string } | null;
  money: string;
};

function payStop(w: WinRow): Stop {
  const base = { key: "pay" as const, label: "Pay", date: "" };
  switch (w.pay.state) {
    case "confirmed":
      return { ...base, state: "done", sentence: null };
    case "proposed":
      return {
        ...base,
        state: "waiting",
        sentence: "Waiting for the CEO to confirm",
      };
    case "waiting":
      return {
        ...base,
        state: "waiting",
        sentence: (w.pay.why ?? "Waiting").replace(/\.$/, ""),
      };
    case "declined":
      return {
        ...base,
        state: "declined",
        sentence: `Declined${w.pay.why ? `: ${w.pay.why.replace(/\.$/, "")}` : ""}`,
      };
    default:
      return { ...base, state: "todo", sentence: null };
  }
}

/** The stops, the voided cut and the money at the right end, in 5.0's words. */
export function ribbonOf(w: WinRow): Ribbon {
  const upsell = isUpsell(w.kind);
  const at = (stage: WinStage) => STAGES.indexOf(stage);
  // A voided win keeps how far it got; the track is cut after that.
  const reached: WinStage = w.stage;
  const stops: Stop[] = [];
  if (upsell) {
    const past = (s: WinStage) => reached !== "void" && at(reached) >= at(s);
    stops.push({
      key: "offered",
      label: "Offered",
      state: reached === "void" || past("quote_given") ? "done" : "todo",
      date: day(w.offeredOn ?? w.wonOn),
      sentence: null,
    });
    stops.push({
      key: "accepted",
      label: "Accepted",
      state:
        past("signed") || (reached === "void" && w.agreementUrl)
          ? "done"
          : "todo",
      date: past("signed") ? day(w.acceptedOn) : "",
      sentence: null,
    });
    const paid = past("paid");
    const pending = !paid && w.tiePending;
    stops.push({
      key: "paid",
      label: "Paid",
      state: paid ? "done" : pending ? "waiting" : "todo",
      date: paid ? day(w.paidOn) : "",
      sentence: pending
        ? w.tiePending?.usd !== null && w.tiePending?.usd !== undefined
          ? `${money(w.tiePending.usd)} waiting for the CEO to confirm`
          : "Waiting for the CEO to confirm"
        : null,
    });
  } else {
    stops.push({
      key: "logged",
      label: "Logged",
      state: "done",
      date: day(w.wonOn),
      sentence: null,
    });
  }
  if (reached !== "void") stops.push(payStop(w));
  const parts: string[] = [];
  if (upsell) {
    if (w.stage === "paid" || (w.tiedUsd ?? 0) > 0)
      parts.push(`${money(w.tiedUsd)} tied`);
    else if (w.quotedUsd !== null)
      parts.push(
        `${money(w.quotedUsd)}${w.recurring ? " a month" : ""} quoted`,
      );
  }
  if (w.pay.state === "proposed" || w.pay.state === "confirmed")
    parts.push(`${money(w.pay.amountUsd)} ${w.pay.state}`);
  return {
    stops,
    voided:
      reached === "void" ? { reason: w.voidReason ?? "no reason given" } : null,
    money: parts.join(" · "),
  };
}

/** The actions a stage offers on the client page (5.2). */
export function actionsOf(
  w: WinRow,
): ("accept" | "invoice" | "tie" | "mrr" | "void")[] {
  if (w.stage === "quote_given") return ["accept", "void"];
  if (w.stage === "signed")
    return [...(w.invoiceId ? [] : (["invoice"] as const)), "tie", "void"];
  if (w.stage === "paid") return w.recurring && w.monthlyUsd ? ["mrr"] : [];
  if (w.stage === "logged") return ["void"];
  return [];
}

/** "Add $500 to MRR?" for a paid recurring win (4.3.7); null otherwise. */
export function mrrPrompt(w: WinRow): string | null {
  return w.stage === "paid" && w.recurring && isNum(w.monthlyUsd)
    ? `Add ${money(w.monthlyUsd)} to MRR?`
    : null;
}

// --- Tie candidates (3.3) ----------------------------------------------------------------

export type TieCandidate = {
  paymentId: string;
  rail: string;
  usd: number | null;
  paidOn: string | null;
  checked: boolean;
  inDealLedger: { closerRole: string | null; month: string | null } | null;
  closerPaidMonth: string | null;
};

export function toCandidate(raw: unknown): TieCandidate | null {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  if (!r || !text(r.paymentId)) return null;
  const led =
    r.inDealLedger && typeof r.inDealLedger === "object"
      ? r.inDealLedger
      : null;
  return {
    paymentId: String(r.paymentId),
    rail: text(r.rail) ?? "payment",
    usd: num(r.usd),
    paidOn: text(r.paidOn),
    checked: r.checked === true,
    inDealLedger: led
      ? {
          closerRole: text(led.closerRole ?? led.closer ?? led.role),
          month: text(led.month),
        }
      : null,
    closerPaidMonth: text(r.closerPaidMonth),
  };
}

const RAIL_WORDS: Record<string, string> = {
  whop: "Whop",
  tap: "Tap",
  ecom: "Ecom",
  transfer: "Transfer",
  bank: "Bank",
  manual: "Transfer",
};

export function railWord(rail: string | null | undefined): string {
  const r = String(rail ?? "").toLowerCase();
  return (
    RAIL_WORDS[r] ?? (r ? r.charAt(0).toUpperCase() + r.slice(1) : "Payment")
  );
}

/** "{rail} · {usd} · {date}" (5.2). */
export function candidateLine(c: TieCandidate): string {
  return `${railWord(c.rail)} · ${money(c.usd)} · ${day(c.paidOn) || "no date"}`;
}

/** The chips a candidate carries: "Not checked yet", "Counts for the closer now". */
export function candidateChips(c: TieCandidate): string[] {
  const out: string[] = [];
  if (!c.checked) out.push("Not checked yet");
  if (c.inDealLedger) out.push("Counts for the closer now");
  if (c.closerPaidMonth)
    out.push(`Paid to the closer in ${monthWords(c.closerPaidMonth)}`);
  return out;
}

// --- Log a win: the duplicate warning and the done words ----------------------------------

/** What cockpit_csm_win_log answered: stored, or a warning that stored nothing. */
export type LogAnswer =
  | { ok: true; winId: string | null; stage: WinStage | null; sentence: string }
  | { ok: false; warning: string };

export function logAnswerOf(raw: unknown, fromProposal: boolean): LogAnswer {
  const r = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  if (r.ok === false && text(r.warning))
    return { ok: false, warning: String(r.warning) };
  return {
    ok: true,
    winId: text(r.winId),
    stage: STAGES.includes(r.stage) ? r.stage : null,
    sentence: text(r.sentence) ?? (fromProposal ? SAY.offered : SAY.logged),
  };
}

// --- Totals and tiles (5.2 Money tab) ------------------------------------------------------

export type WinTotals = {
  upsellsOffered: number | null;
  upsellsAccepted: number | null;
  upsellCashChecked: number | null;
  reviewsAndTestimonials: number | null;
};

export function totalsOf(raw: unknown, wins: WinRow[] | null): WinTotals {
  const t =
    raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  const by = t?.byKind && typeof t.byKind === "object" ? t.byKind : null;
  const fromWins = (kinds: string[]) =>
    wins
      ? wins.filter(w => w.stage !== "void" && kinds.includes(String(w.kind)))
          .length
      : null;
  return {
    upsellsOffered: num(t?.upsellsOffered),
    upsellsAccepted: num(t?.upsellsAccepted),
    upsellCashChecked: num(t?.upsellCashChecked),
    reviewsAndTestimonials: by
      ? (num(by.review) ?? 0) +
        (num(by.video_testimonial) ?? 0) +
        (num(by.podcast) ?? 0)
      : fromWins(["review", "video_testimonial", "podcast"]),
  };
}

/** The Money tab's range presets: this month, last month, or picked days. */
export function rangeOf(
  preset: "this" | "last",
  today: string,
): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  if (preset === "this")
    return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: today };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${last}` };
}

// --- Today bands (5.12) ---------------------------------------------------------------------

export type BandKind =
  | "accepted_no_agreement"
  | "invoice_paid_untied"
  | "tie_waiting"
  | "receipt_in"
  | "back"
  | "receipt_checked"
  | "due_no_money";

export type Band = {
  key: string;
  kind: BandKind;
  text: string;
  action: string;
  taskId: string | null;
  /** What the action opens: a proposal, a win, a part. */
  ref: Record<string, unknown>;
};

export type BandInput = {
  kind: string;
  taskId?: string | null;
  client?: string | null;
  offer?: string | null;
  proposalId?: string | null;
  winId?: string | null;
  count?: number | null;
  returnedOn?: string | null;
  dueOn?: string | null;
  part?: string | null;
  partNo?: number | null;
  expectedAmount?: number | null;
  currency?: string | null;
  dealResponseId?: string | null;
  [k: string]: unknown;
};

/**
 * The Today bands of 5.12 from the rows the reads give. Hidden when empty;
 * "Back" only for 7 days after the return; the CEO-only count only for the
 * CEO; a "due, no money" row never for a Paused or Stopped card.
 */
export function todayBands(
  rows: BandInput[],
  o: {
    ceo: boolean;
    today: string;
    pausedOrStopped?: (taskId: string) => boolean;
  },
): Band[] {
  const out: Band[] = [];
  const who = (r: BandInput) => r.client ?? "a client";
  // The read gives one tie_waiting row per open proposal (20261102h); a row may also carry its own count.
  const ties = rows.filter(r => r.kind === "tie_waiting");
  const tieCount = ties.reduce(
    (n, r) => n + (num(r.count) ?? (r.proposalId ? 1 : 0)),
    0,
  );
  let tieShown = false;
  for (const [i, r] of rows.entries()) {
    const taskId = r.taskId ?? null;
    const offer = r.offer ?? "upsell";
    const key = `${r.kind}:${taskId ?? ""}:${r.winId ?? r.proposalId ?? r.part ?? i}`;
    switch (r.kind) {
      case "accepted_no_agreement":
        out.push({
          key,
          kind: r.kind,
          text: `Client accepted: send the agreement for the ${offer} (${who(r)})`,
          action: "Open the proposal",
          taskId,
          ref: { proposalId: r.proposalId ?? null },
        });
        break;
      case "invoice_paid_untied":
        out.push({
          key,
          kind: r.kind,
          text: `Invoice paid: tie it to the ${offer} (${who(r)})`,
          action: "Tie the payment",
          taskId,
          ref: { winId: r.winId ?? null },
        });
        break;
      case "tie_waiting": {
        const n = tieCount;
        if (tieShown) break;
        tieShown = true;
        if (o.ceo && n > 0)
          out.push({
            key: "tie_waiting",
            kind: "tie_waiting",
            text: `Upsell payments to confirm: ${n}`,
            action: "Open Money",
            taskId: null,
            ref: {},
          });
        break;
      }
      case "receipt_in":
        out.push({
          key,
          kind: r.kind,
          text: `Receipt in: ${who(r)}`,
          action: "Open Checks waiting",
          taskId,
          ref: {},
        });
        break;
      case "back": {
        const since = r.returnedOn ?? null;
        const age =
          since && /^\d{4}-\d{2}-\d{2}$/.test(since)
            ? Math.round(
                (Date.parse(`${o.today}T00:00:00Z`) -
                  Date.parse(`${since}T00:00:00Z`)) /
                  86_400_000,
              )
            : null;
        if (age !== null && age >= 0 && age < 7)
          out.push({
            key,
            kind: "back",
            text: `Back: ${who(r)}`,
            action: "Open the relaunch ticket",
            taskId,
            ref: { type: "client_relaunch" },
          });
        break;
      }
      case "receipt_checked": {
        // A transfer never passes Confirm paid: the checked receipt is the payment, so the CSM sets
        // the card's next payment date (the date the rule of 4.6 gives, when it gives one).
        const next =
          typeof r.dateIfConfirmed === "string" ? day(r.dateIfConfirmed) : "";
        out.push({
          key,
          kind: r.kind,
          text: next
            ? `Receipt checked: set the next payment date to ${next} (${who(r)})`
            : `Receipt checked: set the next payment date (${who(r)})`,
          action: "Open the billing sheet",
          taskId,
          ref: {
            part: r.part ?? null,
            partNo: r.partNo ?? null,
            date:
              typeof r.dateIfConfirmed === "string" ? r.dateIfConfirmed : null,
          },
        });
        break;
      }
      case "due_no_money":
        if (taskId && o.pausedOrStopped?.(taskId)) break;
        out.push({
          key,
          kind: r.kind,
          text: `Payment due ${day(r.dueOn) || "on a day not recorded"}, no money in: ask for the receipt (${who(r)})`,
          action: "Ask for the receipt",
          taskId,
          ref: {
            part: r.part ?? "later",
            partNo: r.partNo ?? 0,
            // No currency is ever guessed: an unknown one sends none, and no amount.
            expectedAmount: r.currency ? (r.expectedAmount ?? null) : null,
            currency: r.currency ?? null,
            dueOn: r.dueOn ?? null,
            dealResponseId: r.dealResponseId ?? null,
          },
        });
        break;
      default:
        break;
    }
  }
  return out;
}

// --- Reactivate (4.12, 5.11, X30) ----------------------------------------------------------

export type ReactivateState =
  | { show: false }
  | { show: true; enabled: true; departureId: number }
  | { show: true; enabled: false; why: string };

/**
 * "Client is back" shows on a card with a confirmed departure not yet
 * returned; on a Stopped card without one it shows disabled with the next
 * step; anywhere else it does not show.
 */
export function reactivateState(c: {
  status: string | null | undefined;
  departureId: number | null | undefined;
  churnConfirmedAt?: string | null;
  returnedOn?: string | null;
}): ReactivateState {
  const confirmed =
    typeof c.departureId === "number" &&
    Number.isFinite(c.departureId) &&
    !c.returnedOn &&
    (c.churnConfirmedAt === undefined || Boolean(c.churnConfirmedAt));
  if (confirmed)
    return { show: true, enabled: true, departureId: c.departureId as number };
  if (/^\s*stopped\s*$/i.test(String(c.status ?? "")))
    return { show: true, enabled: false, why: CONFIRM_CHURN_FIRST };
  return { show: false };
}

// --- Retired forms (5.14) ----------------------------------------------------------------------

export type RetireItem = {
  id: string;
  kind: string;
  externalId: string;
  name: string;
  usedFor: string;
  ownerRole: string;
  replacement: string;
  state: string;
  offAt: string | null;
  archiveFrom: string | null;
  archivedAt: string | null;
  note: string | null;
};

const REQUEST_TYPE_WORDS: Record<string, string> = {
  whatsapp_reactivation: "the WhatsApp reactivation request",
  landing_page: "the landing page request",
  client_relaunch: "the relaunch request",
};

/**
 * What replaced an old form, in plain words (5.14): never a build code such as
 * "(W12 C1)", "(C7)" or "(Stage 4)", and a request type by its label.
 */
export function retireReplacementWords(replacement: string): string {
  const typed = replacement.match(/^Request type ([a-z_]+)$/);
  if (typed)
    return (
      REQUEST_TYPE_WORDS[typed[1]] ??
      `the ${typed[1].replace(/_/g, " ")} request`
    );
  return replacement
    .replace(
      /\s*\((?:(?:W\d+|C\d+[a-z]?|Q\d+|X\d+|D\d+|A\d+|2b|Stage \d+)[ ,]*)+\)/g,
      "",
    )
    .replace(/\s*\(\d+(?:\.\d+)+\)/g, "")
    .trim();
}

export function toRetireItem(raw: unknown): RetireItem | null {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  if (!r || !text(r.id)) return null;
  return {
    id: String(r.id),
    kind: text(r.kind) ?? "make",
    externalId: text(r.externalId) ?? "",
    name: text(r.name) ?? String(r.id),
    usedFor: text(r.usedFor) ?? "",
    ownerRole: text(r.ownerRole) ?? "",
    replacement: text(r.replacement) ?? "",
    state: text(r.state) ?? "on",
    offAt: text(r.offAt),
    archiveFrom: text(r.archiveFrom),
    archivedAt: text(r.archivedAt),
    note: text(r.note),
  };
}

const KIND_WORDS: Record<string, string> = {
  make: "Make scenario",
  typeform: "Typeform",
  webhook: "Webhook",
};

export function retireKind(kind: string): string {
  return KIND_WORDS[kind] ?? kind;
}

/** The state words of 5.14. */
export function retireState(i: RetireItem, today: string): string {
  switch (i.state) {
    case "on":
      return "Still on";
    case "off":
    case "closed":
    case "removed": {
      const verb =
        i.state === "off"
          ? "Switched off"
          : i.state === "closed"
            ? "Closed"
            : "Removed";
      const said = i.offAt ? `${verb} ${day(i.offAt)}` : verb;
      // The 14 quiet days: the day it may be archived, said once it is known.
      return i.archiveFrom && i.archiveFrom.slice(0, 10) >= "2000-01-01"
        ? `${said} · Archive from ${day(i.archiveFrom)}${i.archiveFrom.slice(0, 10) <= today ? " (ready)" : ""}`
        : said;
    }
    case "archived":
      return i.archivedAt ? `Archived ${day(i.archivedAt)}` : "Archived";
    case "kept":
      return `Kept: ${i.replacement || "stays as it is"}`;
    default:
      return i.state;
  }
}
