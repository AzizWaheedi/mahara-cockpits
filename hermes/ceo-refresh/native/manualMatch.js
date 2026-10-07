/**
 * The rules that keep a hand-logged payment from being counted twice
 * (2026-09-16). Plain functions, no native cockpit function is registered here: the
 * money adapter calls them and convex/ceo/manualPayments.ts shares the name
 * rule.
 *
 * - Tap cover: an entry logged on the "tap" rail while Tap was not
 *   connected is dropped from the manual totals once a Tap charge matches it,
 *   at most MATCH_DAYS apart and within MATCH_GAP. Each charge covers one
 *   entry at most.
 * - Possible duplicates: a live entry and a Whop payment for a similar
 *   client, or a Tap charge (Tap has no client name in the cockpit's read),
 *   inside the same day and amount window. Flagged only, never removed.
 * - Deal values: a hand-logged deal value whose client matches a closer form
 *   deal in the same Kuwait month, or at most MATCH_DAYS apart, is flagged
 *   and left out of contracted, because the closer form already counts it.
 */
/** Whole days two payments may be apart and still be the same money. */
export const MATCH_DAYS = 3;
/** Largest amount gap, as a share of the larger amount. */
export const MATCH_GAP = 0.05;
/**
 * How long after it was handed over a cheque may reach the bank statement
 * and still be the same money. A cheque counts on the day it is received and
 * clears later, when it is deposited and collected, often a week or more; a
 * transfer lands within MATCH_DAYS. Without this, a cheque whose deposit
 * showed four days later counted twice (Liwan's, logged 2026-09-23).
 */
export const CHEQUE_DAYS = 14;
/** A gap kept to four decimals (0.0123 is 1.23%). */
const gap4 = (x) => Math.round(x * 10_000) / 10_000;
/** Lower case letters and digits only, in any script, for comparing names. */
export function nameKey(s) {
    return String(s ?? "")
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
}
/** Whole days between two YYYY-MM-DD days, never negative. */
export function dayGap(a, b) {
    const ms = Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime());
    return Number.isFinite(ms)
        ? Math.round(ms / 86_400_000)
        : Number.POSITIVE_INFINITY;
}
/**
 * Whether a bank statement line on `lineDay` can be the hand-logged payment
 * of `day` on `rail`: within MATCH_DAYS either way, and for a cheque up to
 * CHEQUE_DAYS after it was received.
 */
export function bankCanBe(rail, day, lineDay) {
    const gap = dayGap(day, lineDay);
    if (rail === "cheque" && lineDay >= day)
        return gap <= CHEQUE_DAYS;
    return gap <= MATCH_DAYS;
}
/** |a - b| / max(a, b), 0 when both are 0. */
export function amountGap(a, b) {
    const top = Math.max(Math.abs(a), Math.abs(b));
    return top === 0 ? 0 : Math.abs(a - b) / top;
}
/** "$1,500" without Intl, cents only when there are any. */
export function usdWords(x) {
    const cents = Math.round(x * 100) % 100 !== 0;
    const [whole, frac] = (cents ? x.toFixed(2) : Math.round(x).toFixed(0)).split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `$${grouped}${frac ? `.${frac}` : ""}`;
}
/** "on the same day", "1 day apart", "3 days apart". */
const apart = (n) => n === 0 ? "on the same day" : n === 1 ? "1 day apart" : `${n} days apart`;
export function nameBook(cards) {
    const byTask = new Map();
    const byKey = new Map();
    for (const c of cards) {
        const keys = c.names.map(nameKey).filter(k => k.length >= 3);
        byTask.set(c.taskId, keys);
        for (const k of keys) {
            const set = byKey.get(k) ?? new Set();
            set.add(c.taskId);
            byKey.set(k, set);
        }
    }
    return {
        keysFor: (names, taskId) => {
            const out = new Set();
            const tasks = new Set();
            if (taskId)
                tasks.add(taskId);
            for (const n of names) {
                const k = nameKey(n);
                if (k.length < 3)
                    continue;
                out.add(k);
                for (const t of byKey.get(k) ?? [])
                    tasks.add(t);
            }
            for (const t of tasks)
                for (const k of byTask.get(t) ?? [])
                    out.add(k);
            return out;
        },
    };
}
/**
 * Two clients are similar when a name key is the same on both sides, or the
 * shorter of two keys (4 letters at least) sits inside the longer one. Both
 * sides already carry the names of the card they resolve to, so two names of
 * one card also match.
 */
export function similarNames(a, b) {
    for (const x of a)
        for (const y of b) {
            if (x === y)
                return true;
            const [short, long] = x.length <= y.length ? [x, y] : [y, x];
            if (short.length >= 4 && long.includes(short))
                return true;
        }
    return false;
}
/**
 * Which "tap" rail entries a Tap charge now accounts for. Entries dated
 * before `from` are not looked at (Tap is read from a later day). Oldest
 * entry first, each taking the closest free charge.
 */
