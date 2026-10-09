// Board KPI columns: the native port of convex/writeback.ts pushMetrics
// (hourly CPL 7d + Last Updated) together with the status columns that
// refreshKpiFields wrote when a decision was logged (CPL status, bookings 7d,
// CPB status). Pure: it takes the database inputs and the board as read from
// ClickUp, and returns what would be written.
//
// The formula is Convex's: 7-day spend in USD over 7-day leads, the window
// starting at the Kuwait day seven days back with no upper bound
// (convex/sync.ts). The figure is computed from the daily ledger
// (cockpit_media_daily_stats) and must agree with the campaign row the native
// sync published (cockpit_campaigns) before anything is written. A card whose
// two sources disagree is skipped, never written with a guess.

import { CPB_GATE, CPL_GATE, daysAgo, FIELD, FIELD_NAME, kpiBand, type Row } from "./rules.ts";

/** Numbers older than this are not pushed: the Last Updated column would lie. */
export const MAX_SOURCE_AGE_MS = 3 * 3600_000;

export type KpiInputs = {
  campaigns: Row[];
  daily: { campaignName: string; day: string; spend: number; leads: number }[];
  bookings: { client: string; day: string; booked: number }[];
  dailyReady: boolean;
  bookingsReady: boolean;
  latestPublishAt?: string | null;
  latestSyncedAt?: string | null;
};

export type KpiWrite = {
  taskId: string;
  taskName: string;
  field: string;
  fieldId: string;
  old: unknown;
  new: unknown;
  /** The ClickUp payload value. */
  value: unknown;
  changed: boolean;
};

export type KpiCard = {
  taskId: string;
  taskName: string;
  campaigns: string[];
  writes: KpiWrite[];
  skipped?: string;
  notes: string[];
};

export type KpiPlan = { refused?: string; cards: KpiCard[]; since7: string };

