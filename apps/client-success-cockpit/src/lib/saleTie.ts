import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The sale tied to its card (CEO item 6; sale-tie.md 2.7 and 2.10;
 * WAVE56-CONTRACT.md 4.19 and 5.16): the three browser RPCs of the sale tie,
 * read leniently, and every sentence the screens say. The tie itself is the
 * server's (exact phone or email, never a name); this file only reads it and
 * sends a person's decision.
 *
 * - cockpit_csm_sale_read(p_task_ids text[]): per card, the newest live tied
 *   sale: {signedAt, tiedBy, closer, goLive, handoffProblems, expectations,
 *   salesCallLink, voidedInB2B, otherSales}, or {state: 'none'}. Never a phone,
 *   an email or a digest.
 * - cockpit_sale_tie_list(): "Sales not on a card" (CEO or CSM) and the CEO's
 *   counts.
 * - cockpit_sale_tie_decide(p_response_id, p_choice, p_task, p_note): yes,
 *   pick, not_client or clear, gated on the server.
 *
 * PostgREST's "no such function" (the migration not applied yet) reads as
 * `missing`, which the screens say in one plain line. A seat the read refuses
 * (42501: an admin seat without the csm role) reads as `missing` too, so no
 * screen calls it a failure. While forms.sale_tie.on is false the read says
 * `{on: false}` and every card is `off`: nothing ties and nothing can be
 * decided yet, so no screen tells anyone to tie it.
 */

export type TiedBy = "phone" | "email" | "phone_email" | "person";

export type SaleView =
  | { state: "missing" }
  | { state: "off" }
  | { state: "none" }
  | {
      state: "tied";
      signedAt: string | null;
      tiedBy: TiedBy | null;
      closer: string | null;
      goLive: string | null;
      handoffProblems: string | null;
      expectations: string | null;
      salesCallLink: string | null;
      voidedInB2B: boolean;
      otherSales: number;
    };

export type SaleCandidate = {
  taskId: string;
  name: string | null;
  reason: string | null;
};

export type SaleTieRow = {
  responseId: string;
  businessName: string | null;
  signedAt: string | null;
  /** The signing day in Kuwait ("2026-10-12"), as the server gives it. */
  signedOn: string | null;
  closer: string | null;
  state: string;
  sentence: string | null;
  suggestion: SaleCandidate | null;
  candidates: SaleCandidate[];
  /** A tie the CEO sees because billing ties the sale to another card. */
  tiedTo: { taskId: string; name: string | null; tiedBy: TiedBy | null } | null;
};

export type SaleCounts = {
  sales: number;
  tied: number;
  byPhone: number;
  byEmail: number;
  byBoth: number;
  byPerson: number;
  waiting: number;
};

export type SaleTieList = {
  asOf: string | null;
  /** forms.sale_tie.on: false until the CEO turns sale ties on (nothing ties, nothing is decided). */
  on: boolean | null;
  rows: SaleTieRow[];
  counts: SaleCounts | null;
  note: string | null;
};

export type SaleChoice = "yes" | "pick" | "not_client" | "clear";

/** The screens' line while the sale tie's functions are not on the database. */
export const SALES_MISSING =
  "Sales tie to their cards after the next cockpit update.";
/** A card with no tied sale: never a blank or a zero. */
export const NOT_TIED =
  "Not tied to a New Client Form yet. The CEO can tie it under Sales not on a card.";
/** The band with nothing in it. */
export const EVERY_SALE_TIED = "Every sale is on its card.";
/** Before the tie has counts (the CEO's line): missing is never zero. */
export const NOT_TIED_YET = "Sales are not tied yet.";

const TIED_WORDS: Record<TiedBy, string> = {
  phone: "Tied by phone",
  email: "Tied by email",
  phone_email: "Tied by phone and email",
  person: "Tied by a person",
};

/** The chip's words: "Tied by phone". */
export function tiedByWords(by: TiedBy | null): string {
  return by ? TIED_WORDS[by] : "Tied";
}

/** The chip's tone: teal for an exact key, the neutral chip for a person's tie. */
export function tiedByTone(by: TiedBy | null): "accent" | "neutral" {
  return by && by !== "person" ? "accent" : "neutral";
}

type Any = Record<string, unknown>;
const obj = (v: unknown): Any | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Any) : null;
const txt = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const BY: TiedBy[] = ["phone", "email", "phone_email", "person"];

