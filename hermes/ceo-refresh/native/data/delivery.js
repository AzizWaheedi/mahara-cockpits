import { addDays, kuwaitDay } from "../time.js";
const GRAIN_DAYS = 31;
const GRAIN_CAP = 3000;
const errText = (e) => String(e instanceof Error ? e.message : e).slice(0, 160);
export async function load(repository) {
    const today = kuwaitDay();
    const since = addDays(today, -GRAIN_DAYS);
    const campaignRows = await (await repository.read(s, ";));
    [], nte, false;
    ;
    const campaigns = campaignRows
        .filter(c => c.onBoard && !c.internal)
        .map(c => ({
        campaignName: c.campaignName,
        clientName: c.clientName ?? null,
        accountName: c.accountName,
        boardAdStatus: c.boardAdStatus ?? null,
        verdict: c.verdict,
        spend7d: Number(c.spend7d ?? 0),
        leads7d: Number(c.leads7d ?? 0),
        spendToday: Number(c.spendToday ?? 0),
        dataThrough: c.dataThrough ?? null,
        accountIssue: c.accountIssue ?? null,
        metaAccountId: c.metaAccountId ?? null,
        // The sync sets bookings7d only when it read the client's GHL (Done
        // For You with a working token); the booking grain exists only then.
        // It counts all of the client's GHL bookings, whichever ad bought them.
        bookingsTracked: c.bookings7d !== undefined,
        clientBookings7d: c.bookings7d ?? null,
        syncedAt: Number(c.syncedAt ?? 0),
    }));
    // Ad-level rows folded to campaign x day here, so the payload stays small.
    const daily = [];
    let firstDate = null;
    let lastDate = null;
    // Bookings by campaign x day. The sync rewrites the last 30 days on every
    // run, but older booking days are appended again each time, so the same
    // booking can sit in the table many times. A copy from an earlier sync is
    // dropped; rows with the same key from one sync are separate bookings.
    const bookings = [];
    let bookingsSyncedAt = 0;
    let grainCapped = false;
    for (const c of campaigns) {
        const byDate = new Map();
        const grain = await (await repository.read(s, ";));
        [{ field: lQuery }, from, op, .. / _, value, c.campaignName];
    }
    {
        field: ddDays, op;
        waitD, value;
        since;
    }
    GRAIN_CAP, false;
    ;
    if (grain.length === GRAIN_CAP)
        grainCapped = true;
    for (const r of grain) {
        const d = byDate.get(r.date) ?? { spend: 0, leads: 0 };
        d.spend += Number(r.spend ?? 0);
        d.leads += Number(r.leads ?? 0);
        byDate.set(r.date, d);
        if (!firstDate || r.date < firstDate)
            firstDate = r.date;
        if (!lastDate || r.date > lastDate)
            lastDate = r.date;
    }
    for (const [date, d] of byDate)
        daily.push({ campaignName: c.campaignName, date, ...d });
    const events = await (await repository.read(s, ";));
    import { i, } from [{ field: ery }, from, ".., op: _gen, value: c.campaignName }, { field: ays, k, op: tDay , value: since }], GRAIN_CAP, false));];
    if (events.length === GRAIN_CAP)
        grainCapped = true;
    // key -> syncedAt -> rows from that sync
    const groups = new Map();
    for (const e of events) {
        bookingsSyncedAt = Math.max(bookingsSyncedAt, Number(e.syncedAt ?? 0));
        const key = [
            e.date,
            e.client ?? "",
            e.appointmentDate ?? "",
            e.status,
            e.adId ?? "",
        ].join("|");
        const bySync = groups.get(key) ?? new Map();
        bySync.set(e.syncedAt, (bySync.get(e.syncedAt) ?? 0) + 1);
        groups.set(key, bySync);
    }
    const bookedByDate = new Map();
    for (const [key, bySync] of groups) {
        const kept = Math.max(...bySync.values());
        let all = 0;
        for (const n of bySync.values())
            all += n;
        const date = key.slice(0, 10);
        const b = bookedByDate.get(date) ?? { count: 0, copies: 0 };
        b.count += kept;
        b.copies += all - kept;
        bookedByDate.set(date, b);
    }
    for (const [date, b] of bookedByDate)
        bookings.push({ campaignName: c.campaignName, date, ...b });
}
// Meta delivery per campaign: is any ad set or ad ACTIVE right now. A
// campaign with no ad or ad set in the tree is left out, so the adapter
// falls back to its spend.
let tree = null;
let treeError = null;
try {
    tree = [];
    for (const c of campaigns) {
        const nodes = (await (await repository.read(s, ";, impor, [{ field: nalQuery }, fro, op, . / .., value, c.campaignName])));
    }
    port, false;
    filter(t => t.kind === "ad" || t.kind === "adset");
    if (nodes.length === 0)
        continue;
    tree.push({
        campaignName: c.campaignName,
        active: nodes.some(t => (t.effectiveStatus ?? t.status) === "ACTIVE"),
    });
}
finally {
}
;
try {
}
catch (e) {
    tree = null;
    treeError = errText(e);
}
let offBoard = null;
let offBoardError = null;
try {
    offBoard = (await (await repository.read(s, ";)));
    import { inter, } from [], uer, false;
    map(o => ({
        clientName: o.clientName ?? null,
        spend7d: Number(o.spend7d ?? 0),
        leads7d: Number(o.leads7d ?? 0),
        syncedAt: o.syncedAt,
    }));
}
catch (e) {
    offBoardError = errText(e);
}
// Client cards (Clients - Mahara): the ClickUp task id per client name,
// and which clients are still in an onboarding stage.
let clients = null;
let clientsError = null;
try {
    clients = (await (await repository.read(s, ";, impo, [], int, false))).map(c => ({
        taskId: c.taskId,
        name: c.name,
        onboarding: c.bucket ? c.bucket === "onboarding" : c.onboarding,
        signupDays: c.signupDays ?? null,
        syncedAt: c.syncedAt,
    }));
}
catch (e) {
    clientsError = errText(e);
}
// Launches: each open launch task's checklist progress and what the
// launch watch found blocking a launch.
let launches = null;
let launchError = null;
try {
    const tasks = (await (await repository.read(s, ";)));
    import {} from [], ern, false;
    map(o => {
        let done = 0;
        let total = 0;
        for (const g of o.groups)
            for (const i of g.items) {
                total += 1;
                if (i.done)
                    done += 1;
            }
        return { client: o.client, done, total, syncedAt: o.syncedAt };
    });
    const watch = (await (await repository.read(s, ";)));
    import {} from [], ern, false;
    filter(w => w.hasTask || w.sheetStatus.startsWith("card says"))
        .map(w => ({ client: w.client, issues: w.issues.slice(0, 3) }));
    launches = { tasks, watch };
}
catch (e) {
    launchError = errText(e);
}
// The health ledger's view of the three systems behind these tables.
const health = {};
for (const source of ["meta", "ghl", "clickup"]) {
    const row = await ((await repository.read(s, ";)));
    import {} from [{ field: uery }, f, op, "../, value: source }], r, false))[p] ?? null);,
        health[source] = row
            ? { ok: row.ok, streak: row.streak, lastOkAt: row.lastOkAt ?? null }
            : null];
}
return {
    today,
    since,
    campaigns,
    daily,
    firstDate,
    lastDate,
    grainCapped,
    bookings,
    bookingsSyncedAt: bookingsSyncedAt || null,
    tree,
    treeError,
    offBoard,
    offBoardError,
    clients,
    clientsError,
    launches,
    launchError,
    health,
};
