// Board KPI columns: the native port of convex/writeback.ts pushMetrics
// (hourly CPL 7d + Last Updated) together with the status columns that
// refreshKpiFields wrote when a decision was logged (CPL status, bookings 7d,
// CPB status). Pure: it takes the database inputs and the board as read from
// ClickUp, and returns what would be written.
//
// The window is the media sync's own 7 days (cost per booking build 2, R1 and
// R12, 22 Oct 2026): weekFrom to weekThrough from cockpit_media_week(), the
// days the published campaign rows were computed over. Spend, leads and
// bookings all stop on weekThrough, the last day the sheet has spend for, so a
// booking made today is never divided by spend that stopped yesterday. Before
// the sync publishes that window nothing is planned.
//
// Every card is checked against two sources before anything is written: the
// campaign rows the native sync published (cockpit_campaigns) against the
// daily ledger (cockpit_media_daily_stats) for spend and leads, and against
// the booking ledger by campaign (cockpit_media_booking_events) for bookings.
// A card whose sources disagree keeps those columns as they are, and Last
// Updated is stamped only when every column of the card was written or was
// already right.
//
// Bands are judged on the figure to the cent, as the cockpit shows it
// (hermes/cockpit-sync/calculator.ts cents()): $60.004 is $60.00 and within
// the $60 gate, and the Cost Per Lead band is judged on the CPL (7d) value
// written beside it, so the two columns never disagree.

import { CPB_GATE, CPL_GATE, FIELD, FIELD_NAME, kpiBand, money, type Row } from "./rules.ts";

/** Numbers older than this are not pushed: the Last Updated column would lie. */
export const MAX_SOURCE_AGE_MS = 3 * 3600_000;

export type KpiInputs = {
  campaigns: Row[];
  daily: { campaignName: string; day: string; spend: number; leads: number }[];
  /** Bookings by client. Still in the inputs for older readers; the plan reads bookingsByCampaign. */
  bookings?: { client: string; day: string; booked: number }[];
  /** Bookings by campaign and booking day (20261022z). */
  bookingsByCampaign?: { campaignName: string; day: string; booked: number }[];
  /** The media sync's 7 days (20261022z, from cockpit_media_week()). weekFrom is null until the sync publishes it. */
  weekFrom?: string | null;
  weekThrough?: string | null;
  weekSource?: string | null;
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
  /** True when Last Updated is in the writes: every column was written or already right. */
  stamped: boolean;
  /** Why Last Updated was left as it was. */
  held?: string;
  /** The card's Last Updated as read from ClickUp (ms), when it has one. */
  lastUpdated?: number;
};

export type KpiWindow = { from: string; through: string; source: string };

export type KpiPlan = {
  refused?: string;
  cards: KpiCard[];
  window?: KpiWindow;
  /**
   * The oldest Last Updated among the board's cards that show numbers (ms), null when none does.
   * A card with no numbers on it carries only the date it was made, which vouches for nothing.
   */
  oldestLastUpdated: number | null;
  /** Board cards that show no numbers yet: CPL (7d) and Bookings (7d) blank, both bands blank or Pending. */
  noNumbers: number;
  /** Board cards that show numbers but have no Last Updated date. */
  undated: number;
};

export const NO_WINDOW = "The media sync has not published its 7-day window yet, so nothing was planned.";
/** cockpit_clickup_writeback_inputs before 20261022z has no weekFrom key at all (20261022z always sends it, null or a day). */
export const NO_WINDOW_KEY = "cockpit_clickup_writeback_inputs has no 7-day window (migration 20261022z is not applied), so nothing was planned.";

/**
 * Under this much 7-day spend the media sync calls a campaign "no delivery"
 * (hermes/cockpit-sync/calculator.ts, spend < 1), so bookings in the window
 * came from earlier spend and their cost per booking is not judged.
 */
export const NO_DELIVERY_SPEND = 1;