/** One card's sale, from whatever row the read gives. */
export function readSaleView(v: unknown): SaleView {
  const o = obj(v);
  if (!o || o.state === "none" || (!txt(o.signedAt) && !txt(o.tiedBy)))
    return { state: "none" };
  const by = o.tiedBy as TiedBy;
  return {
    state: "tied",
    signedAt: txt(o.signedAt),
    tiedBy: BY.includes(by) ? by : null,
    closer: txt(o.closer),
    goLive: txt(o.goLive),
    handoffProblems: txt(o.handoffProblems),
    expectations: txt(o.expectations),
    salesCallLink: txt(o.salesCallLink),
    voidedInB2B: o.voidedInB2B === true,
    otherSales: num(o.otherSales) ?? 0,
  };
}

/**
 * cockpit_csm_sale_read's answer, by card: `{cards: {id: view}}`,
 * `{rows: [{taskId, …}]}`, a bare list of rows or a bare map are all read. A
 * card the answer does not name is `none`. `{on: false}` (sale ties not
 * turned on) makes every card `off`, whatever the answer lists.
 */
export function readSales(
  v: unknown,
  taskIds: string[],
): Record<string, SaleView> {
  const out: Record<string, SaleView> = {};
  const o = obj(v);
  if (o?.on === false) {
    for (const id of taskIds) out[id] = { state: "off" };
    return out;
  }
  for (const id of taskIds) out[id] = { state: "none" };
  const list = Array.isArray(v)
    ? v
    : Array.isArray(o?.rows)
      ? (o?.rows as unknown[])
      : Array.isArray(o?.cards)
        ? (o?.cards as unknown[])
        : null;
  if (list) {
    for (const x of list) {
      const id = txt(obj(x)?.taskId);
      if (id) out[id] = readSaleView(x);
    }
    return out;
  }
  const map = obj(o?.cards) ?? o ?? {};
  for (const [id, x] of Object.entries(map))
    if (obj(x) && id !== "asOf") out[id] = readSaleView(x);
  return out;
}

function readCandidate(v: unknown): SaleCandidate | null {
  const o = obj(v);
  const taskId = o ? txt(o.taskId) : null;
  if (!o || !taskId) return null;
  return {
    taskId,
    name: txt(o.clientName ?? o.name ?? o.cardName),
    reason: txt(o.reason),
  };
}

/** cockpit_sale_tie_list's answer. */
export function readSaleList(v: unknown): SaleTieList {
  const o = obj(v) ?? {};
  const rows: SaleTieRow[] = (Array.isArray(o.rows) ? o.rows : [])
    .map(x => {
      const r = obj(x);
      const responseId = r ? txt(r.responseId) : null;
      if (!r || !responseId) return null;
      const tied = obj(r.tiedTo);
      const tiedTask = tied ? txt(tied.taskId) : null;
      return {
        responseId,
        businessName: txt(r.businessName),
        signedAt: txt(r.signedAt),
        signedOn: txt(r.signedOn),
        closer: txt(r.closer),
        tiedTo:
          tied && tiedTask
            ? {
                taskId: tiedTask,
                name: txt(tied.clientName ?? tied.name),
                tiedBy: BY.includes(tied.tiedBy as TiedBy)
                  ? (tied.tiedBy as TiedBy)
                  : null,
              }
            : null,
        state: txt(r.state) ?? "unmatched",
        sentence: txt(r.sentence),
        suggestion: readCandidate(r.suggestion),
        candidates: (Array.isArray(r.candidates) ? r.candidates : [])
          .map(readCandidate)
          .filter((c): c is SaleCandidate => c !== null),
      };
    })
    .filter((x): x is SaleTieRow => x !== null);
  // B3's `summary` (sales, onCard, byPhone, byEmail, byPhoneAndEmail, byPerson,
  // forPerson); `counts` with the plain names is read the same way.
  const c = obj(o.summary) ?? obj(o.counts);
  const n = (...keys: string[]) => {
    for (const k of keys) {
      const v = c ? num(c[k]) : null;
      if (v !== null) return v;
    }
    return null;
  };
  const sales = n("sales");
  const tied = n("onCard", "tied");
  const counts =
    sales !== null && tied !== null
      ? {
          sales,
          tied,
          byPhone: n("byPhone") ?? 0,
          byEmail: n("byEmail") ?? 0,
          byBoth: n("byPhoneAndEmail", "byBoth") ?? 0,
          byPerson: n("byPerson") ?? 0,
          waiting: n("forPerson", "waiting") ?? rows.length,
        }
      : null;
  return {
    asOf: txt(o.asOf),
    on: typeof o.on === "boolean" ? o.on : null,
    rows,
    counts,
    note: txt(o.note),
  };
}

/**
 * The CEO's forms-health line: "55 sales: 39 on their card (33 by phone, 6
 * by email, 0 by a person), 15 waiting for a person." "By phone" counts the
 * ties where the phone matched (with or without the email). Before the tie
 * has counts it says so, never 0.
 */
