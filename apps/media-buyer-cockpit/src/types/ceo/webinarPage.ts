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

export type PageVisitor = {
  visitorId: string;
  /** Their first event anywhere on the site. */
  firstAt: number;
  /** Their first landing page view; null for someone who only saw the thank-you page. */
  firstLanding: number | null;
  landingViews: number;
  landingSessions: number;
  formView: boolean;
  formFocus: boolean;
  formSubmit: boolean;
  cta: boolean;
  maxScroll: number | null;
  landingSeconds: number | null;
  thankYouAt: number | null;
  calendarAdd: boolean;
  whatsapp: boolean;
  whatsappPlaceholder: boolean;
  surveyStart: boolean;
  surveySubmit: boolean;
  landingVideo: boolean;
  thankYouVideo: boolean;
  thankYouVideo75: boolean;
  /** The ad (utm_content) and source of their first tagged visit. */
  utmContent: string | null;
  utmSource: string | null;
  fbclid: boolean;
  device: string | null;
};

export type JoinClick = { visitorId: string; at: number };
/** A click on /p1 or /p2, the booking links shared at each pitch. */
export type PitchClick = { visitorId: string; at: number; pitch: 1 | 2 };

export type PageStats = {
  /** Distinct people who opened the landing page. */
  visitors: number;
  sessions: number;
  views: number;
  /** Visitors who saw the form, clicked into it, and sent it. */
  formView: number;
  formStart: number;
  formSubmit: number;
  /** Visitors who clicked a register button. */
  ctaClick: number;
  /** Visitors who reached the thank-you page (the page's own count of registrations). */
  thankYou: number;
  /** Visitors who read half, three quarters and all of the landing page. */
  scroll50: number;
  scroll75: number;
  scroll100: number;
  /** Median seconds on the landing page, per visitor. */
  secondsMedian: number | null;
  /** Visitors who played a testimonial on the landing page. */
  videoPlays: number;
  thankYouVideo: number;
  thankYouVideoWatched: number;
  calendarAdd: number;
  whatsapp: number;
  /** True while the thank-you page's WhatsApp button still carries the placeholder link. */
  whatsappPlaceholder: boolean;
  surveyStart: number;
  surveySubmit: number;
  /** Distinct people who opened the reminders' join link, before and after the start. */
  joinBefore: number;
  joinAfter: number;
  /** Distinct people who opened each pitch's booking link, from the start to two days after. */
  pitch1Clicks: number;
  pitch2Clicks: number;
  mobile: number;
  withAd: number;
  /** Per ad (utm_content): visitors and thank-you page views. */
  byAd: { adId: string; visitors: number; thankYou: number }[];
};

export const EMPTY_PAGE: PageStats = {
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

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Counts for one round's visitors, and the join-link clicks around its session. */
export function pageStats(
  visitors: PageVisitor[],
  joins: JoinClick[],
  sessionAt: number | null,
  pitches: PitchClick[] = [],
): PageStats {
  const landing = visitors.filter(v => v.firstLanding !== null);
  const count = (f: (v: PageVisitor) => boolean) => visitors.filter(f).length;
  const ads = new Map<string, { visitors: number; thankYou: number }>();
  for (const v of visitors) {
    if (!v.utmContent || !AD_ID.test(v.utmContent)) continue;
    const a = ads.get(v.utmContent) ?? { visitors: 0, thankYou: 0 };
    if (v.firstLanding !== null) a.visitors++;
    if (v.thankYouAt !== null) a.thankYou++;
    ads.set(v.utmContent, a);
  }
  // The reminders' join link: from a day before the session to three hours
  // after its start, each person once on each side of the start.
  const before = new Set<string>();
  const after = new Set<string>();
  if (sessionAt !== null)
    for (const j of joins) {
      if (j.at < sessionAt - 24 * 3_600_000 || j.at > sessionAt + 3 * 3_600_000)
        continue;
      (j.at < sessionAt ? before : after).add(j.visitorId);
    }
  // The pitch links: from an hour before the start (a test click) to two
  // days after (the recording and the follow-ups carry them too).
  const pitch = { 1: new Set<string>(), 2: new Set<string>() };
  if (sessionAt !== null)
    for (const c of pitches)
      if (c.at >= sessionAt - 3_600_000 && c.at <= sessionAt + 48 * 3_600_000)
        pitch[c.pitch].add(c.visitorId);
  const secs = landing
    .map(v => v.landingSeconds)
    .filter((x): x is number => x !== null && x > 0);
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