const num = (x: unknown): number | undefined => {
  if (x === null || x === undefined || x === "") return undefined;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const round2 = (n: number) => Number(n.toFixed(2));
const tightName = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** The label a dropdown custom field currently shows. ClickUp returns an option id or its orderindex. */
export function dropdownLabel(field: Row | undefined): string | undefined {
  if (!field || field.value === undefined || field.value === null || field.value === "") return undefined;
  const options: Row[] = field.type_config?.options ?? [];
  const hit =
    options.find(o => o.id === field.value) ??
    options.find(o => o.orderindex !== undefined && String(o.orderindex) === String(field.value)) ??
    (typeof field.value === "number" ? options[field.value] : undefined);
  return hit?.name ?? hit?.label ?? undefined;
}

/** Option id for a label, from the list's field definitions (convex/writeback.ts optionId). */
export function optionId(fields: Row[], fieldId: string, label: string): string | undefined {
  const f = fields.find(x => x.id === fieldId);
  return (f?.type_config?.options ?? []).find((o: Row) => o.name === label)?.id;
}

/** Sum the daily ledger the way convex/sync.ts sums its 7-day window. */
export function sevenDay(daily: KpiInputs["daily"], campaignNames: string[], since7: string) {
  const names = new Set(campaignNames);
  let spend = 0;
  let leads = 0;
  let rows = 0;
  for (const d of daily) {
    if (!names.has(d.campaignName) || String(d.day) < since7) continue;
    spend += Number(d.spend) || 0;
    leads += Number(d.leads) || 0;
    rows += 1;
  }
  return { spend, leads, rows };
}

export function planKpi(
  inputs: KpiInputs,
  tasks: Row[],
  fields: Row[],
  now: number,
): KpiPlan {
  const since7 = daysAgo(7, now);
  if (!inputs.dailyReady)
    return {
      since7,
      cards: [],
      refused:
        "The daily statistics ledger is not imported and verified, so the CPL cannot be checked against a second source. Nothing was written. Run the media source producer.",
    };
  const freshest = Math.max(
    Date.parse(String(inputs.latestPublishAt ?? "")) || 0,
    Date.parse(String(inputs.latestSyncedAt ?? "")) || 0,
  );
  if (!freshest || now - freshest > MAX_SOURCE_AGE_MS)
    return {
      since7,
      cards: [],
      refused: freshest
        ? `The media numbers were last refreshed ${Math.round((now - freshest) / 60_000)} minutes ago, so the board was left as it is. Check the native media sync.`
        : "There is no record of a native media refresh, so the board was left as it is. Check the native media sync.",
    };

  // convex/writeback.ts boardCampaigns: rows with a task, never Mahara's own account.
  const board = inputs.campaigns.filter(c => c.taskId && !c.internal);
  const byTask = new Map<string, Row[]>();
  for (const c of board) byTask.set(String(c.taskId), [...(byTask.get(String(c.taskId)) ?? []), c]);
  const taskById = new Map(tasks.map(t => [String(t.id), t]));
  const bookedByClient = new Map<string, number>();
  for (const b of inputs.bookings)
    if (String(b.day) >= since7) bookedByClient.set(tightName(b.client), (bookedByClient.get(tightName(b.client)) ?? 0) + Number(b.booked || 0));

  const cards: KpiCard[] = [];
  for (const [taskId, rows] of [...byTask].sort(([a], [b]) => a.localeCompare(b))) {
    const task = taskById.get(taskId);
    const names = rows.map(r => String(r.campaignName));
    const card: KpiCard = { taskId, taskName: String(task?.name ?? names[0]), campaigns: names, writes: [], notes: [] };
    cards.push(card);
    if (!task) {
      card.skipped = "This card was not found on the Ads Managment list. It may be archived or moved.";
      continue;
    }
    const cf = (id: string) => (task.custom_fields ?? []).find((f: Row) => f.id === id);
    const ledger = sevenDay(inputs.daily, names, since7);
    const rowSpend = rows.reduce((s, r) => s + (num(r.spend7d) ?? 0), 0);
    const rowLeads = rows.reduce((s, r) => s + (num(r.leads7d) ?? 0), 0);
    const spendOk = Math.abs(ledger.spend - rowSpend) <= Math.max(0.05, rowSpend * 0.005);
    if (!spendOk || ledger.leads !== rowLeads) {
      card.skipped = `The two sources disagree: the campaign row says $${rowSpend.toFixed(2)} for ${rowLeads} leads, the daily ledger says $${ledger.spend.toFixed(2)} for ${ledger.leads} leads since ${since7}. Nothing was written to this card.`;
      continue;
    }
    if (rows.length === 1) {
      // A single campaign: its own CPL must also match what the row published.
      const rowCpl = num(rows[0].cpl);
      const ledgerCpl = ledger.leads > 0 ? ledger.spend / ledger.leads : undefined;
      if ((rowCpl === undefined) !== (ledgerCpl === undefined) || (rowCpl !== undefined && ledgerCpl !== undefined && Math.abs(rowCpl - ledgerCpl) > 0.01)) {
        card.skipped = `The campaign row's CPL (${rowCpl === undefined ? "none" : `$${rowCpl.toFixed(2)}`}) does not match the daily ledger (${ledgerCpl === undefined ? "none" : `$${ledgerCpl.toFixed(2)}`}). Nothing was written to this card.`;
        continue;
      }
    } else {
      card.notes.push(`${rows.length} campaigns share this card, so its CPL is their combined 7-day spend over combined leads.`);
    }

    const push = (fieldId: string, oldDisplay: unknown, newDisplay: unknown, value: unknown, changed: boolean) =>
      card.writes.push({ taskId, taskName: card.taskName, field: FIELD_NAME[fieldId], fieldId, old: oldDisplay ?? null, new: newDisplay, value, changed });

    const cpl = ledger.leads > 0 ? ledger.spend / ledger.leads : undefined;
    if (cpl !== undefined) {
      const value = round2(cpl);
      const old = num(cf(FIELD.cpl7d)?.value);
      push(FIELD.cpl7d, old, value, value, old === undefined || round2(old) !== value);
      const label = kpiBand(cpl, CPL_GATE);
      const id = optionId(fields, FIELD.cplStatus, label);
      const oldLabel = dropdownLabel(cf(FIELD.cplStatus));
      if (id) push(FIELD.cplStatus, oldLabel, label, id, oldLabel !== label);
      else card.notes.push(`The Cost Per Lead column has no "${label}" option, so it was not set.`);
    } else {
      card.notes.push("No leads in the last 7 days, so there is no CPL. The CPL columns were left as they were.");
    }

    // Bookings and cost per booking: only with bookings, as in refreshKpiFields.
    const bookingValues = rows.map(r => num(r.bookings7d)).filter((n): n is number => n !== undefined);
    const booked = bookingValues.length ? Math.max(...bookingValues) : undefined;
    if (booked !== undefined && booked > 0) {
      const clients = [...new Set(rows.map(r => tightName(r.clientName)).filter(Boolean))];
      const ledgerBooked = clients.reduce((s, c) => s + (bookedByClient.get(c) ?? 0), 0);
      if (!inputs.bookingsReady) {
        card.notes.push("The booking ledger is not imported and verified, so bookings were not written.");
      } else if (ledgerBooked !== booked) {
        card.notes.push(`Bookings were not written: the campaign row says ${booked}, the booking ledger says ${ledgerBooked} since ${since7}.`);
      } else {
        const oldBooked = num(cf(FIELD.bookings7d)?.value);
        push(FIELD.bookings7d, oldBooked, booked, booked, oldBooked !== booked);
        const label = kpiBand(ledger.spend / booked, CPB_GATE);
        const id = optionId(fields, FIELD.cpbStatus, label);
        const oldLabel = dropdownLabel(cf(FIELD.cpbStatus));
        if (id) push(FIELD.cpbStatus, oldLabel, label, id, oldLabel !== label);
        else card.notes.push(`The Cost Per Booking column has no "${label}" option, so it was not set.`);
      }
    }

    const lastOld = num(cf(FIELD.lastUpdated)?.value);
    push(FIELD.lastUpdated, lastOld === undefined ? null : new Date(lastOld).toISOString(), new Date(now).toISOString(), now, true);
  }
  return { since7, cards };
}
