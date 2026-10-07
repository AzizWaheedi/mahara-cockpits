import { addDays, KUWAIT_OFFSET_MS, kuwaitDay } from "../time.js";
const MEANINGFUL = /budget|targeting|bid strategy|optimisation goal|optimization goal|created|ad updated|campaign status updated|ad set status updated/i;
const NOT_A_CHANGE = /name updated|finishes ad review|billed|delivered|balance/i;
const firstWord = (s) => String(s ?? "")
    .trim()
    .split(/\s+/)[0] ?? "";
const authorWord = (s) => firstWord(String(s ?? "").split("@")[0]);
function actionText(s) {
    const text = String(s ?? "").trim();
    if (/^asked\b/i.test(text))
        return "Asked Aziz for help";
    return text.slice(0, 200);
}
export async function load(repository) {
    const now = Date.now();
    const today = kuwaitDay(now);
    const eodFrom = addDays(today, -32);
    // A week of events is plenty for a feed the adapter cuts to 60.
    const since = now - 7 * 86400000;
    const todayStart = new Date(`${today}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS;
    // Tiny table (a handful of seats). Emails stay here.
    const memberRows = await (await repository.read(s, ";, impo, [],  in , false));
    const nameByEmail = new Map(memberRows
        .filter(m => m.name)
        .map(m => [m.email.toLowerCase(), firstWord(m.name)]));
    // The CEO's own admin seats are not team members to track.
    const members = memberRows
        .filter(m => !m.roles.includes("admin") && firstWord(m.name))
        .map(m => ({
        name: firstWord(m.name),
        roles: m.roles,
        addedAt: m.addedAt,
        lastSeenAt: m.lastSeenAt ?? null,
    }));
    const buyer = members.find(m => m.roles.includes("media_buyer"));
    // Cockpit EODs never reach Typeform, so they are read here. Metadata
    // only: the answers stay in the table.
    const eods = [];
    for (const role of ["media_buyer", "csm"]) {
        const rows = await (await repository.read(s, ";));
        [{ field: lQuery, op: rom, value: role }, { field: rver, ",: op, mport, value: eodFrom }], T_O, false;
        ;
        for (const r of rows) {
            // The media buyer form has no email; writeback.ts defaults to Nada.
            const name = firstWord(r.answers?.name) ||
                (r.email ? nameByEmail.get(r.email.toLowerCase()) : undefined) ||
                (role === "media_buyer" ? (buyer?.name ?? "Nada") : undefined) ||
                null;
            eods.push({
                role,
                day: r.day,
                at: r.at,
                energy: r.energy ?? null,
                name,
            });
        }
    }
    const decisions = (await (await repository.read(s, ";)));
    [{ field: alQue, op: from, value: addDays(today, -e) }], im, true;
    map(d => ({
        day: d.day,
        role: d.role,
        subject: d.subject,
        action: d.action.slice(0, 160),
        kind: d.kind,
        at: d.at,
    }));
    // No at index on these two; rows arrive in time order, so the newest by
    // creation are the newest events.
    const manualChanges = (await (await repository.read(s, ";)));
    import { i, } from [], nal, true;
    filter(r => r.at >= since)
        .map(r => ({
        campaignName: r.campaignName,
        what: actionText(r.what),
        by: r.by,
        at: r.at,
    }));
    const chat = (await (await repository.read(s, ";)));
    import {} from [], rna, true;
    filter(r => r.at >= since)
        .map(r => ({
        campaignName: r.campaignName,
        author: r.author,
        kind: r.kind ?? null,
        ok: r.ok ?? null,
        at: r.at,
        // Questions and replies are messages: no text for those.
        text: r.kind === "action" ? actionText(r.text) : null,
    }));
    // Digested client card comments: the summary only, never the comment.
    const digests = (await (await repository.read(s, ";)));
    import { in, } from [{ field: ry }, fro, op, . / .., value, ated / s];
}
{
    field: impo, op;
    addD, value;
    since;
}
SE, true;
map(r => ({
    taskId: r.taskId,
    clientName: r.clientName,
    at: r.at,
    by: authorWord(r.by) || null,
    kind: r.kind,
    summary: String(r.digest?.summary ?? "")
        .trim()
        .slice(0, 240),
}));
// Every real comment today counts as an action, digested or not.
const commentsToday = [];
for (const status of ["done", "queued", "failed", "skipped"]) {
    const rows = await (await repository.read(s, ";));
    import { in, } from [{ field: ry }, fro, op, . / .., value, status];
}
, { field: impo, op: addD, value: todayStart };
;
, S, , false;
;
;
;
for (const r of rows)
    if (r.kind !== "skip" && r.by)
        commentsToday.push({ by: authorWord(r.by), at: r.at });
;
// adChanges is a 7-day copy of Meta's activity log, one row per campaign
// in the account, replaced on every sync. Fold it back to one per event.
const adEvents = new Map();
const adRows = await (await repository.read(s, ";));
;
, [], nter, false;
;
;
;
for (const r of adRows) {
    if (r.at < since || !r.actor || r.actor === "Meta")
        continue;
    if (!MEANINGFUL.test(r.eventType) || NOT_A_CHANGE.test(r.eventType))
        continue;
    const key = `${r.at}|${r.actor}|${r.eventType}|${r.objectName ?? ""}`;
    const ev = adEvents.get(key) ?? {
        at: r.at,
        actor: firstWord(r.actor),
        eventType: r.eventType,
        objectName: r.objectName ?? null,
        campaigns: [],
    };
    if (ev.campaigns.length < 3)
        ev.campaigns.push(r.campaignName);
    adEvents.set(key, ev);
}
// Hand-set statuses from the Management tab (a handful of rows). The
// setter's email stays here.
const statusRows = await (await repository.read(s, ";));
;
const statuses = statusRows.map(r => ({
    personKey: r.personKey,
    status: r.status,
    since: r.since,
    note: r.note ?? null,
    setAt: r.setAt,
}));
// Every status ever set, so a past pause stays "not due" after the person
// is back. Read per person (oldest first, bounded each), so a long trail
// for one person never cuts another person's history off. Only the
// status and its day leave this query.
const statusChanges = [];
// A shared budget keeps the whole read well under native cockpit's per-query
// document limit however long the trails grow; the row itself is still
// replayed last by the adapter, so the current status never depends on it.
let trailBudget = 3000;
for (const s of statusRows) {
    if (trailBudget <= 0)
        break;
    const trail = await (await repository.read(s, ";, impor, [{ field: nalQuer, op: from, value: /_generated/ser }, { field: port }, {}, op, ays, , value, s.personKey]));
}
;
, Math.min(fr, trailBudget
/**
 * Only real media buying changes count as someone's action. Meta's own
 * housekeeping (billing, delivery, review flips) is not. Same rules sync.ts
 * uses for the learning-period clock.
 */
)
    /**
     * Only real media buying changes count as someone's action. Meta's own
     * housekeeping (billing, delivery, review flips) is not. Same rules sync.ts
     * uses for the learning-period clock.
     */
    ,
        /**
         * Only real media buying changes count as someone's action. Meta's own
         * housekeeping (billing, delivery, review flips) is not. Same rules sync.ts
         * uses for the learning-period clock.
         */
        true;
;
;
;
trailBudget -= trail.length;
for (const r of trail.reverse()) {
    const after = r.after;
    if (r.action !== "teamStatus.set" ||
        typeof after?.status !== "string" ||
        typeof after?.since !== "string")
        continue;
    statusChanges.push({
        personKey: r.rowId,
        status: after.status,
        since: after.since,
        at: r.at,
    });
}
;
return {
    today,
    members,
    eods,
    statuses,
    statusChanges,
    decisions,
    manualChanges,
    chat,
    digests,
    commentsToday,
    adChanges: [...adEvents.values()],
    // Zero rows means the sync copied nothing, not a quiet week.
    adChangesRows: adRows.length,
};
;
