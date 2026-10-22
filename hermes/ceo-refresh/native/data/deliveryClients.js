import { GONE_STATUS } from "./triage.js";

/**
 * A client can own several ad accounts. Keep those accounts separate at the
 * source, then combine their counts once under the exact ClickUp identity.
 * Ratios are calculated by the adapter after this merge, never averaged.
 */
export function deliveryClientGroups(clients, spendBy = new Map(), bookBy = new Map(), countsBy = new Map(), noOutcomeBy = new Map()) {
    const groups = new Map();
    const owners = new Map();
    const add = (target, source) => {
        for (const [key, value] of Object.entries(source ?? {})) {
            if (typeof value !== "number" || !Number.isFinite(value))
                throw new Error("Client delivery contains an invalid source count.");
            target[key] = (target[key] ?? 0) + value;
        }
    };
    for (const client of clients) {
        if (!client.clientId) throw new Error("Client delivery has no account identity.");
        const key = client.clickupTaskId ? `task:${client.clickupTaskId}` : `account:${client.clientId}`;
        const owner = owners.get(client.clientId);
        if (owner && owner !== key)
            throw new Error("An ad account points to more than one client. Review its source mapping.");
        // A repeated identical join row must not double spend or appointments.
        if (owner) continue;
        owners.set(client.clientId, key);
        let group = groups.get(key);
        if (!group) {
            group = { ...client, campaigns: 0, accountIds: [], locationIds: [], spend: {}, booked: {provisional: 0, confirmed: 0},
                counts: {leads: 0, bookings: 0, provisional: 0, confirmed: 0, showed: 0, noshow: 0, closes: 0, noOutcome: 0},
                noOutcome: [], modes: new Set() };
            groups.set(key, group);
        }
        group.accountIds.push(client.clientId);
        // The board locations the card's accounts tie to, each once, so a
        // location two accounts share is never counted twice (R2, 2026-10-22).
        for (const loc of client.locationIds ?? [])
            if (!group.locationIds.includes(loc)) group.locationIds.push(loc);
        group.campaigns += client.campaigns ?? 0;
        if (client.serviceMode) group.modes.add(client.serviceMode.trim().toLowerCase());
        add(group.spend, spendBy.get(client.clientId));
        add(group.booked, bookBy.get(client.clientId));
        add(group.counts, countsBy.get(client.clientId));
        group.noOutcome.push(...(noOutcomeBy.get(client.clientId) ?? []));
    }
    return [...groups.values()].map(({modes, ...group}) => ({
        ...group,
        serviceMode: modes.size === 1 ? [...modes][0] : null,
        noOutcome: group.noOutcome.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
    }));
}

/*
 * CEO Delivery's bookings and cost per confirmed booking, paired the way the
 * Client Performance board pairs them (R2 and R10, 2026-10-22).
 *
 * Bookings are the board's stored counts per GoHighLevel location and Kuwait
 * day (triage.js boardBookingDaysSql), by the day the booking was made.
 * Spend is per client ad account and the account's reporting day
 * (triage.js mediaClientDaysSql). A client's spend on a day is "measured"
 * when the board stores a confirmed count that day for every location the
 * client ties to; only measured spend is divided by bookings, and the rest is
 * named with the reason, never divided and never read as zero bookings. A
 * window's bookings are every stored count on the locations the section's
 * clients tie to, whether or not that client spent that day: a booking often
 * comes days after the spend that bought it.
 *
 * The board's own rule is the same: spend only on days with stored bookings,
 * and "not measured" where it stores none. It lives in this file, beside the
 * client groups it pairs, so the native package's reviewed file list
 * (scripts/prepare-native-worker-package.py REQUIRED) needs no new entry.
 */

const usd = (x) => Math.round(x * 100) / 100;
/** Four places: for a per-day figure that screens add up before rounding. */
const fine = (x) => Math.round(x * 10_000) / 10_000;

/** Every Kuwait day from `from` to `to`, inclusive. */
export function daysOf(from, to) {
    const out = [];
    for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86_400_000)
        out.push(new Date(t).toISOString().slice(0, 10));
    return out;
}

/**
 * The board's stored days, keyed by location and day, and each client's
 * locations. `clients` are triage.js clients after the card fold, each with
 * `locationIds`.
 */
