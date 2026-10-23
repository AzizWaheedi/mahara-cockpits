import { OFF_STATUSES } from "../board.js";
import { CPB_BAD, CPB_GATE, CPL_GATE, NO_LEAD_MULTIPLE, SHOW_RATE_GOOD } from "../constants.js";
import { attendanceOf, BoardBookingsUnreadable, clientDelivery, GONE_STATUS, hasNoOutcome, isWon, } from "../data/triage.js";
import { bookingLedger, clientBookingWindow, deliveryClientGroups, deliveryDaily, deliveryWindow, isDoneWithYou, storedBookings, } from "../data/deliveryClients.js";
import { addDays, KUWAIT_OFFSET_MS, kuwaitDay, monthStart } from "../time.js";
// The gates come from convex/constants.ts, the one place the whole cockpit
// reads them, so the delivery colours, the client risk points and the KPI
// screens can never judge the same cost against two different numbers.
/** Days from signup to launch (DEL-16 target); an onboarding client past it is stuck. */
const LAUNCH_DAYS = 7;
/** The sync runs every 10 minutes by day and hourly overnight; 3 hours behind is stale. */
const STALE_MS = 3 * 3600_000;
/**
 * The board counts bookings at 2 and 32 past each hour (cron
 * mahara-board-facts) and again at 00:50; a newest count over 2 hours old is
 * four missed runs, so the latest days may read low.
 */
export const BOARD_STALE_MS = 2 * 3600_000;
/** A Kuwait clock time, "HH:MM", for a moment in ms. */
const kuwaitTime = (ms) => new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(11, 16);
const STATUS_ORDER = {
    bad: 0,
    watch: 1,
    good: 2,
    "no-data": 3,
};
const usd = (x) => Math.round(x * 100) / 100;
/** Whole dollars with thousands commas, without relying on Intl. */
const dollars = (x) => `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
/** Dollars to the cent with thousands commas, for a cost the note divides. */
const cents = (x) => {
    const [whole, part] = usd(x).toFixed(2).split(".");
    return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${part}`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Same folding the sync and csmSync use to match names across systems. */
const norm = (s) => String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
/** Launch task and client card names differ ("ARDON", "Arch Home - ..."): exact or a 5+ letter prefix. */
function sameClient(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (!x || !y)
        return false;
    if (x === y)
        return true;
    return (Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x)));
}
/** The launch watch's first sentence, without links or dashes, for a one-line blocker. */
function shortIssue(text) {
    const first = text.split(/\s+[—–]\s+|(?<=\.)\s/)[0] ?? "";
    const s = first
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return (/[.!?]$/.test(s) ? s : `${s}.`).slice(0, 200);
}
/** The cost per lead that makes a client bad: 50% over the gate, $22.50, the same line the sync kills a campaign on. */
const CPL_BAD = CPL_GATE * 1.5;
/** The no-lead line where a row carries none of its own: 2 x the $15 gate. */
const GATE_NO_LEAD_LINE = NO_LEAD_MULTIPLE * CPL_GATE;
/** The sentence a Done With You row's booking fields carry (decision 2, 23 Oct 2026). */
export const DWY_WHY = "Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.";
/**
 * Spend with no lead (the CEO, 23 Oct 2026, cost per booking decisions, 4):
 * "Depends on how much spend if 2x target cpl then yes bad if below that then
 * not enough data". No lead is leads known and 0; unknown leads are never "no
 * lead". At or over the row's `noLeadLine` (2 x the client's cost per lead
 * line, 2 x the $15 gate when it carries none), compared on the cent, the
 * cost per lead counts as over CPL_BAD. Above $0 and under the line it is too
 * few to judge, and never bad on leads.
 */
function leadsJudged(x) {
    const line = typeof x.noLeadLine === "number" && Number.isFinite(x.noLeadLine) ? x.noLeadLine : GATE_NO_LEAD_LINE;
    const noLead = x.leads === 0;
    const noLeadBad = noLead && usd(x.spend) >= line;
    return {
        noLeadBad,
        cplBad: noLeadBad || (x.leads > 0 && x.cpl !== null && x.cpl > CPL_BAD),
        tooFew: x.spend > 0 && noLead && !noLeadBad,
    };
}
/** Spend with no lead under the row's no-lead line: too few to judge (decision 4). */
export function tooFew(x) {
    return leadsJudged(x).tooFew;
}
/**
 * Aziz's client status rule (2026-09-21) under the golden rule (R5,
 * 2026-10-22): cost per booking is the number that matters, so a cost per
 * lead over the gate under a good cost per booking is a watch line, never off
 * track. Costs are the last 7 days, the show rate the last 30.
 *
 * For a client we book for:
 * - cost per confirmed booking known and within CPB_GATE: good when cost per
 *   lead is within CPL_GATE and the show rate at least SHOW_RATE_GOOD, else
 *   watch, however high the cost per lead;
 * - known and over CPB_GATE: bad over CPB_BAD or with a cost per lead over
 *   CPL_BAD (spend with no lead at or over the no-lead line is that), else
 *   watch;
 * - no confirmed booking yet (measured): the spend so far is the cost per
 *   booking: over CPB_BAD bad, over CPB_GATE watch (bad with a bad cost per
 *   lead), up to CPB_GATE too early to judge, which reads watch (bad only with
 *   a bad cost per lead or no lead on the no-lead line);
 * - bookings not measured (`confirmed` null: the board stores none of these
 *   days): judged on cost per lead alone, bad or watch, and the row says so.
 * A low show rate alone is watch, never bad: the one show rate line for
 * clients is 60 (Aziz, 2026-09-21). no-data is nothing spent.
 *
 * `weBook` false is a Done With You client, whatever bookings GoHighLevel
 * holds for it (decision 2, 23 Oct 2026), or a client with nothing saying we
 * book for it and no booking: cost per lead is the only number judged, as the
 * sync judges DWY campaigns.
 *
 * Spend with no lead (decision 4, 23 Oct 2026) is a bad cost per lead only at
 * or over `noLeadLine` (2 x the client's cost per lead line; 2 x the $15 gate
 * when absent); under it, it is too few to judge and the booking rules alone
 * give the status.
 *
 * `confirmed` absent reads `cpbConfirmed` alone: known when it is a number,
 * no confirmed booking when it is null. `spendMeasured` is the spend on the
 * days the board stores bookings (all of `spend` when absent).
 */
export function clientStatus(x) {
    if (x.spend <= 0)
        return "no-data";
    const { cplBad } = leadsJudged(x);
    const cplGood = x.cpl !== null && x.cpl <= CPL_GATE;
    if (!x.weBook)
        return cplBad ? "bad" : cplGood ? "good" : "watch";
    if (x.confirmed === null)
        return cplBad ? "bad" : "watch";
    if (x.cpbConfirmed !== null && x.cpbConfirmed !== undefined) {
        if (x.cpbConfirmed <= CPB_GATE)
            return cplGood && x.showRate !== null && x.showRate >= SHOW_RATE_GOOD / 100
                ? "good"
                : "watch";
        return x.cpbConfirmed > CPB_BAD || cplBad ? "bad" : "watch";
    }
    const spent = x.spendMeasured ?? x.spend;
    if (spent > CPB_BAD)
        return "bad";
    return cplBad ? "bad" : "watch";
}
/**
 * Too early to judge: a client we book for with no confirmed booking yet on
 * measured spend within the booking gate and a cost per lead that is not bad
 * (clientStatus reads it as a watch). With no lead at or over the no-lead
 * line, or a cost per lead over CPL_BAD, it is off track instead, never "too
 * early".
 */
