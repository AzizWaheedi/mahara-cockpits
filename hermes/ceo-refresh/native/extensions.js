import {groupOf,isInternalCard,isOneOffPlan} from "./billing.js";
import {addDays,kuwaitDay,monthStart} from "./time.js";
import {runtime} from "../runtime.ts";
import {sql,TRIAGE} from "./sb.js";
/**
 * Extensions after waves 1 and 2 (docs/forms/WAVE12-CONTRACT.md 4.11.3): a
 * grant is an `extension` billing event, "Give more time" on the client page
 * or Extend on the billing sheet, read from cockpit_extensions_v (billing
 * events only, voided ones left out). Every grant carries its card id, so the
 * typed-name match the Client Extension Form needed is only a fallback for a
 * card the roster does not hold. The form (Typeform gqBcyK6g) is not read: its
 * two answers of 14 Sep were tests, never grants. The field write is the
 * billing queue's alone; nothing here writes ClickUp.
 */
export const EXT_FORM = "gqBcyK6g";
export const EXT_VIEW = "cockpit_extensions_v";
/** The newest grants read per run: far above a month's few, and named so the note can say it. */
export const EXT_PAGE = 500;
/** One select, no limit word (the native transport reads a limit as a coverage cap). Newest first. */
export const EXT_SQL = `select e.grant_id, e.clickup_task_id, e.client_name, e.granted_at, e.granted_on::text as granted_on, e.weeks,
  e.from_date::text as from_date, e.until::text as until, e.state, e.seat_role
  from public.cockpit_extensions_v e order by e.granted_on desc, e.grant_id desc`;
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const INTERNAL_TEXT = /\binternal test\b|playing account/i;
export const isInternalText = (s) => INTERNAL_TEXT.test(String(s ?? ""));
export const CLIENTS_LIST = "901816559981";
export const EXTENSION_FIELD_NAME = "Current extension (weeks)";
export const EXTENSION_FIELD_ENV = "CLICKUP_EXTENSION_FIELD";
export const FIELD_ASK = `Create a Number field '${EXTENSION_FIELD_NAME}' on the Clients - Mahara list (${CLIENTS_LIST}); the cockpit finds it by name at the next sync`;
export const fold = (s) => String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const epochDay = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const daysBetween = (from, to) => epochDay(to) - epochDay(from);
const STATES = new Set(["live", "ended", "replaced"]);
/**
 * cockpit_extensions_v rows to the grants the Client success section sums:
 * {id, submittedAt, day, client, weeks, until, clickupTaskId, state, seatRole}.
 * `day` is the Kuwait day the grant was given (the clock starts there, as it
 * did at the form's submission). A row without its card, its days, 1, 2 or 4
 * weeks or a known state throws, so a broken view never reads as no grant.
 */
