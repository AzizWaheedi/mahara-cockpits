/**
 * Pure rules for the Management team switch (2026-09-16), shared by the team
 * adapter and the teamStatus mutations. Registers no native cockpit function.
 */
const ROLE_LABELS = {
    media_buyer: "Media buyer",
    creative_director: "Creative director",
    video_editor: "Video editor",
    systems_manager: "Systems manager",
    client_sales_rep: "Client sales rep",
    account_manager: "Account manager",
    executive_assistant: "Executive assistant",
    sales_rep: "Sales rep",
    sales_setter: "Setter",
    // Cockpit roles.
    csm: "Account manager",
    creative: "Creative director",
};
/** "media_buyer" -> "Media buyer". */
export const roleLabel = (role) => ROLE_LABELS[role] ??
    role.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
export const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "media_buyer:nada" -> { role: "media_buyer", first: "nada" }, or null. */
export function splitPersonKey(key) {
    const i = key.indexOf(":");
    if (i <= 0 || i === key.length - 1)
        return null;
    return { role: key.slice(0, i), first: key.slice(i + 1) };
}
/** "media_buyer:nada" -> "Nada (Media buyer)", for audit sentences. */
export function personLabelFromKey(key) {
    const parts = splitPersonKey(key);
    if (!parts)
        return key;
    return `${titleCase(parts.first)} (${roleLabel(parts.role)})`;
}
/**
 * A person's status over time, rebuilt from every status the CEO set, in the
 * order they were set. Each change says "from `since` on, the person is
 * `status`":
 *
 * - a change with the same status as the change just before it is a
 *   correction of that change (a new date or note): it takes its place, so
 *   the days the old date covered go back to what they were before it;
 * - otherwise it replaces whatever earlier changes said about `since` and
 *   later, and runs on from an earlier segment with the same status (a new
 *   pause that starts inside an old one keeps the old start);
 * - setting "active" on the same day a pause started undoes the pause.
 *
 * Replaying the stored row once more after its own trail changes nothing, so
 * the adapter can append it as a safety net. Everyone starts active. The
 * result is ordered by `since`, first segment always the implicit active one.
 */
export function buildTimeline(changes) {
    const effective = [];
    for (const c of changes) {
        if (!c.since)
            continue;
        const prev = effective[effective.length - 1];
        if (prev && prev.status === c.status)
            effective[effective.length - 1] = c;
        else
            effective.push(c);
    }
    const out = [{ status: "active", since: "" }];
    for (const c of effective) {
        while (out.length > 1 && out[out.length - 1].since >= c.since)
            out.pop();
        if (out[out.length - 1].status !== c.status)
            out.push({ status: c.status, since: c.since });
    }
    return out;
}
/** The segment in force on a Kuwait day. */
export function segmentOn(timeline, day) {
    let seg = timeline[0];
    for (const s of timeline)
        if (s.since <= day)
            seg = s;
    return seg;
}
/** Free text leaving the backend: emails and phone numbers masked, one line, no em dashes. */
export function maskText(s, max = 300) {
    return s
        .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
        .replace(/\+?\d(?: ?\d){7,}/g, "[number]")
        .replace(/\s*[\u2014\u2013]\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}
