import type { SupabaseClient } from '@supabase/supabase-js';
import { addMonths, REASONS, rollUp, type Departure, type MonthInput, type MonthRow, type Reason } from './churnCore';
import { addDays } from './projectionsCore';
import { churnSourceSchema, type ChurnSource, type DepartureSource, type MonthSource } from './churnSchema';
const PAUSE_IS_CHURN_DAYS = 14;
export type Waiting = {
  key: string;
  client: string;
  clickupTaskId: string | null;
  leftOn: string;
  launchedOn: string | null;
  reason: Reason | null;
  mrrLostUsd: number | null;
  csm: string | null;
  /** The evidence, in plain words. */
  why: string;
};

export type PickClient = {
  key: string;
  name: string;
  stage: string;
  launchedOn: string | null;
  csm: string | null;
  mrrUsd: number | null;
};

export type ChurnPage = {
  today: string;
  month: string;
  me: { email: string; canRemove: boolean };
  reasons: readonly string[];
  departures: Departure[];
  /** Newest first, months with something in them, the current one always. */
  months: MonthRow[];
  waiting: Waiting[];
  clients: PickClient[];
  /** The roster's paying count on each month's first day, to fill a start with. */
  starts: { month: string; day: string | null; paying: number | null }[];
  /** Cards that launched in each month, to fill new clients with. */
  launches: { month: string; names: string[] }[];
  log: { at: string; by: string; what: string }[];
};


function departureOf(r: DepartureSource): Departure {
  return {
    id: Number(r.id),
    client: String(r.client),
    clickupTaskId: r.clickup_task_id ?? null,
    leftOn: String(r.left_on).slice(0, 10),
    launchedOn: r.launched_on ? String(r.launched_on).slice(0, 10) : null,
    reason: (REASONS as readonly string[]).includes(r.reason)
      ? (r.reason as Reason)
      : "Other",
    mrrLostUsd:
      r.mrr_lost_usd === null || r.mrr_lost_usd === undefined
        ? null
        : Number(r.mrr_lost_usd),
    csm: r.csm ?? null,
    note: r.note ?? null,
    source: r.source === "sheet" ? "sheet" : "cockpit",
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedBy: r.updated_by ?? null,
    updatedAt: String(r.updated_at),
  };
}