export function tooEarly(x) {
    if (!x.weBook || x.confirmed === null || x.confirmed === undefined)
        return false;
    if (x.cpbConfirmed !== null && x.cpbConfirmed !== undefined)
        return false;
    const spent = x.spendMeasured ?? x.spend;
    const { cplBad } = leadsJudged(x);
    return spent > 0 && spent <= CPB_GATE && !cplBad;
}
/** What a booking that shows would cost at the good show rate: cost per confirmed booking over 0.6. */
export function costPerShownAt60(cpbConfirmed) {
    return cpbConfirmed === null
        ? null
        : usd(cpbConfirmed / (SHOW_RATE_GOOD / 100));
}
/** A fraction to three places, or null when the denominator is zero. */
const share = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 1000 : null;
/** A client's rates over one window, from its counts. */
export function deliveryRates(c) {
    return {
        ...c,
        bookRate: share(c.bookings, c.leads),
        bookRateConfirmed: share(c.confirmed, c.leads),
        bookRateProvisional: share(c.provisional, c.leads),
        showRate: share(c.showed, c.showed + c.noshow),
        closeRate: share(c.closes, c.showed),
    };
}
/**
 * Client delivery: Meta spend and leads from the on-board campaign grain, GHL
 * bookings, campaign verdicts and board status, off-board spend, blocked ad
 * accounts and launches. All from the media buyer native cockpit tables the sync
 * rebuilds, read in one bounded internal query.
 */
