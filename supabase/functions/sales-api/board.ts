// The pipeline board's Closed column (the CEO, 2026-10-11: "if we move a
// client to the sales pipeline, it shouldn't remove it when we sign the
// client or move it to the client success. I just wanted to go to the
// closed pipeline in the sales tool").
//
// A lead that is an active client (tagged client, or a live deal from the
// New Client Form), whose opportunity HighLevel marks won, or that sits in a
// won stage is placed in its pipeline's Closed column instead of being left
// off the board. HighLevel's own stage after signing is arbitrary (0 of 32
// signed leads sat in Closed on 2026-10-11), so this is the cockpit's
// placement only: nothing is written to HighLevel, and pipeline.move refuses
// to move a client at all, because a stage's workflows could message them.
//
// Pure; bun test supabase/functions/sales-api/board.test.ts.

import type { ClientFacts } from "./clients.ts";
import { stageRole } from "./dialer.ts";

type Row = Record<string, unknown>;

export interface BoardStage {
  id: string;
  name: string;
  role: string | null;
  position?: number;
}

export interface BoardPipe {
  id: string;
  name: string;
  stages: readonly BoardStage[];
}

/** The column signed and closed leads sit in. */
export interface ClosedColumn {
  id: string;
  name: string;
  /** True when the pipeline has no won stage, so the cockpit draws its own. */
  synthetic: boolean;
}

/** The cockpit's own column, for a pipeline with no won stage. */
export const SIGNED_COLUMN: ClosedColumn = { id: "signed", name: "Signed", synthetic: true };

/** Why a move of a client on the board is refused (D52). */
export const CLIENT_MOVE_REFUSAL = "This client is signed, so they stay in Closed. Client success looks after them.";

/** Plain stage name: no emoji, trimmed, lower case. */
const plain = (s: unknown) =>
  String(s ?? "")
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, "")
    .trim()
    .toLowerCase();

/**
 * The pipeline's Closed column: the won stage whose name says closed, else
 * the first won stage in the pipeline's order, else the cockpit's "Signed".
 */
export function closedColumn(pipe: Pick<BoardPipe, "stages"> | null | undefined): ClosedColumn {
  const won = [...(pipe?.stages ?? [])]
    .filter(s => s.role === "won")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  // "Closed Lost" reads as won by its name alone (dialer.ts stageRole), so a
  // stage that says lost is the last pick.
  const kept = won.filter(s => !/\blost\b/.test(plain(s.name)));
  const pick = kept.find(s => /\bclosed\b/.test(plain(s.name))) ?? kept[0] ?? won[0];
  return pick ? { id: pick.id, name: pick.name, synthetic: false } : { ...SIGNED_COLUMN };
}

/** The lead's own stage's role: the pipeline's word for it, else the settings', else its name's. */
export function leadStageRole(
  lead: Row,
  pipe: Pick<BoardPipe, "stages"> | null | undefined,
  roles: Record<string, string> = {},
): string | null {
  const id = lead.stage_id === null || lead.stage_id === undefined ? "" : String(lead.stage_id);
  if (!id && !lead.stage_name) return null;
  const own = id ? pipe?.stages.find(s => s.id === id) : undefined;
  return own?.role ?? (id ? roles[id] : undefined) ?? stageRole(lead.stage_name as string | null);
}

/** A placement: the Closed column, or the lead's own stage (null: no stage yet). */
export type Placement = { closed: true; stage_id: string } | { closed: false; stage_id: string | null };

/**
 * Where a lead's card goes (D48): the Closed column for an active client, an
 * opportunity HighLevel marks won, or a lead in a won stage; else its own stage.
 */
export function placeLead(
  lead: Row,
  facts: Pick<ClientFacts, "client">,
  pipe: Pick<BoardPipe, "stages"> | null | undefined,
  roles: Record<string, string> = {},
): Placement {
  const won = facts.client || lead.opp_status === "won" || leadStageRole(lead, pipe, roles) === "won";
  if (won) return { closed: true, stage_id: closedColumn(pipe).id };
  return { closed: false, stage_id: lead.stage_id === null || lead.stage_id === undefined ? null : String(lead.stage_id) };
}

/** The fields every card carries for the Closed column (D49). */
export interface ClosedFields {
  client: boolean;
  closed: boolean;
  signed_at: string | null;
  value: number | null;
  closer: string | null;
  setter: string | null;
  /** HighLevel's real stage name, shown small on a Closed card; null on an open card. */
  crm_stage: string | null;
}

/** An open lead's card: none of the Closed fields. */
export const OPEN_FIELDS: ClosedFields = {
  client: false,
  closed: false,
  signed_at: null,
  value: null,
  closer: null,
  setter: null,
  crm_stage: null,
};

/**
 * A Closed card's own fields: the signed date, the value and who closed it
 * (from the newest live deal), and HighLevel's real stage. No heat, no hot
 * flag and no next step: the caller leaves those empty.
 */
export function closedCard(lead: Row, facts: ClientFacts): ClosedFields {
  const stage = typeof lead.stage_name === "string" && lead.stage_name.trim() ? lead.stage_name : null;
  return {
    client: facts.client,
    closed: true,
    signed_at: facts.signed_at,
    value: facts.value,
    closer: facts.closer,
    setter: facts.setter,
    crm_stage: stage,
  };
}

const time = (v: unknown): number => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * The Closed column's order (D50): the newest signing first; then clients
 * known only by the tag; then leads in Closed by HighLevel's stage alone;
 * each of the last two by their last update.
 */
export function sortClosed<T extends { signed_at?: string | null; client?: boolean; last_touch_at?: string | null; name?: unknown }>(
  cards: readonly T[],
): T[] {
  const rank = (c: T) => (c.signed_at ? 0 : c.client ? 1 : 2);
  return [...cards].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      time(b.signed_at) - time(a.signed_at) ||
      time(b.last_touch_at) - time(a.last_touch_at) ||
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
}

/** The Closed column header's counts (D53): open leads apart from signed clients. */
export function closedCounts(cards: readonly { closed?: unknown; client?: unknown }[]): { open: number; signed: number } {
  let open = 0;
  let signed = 0;
  for (const c of cards) {
    if (c.closed !== true) continue;
    if (c.client === true) signed += 1;
    else open += 1;
  }
  return { open, signed };
}

/** A seat's names as the deals spell them: lower case, trimmed (cockpit_sales_my_names). */
export function myNames(...names: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const n of names.flat()) {
    const s = String(n ?? "").trim().toLowerCase();
    if (s) out.add(s);
  }
  return out;
}

/**
 * The "Mine" scope for a Closed card (D53): the lead is mine, or a live deal
 * of the lead names me as its closer or setter.
 */
export function closedIsMine(
  lead: Row,
  deals: readonly Row[],
  me: { ghl_user_id?: string | null; names: Set<string> },
): boolean {
  if (me.ghl_user_id && lead.assigned_to === me.ghl_user_id) return true;
  return deals.some(
    d =>
      d.voided !== true &&
      (me.names.has(String(d.closer ?? "").trim().toLowerCase()) || me.names.has(String(d.setter ?? "").trim().toLowerCase())),
  );
}
