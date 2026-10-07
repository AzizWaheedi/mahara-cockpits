/**
 * The landing page, computed on read from the page events the webinar site
 * sends (sites/webinar/mm-track.js → cockpit_webinar_page_events). The
 * tracking brief: the page's own events are "our source of truth for
 * traffic volume and on-page conversion"; registrations stay HighLevel's.
 *
 * The adapter reads one row per visitor (what they did, first touch first);
 * this puts each visitor in a round and counts. Pure, so
 * scripts/webinar.test.ts runs it directly.
 */
export const EMPTY_PAGE = {
    visitors: 0,
    sessions: 0,
    views: 0,
    formView: 0,
    formStart: 0,
    formSubmit: 0,
    ctaClick: 0,
    thankYou: 0,
    scroll50: 0,
    scroll75: 0,
    scroll100: 0,
    secondsMedian: null,
    videoPlays: 0,
    thankYouVideo: 0,
    thankYouVideoWatched: 0,
    calendarAdd: 0,
    whatsapp: 0,
    whatsappPlaceholder: false,
    surveyStart: 0,
    surveySubmit: 0,
    joinBefore: 0,
    joinAfter: 0,
    pitch1Clicks: 0,
    pitch2Clicks: 0,
    mobile: 0,
    withAd: 0,
    byAd: [],
};
/** A Meta ad id as it arrives in utm_content: digits only. */
export const AD_ID = /^\d{6,}$/;
function median(xs) {
    if (!xs.length)
        return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** Counts for one round's visitors, and the join-link clicks around its session. */
export function pageStats(visitors, joins, sessionAt, pitches = []) {
    const landing = visitors.filter(v => v.firstLanding !== null);
    const count = (f) => visitors.filter(f).length;
    const ads = new Map();
    for (const v of visitors) {
        if (!v.utmContent || !AD_ID.test(v.utmContent))
            continue;
        const a = ads.get(v.utmContent) ?? { visitors: 0, thankYou: 0 };
        if (v.firstLanding !== null)
            a.visitors++;
        if (v.thankYouAt !== null)
            a.thankYou++;
        ads.set(v.utmContent, a);
    }
    // The reminders' join link: from a day before the session to three hours
    // after its start, each person once on each side of the start.
    const before = new Set();
    const after = new Set();
    if (sessionAt !== null)
        for (const j of joins) {
            if (j.at < sessionAt - 24 * 3_600_000 || j.at > sessionAt + 3 * 3_600_000)
                continue;
            (j.at < sessionAt ? before : after).add(j.visitorId);
        }
    // The pitch links: from an hour before the start (a test click) to two
    // days after (the recording and the follow-ups carry them too).
    const pitch = { 1: new Set(), 2: new Set() };
    if (sessionAt !== null)
        for (const c of pitches)
            if (c.at >= sessionAt - 3_600_000 && c.at <= sessionAt + 48 * 3_600_000)
                pitch[c.pitch].add(c.visitorId);
    const secs = landing
        .map(v => v.landingSeconds)
        .filter((x) => x !== null && x > 0);
    const m = median(secs);
    return {
        visitors: landing.length,
        sessions: landing.reduce((t, v) => t + v.landingSessions, 0),
        views: landing.reduce((t, v) => t + v.landingViews, 0),
        formView: count(v => v.formView),
        formStart: count(v => v.formFocus),
        formSubmit: count(v => v.formSubmit),
        ctaClick: count(v => v.cta),
        thankYou: count(v => v.thankYouAt !== null),
        scroll50: count(v => (v.maxScroll ?? 0) >= 50),
        scroll75: count(v => (v.maxScroll ?? 0) >= 75),
        scroll100: count(v => (v.maxScroll ?? 0) >= 100),
        secondsMedian: m === null ? null : Math.round(m),
        videoPlays: count(v => v.landingVideo),
        thankYouVideo: count(v => v.thankYouVideo),
        thankYouVideoWatched: count(v => v.thankYouVideo75),
        calendarAdd: count(v => v.calendarAdd),
        whatsapp: count(v => v.whatsapp),
        whatsappPlaceholder: visitors.some(v => v.whatsappPlaceholder),
        surveyStart: count(v => v.surveyStart),
        surveySubmit: count(v => v.surveySubmit),
        joinBefore: before.size,
        joinAfter: after.size,
        pitch1Clicks: pitch[1].size,
        pitch2Clicks: pitch[2].size,
        mobile: landing.filter(v => v.device === "mobile").length,
        withAd: landing.filter(v => v.utmContent && AD_ID.test(v.utmContent))
            .length,
        byAd: [...ads.entries()]
            .map(([adId, a]) => ({ adId, ...a }))
            .sort((a, b) => b.visitors - a.visitors),
    };
}