export function bookingLedger(triage) {
    const byLoc = new Map();
    for (const r of triage.bookingDays ?? []) {
        let days = byLoc.get(r.locationId);
        if (!days) {
            days = new Map();
            byLoc.set(r.locationId, days);
        }
        days.set(r.date, { confirmed: r.confirmed, provisional: r.provisional });
    }
    const clients = new Map(triage.clients.map(c => [c.clientId, c]));
    const tied = new Set(triage.clients.flatMap(c => c.locationIds ?? []));
    return { byLoc, clients, tied };
}

/** Whether every one of `locs` has a stored confirmed count on `date`. */
function storedOn(ledger, locs, date) {
    if (!locs.length)
        return false;
    for (const loc of locs) {
        const r = ledger.byLoc.get(loc)?.get(date);
        if (!r || r.confirmed === null)
            return false;
    }
    return true;
}

/**
 * Stored bookings on a set of locations over a window: confirmed and
 * provisional summed over the days with a stored count. `confirmed` is null
 * when no location stores any day of the window (not measured, never 0);
 * `provisionalUnread` counts stored days whose provisional count is null.
 */
export function storedBookings(ledger, locs, from, to) {
    let confirmed = 0;
    let provisional = 0;
    let stored = 0;
    let provisionalUnread = 0;
    for (const loc of new Set(locs)) {
        const days = ledger.byLoc.get(loc);
        if (!days)
            continue;
        for (const [date, r] of days) {
            if (date < from || date > to || r.confirmed === null)
                continue;
            stored += 1;
            confirmed += r.confirmed;
            if (r.provisional === null)
                provisionalUnread += 1;
            else
                provisional += r.provisional;
        }
    }
    return stored > 0
        ? { confirmed, provisional, stored, provisionalUnread }
        : { confirmed: null, provisional: null, stored: 0, provisionalUnread: 0 };
}

/** Why a client's spend on some days is not divided by bookings, in one plain sentence. */
function notMeasuredWhy(client, locs, missing, spendDays, storedAny) {
    if (!locs.length)
        return client?.clickupTaskId
            ? "No Client Performance board row is tied to this client's ad account, so its bookings are not read."
            : "This ad account is tied to no client card or board row, so its bookings are not read.";
    if (!storedAny)
        return client?.status && GONE_STATUS.test(client.status)
            ? `The card is ${client.status.toLowerCase()}: the board stores no booking days for it in these days.`
            : "The board stores no booking days for this client in these days.";
    return `Bookings are not stored for ${missing} of the ${spendDays} days it spent.`;
}

/**
 * Spend split into measured and not measured for a set of clients over a
 * window, from triage.days. Returns the measured spend and, per client with
 * spend on a day the board does not store, that spend and why.
 */
export function measuredSpend(triage, ledger, from, to, clientIds) {
    const want = clientIds ? new Set(clientIds) : null;
    let spend = 0;
    let leads = 0;
    let spendMeasured = 0;
    const per = new Map();
    for (const d of triage.days) {
        if (d.date < from || d.date > to || (want && !want.has(d.clientId)))
            continue;
        spend += d.spend;
        leads += d.leads;
        const locs = ledger.clients.get(d.clientId)?.locationIds ?? [];
        const p = per.get(d.clientId) ?? { spend: 0, spendDays: new Set(), missingDays: new Set() };
        per.set(d.clientId, p);
        if (d.spend > 0)
            p.spendDays.add(d.date);
        if (storedOn(ledger, locs, d.date))
            spendMeasured += d.spend;
        else if (d.spend > 0) {
            p.spend += d.spend;
            p.missingDays.add(d.date);
        }
    }
    const notMeasured = [];
    for (const [clientId, p] of per) {
        if (!(p.spend > 0))
            continue;
        const client = ledger.clients.get(clientId);
        const locs = client?.locationIds ?? [];
        const storedAny = storedBookings(ledger, locs, from, to).confirmed !== null;
        notMeasured.push({
            client: client?.name ?? clientId,
            spend: usd(p.spend),
            why: notMeasuredWhy(client, locs, p.missingDays.size, p.spendDays.size, storedAny),
        });
    }
    notMeasured.sort((a, b) => b.spend - a.spend || a.client.localeCompare(b.client));
    return { spend: usd(spend), leads, spendMeasured: usd(spendMeasured), notMeasured };
}

/**
 * A company window: every client's spend and leads, the board's bookings on
 * every location the clients tie to, and the cost per confirmed booking over
 * the measured spend (DeliveryWindow in src/types/ceo/payloads.ts). When no
 * tied location stores a day of the window, `confirmed`, `provisional` and
 * `bookings` are null: not measured, never zero.
 */