export const delivery = {
    key: "delivery",
    label: "Client delivery",
    compute: async (ctx) => {
        const data = await ctx.repository.delivery();
        const now = Date.now();
        const today = data?.today ?? kuwaitDay(now);
        const yesterday = addDays(today, -1);
        // Creative Triage is the source of truth for what a client was delivered
        // (see ../data/triage.ts). It is read for the whole 180-day series plus the
        // previous week, which is every window this section shows.
        // The rates the table shows cover the last 30 full days; the past
        // appointments with their Mahara OS outcomes are read for that window.
        const from30 = addDays(today, -30);
        let triage = null;
        let triageError = null;
        try {
            triage = await clientDelivery(addDays(today, -180), today, from30);
        }
        catch (e) {
            // Bookings the board could not give are a failed source: the section
            // keeps its last good payload rather than show them as zero or count
            // them by another rule (R2, 2026-10-22).
            if (e instanceof BoardBookingsUnreadable)
                throw e;
            triageError = String(e instanceof Error ? e.message : e).slice(0, 200);
        }
        const ledger = triage ? bookingLedger(triage) : null;
        // How current the board's counts are. A stale count, or yesterday's
        // count taken before yesterday ended, still publishes (it is what the
        // board stores), but the notes say so and the source is not ok.
        const bookingsFresh = (() => {
            if (!triage)
                return null;
            const at = triage.bookingsFreshAt ?? 0;
            const yAt = triage.bookingsDayFreshAt?.[yesterday] ?? 0;
            const todayStart = Date.parse(`${today}T00:00:00Z`) - KUWAIT_OFFSET_MS;
            const problems = [];
            if (!(at > 0) || now - at > BOARD_STALE_MS)
                problems.push(at > 0
                    ? `The Client Performance board last counted bookings ${Math.round((now - at) / 3600_000)} hours ago (${kuwaitDay(at)} ${kuwaitTime(at)} Kuwait); it counts every 30 minutes, so the latest days' bookings may read low until it runs again.`
                    : "The Client Performance board's booking counts carry no time they were computed, so how current they are is not known.");
            if (!(yAt > 0))
                problems.push(`The Client Performance board stores no booking count for yesterday (${yesterday}), so yesterday's bookings read n/a, not zero.`);
            else if (yAt < todayStart)
                problems.push(`Yesterday's bookings (${yesterday}) were last counted at ${kuwaitTime(yAt)} that day, before it ended, so yesterday may read low until the board counts it again.`);
            return { ok: problems.length === 0, problems };
        })();
        const campaigns = data?.campaigns ?? [];
        // Nothing on the board usually means the sync is mid-rewrite; keep the
        // last good payload instead of showing an empty section.
        if (campaigns.length === 0)
            throw new Error("No on-board campaigns in the media buyer tables (the sync may be rewriting them)");
        const notes = [];
        const warn = (text) => notes.push({ level: "warn", text });
        const info = (text) => notes.push({ level: "info", text });
        for (const text of bookingsFresh?.problems ?? [])
            warn(text);
        const last7From = addDays(today, -7);
        if (triage) {
            const fill = triage.days
                .filter(d => d.source === "frozen" && d.date >= last7From && d.date <= yesterday)
                .reduce((n, d) => n + d.spend, 0);
            info(`Spend and leads come from the media buyer's Meta sync in Creative Triage (cockpit_media_daily_stats), already in USD, for every campaign in it that ties to a client ad account through cockpit_campaigns, cards taken off the board included. Ad-days the media sync does not hold (campaigns with no card, or taken off the board) come from ads_daily_snapshots, which the Meta dashboard feed has kept current every 10 minutes from cockpit_meta_ad_days since 18 Oct, matched by Meta ad id so no day counts twice and converted with the cockpit's fixed rate table${fill > 0 ? ` (${dollars(fill)} of the last 7 days)` : ""}. So spend is the whole ad account, as the Client Performance board counts it: Mahara's campaigns and any other campaign on the account, a client's own campaign before launch included, where the media buyer's screens count Mahara's campaigns only. Ads on the compromise list (cockpit_excluded_ads, outsiders' ads run on a client's account) are left out of both. A day is the ad account's reporting day. Bookings are the Client Performance board's, by the Kuwait day the booking was made. Gates are Aziz's (2026-09-16): cost per lead $${CPL_GATE}, cost per booking $${CPB_GATE}.`);
        }
        else
            info(`Spend and leads are Meta only, for campaigns on the Ads Management board, in USD after a fixed exchange table. A day is the ad account's reporting day. Gates are Aziz's (2026-09-16): cost per lead $${CPL_GATE}, cost per booking $${CPB_GATE}.`);
        info(`Client status is Aziz's rule (2026-09-21) under the golden rule (2026-10-22): cost per booking decides. For a client we book for, a cost per confirmed booking within $${CPB_GATE} is on track with a cost per lead within $${CPL_GATE} and a show rate of at least ${SHOW_RATE_GOOD}%, and a watch otherwise, however high the cost per lead. Over $${CPB_GATE} it is a watch, and off track over $${CPB_BAD} or with a cost per lead over $${CPL_BAD.toFixed(2)} (spend with no lead at or over the no-lead line counts as that). With no confirmed booking yet, the spend so far counts as the cost per booking: over $${CPB_BAD} is off track, $${CPB_GATE} to $${CPB_BAD} a watch (off track with a cost per lead over $${CPL_BAD.toFixed(2)}), and up to $${CPB_GATE} too early to judge, shown as a watch (off track only with a cost per lead over $${CPL_BAD.toFixed(2)} or no lead on the no-lead line). Spend with no lead (Aziz, 23 Oct 2026) is off track once it reaches ${NO_LEAD_MULTIPLE} x the client's cost per lead line on the Client Performance board, $${GATE_NO_LEAD_LINE} (${NO_LEAD_MULTIPLE} x the $${CPL_GATE} gate) where the board holds no line for the client; under that it is too few to judge, never off track on leads, and the row says so. A client whose bookings the board does not store is judged on cost per lead alone, and its row says so. There is one show rate line for clients, ${SHOW_RATE_GOOD}%; under it is a watch, never off track. Costs are the last 7 days, the show rate the last 30. Beside each status is what a booking that shows would cost at a ${SHOW_RATE_GOOD}% show rate: cost per confirmed booking over 0.${SHOW_RATE_GOOD}. A Done With You client (Aziz, 23 Oct 2026) is judged on cost per lead alone, whatever bookings GoHighLevel holds for it: it books its own meetings, so its cost per booking and booking rate are not judged, and its spend is left out of every company cost per booking.`);
        if (triage && triage.cplTargets && triage.cplTargets.ok === false)
            warn(`The clients' cost per lead lines (cockpit_board_targets) could not be read this run, so spend with no lead is judged against $${GATE_NO_LEAD_LINE} (${NO_LEAD_MULTIPLE} x the $${CPL_GATE} gate) for every client (${triage.cplTargets.error ?? "no reason given"}).`);
        if (triageError)
            warn(`The Creative Triage database could not be read this run, so these numbers fall back to the Ads Management board, which counts only campaigns carrying a card and undercounts both spend and bookings, and no cost per confirmed booking is shown (${triageError}).`);
        const grain = data.daily ?? [];
        const booked = data.bookings ?? [];
        const tracked = new Set(campaigns.filter(c => c.bookingsTracked).map(c => c.campaignName));
        // campaigns.spend7d and bookings7d cover the 7 days up to the day the sync
        // ran, including that day, so compare the rows over the same days: after
        // Kuwait midnight today's window has already moved on.
        const syncAt = Math.max(0, ...campaigns.map(c => Number(c.syncedAt ?? 0)));
        const syncWeekFrom = addDays(kuwaitDay(syncAt || now), -7);
        // The daily grain and the sync's own 7-day totals come from the same pull.
        // The sync clears the grain before it writes it back in chunks, so rows
        // far short of the totals mean a rewrite in flight or a failed write:
        // keep the last good payload rather than show missing spend as zero.
        const syncTotal = campaigns.reduce((s, c) => s + c.spend7d, 0);
        // Like for like: the totals are the board campaigns', and the grain
        // also keeps the rows of campaigns since taken off the board.
        const boardNames = new Set(campaigns.map(c => c.campaignName));
        let grainTotal = 0;
        for (const d of grain)
            if (d.date >= syncWeekFrom && boardNames.has(d.campaignName))
                grainTotal += d.spend;
        if (syncTotal >= 50 && grainTotal < syncTotal * 0.5)
            throw new Error(`Daily ad rows add up to ${dollars(grainTotal)} for the sync's last 7 days against ${dollars(syncTotal)} in the campaign totals (the sync may be rewriting them)`);
        /** Per campaign spend, leads and bookings over an inclusive day range. */
        const byCampaign = (from, to) => {
            const out = new Map();
            const row = (name) => {
                const r = out.get(name) ?? { spend: 0, leads: 0, bookings: 0 };
                out.set(name, r);
                return r;
            };
            for (const d of grain)
                if (d.date >= from && d.date <= to) {
                    const r = row(d.campaignName);
                    r.spend += d.spend;
                    r.leads += d.leads;
                }
            for (const b of booked)
                if (b.date >= from && b.date <= to)
                    row(b.campaignName).bookings += b.count;
            return out;
        };
        /**
         * Totals over an inclusive day range from Creative Triage and the
         * board (../data/deliveryBookings.js), or null when it could not be
         * read. Bookings are the board's, by the day they were made; cost per
         * confirmed booking divides only the spend on days the board stores.
         */
        const triageWindow = (from, to) => triage && ledger ? deliveryWindow(triage, ledger, from, to) : null;
        /**
         * The fallback when Creative Triage could not be read: the media
         * buyer's own rows. Its bookings are the sync's booking events, a
         * different rule, so no confirmed count or cost per confirmed booking
         * is given: the screens say why.
         */
        const boardWindow = (from, to) => {
            let spend = 0;
            let leads = 0;
            let bookings = 0;
            let trackedSpend = 0;
            for (const [name, r] of byCampaign(from, to)) {
                spend += r.spend;
                leads += r.leads;
                bookings += r.bookings;
                if (tracked.has(name))
                    trackedSpend += r.spend;
            }
            return {
                spend: usd(spend),
                leads,
                cpl: leads > 0 ? usd(spend / leads) : null,
                bookings,
                // Bookings exist only for campaigns whose GHL is read, so only their
                // spend is divided.
                cpb: bookings > 0 && trackedSpend > 0
                    ? usd(trackedSpend / bookings)
                    : null,
            };
        };
        const windowOf = (from, to) => triageWindow(from, to) ?? boardWindow(from, to);
        // Full Kuwait days ending yesterday; the month to date includes today
        // so far, as every CEO tab's month does (the screens say "today so
        // far"; the board and the timeframe card pair days up to yesterday).
        const prevFrom = addDays(today, -14);
        const prevTo = addDays(today, -8);
        const seriesFrom = addDays(today, -180);
        let dailySeries;
        if (triage && ledger)
            dailySeries = deliveryDaily(triage, ledger, seriesFrom, yesterday);
        else {
            const byDay = new Map();
            const at = (date) => {
                const r = byDay.get(date) ?? { spend: 0, leads: 0, bookings: 0 };
                byDay.set(date, r);
                return r;
            };
            for (const d of grain) {
                const r = at(d.date);
                r.spend += d.spend;
                r.leads += d.leads;
            }
            for (const b of booked)
                at(b.date).bookings += b.count;
            dailySeries = [];
            for (let date = seriesFrom; date <= yesterday; date = addDays(date, 1)) {
                const r = byDay.get(date);
                dailySeries.push({
                    date,
                    spend: usd(r?.spend ?? 0),
                    leads: r?.leads ?? 0,
                    bookings: r?.bookings ?? 0,
                });
            }
        }
        // --- Triage against the board: say it, never hide it -------------------
        if (triage && ledger) {
            const mine = triageWindow(last7From, yesterday);
            const board = boardWindow(last7From, yesterday);
            if (mine) {
                const gap = usd(mine.spend - board.spend);
                // The sync's booking events carry no provisional booking, so
                // they are set against the board's confirmed count alone.
                const bookGap = mine.confirmed === null ? 0 : mine.confirmed - board.bookings;
                // Spend and leads come from one table on both sides
                // (R2, 2026-10-11), so a spend gap can only be campaigns that tie
                // to no client ad account; bookings come from two places: the
                // media sync ties a booking to an ad campaign, the board holds
                // every booking on the client's calendars.
                if (Math.abs(gap) >= 50 || Math.abs(bookGap) >= 3)
                    info(`Cross-check, last 7 days: the media sync's own rows add up to ${dollars(board.spend)} and ${plural(board.bookings, "booking")} it tied to an ad campaign; the Client Performance board holds ${mine.confirmed === null ? "no stored count" : plural(mine.confirmed, "confirmed booking")} made on the same days. ${Math.abs(gap) >= 1
                        ? `Spend tied to a client ad account is ${dollars(mine.spend)}: the ${dollars(Math.abs(gap))} gap is campaigns that tie to no client ad account (named below).`
                        : "Spend is the same table on both sides, so it matches."} The figures above use the board, which also holds bookings the sync could not tie to a campaign.`);
                // The spend the cost per confirmed booking leaves out, named:
                // spend whose bookings the board does not store, and Done With
                // You clients' spend (decision 2, 23 Oct 2026). "Over all" adds
                // back only the first: done-with-you spend is never divided.
                const dwyOut = mine.doneWithYou ?? [];
                if ((mine.notMeasured.length || dwyOut.length) && mine.confirmed !== null) {
                    const left = mine.notMeasured.reduce((n, x) => n + x.spend, 0);
                    const dwyLeft = dwyOut.reduce((n, x) => n + x.spend, 0);
                    const parts = [];
                    if (mine.notMeasured.length)
                        parts.push(`${cents(left)} of spend whose bookings the board does not store: ${mine.notMeasured.slice(0, 6).map(x => `${x.client} ${cents(x.spend)} (${x.why.replace(/\.$/, "")})`).join("; ")}${mine.notMeasured.length > 6 ? `; and ${mine.notMeasured.length - 6} more` : ""}`);
                    if (dwyOut.length)
                        parts.push(`${cents(dwyLeft)} of done-with-you spend: ${dwyOut.map(x => `${x.client} ${cents(x.spend)}`).join("; ")} (${dwyOut.length === 1 ? "the client books its own meetings" : "these clients book their own meetings"}, so ${dwyOut.length === 1 ? "its" : "their"} spend and stored bookings are out of the cost per booking)`);
                    const counted = mine.spendMeasured + left;
                    warn(`Cost per confirmed booking for the last 7 days divides ${cents(mine.spendMeasured)} by ${plural(mine.confirmed, "confirmed booking")} and leaves out ${parts.join("; and ")}.${mine.notMeasured.length ? ` Over all ${cents(counted)} of spend${dwyOut.length ? ", done-with-you spend still left out," : ""} it would read ${mine.confirmed > 0 ? cents(counted / mine.confirmed) : "n/a"}.` : ""}`);
                }
            }
            info(`This month runs from the 1st to today so far, as every CEO tab's month does, so it adds today's spend and bookings as they come in; the last 7 days, yesterday, the Client Performance board and the timeframe card stop at yesterday.`);
            info(`Bookings are the Client Performance board's counts (cockpit_client_days), by the Kuwait day the booking was made, never the day of the meeting. Confirmed is main and online calendar bookings, leaving out cancelled, invalid, Google Calendar copies, the call centre's call-back bookings and rescheduled bookings whose original still counts; provisional is the Not Confirmed Appointments calendar; the total is both. A client ties to the board through its Meta ad account (cockpit_board_clients), else through GoHighLevel. Cost per confirmed booking divides the spend on the days the board stores a count by the confirmed bookings: spend on days it does not store is named, never divided, and a client with none stored reads "not measured", never zero bookings. Done With You clients are left out of it (Aziz, 23 Oct 2026): they book their own meetings, so their spend leaves the spend divided and their stored bookings leave the count, each window names that spend, and their spend and leads stay in cost per lead. Show and close rates use the day of the meeting, because they need the meeting to have happened.`);
            {
                const p = storedBookings(ledger, [...ledger.tied], last7From, yesterday);
                if (p.provisionalUnread > 0)
                    info(`Provisional bookings are not stored for ${plural(p.provisionalUnread, "client day")} in the last 7 days (the dialer has no appointment sync for those clients), so the provisional count may read low there; confirmed is not affected.`);
            }
            if (triage.sharedAccounts.length)
                info(`${plural(triage.sharedAccounts.length, "ad account")} ${triage.sharedAccounts.length === 1 ? "is" : "are"} listed on two Client Performance board rows and ${triage.sharedAccounts.length === 1 ? "counts" : "count"} once, under the first: ${triage.sharedAccounts.map(a => `${a.account} (${a.client})`).join(", ")}.`);
            {
                const recent = triage.untied.filter(u => u.date >= from30 && u.date <= today);
                const rows = recent.reduce((n, u) => n + u.count, 0);
                if (rows > 0) {
                    const byClient = new Map();
                    for (const u of recent)
                        byClient.set(u.client, (byClient.get(u.client) ?? 0) + u.count);
                    warn(`${plural(rows, "booking")} in the last 30 days ${rows === 1 ? "is" : "are"} on the Client Performance board for clients with no ad spend tied here (no ad account linked, or none that spent in 180 days), so ${rows === 1 ? "it is" : "they are"} in no figure above: ${[
                        ...byClient.entries(),
                    ]
                        .sort((a, b) => b[1] - a[1])
                        .map(([c, n]) => `${c} (${n})`)
                        .join(", ")}.`);
                }
            }
            // Spend on a client we have already lost is money leaving for nothing,
            // and it is the kind of thing a total hides. The headline above still
            // counts every client account, because which clients belong in "what we
            // delivered" is Aziz's definition to set, not this adapter's: both
            // figures are given so either can be read. A lost client is not in the
            // clients table: it is not a live client to judge.
            {
                const gone = new Set(triage.clients
                    .filter(c => GONE_STATUS.test(c.status ?? ""))
                    .map(c => c.clientId));
                if (gone.size) {
                    const from = monthStart(today);
                    let lost = 0;
                    let leads = 0;
                    // Only the lost clients whose accounts spent this month are named.
                    const spentMonth = new Set();
                    for (const d of triage.days)
                        if (gone.has(d.clientId) && d.date >= from && d.date <= today) {
                            lost += d.spend;
                            leads += d.leads;
                            if (d.spend > 0)
                                spentMonth.add(d.clientId);
                        }
                    const month = windowOf(from, today);
                    const goneClients = deliveryClientGroups(triage.clients.filter(c => spentMonth.has(c.clientId)));
                    if (usd(lost) > 0)
                        warn(`${dollars(lost)} of this month's spend is on ${plural(goneClients.length, "lost client")} (cancelled, stopped or churned), and it brought in ${plural(leads, "lead")}: ${goneClients
                            .map(c => `${c.name} (${String(c.status ?? "").toLowerCase()})`)
                            .join(", ")}. That money is inside the totals above, and ${goneClients.length === 1 ? "this client is" : "these clients are"} not in the clients table. Without ${goneClients.length === 1 ? "it" : "them"} the month reads ${dollars(month.spend - lost)} and ${plural(month.leads - leads, "lead")}.`);
                }
            }
            if (triage.media.untied.length) {
                const lost = triage.media.untied.reduce((n, u) => n + u.spend, 0);
                warn(`${plural(triage.media.untied.length, "campaign")} in the media sync with ${dollars(lost)} of spend in the last 180 days ${triage.media.untied.length === 1 ? "ties" : "tie"} to no client ad account, so ${triage.media.untied.length === 1 ? "it is" : "they are"} in no figure here: ${triage.media.untied.slice(0, 5).map(u => `${u.campaign} (${dollars(u.spend)}, ${u.firstDay} to ${u.lastDay})`).join(", ")}${triage.media.untied.length > 5 ? ` and ${triage.media.untied.length - 5} more` : ""}.`);
            }
            if (triage.unmapped.length)
                warn(`${plural(triage.unmapped.length, "ad account")} spending in this window ${triage.unmapped.length === 1 ? "is" : "are"} tied to no client card, so ${triage.unmapped.length === 1 ? "its" : "their"} spend is in the totals but has no client row: ${triage.unmapped.slice(0, 5).join(", ")}${triage.unmapped.length > 5 ? ` and ${triage.unmapped.length - 5} more` : ""}.`);
            if (triage.unknownCurrencies.length)
                warn(`Spend in ${triage.unknownCurrencies.join(", ")} is left out entirely: the cockpit has no exchange rate for ${triage.unknownCurrencies.length === 1 ? "it" : "them"}, and counting it at one to one would be wrong rather than approximate.`);
            const noMode = deliveryClientGroups(triage.clients).filter(c => c.clickupTaskId && !c.serviceMode);
            if (noMode.length)
                info(`${plural(noMode.length, "client")} ${noMode.length === 1 ? "has" : "have"} a blank Service Mode, so nothing here knows whether we book their appointments or they do: ${noMode
                    .map(c => c.name)
                    .slice(0, 4)
                    .join(", ")}.`);
        }
        // --- Client cards: ClickUp task id by client name --------------------
        const cards = data.clients ?? [];
        if (data.clientsError)
            warn("Client cards could not be read, so client rows carry no ClickUp id and launches are empty.");
        const cardByName = new Map();
        for (const c of cards)
            cardByName.set(norm(c.name), c);
        const cardOf = (c) => cardByName.get(norm(c.clientName ?? c.accountName));
        // --- Campaigns: running on Meta, verdicts, board off, off board -------
        const offOnBoard = new Set(OFF_STATUSES.map(s => s.toLowerCase()));
        const activeOnMeta = new Map((data.tree ?? []).map(t => [t.campaignName, t.active]));
        if (data.treeError)
            warn("The Meta ad tree could not be read, so running means spend on the last reported day.");
        // Same rule as Ads management: Meta's ad and ad set statuses when the
        // tree has the campaign, else spend on the last day or the day before.
        const runningOnMeta = (c) => activeOnMeta.has(c.campaignName)
            ? Boolean(activeOnMeta.get(c.campaignName))
            : c.spendToday > 0 && String(c.dataThrough ?? "") >= yesterday;
        const running = campaigns.filter(runningOnMeta);
        const verdicts = {};
        for (const c of running)
            verdicts[c.verdict] = (verdicts[c.verdict] ?? 0) + 1;
        const boardOffButRunning = running.filter(c => offOnBoard.has(String(c.boardAdStatus ?? "").toLowerCase())).length;
        const offBoard = (data.offBoard ?? []).filter((o) => o.spend7d > 0);
        if (data.offBoardError)
            warn("Campaigns spending with no board card could not be read.");
        else if (offBoard.length > 0) {
            const spend = offBoard.reduce((s, o) => s + o.spend7d, 0);
            // With Creative Triage read, a campaign with no card still counts
            // through the snapshot table when its ad account ties to a client.
            if (triage)
                info(`${dollars(spend)} was spent in the last 7 days on ${plural(offBoard.length, "campaign")} with no Ads Management card. Where the ad account ties to a client it is in these numbers (from ads_daily_snapshots); the media buyer's campaign verdicts do not cover ${offBoard.length === 1 ? "it" : "them"}.`);
            else
                warn(`${dollars(spend)} spent in the last 7 days on ${plural(offBoard.length, "campaign")} with no Ads Management card is not in these numbers.`);
        }
        // --- Clients with spend in the last 7 days ----------------------------
        const last7ByCampaign = byCampaign(last7From, yesterday);
        const groups = new Map();
        for (const c of campaigns) {
            const r = last7ByCampaign.get(c.campaignName);
            if (!r || r.spend <= 0)
                continue;
            const card = cardOf(c);
            const key = card
                ? `task:${card.taskId}`
                : `name:${norm(c.clientName ?? c.accountName)}`;
            const g = groups.get(key) ?? {
                client: card?.name ?? c.clientName ?? c.accountName,
                clickupTaskId: card?.taskId ?? null,
                spend: 0,
                leads: 0,
                bookings: 0,
                trackedSpend: 0,
                tracked: false,
                campaigns: 0,
            };
            g.spend += r.spend;
            g.leads += r.leads;
            g.bookings += r.bookings;
            g.campaigns += 1;
            if (tracked.has(c.campaignName)) {
                g.tracked = true;
                g.trackedSpend += r.spend;
            }
            groups.set(key, g);
        }
        // Triage knows every client with spend, not only those on the board, and
        // ties an ad account to a ClickUp card through the Client Performance
        // board's ad accounts (cockpit_board_clients), else through
        // ghl_client_ad_accounts, which is a firmer join than matching typed
        // names. A client whose card is cancelled or stopped is not a live
        // client to judge: its spend is named in the note above instead.
        const triageClients = triage && ledger
            ? (() => {
                const spendBy = new Map();
                for (const d of triage.days)
                    if (d.date >= last7From && d.date <= yesterday) {
                        const r = spendBy.get(d.clientId) ?? { spend: 0, leads: 0 };
                        r.spend += d.spend;
                        r.leads += d.leads;
                        spendBy.set(d.clientId, r);
                    }
                const countsBy = new Map();
                const countsOf = (id) => {
                    let r = countsBy.get(id);
                    if (!r) {
                        r = {
                            leads: 0,
                            bookings: 0,
                            provisional: 0,
                            confirmed: 0,
                            showed: 0,
                            noshow: 0,
                            closes: 0,
                            noOutcome: 0,
                        };
                        countsBy.set(id, r);
                    }
                    return r;
                };
                for (const d of triage.days)
                    if (d.date >= from30 && d.date <= yesterday)
                        countsOf(d.clientId).leads += d.leads;
                const noOutcomeBy = new Map();
                for (const a of triage.appointments) {
                    if (a.date < from30 || a.date > yesterday)
                        continue;
                    const r = countsOf(a.clientId);
                    const att = attendanceOf(a);
                    if (att === "showed")
                        r.showed += 1;
                    else if (att === "noshow")
                        r.noshow += 1;
                    if (isWon(a))
                        r.closes += 1;
                    if (hasNoOutcome(a)) {
                        r.noOutcome += 1;
                        const list = noOutcomeBy.get(a.clientId) ?? [];
                        // The read is newest first; the screen shows at most 20.
                        if (list.length < 20)
                            list.push({ at: a.at, calendar: a.calendar, status: a.status });
                        noOutcomeBy.set(a.clientId, list);
                    }
                }
                return deliveryClientGroups(triage.clients, spendBy, new Map(), countsBy, noOutcomeBy)
                    .map(c => {
                    const r = c.spend;
                    if (!(usd(r.spend ?? 0) > 0))
                        return null;
                    if (GONE_STATUS.test(c.status ?? ""))
                        return null;
                    // The board's bookings on the card's locations, by the day
                    // they were made; null when it stores none of these days.
                    const w7 = clientBookingWindow(triage, ledger, c, last7From, yesterday);
                    const w30 = clientBookingWindow(triage, ledger, c, from30, yesterday);
                    const counts = {
                        ...c.counts,
                        confirmed: w30.confirmed ?? 0,
                        provisional: w30.provisional ?? 0,
                        bookings: w30.bookings ?? 0,
                    };
                    const rates = deliveryRates(counts);
                    // Done With You (decision 2, 23 Oct 2026): the client books
                    // its own meetings, so its cost per booking and booking rate
                    // are never judged, whatever GoHighLevel holds for it.
                    const isDwy = isDoneWithYou(c.serviceMode);
                    // Lead to booking needs the bookings: not measured is n/a, never 0%.
                    const rates30 = w30.confirmed === null || isDwy
                        ? { ...rates, bookRate: null, bookRateConfirmed: null, bookRateProvisional: null }
                        : rates;
                    const cpl = r.leads > 0 ? usd(r.spend / r.leads) : null;
                    // Cost per lead is the only number we own for a Done With You
                    // client. A client we do book for is judged on all three, even
                    // in a week that produced nothing.
                    const weBook = !isDwy && ((w7.bookings ?? 0) > 0 || /dfy|done for/i.test(c.serviceMode ?? ""));
                    // The client's own cost per lead line, as the board reads it
                    // (its card's line, else the board default, else the gate):
                    // spend with no lead is bad at NO_LEAD_MULTIPLE x it (decision 4).
                    const targets = triage.cplTargets;
                    const cplLine = (c.clickupTaskId ? targets?.byCard?.[c.clickupTaskId] : undefined) ?? targets?.defaults ?? CPL_GATE;
                    const noLeadLine = NO_LEAD_MULTIPLE * cplLine;
                    const judged = {
                        spend: usd(r.spend),
                        leads: r.leads,
                        cpl,
                        confirmed: w7.confirmed,
                        cpbConfirmed: w7.cpbConfirmed,
                        spendMeasured: w7.spendMeasured,
                        showRate: rates30.showRate,
                        weBook,
                        noLeadLine,
                    };
                    return {
                        client: c.name,
                        clickupTaskId: c.clickupTaskId,
                        spend7d: usd(r.spend),
                        leads7d: r.leads,
                        cpl7d: cpl,
                        bookings7d: isDwy ? null : w7.bookings,
                        cpb7d: isDwy ? null : w7.cpb,
                        campaigns: c.campaigns,
                        status: clientStatus(judged),
                        tooEarly: tooEarly(judged),
                        // No lead yet on spend under the row's no-lead line: too
                        // few to judge, a watch at worst (decision 4).
                        tooFew: tooFew(judged),
                        noLeadLine,
                        // Judged on cost per lead alone, and why: a Done With
                        // You client with no booking books its own meetings; a
                        // client with no card or a blank Service Mode and no
                        // booking has nothing saying we book for it; a client
                        // we book for whose days the board stores none of is
                        // not measured (a watch at best).
                        cplOnly: isDwy
                            ? "dwy"
                            : weBook
                                ? (w7.confirmed === null ? "not measured" : null)
                                : c.serviceMode ? "dwy" : "no service mode",
                        provisional7d: isDwy ? null : w7.provisional,
                        confirmed7d: isDwy ? null : w7.confirmed,
                        spendMeasured7d: w7.spendMeasured,
                        cpbConfirmed7d: isDwy ? null : w7.cpbConfirmed,
                        // Why some or all of the spend has no bookings to
                        // divide by (not measured), in one plain sentence; for a
                        // Done With You client, why none is judged.
                        bookingsWhy: isDwy ? DWY_WHY : w7.why,
                        costPerShownAt60: isDwy ? null : costPerShownAt60(w7.cpbConfirmed),
                        rates30,
                        noOutcome: c.noOutcome,
                    };
                })
                    .filter((x) => x !== null)
                    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
                    b.spend7d - a.spend7d);
            })()
            : null;
        const boardClients = [...groups.values()]
            .map(g => {
            const cpl = g.leads > 0 ? usd(g.spend / g.leads) : null;
            const cpb = g.bookings > 0 && g.trackedSpend > 0
                ? usd(g.trackedSpend / g.bookings)
                : null;
            // The board fallback has no calendar split and no show rate: the
            // status is judged on cost per lead and cost per booking alone.
            const judged = {
                spend: g.spend,
                leads: g.leads,
                cpl,
                // The sync's booking events, read only where its GHL is;
                // anywhere else bookings are not measured.
                confirmed: g.tracked ? g.bookings : null,
                cpbConfirmed: cpb,
                showRate: null,
                weBook: g.tracked,
                noLeadLine: GATE_NO_LEAD_LINE,
            };
            return {
                client: g.client,
                clickupTaskId: g.clickupTaskId,
                spend7d: usd(g.spend),
                leads7d: g.leads,
                cpl7d: cpl,
                bookings7d: g.bookings,
                cpb7d: cpb,
                campaigns: g.campaigns,
                status: clientStatus(judged),
                tooFew: tooFew(judged),
                noLeadLine: GATE_NO_LEAD_LINE,
                cplOnly: g.tracked ? null : "not measured",
                rates30: null,
            };
        })
            .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            b.spend7d - a.spend7d);
        const clients = triageClients ?? boardClients;
        // Company-wide, the same 30 full days as the rates: how much of the past
        // appointment book has an outcome in Mahara OS, and the close rate's
        // second source, the clients' own CRM.
        let outcomes;
        if (triage) {
            const past = triage.appointments.filter(a => a.date >= from30 && a.date <= yesterday);
            const withOutcome = past.filter(a => a.outcome !== null).length;
            const won = past.filter(isWon).length;
            const sheetOnly = past.filter(a => a.outcome === null && a.attended !== null).length;
            const noOutcome = past.filter(hasNoOutcome).length;
            const shown = past.filter(a => attendanceOf(a) === "showed").length;
            const crmWins30 = triage.wins
                .filter(w => w.date >= from30 && w.date <= yesterday)
                .reduce((n, w) => n + w.count, 0);
            outcomes = {
                pastAppointments: past.length,
                withOutcome,
                won,
                since: triage.outcomes.since,
            };
            info(`The rates cover the last 30 full days. Lead to booking is the board's confirmed bookings, by the day they were made, over platform leads, the main one; lead to provisional and lead to any booking sit beside it, and a client whose bookings the board does not store reads n/a. Show rate is showed over showed plus no-show on meetings whose time has passed, by the day of the meeting: showed is the CRM status, else the attendance sheet's mark, else Mahara OS's attendance. Close rate is deals the client marked won in Mahara OS over shown appointments (${won} won over ${shown} shown across every client). Mahara OS outcomes start on ${triage.outcomes.since ?? "2026-09-18"}: ${plural(triage.outcomes.rows, "outcome row")} so far, ${triage.outcomes.joined} of them on an appointment in this database, and ${withOutcome} of the ${plural(past.length, "past appointment")} in the window have one, so the close rate reads low until clients report. ${plural(noOutcome, "past appointment")} ${noOutcome === 1 ? "has" : "have"} no outcome at all: an appointment still marked confirmed after its time counts as no outcome unless the attendance sheet marked it${sheetOnly ? ` (the sheet marked ${sheetOnly} that Mahara OS has not)` : ""}. The clients' own CRM marked ${plural(crmWins30, "opportunity", "opportunities")} won in the same window; that figure is not the one shown. "Running" is campaigns that spent in the last three days.`);
        }
        // --- Blocked ad accounts, one row per account --------------------------
        const accountIssues = [];
        {
            const seen = new Set();
            for (const c of campaigns) {
                if (!c.accountIssue)
                    continue;
                const key = c.metaAccountId ?? norm(c.accountName);
                if (seen.has(key))
                    continue;
                seen.add(key);
                accountIssues.push({
                    client: cardOf(c)?.name ?? c.clientName ?? c.accountName,
                    issue: String(c.accountIssue),
                });
            }
        }
        // --- Launches ------------------------------------------------------------
        // In flight: client cards still in an onboarding stage. Stuck: past the
        // launch target, with what blocks them from the launch watch, else the
        // state of their open launch task.
        const tasks = data.launches?.tasks ?? [];
        const watch = data.launches?.watch ?? [];
        if (data.launchError)
            warn("Launch tasks and the launch watch could not be read, so blockers are missing.");
        const onboarding = cards.filter(c => c.onboarding);
        const stuck = [];
        let ageUnknown = 0;
        for (const c of onboarding) {
            if (c.signupDays === null || c.signupDays === undefined) {
                ageUnknown += 1;
                continue;
            }
            if (c.signupDays <= LAUNCH_DAYS)
                continue;
            const issue = watch.find(w => sameClient(w.client, c.name))?.issues?.[0];
            const task = tasks.find(t => sameClient(t.client, c.name));
            const blocker = issue
                ? shortIssue(String(issue))
                : data.launchError
                    ? null
                    : !task
                        ? "No open launch task found on the ads boards."
                        : task.total > 0
                            ? `Launch checklist ${task.done} of ${task.total} done.`
                            : null;
            stuck.push({ client: c.name, days: c.signupDays, blocker });
        }
        stuck.sort((a, b) => b.days - a.days);
        if (!data.clientsError)
            info(`Launch age is days since the client card was created; a launch counts as stuck after ${LAUNCH_DAYS} days.${ageUnknown ? ` ${plural(ageUnknown, "onboarding client")} ${ageUnknown === 1 ? "has" : "have"} no creation date.` : ""}`);
        const strayTasks = tasks.filter(t => !onboarding.some(c => sameClient(t.client, c.name)));
        if (strayTasks.length && !data.clientsError)
            info(`Open launch tasks on clients whose card is not in an onboarding stage: ${strayTasks.map(t => t.client).join(", ")}.`);
        // --- Trust notes ----------------------------------------------------------
        const earliestNeeded = [seriesFrom, prevFrom, monthStart(today)].sort()[0];
        // With the database read, spend per day is the media table plus the
        // snapshot table, which the Meta dashboard feed has kept current since
        // 18 Oct: the series starts at the first day either table holds. Before
        // that day the series reads no spend because there is none recorded,
        // which is said rather than left to look like zero spend.
        const firstSpendDay = triage
            ? triage.days.reduce((m, d) => (m === null || d.date < m ? d.date : m), null)
            : data.firstDate;
        if (!firstSpendDay)
            warn(triage ? "No client ad spend is recorded in the last 180 days." : "No daily ad rows in the last 40 days.");
        else if (firstSpendDay > earliestNeeded)
            (triage ? info : warn)(`Client spend per day is recorded from ${firstSpendDay}, so the days before it read no spend here: nothing was recorded, not nothing spent.`);
        if (data.lastDate && data.lastDate < yesterday)
            info(`The newest daily ad data is for ${data.lastDate}.`);
        info("A campaign taken off the board loses its last 30 days of ad rows at the next sync, so past totals can drop.");
        // A smaller gap than the one that throws above: some grain rows were lost.
        if (Math.abs(syncTotal - grainTotal) > Math.max(25, syncTotal * 0.1))
            warn(`The daily ad rows add up to ${dollars(grainTotal)} for the last 7 days, but the campaign totals say ${dollars(syncTotal)}; some daily rows are missing.`);
        if (data.grainCapped)
            warn("A campaign has more daily ad or booking rows than one read takes, so some days are cut short.");
        const untracked = [...groups.values()]
            .filter(g => !g.tracked)
            .map(g => g.client);
        if (triage) {
            // Decision 2 (the CEO, 23 Oct 2026): "No keep the CPL but ignore CPB".
            const dwy = deliveryClientGroups(triage.clients).filter(c => isDoneWithYou(c.serviceMode));
            warn(`${dwy.length
                ? `${plural(dwy.length, "Done With You client")} ${dwy.length === 1 ? "books its" : "book their"} own meetings, so ${dwy.length === 1 ? "it is" : "they are"} judged on cost per lead alone, whatever bookings GoHighLevel holds: ${dwy
                    .map(c => c.name)
                    .slice(0, 4)
                    .join(", ")}${dwy.length > 4 ? ` and ${dwy.length - 4} more` : ""}. ${dwy.length === 1 ? "Its" : "Their"} spend and leads stay in spend, leads and cost per lead; ${dwy.length === 1 ? "its" : "their"} spend and stored bookings are left out of every company cost per booking, and each window names that spend.`
                : "Every client with spend is one we book appointments for."}`);
        }
        else
            warn(`Bookings come from GHL for Done For You clients with a working GHL connection (${clients.length - untracked.length} of ${clients.length} clients with spend). The sync reads appointments up to now only, so a booking made for a later date is counted once that day comes and the latest days read low.`);
        if (!triage && untracked.length)
            info(`${plural(untracked.length, "client")} without booking data (${untracked.join(", ")}) ${untracked.length === 1 ? "is" : "are"} judged on cost per lead alone, and cost per booking leaves out their spend.`);
        const copies = booked
            .filter(b => b.date >= earliestNeeded)
            .reduce((s, b) => s + b.copies, 0);
        if (!triage && copies > 0)
            info(`${plural(copies, "repeated booking row")} left over from earlier syncs ${copies === 1 ? "was" : "were"} not counted.`);
        // campaigns.bookings7d is the client's whole GHL count; the booking rows
        // keep only bookings tied to the client's board campaigns. A booking
        // bought by an off-board ad is in the first and not the second. Only
        // the fallback counts these rows; with the board read they are no
        // figure here.
        if (!triage) {
            const perClient = new Map();
            const rowsByCampaign = byCampaign(syncWeekFrom, today);
            for (const c of campaigns) {
                if (!c.bookingsTracked)
                    continue;
                const card = cardOf(c);
                const key = card?.taskId ?? norm(c.clientName ?? c.accountName);
                const p = perClient.get(key) ?? {
                    client: card?.name ?? c.clientName ?? c.accountName,
                    ghl: 0,
                    rows: 0,
                };
                p.ghl = Math.max(p.ghl, Number(c.clientBookings7d ?? 0));
                p.rows += rowsByCampaign.get(c.campaignName)?.bookings ?? 0;
                perClient.set(key, p);
            }
            const short = [...perClient.values()].filter(p => p.ghl > p.rows);
            if (short.length) {
                const missing = short.reduce((s, p) => s + p.ghl - p.rows, 0);
                warn(`GHL shows ${plural(missing, "more booking")} in the last 7 days than the board campaigns carry (${short.map(p => p.client).join(", ")}): bookings bought by ads outside the board campaigns are not counted.`);
            }
        }
        // --- Sources ----------------------------------------------------------------
        const health = data.health ?? {};
        const metaFresh = syncAt > 0 && now - syncAt <= STALE_MS;
        if (!metaFresh)
            warn(`The media buyer sync last wrote campaign numbers ${Math.round((now - syncAt) / 3600_000)} hours ago.`);
        const clickupAt = Math.max(0, ...cards.map(c => Number(c.syncedAt ?? 0)), ...tasks.map(t => Number(t.syncedAt ?? 0)));
        const failing = (source) => health[source]?.ok === false
            ? `Failing ${plural(Number(health[source].streak ?? 1), "time")} in a row`
            : undefined;
        const sources = [
            {
                name: "Client ad spend (media daily statistics)",
                freshestAt: triage?.adsFreshAt,
                ok: !!triage,
                note: triage
                    ? `cockpit_media_daily_stats ${triage.media.firstDay} to ${triage.media.lastDay ?? "?"}, ${triage.media.rows} rows`
                    : (triageError ?? "Not read; falling back to the board"),
            },
            {
                name: "Client bookings (Client Performance board, cockpit_client_days)",
                freshestAt: triage?.bookingsFreshAt,
                ok: !!triage && bookingsFresh?.ok === true,
                note: triage
                    ? `${plural(triage.bookingDays.length, "stored client day")} from ${seriesFrom} to ${today}, by the day the booking was made${bookingsFresh?.ok === false ? `. ${bookingsFresh.problems.join(" ")}` : ""}`
                    : (triageError ?? "Not read; falling back to the media sync's booking events, with no cost per confirmed booking"),
            },
            {
                name: "Creative Triage appointments (show and close rates)",
                ok: !!triage,
                note: triage
                    ? `${plural(triage.appointments.length, "past meeting")} since ${from30}, by the day of the meeting`
                    : (triageError ?? "Not read"),
            },
            {
                name: "Mahara OS appointment outcomes",
                freshestAt: triage?.outcomes.latestAt,
                ok: !!triage,
                note: triage
                    ? triage.outcomes.rows === 0
                        ? "No outcome reported yet"
                        : undefined
                    : (triageError ?? "Not read"),
            },
            {
                name: "Meta ads (media buyer sync)",
                freshestAt: syncAt || undefined,
                ok: metaFresh && health.meta?.ok !== false,
                note: failing("meta") ?? (metaFresh ? undefined : "Sync is stale"),
            },
            {
                name: "GHL bookings",
                freshestAt: data.bookingsSyncedAt ?? undefined,
                ok: health.ghl?.ok !== false,
                note: failing("ghl"),
            },
            {
                name: "ClickUp board, launch tasks and client cards",
                freshestAt: clickupAt || undefined,
                ok: health.clickup?.ok !== false &&
                    !data.clientsError &&
                    !data.launchError,
                note: failing("clickup") ??
                    (data.clientsError || data.launchError
                        ? "Client cards or launch tasks could not be read"
                        : undefined),
            },
        ];
        // Warnings first; the sort is stable, so each level keeps its order.
        notes.sort((a, b) => Number(b.level === "warn") - Number(a.level === "warn"));
        const payload = {
            yesterday: windowOf(yesterday, yesterday),
            last7: windowOf(last7From, yesterday),
            prevLast7: windowOf(prevFrom, prevTo),
            mtd: windowOf(monthStart(today), today),
            daily: dailySeries,
            gates: { cpl: CPL_GATE, cpb: CPB_GATE },
            campaigns: {
                running: running.length,
                boardOffButRunning,
                spendingNotOnBoard: offBoard.length,
                verdicts,
            },
            clients,
            outcomes,
            // The board stores provisional bookings beside confirmed ones.
            provisionalSynced: triage ? true : undefined,
            // Where the bookings came from: the Client Performance board (by
            // the day the booking was made), or the media sync's booking events
            // when Creative Triage could not be read, which give no confirmed
            // count. Absent on payloads stored before 2026-10-22.
            bookingSource: triage ? "board" : "media sync",
            launches: { inFlight: onboarding.length, stuck },
            accountIssues,
            notes,
        };
        // Today's counts the tables overwrite every sync, so they gain a history.
        const point = (metric, value) => ({
            date: today,
            metric: `delivery.${metric}`,
            scope: "company",
            value,
        });
        // A count built on a failed read is skipped, never saved as history.
        const daily = [point("accountIssues", accountIssues.length)];
        if (!data.treeError)
            daily.push(point("campaigns.running", running.length), point("campaigns.kill", verdicts.kill ?? 0), point("campaigns.boardOffButRunning", boardOffButRunning));
        if (!data.offBoardError)
            daily.push(point("campaigns.spendingNotOnBoard", offBoard.length));
        if (!data.clientsError)
            daily.push(point("launches.stuck", stuck.length));
        return { payload, daily, sources };
    },
};