export function coverWithTap(entries, charges, from) {
    const out = new Map();
    const used = new Set();
    const tapEntries = entries
        .filter(e => e.rail === "tap" && e.deletedAt === null && e.day >= from)
        .sort((a, b) => a.day === b.day ? a.addedAt - b.addedAt : a.day < b.day ? -1 : 1);
    for (const e of tapEntries) {
        let best = null;
        for (const c of charges) {
            if (c.usd === null || used.has(c.id))
                continue;
            const d = dayGap(e.day, c.day);
            if (d > MATCH_DAYS)
                continue;
            const g = amountGap(e.amountUsd, c.usd);
            if (g > MATCH_GAP)
                continue;
            if (!best || d < best.d || (d === best.d && g < best.g))
                best = { c: { ...c, usd: c.usd }, d, g };
        }
        if (best) {
            used.add(best.c.id);
            out.set(e.id, { chargeDay: best.c.day, chargeUsd: best.c.usd });
        }
    }
    return out;
}
function closest(list) {
    let best = null;
    for (const c of list)
        if (!best || c.d < best.d || (c.d === best.d && c.g < best.g))
            best = c;
    return best;
}
/**
 * Cash entries that may already be counted on Whop or Tap. `entries` are the
 * live, uncovered entries to test; `tap` is null while Tap is not read.
 */
export function cashDuplicates(entries, whop, tap, book) {
    const out = [];
    for (const e of entries) {
        const mine = book.keysFor([e.client], e.clickupTaskId);
        const near = (day, usd) => {
            const d = dayGap(e.day, day);
            const g = amountGap(e.amountUsd, usd);
            return d <= MATCH_DAYS && g <= MATCH_GAP ? { d, g } : null;
        };
        const w = closest(whop.flatMap(p => {
            const hit = near(p.day, p.usd);
            if (!hit)
                return [];
            const theirs = book.keysFor([p.business, ...p.matchNames]);
            return similarNames(mine, theirs)
                ? [{ day: p.day, usd: p.usd, client: p.business, ...hit }]
                : [];
        }));
        if (w)
            out.push({
                manualId: e.id,
                manualDay: e.day,
                manualUsd: e.amountUsd,
                manualClient: e.client,
                against: "whop",
                otherDay: w.day,
                otherUsd: w.usd,
                otherClient: w.client,
                daysApart: w.d,
                amountGap: gap4(w.g),
                why: `${usdWords(e.amountUsd)} logged by hand from ${e.client} on ${e.day} and a Whop payment of ${usdWords(w.usd)} on ${w.day} for a similar client are ${apart(w.d)}. If Whop already has this money, remove the hand entry.`,
            });
        if (tap) {
            const t = closest(tap.flatMap(c => {
                if (c.usd === null)
                    return [];
                const hit = near(c.day, c.usd);
                return hit ? [{ day: c.day, usd: c.usd, client: null, ...hit }] : [];
            }));
            if (t)
                out.push({
                    manualId: e.id,
                    manualDay: e.day,
                    manualUsd: e.amountUsd,
                    manualClient: e.client,
                    against: "tap",
                    otherDay: t.day,
                    otherUsd: t.usd,
                    otherClient: null,
                    daysApart: t.d,
                    amountGap: gap4(t.g),
                    why: `${usdWords(e.amountUsd)} logged by hand from ${e.client} on ${e.day} and a Tap charge of ${usdWords(t.usd)} on ${t.day} are ${apart(t.d)}. Tap charges carry no client name here, so this is a match on day and amount only. If Tap already has this money, remove the hand entry.`,
                });
        }
    }
    return out;
}
/**
 * Hand-logged deal values the closer form already has: a deal for a similar
 * client in the same Kuwait month, or at most MATCH_DAYS apart. Closer form
 * deals with no contracted value are passed in by the caller only when they
 * carry one, since a form deal worth nothing cannot be counted twice.
 */
export function dealDuplicates(entries, deals, book) {
    const out = [];
    for (const e of entries) {
        if (e.dealContractedUsd === null)
            continue;
        const dealUsd = e.dealContractedUsd;
        const mine = book.keysFor([e.client], e.clickupTaskId);
        const hit = closest(deals.flatMap(f => {
            const d = dayGap(e.day, f.day);
            const sameMonth = f.day.slice(0, 7) === e.day.slice(0, 7);
            if (!sameMonth && d > MATCH_DAYS)
                return [];
            if (!similarNames(mine, book.keysFor([f.business])))
                return [];
            return [
                {
                    day: f.day,
                    usd: f.usd,
                    client: f.business,
                    d,
                    g: amountGap(dealUsd, f.usd),
                },
            ];
        }));
        if (!hit)
            continue;
        out.push({
            manualId: e.id,
            manualDay: e.day,
            manualUsd: dealUsd,
            manualClient: e.client,
            against: "closer_form",
            otherDay: hit.day,
            otherUsd: hit.usd,
            otherClient: hit.client,
            daysApart: hit.d,
            amountGap: gap4(hit.g),
            why: `The ${usdWords(dealUsd)} deal logged by hand with ${e.client} on ${e.day} matches the closer form deal for ${hit.client} on ${hit.day} (${usdWords(hit.usd)}), so it is left out of contracted and the closer form figure stands. If it really is a second deal, put it on the closer form.`,
        });
    }
    return out;
}