export function grantsOfView(rows) {
    const out = [];
    for (const r of rows) {
        const taskId = String(r?.clickup_task_id ?? "").trim();
        const day = String(r?.granted_on ?? "").slice(0, 10);
        const until = String(r?.until ?? "").slice(0, 10);
        const weeks = Number(r?.weeks);
        const state = String(r?.state ?? "");
        if (!taskId || !ISO_DAY.test(day) || !ISO_DAY.test(until) || ![1, 2, 4].includes(weeks) || !STATES.has(state))
            throw Error("An extension grant in cockpit_extensions_v lacks its card, its days, its weeks or its state");
        const at = Date.parse(String(r?.granted_at ?? "").replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
        out.push({
            id: String(r?.grant_id ?? `${day}:${taskId}`),
            submittedAt: Number.isFinite(at) ? at : Date.parse(`${day}T09:00:00+03:00`),
            day,
            client: String(r?.client_name ?? "").trim() || taskId,
            weeks,
            until,
            clickupTaskId: taskId,
            state,
            seatRole: typeof r?.seat_role === "string" && r.seat_role ? r.seat_role : null,
        });
    }
    return out.sort((a, b) => a.submittedAt - b.submittedAt);
}
/** Kept for the old Typeform shape's callers; the refresh no longer reads the form. */
export function parseExtensionResponses() {
    return [];
}
export function matchCard(client, cards) {
    const typed = fold(client);
    if (typed.length < 4)
        return null;
    let best = null;
    for (const card of cards) {
        const key = fold(card.name);
        if (!key || !(typed.includes(key) || key.includes(typed)))
            continue;
        if (!best) {
            best = { card, key };
            continue;
        }
        const exact = key === typed;
        const bestExact = best.key === typed;
        if (exact !== bestExact) {
            if (exact)
                best = { card, key };
            continue;
        }
        if (key.length > best.key.length)
            best = { card, key };
    }
    return best?.card ?? null;
}
export function summariseExtensions(grants, cards, today) {
    const from = monthStart(today);
    const lastTo = addDays(from, -1);
    const lastFrom = monthStart(lastTo);
    const byKey = new Map();
    let totalWeeks = 0;
    let count = 0;
    let lastWeeks = 0;
    let lastCount = 0;
    let unmatched = 0;
    let internalTest = 0;
    let newestAt = null;
    const byId = new Map(cards.map(c => [c.taskId, c]));
    for (const g of grants) {
        // A grant names its card (cockpit_extensions_v); the name match is for a card the roster does not hold.
        const card = (g.clickupTaskId ? byId.get(g.clickupTaskId) : undefined) ?? matchCard(g.client, cards);
        if (isInternalText(g.client) || (card && isInternalText(card.name))) {
            internalTest += 1;
            continue;
        }
        if (!card)
            unmatched += 1;
        if (newestAt === null || g.submittedAt > newestAt)
            newestAt = g.submittedAt;
        const taskId = card?.taskId ?? g.clickupTaskId ?? null;
        const key = taskId ? `card:${taskId}` : `text:${fold(g.client)}`;
        const acc = byKey.get(key) ?? {
            client: card?.name ?? g.client,
            clickupTaskId: taskId,
            weeks: 0,
            until: g.until,
        };
        if (g.until > acc.until)
            acc.until = g.until;
        if (g.day >= from && g.day <= today) {
            acc.weeks += g.weeks;
            totalWeeks += g.weeks;
            count += 1;
        }
        else if (g.day >= lastFrom && g.day <= lastTo) {
            lastWeeks += g.weeks;
            lastCount += 1;
        }
        byKey.set(key, acc);
    }
    const perClient = [...byKey.values()]
        .map(a => ({ ...a, live: a.until >= today }))
        .filter(a => a.weeks > 0 || a.live)
        .sort((a, b) => b.weeks - a.weeks ||
        b.until.localeCompare(a.until) ||
        a.client.localeCompare(b.client));
    return {
        from,
        to: today,
        totalWeeks,
        grants: count,
        perClient,
        lastMonth: {
            from: lastFrom,
            to: lastTo,
            totalWeeks: lastWeeks,
            grants: lastCount,
        },
        unmatched,
        internalTest,
        newestAt,
    };
}
export function createdDayOf(signupDays, anchorDay) {
    const n = Number(signupDays);
    if (signupDays === null ||
        signupDays === undefined ||
        !Number.isFinite(n) ||
        n < 0 ||
        !ISO_DAY.test(anchorDay))
        return null;
    return addDays(anchorDay, -Math.round(n));
}
export function daysToLaunchOf(createdDay, launchDate, today) {
    if (!createdDay ||
        typeof launchDate !== "string" ||
        !ISO_DAY.test(launchDate) ||
        launchDate > today)
        return null;
    return daysBetween(createdDay, launchDate);
}
function median(sorted) {
    const n = sorted.length;
    if (n === 0)
        return null;
    const mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : round1((sorted[mid - 1] + sorted[mid]) / 2);
}
export function summariseLaunch(rows, today) {
    const out = [];
    const createdAfterLaunch = [];
    let noCreatedDay = 0;
    let notLaunched = 0;
    for (const r of rows) {
        if (r.internal)
            continue;
        const launched = typeof r.launchDate === "string" &&
            ISO_DAY.test(r.launchDate) &&
            r.launchDate <= today;
        if (!launched) {
            if (r.bucket === "active" || r.bucket === "onboarding")
                notLaunched += 1;
            continue;
        }
        if (!r.createdDay) {
            noCreatedDay += 1;
            continue;
        }
        const days = daysBetween(r.createdDay, r.launchDate);
        if (days < 0) {
            createdAfterLaunch.push(r.client);
            continue;
        }
        out.push({
            client: r.client,
            clickupTaskId: r.clickupTaskId,
            days,
            launchDate: r.launchDate,
        });
    }
    out.sort((a, b) => b.days - a.days || a.client.localeCompare(b.client));
    const days = out.map(r => r.days).sort((a, b) => a - b);
    return {
        averageDays: days.length
            ? round1(days.reduce((s, d) => s + d, 0) / days.length)
            : null,
        medianDays: median(days),
        clients: out.length,
        rows: out,
        notLaunched,
        createdAfterLaunch: createdAfterLaunch.sort(),
        noCreatedDay,
    };
}
export const isRecurringPlan = (plan) => typeof plan === "string" && plan.trim() !== "" && !isOneOffPlan(plan);
export function averageRetainer(rows) {
    const kept = rows.filter(r => groupOf(r.stage) === "active" &&
        !isInternalCard(r.name) &&
        typeof r.mrrUsd === "number" &&
        Number.isFinite(r.mrrUsd) &&
        isRecurringPlan(r.paymentPlan));
    if (kept.length === 0)
        return { averageUsd: null, cards: 0 };
    const total = kept.reduce((s, r) => s + r.mrrUsd, 0);
    return { averageUsd: round2(total / kept.length), cards: kept.length };
}

export async function findExtensionField(){const r=await runtime().tools.clickup(`list/${CLIENTS_LIST}/field`);const f=(r.fields??[]).find(f=>String(f.name??" ").trim().toLowerCase()===EXTENSION_FIELD_NAME.toLowerCase());return f?.id?String(f.id):null;}
/**
 * The grants, from cockpit_extensions_v. The name and the result's shape are
 * kept so the Client success adapter reads it unchanged: {ok, grants,
 * responses (the grant rows read), cached, items}. A failed read is {ok:false,
 * error}, never an empty list.
 */
export async function readExtensionForm(){try{const items=await sql(TRIAGE,EXT_SQL);if(!Array.isArray(items))throw Error("cockpit_extensions_v returned no rows collection");return {ok:true,grants:grantsOfView(items),responses:items.length,cached:false,items,source:EXT_VIEW};}catch(e){return {ok:false,error:e instanceof Error?e.message:String(e)};}}
/**
 * The month-free lifecycle the CEO metrics read beside the grants
 * (WAVE12-CONTRACT 4.11.4): every departure on the churn register with its
 * confirm, and every late spell over the daily card snapshots. Two selects,
 * no limit word. The Client success adapter puts the result on its payload as
 * `lifecycle`; metrics.ts reads it there.
 */
export const LIFECYCLE_SQL = {
    departures: `select d.id, d.clickup_task_id, d.client, d.left_on::text as left_on, d.reason, d.churn_type,
  (d.confirmed_at is not null) as confirmed, (d.confirmed_at at time zone 'Asia/Kuwait')::date::text as confirmed_on
  from public.cockpit_churn_departures d where d.removed_at is null order by d.left_on, d.id`,
    latePayments: `select l.clickup_task_id, l.client_name, l.due_on::text as due_on, l.ended_on::text as ended_on, l.closed_how,
  l.paid_on::text as paid_on, l.days_late, l.amount_usd from public.cockpit_late_payments_v l order by l.due_on, l.clickup_task_id`,
};
const COMPLETED_REASON = "Completed term, did not renew";
/** Rows to {departures, latePayments}. A row without its card or its day throws: a broken read is not "none". */
export function lifecycleOf(departureRows, lateRows) {
    const departures = departureRows.map(r => {
        const leftOn = String(r?.left_on ?? "").slice(0, 10);
        if (!ISO_DAY.test(leftOn))
            throw Error("A departure on the churn register lacks its day");
        const churnType = r?.churn_type === "completed" || r?.churn_type === "mid_programme" ? r.churn_type : null;
        return {
            id: Number(r?.id),
            taskId: r?.clickup_task_id ? String(r.clickup_task_id) : null,
            client: String(r?.client ?? ""),
            leftOn,
            reason: String(r?.reason ?? ""),
            churnType,
            // The CEO's count (30 Oct, the goal sheet's rule): every departure but a finished term.
            counts: churnType !== "completed" && String(r?.reason ?? "") !== COMPLETED_REASON,
            confirmed: r?.confirmed === true || r?.confirmed === "t" || r?.confirmed === "true",
            confirmedOn: ISO_DAY.test(String(r?.confirmed_on ?? "")) ? String(r.confirmed_on) : null,
        };
    });
    const latePayments = lateRows.map(r => {
        const dueOn = String(r?.due_on ?? "").slice(0, 10);
        const taskId = String(r?.clickup_task_id ?? "").trim();
        if (!taskId || !ISO_DAY.test(dueOn))
            throw Error("A late spell lacks its card or its due day");
        const days = r?.days_late === null || r?.days_late === undefined ? null : Number(r.days_late);
        const amount = r?.amount_usd === null || r?.amount_usd === undefined ? null : Number(r.amount_usd);
        return {
            taskId,
            client: String(r?.client_name ?? ""),
            dueOn,
            endedOn: ISO_DAY.test(String(r?.ended_on ?? "")) ? String(r.ended_on) : null,
            closedHow: String(r?.closed_how ?? ""),
            paidOn: ISO_DAY.test(String(r?.paid_on ?? "")) ? String(r.paid_on) : null,
            daysLate: Number.isFinite(days) ? days : null,
            amountUsd: Number.isFinite(amount) ? amount : null,
        };
    });
    return { departures, latePayments };
}
/** {ok, departures, latePayments} or {ok:false, error}: never an empty list for a read that failed. */
export async function readLifecycle() {
    try {
        const [d, l] = await Promise.all([sql(TRIAGE, LIFECYCLE_SQL.departures), sql(TRIAGE, LIFECYCLE_SQL.latePayments)]);
        return { ok: true, ...lifecycleOf(d, l) };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
