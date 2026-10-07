import {groupOf,isInternalCard,isOneOffPlan} from "./billing.js";
import {addDays,kuwaitDay,monthStart} from "./time.js";
import {runtime} from "../runtime.ts";
export const EXT_FORM = "gqBcyK6g";
const EXT_CLIENT_REF = "5145ff0c-009b-4f51-b3a9-4651efc908be";
const EXT_DURATION_REF = "278c2f80-88bd-428e-b330-8c6b3175d63f";
export const EXT_PAGE = 200;
const EXT_URL = `https://api.typeform.com/forms/${EXT_FORM}/responses?page_size=${EXT_PAGE}`;
const WEEKS_BY_LABEL = {
    "1 WEEK": 1,
    "2 WEEKS": 2,
    "4 WEEKS": 4,
};
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
export function parseExtensionResponses(items) {
    const out = [];
    for (const raw of items) {
        const item = raw;
        const answers = Array.isArray(item?.answers) ? item.answers : [];
        const client = String(answers.find(a => a?.field?.ref === EXT_CLIENT_REF)?.text ?? "").trim();
        // The duration is a dropdown, which the responses API delivers as a
        // text answer carrying the label (2026-09-21: every response on the form
        // arrives that way), so the label is read from either shape.
        const duration = answers.find(a => a?.field?.ref === EXT_DURATION_REF);
        const label = String(duration?.choice?.label ?? duration?.text ?? "")
            .trim()
            .toUpperCase();
        const weeks = WEEKS_BY_LABEL[label];
        const submittedAt = Date.parse(String(item?.submitted_at ?? ""));
        if (!client || !weeks || !Number.isFinite(submittedAt))
            continue;
        out.push({
            id: String(item?.response_id ?? item?.token ?? `${submittedAt}:${fold(client)}`),
            submittedAt,
            day: kuwaitDay(submittedAt),
            client,
            weeks,
            until: kuwaitDay(submittedAt + weeks * 7 * DAY_MS),
        });
    }
    return out.sort((a, b) => a.submittedAt - b.submittedAt);
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
    for (const g of grants) {
        const card = matchCard(g.client, cards);
        if (isInternalText(g.client) || (card && isInternalText(card.name))) {
            internalTest += 1;
            continue;
        }
        if (!card)
            unmatched += 1;
        if (newestAt === null || g.submittedAt > newestAt)
            newestAt = g.submittedAt;
        const key = card ? `card:${card.taskId}` : `text:${fold(g.client)}`;
        const acc = byKey.get(key) ?? {
            client: card?.name ?? g.client,
            clickupTaskId: card?.taskId ?? null,
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
export async function readExtensionForm(){try{const body=await runtime().tools.typeform(EXT_URL);if(!Array.isArray(body.items))throw Error("Extension form has no response collection");return {ok:true,grants:parseExtensionResponses(body.items),responses:body.items.length,cached:false,items:body.items};}catch(e){return {ok:false,error:e instanceof Error?e.message:String(e)};}}
