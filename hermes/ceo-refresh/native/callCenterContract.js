const COUNTS = [
    "dials",
    "providerDials",
    "connections",
    "talkSeconds",
    "leads",
    "leadsDialed",
    "leadsContacted",
    "noVerifiedDial",
    "confirmedBookings",
    "provisionalBookings",
    "unclassifiedBookings",
    "shows",
    "noShow",
    "closed",
    "speedSamples",
    "withinTwoMinutes",
    "callGapSamples",
];
const NULLABLE = [
    "showRate",
    "closeRate",
    "connectionRate",
    "avgSpeedSeconds",
    "medianSpeedSeconds",
    "withinTwoMinutesRate",
    "avgCallGapSeconds",
];
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const amount = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
const isDay = (x) => {
    if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x))
        return false;
    const time = Date.parse(`${x}T00:00:00Z`);
    return (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === x);
};
/** Inclusive Kuwait dates, bounded before every server request. */
export function callCenterRange(from, to) {
    if (!isDay(from) ||
        !isDay(to) ||
        from > to ||
        (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 93)
        throw new Error("Choose valid dates covering no more than 93 days.");
    return { from, to };
}
function metricRow(x) {
    return (object(x) &&
        COUNTS.every(key => amount(x[key])) &&
        NULLABLE.every(key => x[key] === null || amount(x[key])) &&
        Array.isArray(x.values) &&
        x.values.every(v => object(v) &&
            (v.currency === null || typeof v.currency === "string") &&
            typeof v.value === "number" &&
            Number.isFinite(v.value)));
}
/** Fail visibly on a changed/malformed source contract; never replace missing metrics with zero. */
export function parseCallCenterReport(raw, from, to) {
    callCenterRange(from, to);
    if (!object(raw) ||
        raw.version !== 1 ||
        raw.from !== from ||
        raw.to !== to ||
        raw.timezone !== "Asia/Kuwait" ||
        typeof raw.generatedAt !== "string" ||
        !Number.isFinite(Date.parse(raw.generatedAt)) ||
        !metricRow(raw.overall) ||
        !Array.isArray(raw.callers) ||
        !raw.callers.every(r => metricRow(r) &&
            object(r) &&
            (r.email === null || typeof r.email === "string") &&
            typeof r.name === "string") ||
        !Array.isArray(raw.clients) ||
        !raw.clients.every(r => metricRow(r) &&
            object(r) &&
            (r.id === null || typeof r.id === "string") &&
            typeof r.name === "string") ||
        !Array.isArray(raw.daily) ||
        !raw.daily.every(r => metricRow(r) &&
            object(r) &&
            isDay(r.day) &&
            r.day >= from &&
            r.day <= to) ||
        !object(raw.coverage) ||
        !Array.isArray(raw.warnings) ||
        !raw.warnings.every(w => typeof w === "string"))
        throw new Error("The shared call center report is unavailable or has changed. The last good report has been kept.");
    return raw;
}