function monthInputOf(r: MonthSource): MonthInput {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    month: String(r.month),
    activeAtStart: n(r.active_at_start),
    newClients: n(r.new_clients),
    lostBeforeRegister: n(r.lost_before_register),
    note: r.note ?? null,
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export function buildChurnPage(input: unknown): ChurnPage {
 const { today, month, deps, monthRows, cards, log, roster: r, me: seatRow }: ChurnSource = churnSourceSchema.parse(input);
 const departures = deps.map(departureOf);
  const billing = new Map(cards.map(c => [String(c.clickup_task_id), c]));
  const rosterByKey = new Map(r.cards.map(c => [c.key, c]));

  // The pick list: every card the roster or billing knows, live ones first.
  const keys = new Set([...rosterByKey.keys(), ...billing.keys()]);
  const clients: PickClient[] = [...keys]
    .map(k => {
      const rc = rosterByKey.get(k);
      const bc = billing.get(k);
      return {
        key: k,
        name: String(rc?.name ?? bc?.client_name ?? k),
        stage: String(rc?.stage ?? bc?.stage ?? ""),
        launchedOn: rc?.launchedOn ?? null,
        csm: (bc?.csm as string | null) ?? rc?.csm ?? null,
        mrrUsd:
          bc?.mrr_usd === null || bc?.mrr_usd === undefined
            ? null
            : Number(bc.mrr_usd),
      };
    })
    .filter(c => !/playing account|\[internal test\]/i.test(c.name))
    .sort(
      (a, b) =>
        Number(/stop|cancel/i.test(a.stage)) -
          Number(/stop|cancel/i.test(b.stage)) || a.name.localeCompare(b.name),
    );

  // Waiting: evidence of a departure the register does not hold yet.
  const loggedKeys = new Set(
    departures.map(d => d.clickupTaskId).filter(Boolean) as string[],
  );
  const loggedNames = new Set(departures.map(d => norm(d.client)));
  const dismissed = new Set(
    log
      .filter(l => l.what === "dismissed a suggestion")
      .map(l => String(l.detail?.key ?? "")),
  );
  const cutoff = addDays(today, -75);
  const waiting = new Map<string, Waiting>();
  const offer = (w: Waiting) => {
    if (
      loggedKeys.has(w.key) ||
      loggedNames.has(norm(w.client)) ||
      dismissed.has(`${w.key}:${w.leftOn}`) ||
      waiting.has(w.key) ||
      w.leftOn < cutoff
    )
      return;
    waiting.set(w.key, w);
  };
  for (const c of cards)
    if (c.stage_group === "gone" && c.churn_date)
      offer({
        key: String(c.clickup_task_id),
        client: String(c.client_name),
        clickupTaskId: String(c.clickup_task_id),
        leftOn: String(c.churn_date).slice(0, 10),
        launchedOn:
          rosterByKey.get(String(c.clickup_task_id))?.launchedOn ?? null,
        reason: null,
        mrrLostUsd: c.mrr_usd === null ? null : Number(c.mrr_usd),
        csm: c.csm ?? null,
        why: `The ClickUp card is ${c.stage} with a churn date`,
      });
  for (const l of r.left) {
    const rc = rosterByKey.get(l.key);
    const bc = billing.get(l.key);
    offer({
      key: l.key,
      client: rc?.name ?? l.name,
      clickupTaskId: rc || bc ? l.key : null,
      leftOn: l.day,
      launchedOn: rc?.launchedOn ?? null,
      reason: null,
      mrrLostUsd:
        bc?.mrr_usd === null || bc?.mrr_usd === undefined
          ? null
          : Number(bc.mrr_usd),
      csm: (bc?.csm as string | null) ?? rc?.csm ?? null,
      why: `The daily roster saw it leave (${l.to})`,
    });
  }
  for (const c of r.cards)
    if (
      c.pausedSince &&
      c.pausedDays !== null &&
      c.pausedDays >= PAUSE_IS_CHURN_DAYS
    ) {
      const bc = billing.get(c.key);
      offer({
        key: c.key,
        client: c.name,
        clickupTaskId: c.key,
        leftOn: addDays(c.pausedSince, PAUSE_IS_CHURN_DAYS),
        launchedOn: c.launchedOn,
        reason: "Paused past 14 days",
        mrrLostUsd:
          bc?.mrr_usd === null || bc?.mrr_usd === undefined
            ? null
            : Number(bc.mrr_usd),
        csm: (bc?.csm as string | null) ?? c.csm,
        why: `Paused ${c.pausedDays} days: past the 14-day line`,
      });
    }

  const rows = rollUp(monthRows.map(monthInputOf), departures, month);
  const launches = new Map<string, string[]>();
  for (const c of r.cards)
    if (c.launchedOn && c.launchedOn.slice(0, 7) >= addMonths(month, -12))
      launches.set(c.launchedOn.slice(0, 7), [
        ...(launches.get(c.launchedOn.slice(0, 7)) ?? []),
        c.name,
      ]);

  return {
    today,
    month,
    me: {
      email: seatRow.email,
      canRemove: seatRow.isCeo || seatRow.isAdmin,
    },
    reasons: REASONS,
    departures,
    months: rows.filter(x => x.hasData).reverse(),
    waiting: [...waiting.values()].sort((a, b) =>
      b.leftOn.localeCompare(a.leftOn),
    ),
    clients,
    starts: r.starts,
    launches: [...launches.entries()].map(([m, names]) => ({
      month: m,
      names: names.sort(),
    })),
    log: log.slice(0, 30).map(l => ({
      at: String(l.at),
      by: String(l.by_whom),
      what: String(l.what),
    })),
  };
}
export async function readChurnPage(client: SupabaseClient | null): Promise<ChurnPage> {
 if (!client) throw new Error('Client-success sign-in is required');
 const {data,error}=await client.rpc('cockpit_csm_churn_read');
 if(error) throw new Error(error.message);
 if(!data || !Array.isArray(data.deps) || !data.roster) throw new Error('Churn register could not be read');
 return buildChurnPage(data);
}
export async function changeChurn(client: SupabaseClient | null, operation: string, args: Record<string, unknown>): Promise<ChurnPage> {
 if(!client) throw new Error('Client-success sign-in is required');
 const {error}=await client.rpc('cockpit_csm_churn_edit',{p_operation:operation,p_args:args});
 if(error) throw new Error(error.message);
 return readChurnPage(client);
}