export function saleHealthLine(c: SaleCounts | null): string {
  if (!c) return NOT_TIED_YET;
  const plural = (n: number, one: string, many: string) =>
    `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  return `${plural(c.sales, "sale", "sales")}: ${c.tied.toLocaleString("en-US")} on their card (${c.byPhone + c.byBoth} by phone, ${c.byEmail} by email, ${c.byPerson} by a person), ${c.waiting.toLocaleString("en-US")} waiting for a person.`;
}

/** The plain reason a candidate is offered, or the server's own words. */
export function candidateWhy(c: SaleCandidate): string {
  return c.reason ?? "A card the cockpit found for this sale";
}

/** True when the error says the sale tie's functions are not on the database yet. */
export function saleMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? null;
  return code === "PGRST202" || code === "42883";
}

/** A refusal's sentence: the server's own words for its codes, plain words otherwise. */
export class SaleTieError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "SaleTieError";
    this.code = code;
  }
}

const OWN = new Set(["P0001", "22023", "42501", "55000"]);
const RAW =
  /permission denied|violates|duplicate key|syntax|does not exist|invalid input/i;

async function call(
  client: SupabaseClient | null,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!client)
    throw new SaleTieError("Sign in to the cockpit, then try again.");
  let answer: {
    data: unknown;
    error: { message?: string; code?: string } | null;
  };
  try {
    answer = (await client.rpc(name, args)) as typeof answer;
  } catch {
    throw new SaleTieError(
      "The cockpit could not reach the database. Check your connection, then try again.",
    );
  }
  if (answer.error) {
    const code = answer.error.code ?? null;
    const msg = (answer.error.message ?? "").trim();
    if (code === "PGRST202" || code === "42883")
      throw new SaleTieError(SALES_MISSING, code);
    if (code && OWN.has(code) && msg && !RAW.test(msg))
      throw new SaleTieError(msg, code);
    throw new SaleTieError(
      "The database could not answer just now. Try again in a minute.",
      code,
    );
  }
  return answer.data;
}

/** cockpit_csm_sale_read for these cards. */
export async function readSaleTies(
  client: SupabaseClient | null,
  taskIds: string[],
): Promise<Record<string, SaleView>> {
  return readSales(
    await call(client, "cockpit_csm_sale_read", { p_task_ids: taskIds }),
    taskIds,
  );
}

/** True when the read refused this seat (42501): not a failure to show. */
export function saleSeatRefused(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "42501";
}

/**
 * One card's sale; `missing` when the function is not there yet or the seat
 * is not one the read serves (42501), so the rail keeps the card's own rows
 * and says nothing failed.
 */
export async function readSaleTie(
  client: SupabaseClient | null,
  taskId: string,
): Promise<SaleView> {
  try {
    return (await readSaleTies(client, [taskId]))[taskId] ?? { state: "none" };
  } catch (e) {
    if (saleMissing(e) || saleSeatRefused(e)) return { state: "missing" };
    throw e;
  }
}

/** cockpit_sale_tie_list. */
export async function readSaleTieList(
  client: SupabaseClient | null,
): Promise<SaleTieList> {
  return readSaleList(await call(client, "cockpit_sale_tie_list"));
}

/** cockpit_sale_tie_decide: the server's sentence back, or the toast's own. */
export async function decideSaleTie(
  client: SupabaseClient | null,
  p: {
    responseId: string;
    choice: SaleChoice;
    taskId?: string | null;
    note?: string | null;
  },
): Promise<{ sentence: string | null; cardName: string | null }> {
  // B3 answers {ok, responseId, state, taskId, clientName, movedFrom?, facts,
  // handFill?: {taskId, sentence}}. handFill is set when the CEO moved a sale
  // whose card notes were already planned for its first card: its sentence
  // (fill the new card's notes by hand) is the one the toast must say.
  const d = obj(
    await call(client, "cockpit_sale_tie_decide", {
      p_response_id: p.responseId,
      p_choice: p.choice,
      p_task: p.taskId ?? null,
      p_note: p.note?.trim() ? p.note.trim() : null,
    }),
  );
  return {
    sentence: txt(d?.sentence) ?? txt(obj(d?.handFill)?.sentence),
    cardName: txt(d?.clientName ?? d?.cardName),
  };
}

export type SaleTieApi = {
  list(): Promise<SaleTieList>;
  decide: (
    p: Parameters<typeof decideSaleTie>[1],
  ) => ReturnType<typeof decideSaleTie>;
};

export const saleTieApi = (client: SupabaseClient | null): SaleTieApi => ({
  list: () => readSaleTieList(client),
  decide: p => decideSaleTie(client, p),
});