const num = (x: unknown): number | undefined => {
  if (x === null || x === undefined || x === "") return undefined;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const round2 = (n: number) => Number(n.toFixed(2));
/** A dollar figure to the cent, exactly as the media sync rounds it (calculator.ts cents()). */
export const cents = (n: number) => Math.round(n * 100) / 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "14 Oct" for a YYYY-MM-DD day. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "7 Oct 2026" for a time, on the Kuwait calendar. */
export function kuwaitDate(ms: number): string {
  return new Date(ms + 3 * 3600_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

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

/**
 * Sum the daily ledger over the window. With no `through` the window has no
 * upper bound, which is how convex/sync.ts summed it (the parity test keeps
 * that); the plan always passes the media sync's last day.
 */
export function sevenDay(daily: KpiInputs["daily"], campaignNames: string[], since7: string, through?: string) {
  const names = new Set(campaignNames);
  let spend = 0;
  let leads = 0;
  let rows = 0;
  for (const d of daily) {
    const day = String(d.day);
    if (!names.has(d.campaignName) || day < since7 || (through !== undefined && day > through)) continue;
    spend += Number(d.spend) || 0;
    leads += Number(d.leads) || 0;
    rows += 1;
  }
  return { spend, leads, rows };
}

/** Bookings of these campaigns made from..through, from the booking ledger by campaign. */
export function bookedInWindow(ledger: NonNullable<KpiInputs["bookingsByCampaign"]>, campaignNames: string[], from: string, through: string): number {
  const names = new Set(campaignNames);
  let n = 0;
  for (const b of ledger) {
    const day = String(b.day);
    if (names.has(String(b.campaignName)) && day >= from && day <= through) n += Number(b.booked) || 0;
  }
  return n;
}

/** The media sync's window, or why there is none. */
export function kpiWindow(inputs: KpiInputs): KpiWindow | { refused: string } {
  // The key itself is missing only when the inputs function predates 20261022z: say that, not "not published yet".
  if (inputs.weekFrom === undefined) return { refused: NO_WINDOW_KEY };
  const from = inputs.weekFrom ?? null;
  const through = inputs.weekThrough ?? null;
  if (!from) return { refused: NO_WINDOW };
  if (!through || !DAY.test(String(from)) || !DAY.test(String(through)) || String(from) > String(through))
    return {
      refused: `The media sync's 7-day window (${from} to ${through ?? "no end"}) is not a valid pair of days, so nothing was planned. Check cockpit_media_week().`,
    };
  return { from: String(from), through: String(through), source: String(inputs.weekSource ?? "media sync") };
}

const blank = (f: Row | undefined) => !f || f.value === undefined || f.value === null || f.value === "";
/** A dropdown that claims nothing: empty, or ClickUp's own "Pending". */
const neutral = (f: Row | undefined) => blank(f) || dropdownLabel(f) === "Pending";

/** True when the card shows a number or a band: CPL (7d) or Bookings (7d) filled, or a band other than blank or Pending. */
export function showsNumbers(task: Row): boolean {
  const cf = (id: string) => (task.custom_fields ?? []).find((f: Row) => f.id === id);
  return !blank(cf(FIELD.cpl7d)) || !blank(cf(FIELD.bookings7d)) || !neutral(cf(FIELD.cplStatus)) || !neutral(cf(FIELD.cpbStatus));
}

export function planKpi(inputs: KpiInputs, tasks: Row[], fields: Row[], now: number): KpiPlan {
  const empty = { cards: [], oldestLastUpdated: null, noNumbers: 0, undated: 0 };
  if (!inputs.dailyReady)
    return {
      ...empty,
      refused:
        "The daily statistics ledger is not imported and verified, so the CPL cannot be checked against a second source. Nothing was written. Run the media source producer.",
    };
  const win = kpiWindow(inputs);
  if ("refused" in win) return { ...empty, refused: win.refused };
  const freshest = Math.max(
    Date.parse(String(inputs.latestPublishAt ?? "")) || 0,
    Date.parse(String(inputs.latestSyncedAt ?? "")) || 0,
  );
  if (!freshest || now - freshest > MAX_SOURCE_AGE_MS)
    return {
      ...empty,
      window: win,
      refused: freshest
        ? `The media numbers were last refreshed ${Math.round((now - freshest) / 60_000)} minutes ago, so the board was left as it is. Check the native media sync.`
        : "There is no record of a native media refresh, so the board was left as it is. Check the native media sync.",
    };
  const { from, through } = win;
  const days = `${shortDay(from)} to ${shortDay(through)}`;

  // convex/writeback.ts boardCampaigns: rows with a task, never Mahara's own account.
  const board = inputs.campaigns.filter(c => c.taskId && !c.internal);
  const byTask = new Map<string, Row[]>();
  for (const c of board) byTask.set(String(c.taskId), [...(byTask.get(String(c.taskId)) ?? []), c]);
  const taskById = new Map(tasks.map(t => [String(t.id), t]));
  const bookingLedger = Array.isArray(inputs.bookingsByCampaign) ? inputs.bookingsByCampaign : undefined;

  const cards: KpiCard[] = [];
  let oldestLastUpdated: number | null = null;
  let noNumbers = 0;
  let undated = 0;
  for (const [taskId, rows] of [...byTask].sort(([a], [b]) => a.localeCompare(b))) {
    const task = taskById.get(taskId);
    const names = rows.map(r => String(r.campaignName));
    const card: KpiCard = { taskId, taskName: String(task?.name ?? names[0]), campaigns: names, writes: [], notes: [], stamped: false };
    cards.push(card);
    if (!task) {
      card.skipped = "This card was not found on the Ads Managment list. It may be archived or moved.";
      continue;
    }
    const cf = (id: string) => (task.custom_fields ?? []).find((f: Row) => f.id === id);
    card.lastUpdated = num(cf(FIELD.lastUpdated)?.value);
    // "The board still shows numbers last updated ...": only a card with numbers on it counts towards that date.
    if (!showsNumbers(task)) noNumbers += 1;
    else if (card.lastUpdated === undefined) undated += 1;
    else if (oldestLastUpdated === null || card.lastUpdated < oldestLastUpdated) oldestLastUpdated = card.lastUpdated;

    const ledger = sevenDay(inputs.daily, names, from, through);
    const rowSpend = rows.reduce((s, r) => s + (num(r.spend7d) ?? 0), 0);
    const rowLeads = rows.reduce((s, r) => s + (num(r.leads7d) ?? 0), 0);
    const spendOk = Math.abs(ledger.spend - rowSpend) <= Math.max(0.05, rowSpend * 0.005);
    if (!spendOk || ledger.leads !== rowLeads) {
      card.skipped = `The two sources disagree: the campaign rows say $${rowSpend.toFixed(2)} for ${rowLeads} leads, the daily ledger says $${ledger.spend.toFixed(2)} for ${ledger.leads} leads from ${days}. Nothing was written to this card.`;
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
      card.notes.push(`${rows.length} campaigns share this card, so its CPL is their combined 7-day spend over combined leads, and its bookings are their sum.`);
    }

    // Columns that could not be refreshed and do not already read right: they hold Last Updated back.
    const held: string[] = [];
    const push = (fieldId: string, oldDisplay: unknown, newDisplay: unknown, value: unknown, changed: boolean) =>
      card.writes.push({ taskId, taskName: card.taskName, field: FIELD_NAME[fieldId], fieldId, old: oldDisplay ?? null, new: newDisplay, value, changed });
    const band = (fieldId: string, label: string) => {
      const id = optionId(fields, fieldId, label);
      const oldLabel = dropdownLabel(cf(fieldId));
      if (id) push(fieldId, oldLabel, label, id, oldLabel !== label);
      else {
        card.notes.push(`The ${FIELD_NAME[fieldId]} column has no "${label}" option, so it was not set.`);
        held.push(FIELD_NAME[fieldId]);
      }
    };

    // Cost per lead. The band judges the value written beside it: $75.02 for 5 leads is 15.00, At KPI.
    const cpl = ledger.leads > 0 ? ledger.spend / ledger.leads : undefined;
    if (cpl !== undefined) {
      const value = round2(cpl);
      const old = num(cf(FIELD.cpl7d)?.value);
      push(FIELD.cpl7d, old, value, value, old === undefined || round2(old) !== value);
      band(FIELD.cplStatus, kpiBand(value, CPL_GATE));
    } else {
      card.notes.push(`No leads from ${days}, so there is no CPL. The CPL columns were left as they were.`);
      if (!blank(cf(FIELD.cpl7d))) held.push(FIELD_NAME[FIELD.cpl7d]);
      if (!neutral(cf(FIELD.cplStatus))) held.push(FIELD_NAME[FIELD.cplStatus]);
    }

    // Bookings and cost per booking, per campaign, summed over the card's campaigns.
    const bookingColumnsLeft = () => {
      if (!blank(cf(FIELD.bookings7d))) held.push(FIELD_NAME[FIELD.bookings7d]);
      if (!neutral(cf(FIELD.cpbStatus))) held.push(FIELD_NAME[FIELD.cpbStatus]);
    };
    const counts = rows.map(r => num(r.bookings7d));
    const uncounted = rows.filter((_, i) => counts[i] === undefined);
    if (uncounted.length) {
      const dwy = uncounted.every(r => String(r.serviceMode ?? "").toUpperCase() === "DWY");
      card.notes.push(
        dwy
          ? "Done with you: the client books its own meetings, so bookings are not measured and the booking columns were not written."
          : `The media sync gives no 7-day booking count for ${uncounted.length === rows.length ? (rows.length === 1 ? "this campaign" : "these campaigns") : uncounted.map(r => r.campaignName).join(", ")} (a done-with-you client, no GoHighLevel connection, or a failed read), so bookings are unknown and the booking columns were not written.`,
      );
      bookingColumnsLeft();
    } else if (!inputs.bookingsReady) {
      card.notes.push("The booking ledger is not imported and verified, so the booking columns were not written.");
      held.push(FIELD_NAME[FIELD.bookings7d], FIELD_NAME[FIELD.cpbStatus]);
    } else if (!bookingLedger) {
      card.notes.push("The inputs carry no booking ledger by campaign (cockpit_clickup_writeback_inputs before 20261022z), so the booking columns were not written.");
      held.push(FIELD_NAME[FIELD.bookings7d], FIELD_NAME[FIELD.cpbStatus]);
    } else {
      const booked = counts.reduce((s: number, n) => s + (n ?? 0), 0);
      const ledgerBooked = bookedInWindow(bookingLedger, names, from, through);
      if (ledgerBooked !== booked) {
        card.notes.push(`Bookings were not written: the campaign rows say ${booked}, the booking ledger says ${ledgerBooked} from ${days}.`);
        held.push(FIELD_NAME[FIELD.bookings7d], FIELD_NAME[FIELD.cpbStatus]);
      } else {
        const oldBooked = num(cf(FIELD.bookings7d)?.value);
        push(FIELD.bookings7d, oldBooked, booked, booked, oldBooked !== booked);
        // Cost Per Booking is left as it was; a band from an earlier push is not right for these days.
        const leaveCpb = (why: string) => {
          card.notes.push(why);
          if (!neutral(cf(FIELD.cpbStatus))) {
            card.notes.push(`Cost Per Booking still shows "${dropdownLabel(cf(FIELD.cpbStatus))}" from an earlier push.`);
            held.push(FIELD_NAME[FIELD.cpbStatus]);
          }
        };
        // Judged to the cent, as the cockpit shows it: $60.004 is $60.00, within the gate.
        const spent = cents(ledger.spend);
        if (booked > 0 && ledger.spend < NO_DELIVERY_SPEND)
          leaveCpb(
            `${booked} ${booked === 1 ? "booking" : "bookings"} from ${days} on only ${money(ledger.spend)} of spend: the media sync calls that no delivery, so they came from earlier spend. Cost per booking is not judged and Cost Per Booking was left as it was.`,
          );
        else if (booked > 0) band(FIELD.cpbStatus, kpiBand(cents(ledger.spend / booked), CPB_GATE));
        else if (spent > CPB_GATE) {
          const label = kpiBand(spent, CPB_GATE);
          card.notes.push(`No booking on ${money(ledger.spend)} from ${days}, so the spend itself is the cost per booking: ${label}.`);
          band(FIELD.cpbStatus, label);
        } else leaveCpb(`No booking yet on ${money(ledger.spend)} from ${days}: too early to judge, so Cost Per Booking was left as it was.`);
      }
    }

    // Last Updated vouches for every number on the card, so it goes last and only when all of them are right.
    if (held.length) {
      card.held = `Last Updated was left as it was: ${held.join(", ")} could not be refreshed.`;
      continue;
    }
    const lastOld = card.lastUpdated;
    push(FIELD.lastUpdated, lastOld === undefined ? null : new Date(lastOld).toISOString(), new Date(now).toISOString(), now, true);
    card.stamped = true;
  }
  return { window: win, cards, oldestLastUpdated, noNumbers, undated };
}
