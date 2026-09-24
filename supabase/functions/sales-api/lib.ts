// The rules of the sales cockpit's server, kept apart from index.ts so they
// can be tested without the Supabase runtime (bun test supabase/functions/sales-api).

export const MARKS = ["showed", "noshow", "cancelled", "invalid"] as const;
export type Mark = (typeof MARKS)[number];

export const ORIGINS = [
  "https://cockpit.maharamedia.com",
  "https://mahara-sales.vercel.app",
  "http://localhost:5190",
  "http://127.0.0.1:5190",
];

export function cors(origin: string | null): Record<string, string> {
  const ok = origin !== null && ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export interface Who {
  signed_in: boolean;
  email?: string;
  seat?: boolean;
  manager?: boolean;
  ceo?: boolean;
  name?: string | null;
  role?: string | null;
  ghl_user_id?: string | null;
  b2b_rep_id?: string | null;
  maqsam_email?: string | null;
  /** "seat" when the seat names it, "b2b" when it comes from the rep directory. */
  maqsam_from?: "seat" | "b2b" | null;
  fathom_email?: string | null;
}

export interface Appointment {
  appointment_id: string;
  contact_id: string | null;
  call_type: string | null;
  start_at: string | null;
  status: string | null;
  assigned_user_id: string | null;
  calendar_id: string | null;
  origin?: string | null;
}

/** A plain sentence when this person may not mark this call, else null. */
export function refuseMark(
  who: Who,
  appt: Appointment,
  mark: string,
  nowMs: number,
): string | null {
  if (!(MARKS as readonly string[]).includes(mark))
    return "Choose showed, no-show, cancelled or disqualified.";
  if (!who.manager) {
    if (!who.ghl_user_id)
      return "Your seat is not linked to your HighLevel user yet. Ask Aziz to link it on the Team page.";
    if (appt.assigned_user_id !== who.ghl_user_id)
      return "This call is booked with another rep. Only they or a manager can mark it.";
  }
  const start = appt.start_at ? Date.parse(appt.start_at) : Number.NaN;
  // A call can be cancelled ahead of time, but it cannot have been attended
  // before it starts.
  if (mark !== "cancelled" && Number.isFinite(start) && start > nowMs + 10 * 60_000)
    return "This call has not happened yet. Mark it once its time has passed, or mark it cancelled.";
  return null;
}

export interface CrmSettings {
  dispositions?: boolean;
  backlog_days?: number;
}

/**
 * Whether a mark goes to HighLevel. Aziz, 2026-09-24: yes for today's
 * calls, running HighLevel's usual automations; old appointments are marked
 * in the cockpit only, so an old lead is never sent a no-show message.
 */
export function crmDecision(
  s: CrmSettings | null | undefined,
  appt: Appointment,
  nowMs: number,
): "write" | "off" | "skipped" {
  if (!s?.dispositions) return "off";
  const days = Number.isFinite(Number(s.backlog_days)) ? Number(s.backlog_days) : 7;
  const start = appt.start_at ? Date.parse(appt.start_at) : Number.NaN;
  if (!Number.isFinite(start)) return "skipped";
  if (nowMs - start > days * 86_400_000) return "skipped";
  return "write";
}

export function cleanText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
};

/** A pay rule as Aziz described it, or a sentence saying what is wrong. */
export function checkPay(
  p: unknown,
): { ok: true; pay: Record<string, unknown> } | { ok: false; error: string } {
  if (p === null || p === undefined) return { ok: true, pay: {} };
  if (typeof p !== "object" || Array.isArray(p))
    return { ok: false, error: "The pay rule must be a set of fields." };
  const src = p as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const rate = num(src.cash_rate);
  if (rate !== null) {
    if (Number.isNaN(rate) || rate < 0 || rate > 1)
      return { ok: false, error: "The cash rate is a share between 0 and 1 (10% is 0.10)." };
    out.cash_rate = rate;
  }
  for (const k of ["pif_bonus", "per_intro_shown", "per_demo_shown", "per_signed"]) {
    const n = num(src[k]);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || n > 100_000)
      return { ok: false, error: `${k.replace(/_/g, " ")} must be an amount of 0 or more.` };
    out[k] = n;
  }
  const cur = cleanText(src.currency ?? "USD", 3).toUpperCase();
  if (!["USD", "KWD", "SAR", "AED", "QAR", "BHD", "OMR"].includes(cur))
    return { ok: false, error: "Pay is in USD, KWD, SAR, AED, QAR, BHD or OMR." };
  out.currency = cur;
  const note = cleanText(src.note, 500);
  if (note) out.note = note;
  return { ok: true, pay: out };
}

const GOAL_KEYS = ["booked", "shown", "closes", "cash", "dials", "conversations"];

/** Weekly and monthly goals in units and cash. */
export function checkGoals(
  g: unknown,
): { ok: true; goals: Record<string, unknown> } | { ok: false; error: string } {
  if (g === null || g === undefined) return { ok: true, goals: {} };
  if (typeof g !== "object" || Array.isArray(g))
    return { ok: false, error: "Goals must be a set of fields." };
  const out: Record<string, Record<string, number>> = {};
  for (const period of ["weekly", "monthly"]) {
    const src = (g as Record<string, unknown>)[period];
    if (src === undefined || src === null) continue;
    if (typeof src !== "object" || Array.isArray(src))
      return { ok: false, error: `The ${period} goals must be a set of fields.` };
    const row: Record<string, number> = {};
    for (const k of GOAL_KEYS) {
      const n = num((src as Record<string, unknown>)[k]);
      if (n === null) continue;
      if (Number.isNaN(n) || n < 0 || n > 10_000_000)
        return { ok: false, error: `The ${period} ${k} goal must be 0 or more.` };
      row[k] = n;
    }
    if (Object.keys(row).length) out[period] = row;
  }
  return { ok: true, goals: out };
}

