import {USD_PER} from "./data/tap.js";
export const CFB = {
    mrr: "48eb6023-8944-4404-9e30-b01fc8a38256",
    ltv: "11d70e58-20e7-4ff0-85c6-51de42f044d2",
    nextPaymentAmount: "f071ee8f-b7ce-49e8-899b-6bef649d86ba",
    nextPaymentDate: "669ae046-bf82-4b59-80d5-bf25d6b57ef3",
    paymentPlan: "17d17129-43c4-441b-a55c-6eca83b9f776",
    paymentMethod: "665e5754-b9c6-4776-9386-111ad221dead",
    contractStatus: "ac976d4a-409b-441c-8c13-4b0e73a0c12f",
    nextContractRenewal: "eaa2caf3-899d-4072-beb3-72ef3c0427f1",
    signupDate: "03968cf6-dac1-43b6-8f02-cef999af2bbb",
    launchDate: "2e744484-f581-4c37-962a-023c4de23729",
    pausedOn: "930c49eb-9374-410c-801f-9aa81fff4944",
    churnDate: "42429a6e-5cba-4a3b-964d-2b493315421b",
    churnReason: "796f25e7-7e63-4d08-9ec4-41c58a5b57ca",
    churnType: "a121f39a-f8a4-41f5-905e-a735ee729071",
    closer: "63af118b-bb16-48ba-9ddb-d0185b32fb23",
    leadSource: "e993c247-2b0e-4543-bcd8-7e1ed02f65fa",
    status: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
};
const ONE_OFF_PLAN = /paid\s*in\s*full|split\s*pay|one\s*[- ]?off|upfront/i;
export const isOneOffPlan = (plan) => ONE_OFF_PLAN.test(String(plan ?? ""));
const fieldOf = (task, id) => (task?.custom_fields ?? []).find((c) => c.id === id);
function label(task, id) {
    const f = fieldOf(task, id);
    if (!f || f.value === undefined || f.value === null || f.value === "")
        return undefined;
    const opts = f.type_config?.options ?? [];
    const hit = opts.find(o => o.id === f.value) ??
        opts.find(o => String(o.orderindex) === String(f.value));
    return hit?.name ?? undefined;
}
function text(task, id) {
    const raw = fieldOf(task, id)?.value;
    if (typeof raw !== "string")
        return undefined;
    const t = raw.trim();
    return t === "" ? undefined : t;
}
function day(task, id) {
    const n = Number(fieldOf(task, id)?.value);
    if (!Number.isFinite(n) || n <= 0)
        return undefined;
    return new Date(n + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function money(task, id) {
    const f = fieldOf(task, id);
    if (!f)
        return {};
    const n = Number(f.value);
    if (!Number.isFinite(n) || n === 0)
        return {};
    const currency = String(f.type_config?.currency_type ?? "USD").toUpperCase();
    const rate = USD_PER[currency];
    if (rate === undefined)
        return { currency, unknownCurrency: currency };
    return { usd: Math.round(n * rate * 100) / 100, currency };
}
export function billingRows(tasks, now) {
    const rows = [];
    const unknown = new Set();
    for (const t of tasks ?? []) {
        const taskId = String(t?.id ?? "");
        if (!taskId)
            continue;
        const mrr = money(t, CFB.mrr);
        const ltv = money(t, CFB.ltv);
        const next = money(t, CFB.nextPaymentAmount);
        for (const c of [mrr, ltv, next])
            if (c.unknownCurrency)
                unknown.add(c.unknownCurrency);
        rows.push({
            taskId,
            name: String(t?.name ?? "").trim() || `ClickUp card ${taskId}`,
            taskUrl: typeof t?.url === "string" ? t.url : undefined,
            stage: label(t, CFB.status),
            mrrUsd: mrr.usd,
            ltvUsd: ltv.usd,
            nextPaymentAmountUsd: next.usd,
            currency: mrr.currency ?? ltv.currency ?? next.currency,
            nextPaymentDate: day(t, CFB.nextPaymentDate),
            signupDate: day(t, CFB.signupDate),
            launchDate: day(t, CFB.launchDate),
            pausedOn: day(t, CFB.pausedOn),
            churnDate: day(t, CFB.churnDate),
            nextContractRenewal: day(t, CFB.nextContractRenewal),
            paymentPlan: label(t, CFB.paymentPlan),
            paymentMethod: label(t, CFB.paymentMethod),
            contractStatus: label(t, CFB.contractStatus),
            churnReason: label(t, CFB.churnReason) ?? text(t, CFB.churnReason),
            churnType: label(t, CFB.churnType),
            closer: label(t, CFB.closer) ?? text(t, CFB.closer),
            leadSource: label(t, CFB.leadSource) ?? text(t, CFB.leadSource),
            syncedAt: now,
        });
    }
    return { rows, unknownCurrencies: [...unknown].sort() };
}
const GONE = new Set(["Stopped", "CANCELLED ONBOARDING"]);
const SALES_STAGE = "SALES TEAM TO CONTACT";
const INTERNAL_CARD = /playing account|\[internal test\]/i;
export const isInternalCard = (name) => INTERNAL_CARD.test(name);
export const LIVE_GROUPS = ["active", "paused", "pipeline"];
export const groupOf = (stage) => stage === "Active"
    ? "active"
    : stage === "Paused"
        ? "paused"
        : GONE.has(String(stage ?? ""))
            ? "gone"
            : String(stage ?? "") === SALES_STAGE
                ? "sales"
                : "pipeline";
const zero = () => ({
    cards: 0,
    filled: 0,
    bookUsd: 0,
    recurringUsd: 0,
    oneOffUsd: 0,
    unclassifiedUsd: 0,
});
const round2 = (x) => Math.round(x * 100) / 100;
export function summariseBilling(rows) {
    const mrr = {
        active: zero(),
        paused: zero(),
        pipeline: zero(),
        sales: zero(),
        gone: zero(),
    };
    const mrrBlank = [];
    const methods = new Map();
    let ltvFilled = 0;
    let ltvTotal = 0;
    let methodFilled = 0;
    let gone = 0;
    let goneWithChurnDate = 0;
    let goneWithChurnReason = 0;
    let paused = 0;
    let pausedWithDate = 0;
    let withRenewalDate = 0;
    let internalCards = 0;
    let syncedAt = null;
    for (const r of rows) {
        const g = groupOf(r.stage);
        if (isInternalCard(r.name))
            internalCards += 1;
        const bucket = mrr[g];
        bucket.cards += 1;
        if (typeof r.mrrUsd === "number") {
            bucket.filled += 1;
            bucket.bookUsd += r.mrrUsd;
            if (r.paymentPlan === undefined)
                bucket.unclassifiedUsd += r.mrrUsd;
            else if (isOneOffPlan(r.paymentPlan))
                bucket.oneOffUsd += r.mrrUsd;
            else
                bucket.recurringUsd += r.mrrUsd;
        }
        else if (LIVE_GROUPS.includes(g) &&
            !isInternalCard(r.name)) {
            mrrBlank.push({ taskId: r.taskId, name: r.name, stage: r.stage });
        }
        if (typeof r.ltvUsd === "number") {
            ltvFilled += 1;
            ltvTotal += r.ltvUsd;
        }
        if (r.paymentMethod) {
            methodFilled += 1;
            methods.set(r.paymentMethod, (methods.get(r.paymentMethod) ?? 0) + 1);
        }
        if (g === "gone") {
            gone += 1;
            if (r.churnDate)
                goneWithChurnDate += 1;
            if (r.churnReason)
                goneWithChurnReason += 1;
        }
        if (g === "paused") {
            paused += 1;
            if (r.pausedOn)
                pausedWithDate += 1;
        }
        if (g !== "gone" && r.nextContractRenewal)
            withRenewalDate += 1;
        if (syncedAt === null || r.syncedAt > syncedAt)
            syncedAt = r.syncedAt;
    }
    for (const b of Object.values(mrr)) {
        b.bookUsd = round2(b.bookUsd);
        b.recurringUsd = round2(b.recurringUsd);
        b.oneOffUsd = round2(b.oneOffUsd);
        b.unclassifiedUsd = round2(b.unclassifiedUsd);
    }
    return {
        cards: rows.length,
        mrr,
        mrrBlank: mrrBlank.sort((a, b) => a.name.localeCompare(b.name)),
        internalCards,
        ltv: { filled: ltvFilled, totalUsd: round2(ltvTotal) },
        paymentMethod: {
            filled: methodFilled,
            mix: [...methods.entries()]
                .map(([method, cards]) => ({ method, cards }))
                .sort((a, b) => b.cards - a.cards || a.method.localeCompare(b.method)),
        },
        lifecycle: {
            gone,
            goneWithChurnDate,
            goneWithChurnReason,
            paused,
            pausedWithDate,
            withRenewalDate,
        },
        syncedAt,
    };
}