export function deliveryWindow(triage, ledger, from, to) {
    const s = measuredSpend(triage, ledger, from, to);
    const b = storedBookings(ledger, [...ledger.tied], from, to);
    // No tied location stores a day of the window: the counts are not
    // measured (null), never zero bookings, and there is no cost to divide.
    const confirmed = b.confirmed;
    const provisional = b.provisional;
    const bookings = confirmed === null ? null : confirmed + (provisional ?? 0);
    return {
        spend: s.spend,
        leads: s.leads,
        cpl: s.leads > 0 ? usd(s.spend / s.leads) : null,
        bookings,
        cpb: bookings !== null && bookings > 0 && s.spendMeasured > 0 ? usd(s.spendMeasured / bookings) : null,
        provisional,
        confirmed,
        spendMeasured: s.spendMeasured,
        cpbConfirmed: confirmed !== null && confirmed > 0 && s.spendMeasured > 0 ? usd(s.spendMeasured / confirmed) : null,
        notMeasured: s.notMeasured,
    };
}

/**
 * The daily series: spend and leads of every client, and per day the board's
 * confirmed and provisional bookings with the spend they pair with. A day
 * with no stored count on any tied location has confirmed, provisional and
 * spendMeasured null (not measured, never 0); `bookings` stays their sum for
 * older screens.
 */
export function deliveryDaily(triage, ledger, from, to) {
    const out = new Map(daysOf(from, to).map(date => [date, { date, spend: 0, leads: 0, bookings: 0, confirmed: null, provisional: null, spendMeasured: null }]));
    for (const loc of ledger.tied) {
        const days = ledger.byLoc.get(loc);
        if (!days)
            continue;
        for (const [date, r] of days) {
            const row = out.get(date);
            if (!row || r.confirmed === null)
                continue;
            row.confirmed = (row.confirmed ?? 0) + r.confirmed;
            row.provisional = (row.provisional ?? 0) + (r.provisional ?? 0);
            row.spendMeasured = row.spendMeasured ?? 0;
        }
    }
    for (const d of triage.days) {
        const row = out.get(d.date);
        if (!row)
            continue;
        row.spend += d.spend;
        row.leads += d.leads;
        const locs = ledger.clients.get(d.clientId)?.locationIds ?? [];
        if (storedOn(ledger, locs, d.date))
            row.spendMeasured = (row.spendMeasured ?? 0) + d.spend;
    }
    // Spend per day keeps four places, so any run of days a screen adds up
    // rounds once and lands on the same cent as the server's own window.
    return [...out.values()].map(r => ({
        date: r.date,
        spend: fine(r.spend),
        leads: r.leads,
        bookings: (r.confirmed ?? 0) + (r.provisional ?? 0),
        confirmed: r.confirmed,
        provisional: r.provisional,
        spendMeasured: r.spendMeasured === null ? null : fine(r.spendMeasured),
    }));
}

/**
 * One client's bookings over a window (a card group from deliveryClients.js:
 * its ad account ids and its board locations): stored confirmed and
 * provisional, the spend on the days the board stores, and why any spend is
 * not measured. `confirmed` null means none of it is measured.
 */
export function clientBookingWindow(triage, ledger, group, from, to) {
    const locs = group.locationIds ?? [];
    const b = storedBookings(ledger, locs, from, to);
    const s = measuredSpend(triage, ledger, from, to, group.accountIds);
    const confirmed = b.confirmed;
    const provisional = b.provisional;
    const bookings = confirmed === null ? null : confirmed + (provisional ?? 0);
    const unmeasured = s.notMeasured.reduce((n, x) => n + x.spend, 0);
    const why = s.notMeasured.length === 0
        ? null
        : confirmed === null
            ? s.notMeasured[0].why
            : `${s.notMeasured[0].why} Cost per booking covers the other days; $${unmeasured.toFixed(2)} is left out.`;
    return {
        confirmed,
        provisional,
        bookings,
        spendMeasured: s.spendMeasured,
        cpbConfirmed: confirmed !== null && confirmed > 0 && s.spendMeasured > 0 ? usd(s.spendMeasured / confirmed) : null,
        cpb: bookings !== null && bookings > 0 && s.spendMeasured > 0 ? usd(s.spendMeasured / bookings) : null,
        why,
    };
}