export function checkEmail(v: unknown): string | null {
  const e = cleanText(v, 200).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export const LINK_KINDS = ["deck", "form", "calculator", "proof", "library", "script", "other"];

export function checkLink(
  l: Record<string, unknown>,
): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const label = cleanText(l.label, 120);
  const url = cleanText(l.url, 2000);
  if (!label) return { ok: false, error: "Give the link a name." };
  if (!/^https:\/\/[^\s]+$/.test(url))
    return { ok: false, error: "A link must start with https://." };
  const kind = LINK_KINDS.includes(String(l.kind)) ? String(l.kind) : "other";
  // A blank order is the default place, not first: Number("") is 0.
  const sortRaw = l.sort === null || l.sort === undefined || String(l.sort).trim() === "" ? Number.NaN : Number(l.sort);
  const sort = Number.isFinite(sortRaw) ? Math.round(sortRaw) : 100;
  return {
    ok: true,
    row: {
      label,
      url,
      kind,
      note: cleanText(l.note, 500) || null,
      sort,
      active: l.active === undefined ? true : Boolean(l.active),
    },
  };
}

export interface OfferChoice {
  guarantee: boolean;
  payment: string;
  price?: number;
  months?: number;
}

/** The closer's choices for a proposal: guarantee or not, and how it is paid. */
export function checkOffer(
  o: unknown,
): { ok: true; offer: OfferChoice } | { ok: false; error: string } {
  const src = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const payment = cleanText(src.payment ?? "pif", 40) || "pif";
  if (!/^[a-z0-9_-]+$/.test(payment))
    return { ok: false, error: "Choose how the client pays." };
  const offer: OfferChoice = { guarantee: Boolean(src.guarantee), payment };
  const price = num(src.price);
  if (price !== null) {
    if (Number.isNaN(price) || price < 500 || price > 500_000)
      return { ok: false, error: "The price must be between 500 and 500,000." };
    offer.price = price;
  }
  const months = num(src.months);
  if (months !== null) {
    if (Number.isNaN(months) || months < 1 || months > 36 || !Number.isInteger(months))
      return { ok: false, error: "The length is a whole number of months, 1 to 36." };
    offer.months = months;
  }
  return { ok: true, offer };
}

/** HighLevel messages, trimmed to what the lead page shows. */
export function trimMessages(list: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(list) ? list : [];
  return arr.slice(0, 50).map(m => {
    const r = (m ?? {}) as Record<string, unknown>;
    return {
      id: r.id ?? null,
      direction: r.direction ?? null,
      type: r.messageType ?? r.type ?? null,
      status: r.status ?? null,
      at: r.dateAdded ?? null,
      body: cleanText(r.body, 2000) || null,
      has_attachments: Array.isArray(r.attachments) && r.attachments.length > 0,
      source: r.source ?? null,
    };
  });
}

export function redact(s: string): string {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "[key]")
    .replace(/pit-[A-Za-z0-9-]+/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .slice(0, 300);
}

/** Every string in a draft that still carries a FILL, by its path. */
export function fillPaths(v: unknown, path: (string | number)[] = [], out: string[] = []): string[] {
  if (typeof v === "string") {
    if (/\bFILL\b/.test(v)) out.push(path.join("."));
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => fillPaths(x, [...path, i], out));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) fillPaths(x, [...path, k], out);
  }
  return out;
}

/**
 * Put the closer's figures into a draft. Only a string that still carries a
 * FILL can be replaced, so this cannot rewrite anything the model or the
 * validator already settled. A bare number becomes a number.
 */
export function applyFills(
  deal: unknown,
  fills: Record<string, unknown>,
): { ok: true; deal: unknown; changed: string[] } | { ok: false; error: string } {
  const copy = JSON.parse(JSON.stringify(deal ?? null));
  if (!copy || typeof copy !== "object") return { ok: false, error: "This proposal has no draft to fill in." };
  const allowed = new Set(fillPaths(copy));
  const changed: string[] = [];
  for (const [path, raw] of Object.entries(fills ?? {})) {
    if (!allowed.has(path)) return { ok: false, error: `"${path}" is not a blank in this draft.` };
    const value = cleanText(raw, 1000);
    if (!value) continue;
    if (/\bFILL\b/.test(value)) return { ok: false, error: "Replace every FILL with the real figure or words." };
    const keys = path.split(".").map(k => (/^\d+$/.test(k) ? Number(k) : k));
    let node: any = copy;
    for (const k of keys.slice(0, -1)) node = node?.[k as keyof typeof node];
    const last = keys[keys.length - 1];
    if (node === null || node === undefined || typeof node[last] !== "string")
      return { ok: false, error: `"${path}" is not a blank in this draft.` };
    node[last] = /^-?\d+(\.\d+)?$/.test(value.replace(/,/g, "")) && node[last].trim() === "FILL"
      ? Number(value.replace(/,/g, ""))
      : value;
    changed.push(path);
  }
  return { ok: true, deal: copy, changed };
}
