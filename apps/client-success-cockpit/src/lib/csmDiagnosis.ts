/**
 * Constraint diagnosis for one client — "bring solutions, not updates".
 *
 * Two sources, nothing invented:
 * - The gates are the official KPI gates in kpi.ts, the media buyer's own file
 *   copied here (Aziz, 2026-10-13: "The CSM: make it $15 cost per lead and $60
 *   cost per booking"): CPL ≤ $15 · lead→booking ≥ 25% · cost per booking ≤ $60 ·
 *   close rate 20–30% · daily budget floor $30. The show rate: we aim for 70%,
 *   60% is the line, and under it is a watch, never the main constraint.
 * - The diagnosis and the fixes are the company's doc "Diagnosing & Fixing Acquisition
 *   Constraints" (macro vs micro, the golden rule, scenarios 3–6, 9, 10).
 *
 * The golden rule is enforced in the output: ONE constraint is flagged "fix this first",
 * everything else is listed as "after that". A client whose gates are all met gets
 * "nothing needs fixing — scale" instead of manufactured work. A show rate under the
 * one client line is a watch item: it sits beside the diagnosis, never in it.
 *
 * Cost per booking decides, not cost per lead (the constraints checklist's golden
 * rule): with bookings known to cost $60 or less, a cost per lead over $15 is a watch
 * line and the ads are left alone. With the cost per booking unknown or over $60, the
 * cost per lead over its gate is a constraint, and a cost per booking over $60 is one
 * of its own. A week GoHighLevel read with no bookings at all, after more than $60
 * spent, is over $60: zero bookings there is data, not a gap.
 */

import { humanise, humaniseDeep, serviceModel } from "./csmTemplates";
import {
  BOOKING_RATE_GATE,
  CLOSE_RATE_GATE,
  CPB_GATE,
  CPL_GATE,
  SHOW_RATE_GOOD,
} from "./kpi";
import { kuwaitDay, shiftDay } from "./reportPeriod";

// biome-ignore lint/suspicious/noExplicitAny: profile payloads are untyped by design
type Any = any;

export const GATES = {
  bookingRate: BOOKING_RATE_GATE,
  showRate: SHOW_RATE_GOOD,
  closeRate: CLOSE_RATE_GATE,
  cpl: CPL_GATE,
  costPerBooking: CPB_GATE,
  staleDays: 7,
} as const;

export type Constraint = {
  id: string;
  title: string;
  layer: "macro" | "micro" | "admin";
  evidence: string;
  diagnosis: string;
  fixes: string[];
  /** What the CSM says to the client about it, ready to send. */
  say?: { en: string; ar: string };
  /** Which team this becomes a ticket for, when it is not the CSM's own fix. */
  owner?: string;
};

export type Diagnosis = {
  /** The one thing to fix first. Undefined only when nothing is out of KPI. */
  top?: Constraint;
  rest: Constraint[];
  /**
   * Lines to keep an eye on: never `top`, never in `rest`, never counted: a show
   * rate under the one client line (Aziz, 2026-10-12), and a cost per lead over
   * its gate while bookings cost no more than theirs (the golden rule).
   */
  watch: Constraint[];
  /** True when every gate with enough data behind it is met. */
  healthy: boolean;
  /** Why the ranking came out this way, in one line. */
  headline: string;
  /** Sample sizes, so nobody acts on two appointments. */
  basis: string;
};

/**
 * The days a client's sheet holds bookings for, from the profile the worker
 * wrote (hermes/cockpit-sync csmProducer.ts and csmProviders.ts), so a card
 * never counts days the sheet was not read for as days with no booking:
 * missing is never zero (2026-10-22).
 *
 * - Never read (no sheet, or a read that failed with nothing kept, as with
 *   Ideal Elite's 403): `read` is false and the bookings are unknown.
 * - No longer read (a stopped client, or a read now failing after a good
 *   one): the worker keeps the old rows and sets `staleAt`, the day of the
 *   last good read. That day was read only in part, so the sheet's complete
 *   days end the day before it, and `lastRead` names it.
 * - Still read: the same rule from `performanceSyncedAt`. Read today, it ends
 *   at yesterday, as the ad spend does; read on an earlier day (the worker
 *   behind), it ends the day before and `lastRead` names that day.
 * - Read from its month tabs (no Appointments tab): only this month's and
 *   last month's tabs are read, so its bookings start on the first of last
 *   month, counted from the day of the read.
 */
export type SheetCoverage = {
  read: boolean;
  /** The first day its bookings are on record, when it is not the start of time. */
  from?: string;
  /** The last complete day the sheet was read for. */
  to?: string;
  /** The day of the last read, when it was before today. */
  lastRead?: string;
  /** Why the bookings are unknown, in a sentence, when it was never read. */
  why?: string;
};

export function sheetCoverage(
  perf: Any,
  syncedAt: unknown,
  today: string,
): SheetCoverage {
  if (!perf || perf.error || !Array.isArray(perf.appointments))
    return {
      read: false,
      why: perf?.error
        ? "The client's performance sheet could not be read, so its bookings are unknown, not zero."
        : "No performance sheet has been read for this client, so its bookings are unknown, not zero.",
    };
  const dayOf = (v: unknown): string | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0
      ? kuwaitDay(v)
      : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)
        ? v.slice(0, 10)
        : undefined;
  const readDay = dayOf(perf.staleAt) ?? dayOf(syncedAt);
  return {
    read: true,
    from:
      perf.source === "month tabs" && readDay
        ? `${shiftDay(`${readDay.slice(0, 7)}-01`, -1).slice(0, 7)}-01`
        : undefined,
    to: readDay && readDay <= today ? shiftDay(readDay, -1) : undefined,
    lastRead: readDay && readDay < today ? readDay : undefined,
  };
}

const pct = (n: number, d: number) =>
  d > 0 ? Math.round((n / d) * 100) : null;
const first = (name: string) => (name ?? "").split(/[\s—–-]/)[0] || name || "";

/**
 * Diagnose one client from their stored profile.
 *
 * Deliberately conservative: a gate is only judged when there is enough volume behind it
 * (10 leads for booking rate, 8 decided appointments for show rate, 5 attended for close
 * rate), because a 0% close rate on two calls is noise, and chasing noise is how a CSM
 * loses the client's trust.
 */
export function diagnose(p: Any): Diagnosis {
  return humaniseDeep(diagnoseRaw(p));
}

function diagnoseRaw(p: Any): Diagnosis {
  const perf = p?.performance ?? {};
  const m = perf.month ?? {};
  const l = perf.lastMonth ?? {};
  const all = perf.allTime ?? {};
  const name = first(p?.clientName ?? "");
  const stale = Number(perf.staleCount ?? 0);
  const ads: Any[] = p?.ads ?? [];
  const liveAds = ads.reduce(
    (n, c) =>
      n +
      (c.adsets ?? []).reduce(
        (k: number, s: Any) =>
          k +
          (s.ads ?? []).filter((a: Any) => /active/i.test(a.status ?? ""))
            .length,
        0,
      ),
    0,
  );
  const spend7 = ads.reduce((n, c) => n + Number(c.spend7d ?? 0), 0);
  const leads7 = ads.reduce((n, c) => n + Number(c.leads7d ?? 0), 0);
  const cpl = leads7 > 0 ? spend7 / leads7 : null;
  // Done with you: the client books their own, so cost per lead alone decides.
  const dwy = serviceModel(p?.service).dwy;
  // Cost per booking over the same 7 days, only where the sync read the
  // client's GoHighLevel. Bookings are counted per campaign (Muhammed,
  // 2026-10-13), so they add up against the spend of the campaigns that carry
  // them. A campaign without the count is unknown (the read failed or never
  // ran): missing is never zero.
  const tracked = ads.filter(
    c => typeof c.bookings7d === "number" && Number.isFinite(c.bookings7d),
  );
  const bookings7 = tracked.reduce((n, c) => n + Number(c.bookings7d), 0);
  const bookedSpend7 = tracked.reduce((n, c) => n + Number(c.spend7d ?? 0), 0);
  const cpb =
    !dwy && bookings7 > 0 && bookedSpend7 > 0 ? bookedSpend7 / bookings7 : null;
  // GoHighLevel was read and the week booked nothing: that is data, not a gap.
  // Once more than one booking's worth of spend has gone, bookings are known
  // to cost over the gate, though there is no number to put on them.
  const noBookings = !dwy && tracked.length > 0 && bookings7 === 0;

  // Two months of the client's own sheet — enough volume to judge, recent enough to act.
  const leads = Number(m.leads ?? 0) + Number(l.leads ?? 0);
  const booked = Number(m.booked ?? 0) + Number(l.booked ?? 0);
  const shows = Number(m.shows ?? 0) + Number(l.shows ?? 0);
  const noshows = Number(m.noshows ?? 0) + Number(l.noshows ?? 0);
  const closes = Number(m.closes ?? 0) + Number(l.closes ?? 0);
  const decided = shows + noshows;
  const bookingRate = pct(booked, leads);
  const showRate = pct(shows, decided);
  const closeRate = pct(closes, shows);

  // Cost per booking is judged on any volume: it already holds more than one
  // booking's worth of spend, so it is never noise. Only the cost per lead
  // waits for 5 leads. Behind a 5-lead floor, Castello's $188.98 for 3 leads
  // and 1 booking (7 days to 3 Oct) and Khalida's $192.52 for 4 leads and
  // none (7 days to 1 Oct) were never raised (2026-10-21).
  const cplOver = cpl != null && cpl > GATES.cpl;
  const unbooked = noBookings && bookedSpend7 > GATES.costPerBooking;
  const cpbOver = (cpb != null && cpb > GATES.costPerBooking) || unbooked;
  // No leads at all after a booking's worth of spend: the ads, not the calls.
  const adsSide = cplOver || leads7 === 0;

  const found: Constraint[] = [];
  const watch: Constraint[] = [];

  // ---- Admin blockers first: without the sheet there is nothing to diagnose. ----
  if (!p?.links?.sheet) {
    found.push({
      id: "no_sheet",
      layer: "admin",
      title: "No performance sheet is linked, this client cannot be diagnosed",
      evidence: "The Sheet Link field on their ClickUp record is empty.",
      diagnosis:
        "Without their sheet we have no leads, no appointments and no outcomes for them, so every conversation is opinion against opinion.",
      fixes: [
        "Find or create their tracking sheet from the client drive.",
        "Paste it into the Sheet Link field on their ClickUp record.",
        "Confirm the caller has edit access and knows the Appointments tab is the one to fill.",
      ],
      owner: "CSM",
    });
  } else if (stale >= 5) {
    found.push({
      id: "sheet_not_filled",
      layer: "admin",
      title: `${stale} appointments have no outcome, the sheet is not being filled`,
      evidence: `${stale} rows on their Appointments tab have no attended/closed answer${
        perf.staleOldestDays ? `, oldest ${perf.staleOldestDays} days` : ""
      }.`,
      diagnosis:
        "Every unfilled row reads as a loss in the report we send them, and we are optimising the ads blind. This is the cheapest constraint on the list to fix and it blocks judging every other one.",
      fixes: [
        "Send the list of unfilled rows in the group, names only, and ask for attended / closed against each.",
        "If nobody has filled it in for over two weeks, get on a call, do not keep asking over WhatsApp.",
        "Agree who on their side owns the sheet and put their name in the group.",
        "Re-check before the next check-in call and open the call with the corrected numbers.",
      ],
      say: {
        en: `Hey ${name}, I need a hand on the tracking sheet, ${stale} of the appointments we sent have no outcome filled in, so they currently read as nothing happened.\n\nCan you or whoever handles the calls go through them and mark attended or not, and closed or not? It takes ten minutes and it changes what I can do with your budget: I optimise towards the type of lead that actually closes for you, and right now I'm optimising half blind.`,
        ar: `هلا ${name}، أحتاج مساعدتك بشيت المتابعة, ${stale} موعد من اللي أرسلناهم ما فيهم نتيجة، فحالياً يظهرون كأن ما صار فيهم شي.\n\nتقدر أنت أو اللي يتابع المكالمات يمر عليهم ويحدد: حضر ولا لا، وتقفل ولا لا؟ يأخذ عشر دقايق ويغيّر شغلي على ميزانيتك: أنا أحسّن الحملة تجاه نوع الليد اللي يتقفل عندك فعلاً، والحين أحسّن ونص الصورة ناقصة.`,
      },
      owner: "CSM",
    });
  }

  // ---- Is the machine even running? ----
  if (p?.stage && /live|active|manag/i.test(p.stage) && liveAds === 0) {
    found.push({
      id: "nothing_live",
      layer: "macro",
      title: "No active ads are running for a live client",
      evidence: `${ads.length} campaigns synced, none with an active ad.`,
      diagnosis:
        "A paying client with nothing live churns on the day they notice. Everything else on this list is irrelevant until traffic is flowing again.",
      fixes: [
        "Check the ad account for billing failures first, a declined card is the most common cause.",
        "Raise a ticket to the media buyer with the client name and the ad account.",
        "Tell the client yourself today, before they open Ads Manager and find it.",
      ],
      owner: "Media buyer",
    });
  } else if (leads7 >= 5 || cpbOver) {
    // ---- Cost: per booking decides, per lead only when per booking cannot. ----
    if (cpbOver) {
      const fewBook = unbooked
        ? "none of them booked, so the week's spend bought no appointments"
        : "too few of them book, so every appointment costs more than it should";
      const ticket =
        "Raise a ticket to the media buyer with the cost per booking: judge the ads on bookings, and cut the ad with the worst cost per booking, not the worst cost per lead.";
      // Done for you: our call centre calls their leads, so how fast and how
      // often they are called is ours to check, never the client's (the call
      // centre review, 2026-10-13). Done with you: the client calls their own.
      const ourCalls = !dwy;
      const speed = ourCalls
        ? "Check the client's Calls section: first call time, dials per lead and why leads were lost."
        : "Ask how fast their leads get called and how many times, before anything changes in the account.";
      found.push({
        id: "cpb_high",
        layer: "micro",
        title:
          cpb != null
            ? `Cost per booking is $${cpb.toFixed(2)} against a $${GATES.costPerBooking} gate`
            : `No bookings from $${bookedSpend7.toFixed(0)} spent in the last 7 days, against a $${GATES.costPerBooking} gate`,
        evidence: `$${bookedSpend7.toFixed(0)} spent in the last 7 days for ${bookings7} ${bookings7 === 1 ? "booking" : "bookings"} from ${leads7} leads.`,
        diagnosis: !leads7
          ? "The week's spend brought no leads at all, so it is the ads, not the calls."
          : cplOver
            ? `The leads cost more than the gate and ${fewBook}. Cost per booking is the number that decides.`
            : ourCalls
              ? `The leads are cheap enough, but ${fewBook}. That is usually how fast and how often our call centre calls the leads, not the ads.`
              : `The leads are cheap enough, but ${fewBook}. That is usually speed to lead on the client's side, not the ads.`,
        // Cheap leads put the calls first: the brief shows one fix. No leads
        // leave no calls to check.
        fixes: [
          ...(!leads7 ? [ticket] : adsSide ? [ticket, speed] : [speed, ticket]),
          "Do not promise the client a lower cost on the call; promise the change and a date.",
        ],
        owner: adsSide ? "Media buyer" : ourCalls ? "Call centre" : "CSM",
      });
    }
    // The cost per lead keeps its 5-lead floor: on fewer it is noise.
    const cplJudged = leads7 >= 5 && cplOver;
    if (cpl != null && cplJudged && cpb != null && !cpbOver)
      watch.push({
        id: "cpl_watch",
        layer: "micro",
        title: `Cost per lead is $${cpl.toFixed(2)}, over the $${GATES.cpl} gate, but bookings still cost $${cpb.toFixed(2)}, ${cpb < GATES.costPerBooking ? "under" : "on"} the $${GATES.costPerBooking} gate`,
        evidence: `$${spend7.toFixed(0)} spent in the last 7 days for ${leads7} leads and ${bookings7} ${bookings7 === 1 ? "booking" : "bookings"}.`,
        diagnosis:
          "Cost per booking decides, not cost per lead, so a higher cost per lead is not the constraint while those leads still book.",
        fixes: [
          `Bookings still cost ${cpb < GATES.costPerBooking ? "under" : "no more than"} $${GATES.costPerBooking}, so leave the ads alone. Look again if cost per booking passes the gate.`,
        ],
        owner: "Media buyer",
      });
    else if (cpl != null && cplJudged)
      found.push({
        id: "cpl_high",
        layer: "micro",
        title: `Cost per lead is $${cpl.toFixed(2)} against a $${GATES.cpl} gate`,
        evidence: `$${spend7.toFixed(0)} spent in the last 7 days for ${leads7} leads${
          cpb != null
            ? `, and each booking costs $${cpb.toFixed(2)}.`
            : unbooked
              ? ", and no bookings in those 7 days."
              : noBookings
                ? ". No bookings yet in those 7 days, so the cost per lead decides."
                : ". No cost per booking to weigh it against, so the cost per lead decides."
        }`,
        diagnosis:
          "Their cost per lead is above the gate, so the same budget is buying fewer chances. Creative fatigue and a high cost per booking are the only two things that force a decision here.",
        fixes: [
          "Raise a ticket to the media buyer: creative refresh, this account, with the current CPL.",
          "Check the last creative refresh date, anything past 14 days is due.",
          "Do not promise the client a lower CPL on the call; promise the refresh and a date.",
        ],
        owner: "Media buyer",
      });
  }

  // ---- Micro leaks, in the doc's own diagnostic order. ----
  if (bookingRate != null && leads >= 10 && bookingRate < GATES.bookingRate) {
    found.push({
      id: "booking_rate",
      layer: "micro",
      title: `Only ${bookingRate}% of leads become appointments (gate ${GATES.bookingRate}%)`,
      evidence: `${booked} appointments from ${leads} leads over the last two months.`,
      diagnosis:
        "This is a nurture and speed-to-lead problem on the client's side, not an ads problem. Someone who fills a form has not decided to hire anyone yet, whoever calls first usually wins.",
      fixes: [
        "Ask how fast leads get called, and who calls them. Anything slower than 5 minutes is the constraint.",
        "Check whether every lead is called more than once, most teams call once and stop.",
        "Get the follow-up sequence switched on in their sub-account (ticket to tech if it is off).",
        "If they have more than 2–3 leads a day and the owner is the one calling, recommend a dedicated person to call leads.",
      ],
      say: {
        en: `Hey ${name}, I looked at the last two months properly. The ads are producing ${leads} enquiries, and ${booked} of them turned into an appointment, that gap is where your money is going, not in the ads.\n\nThe single biggest lever is how fast someone calls a new enquiry, and how many times they try. Can we get 15 minutes to go through your follow-up? I'll set up the automatic follow-up from our side too.`,
        ar: `هلا ${name}، راجعت آخر شهرين بالتفصيل. الإعلانات جابت ${leads} استفسار، وصار منهم ${booked} موعد فقط, الفرق هذا هو مكان الفلوس، مو بالإعلانات.\n\nأكبر عامل هو سرعة الاتصال بالاستفسار الجديد وعدد مرات المحاولة. نقدر نأخذ ١٥ دقيقة نراجع المتابعة عندكم؟ وأنا أضبط المتابعة الأوتوماتيكية من طرفنا.`,
      },
      owner: "CSM",
    });
  }

  // One line for clients, and under it is a watch, never the first fix: bad is
  // cost per booking or cost per lead (Aziz, 2026-09-21 and 2026-10-12).
  if (showRate != null && decided >= 8 && showRate < GATES.showRate) {
    watch.push({
      id: "show_rate",
      layer: "micro",
      title: `Show rate is ${showRate}%, under the ${GATES.showRate}% line`,
      evidence: `${shows} attended out of ${decided} appointments with an outcome over the last two months.`,
      diagnosis: `${100 - showRate}% of appointments with an outcome were no-shows; confirmation discipline fixes it, not more leads.`,
      fixes: [
        "Confirm every appointment twice: right after booking, and the morning of.",
        "Same-day or next-day appointments only, the further out the slot, the more no-shows.",
        "Have them send a voice note before the meeting rather than a text; it lifts attendance.",
        "Get the reminder sequence switched on in their sub-account (ticket to tech).",
      ],
      owner: "CSM",
    });
  }

  if (closeRate != null && shows >= 5 && closeRate < GATES.closeRate) {
    found.push({
      id: "close_rate",
      layer: "micro",
      title: `Close rate is ${closeRate}% of attended (gate ${GATES.closeRate}–30%)`,
      evidence: `${closes} closed from ${shows} attended appointments over the last two months.`,
      diagnosis:
        "80% of the time this is a sales-skill problem, not a lead-quality problem. Never let their salesperson's 'the leads are bad' trigger a funnel rebuild, audit the calls first.",
      fixes: [
        "Ask for two call recordings before you accept 'bad leads'. If the people are in their market, it is a sales problem.",
        "Check what they quote and how fast, slow quotes lose projects that were already won.",
        "Offer the sales training or the placement service if the person selling is the constraint.",
        "Only after the recordings say otherwise, raise a lead-quality ticket to the media buyer with the evidence.",
      ],
      say: {
        en: `Hey ${name}, the appointments are happening, ${shows} in the last two months, and ${closes} closed. Before I touch anything on the ads I want to hear two of those calls, because that tells us whether it's who we're sending or how the conversation is going.\n\nCan you send me two recordings, one that closed and one that didn't? Then I'll come to the next call with something specific rather than guesses.`,
        ar: `هلا ${name}، المواعيد تصير, ${shows} بآخر شهرين, وتقفل منها ${closes}. قبل ما أعدل شي بالإعلانات أبي أسمع مكالمتين، لأن هذا اللي يبين لنا: هل المشكلة بمن نرسل، ولا بطريقة المكالمة نفسها.\n\nترسل لي تسجيلين، واحد تقفل وواحد لا؟ وأنا أجي بالمكالمة القادمة بشي محدد بدال التخمين.`,
      },
      owner: "CSM",
    });
  }

  // ---- Macro check: everything broken at once is one problem, not four. ----
  // A gate counts as broken only on the same sample its own check needs
  // (10 leads, 5 shows), and "never closed" needs the sheet's all-time total
  // to be there: missing is not zero. The show rate is not a gate here: it is
  // a watch, so it can never tip a client into this constraint (2026-10-12).
  const gates = [
    bookingRate != null && leads >= 10 && bookingRate < GATES.bookingRate,
    closeRate != null && shows >= 5 && closeRate < GATES.closeRate,
  ];
  const everyGateBroken = gates.every(Boolean);
  const neverClosed = typeof all.closes === "number" && all.closes === 0;
  if (everyGateBroken && neverClosed && leads >= 20) {
    found.unshift({
      id: "macro_offer",
      layer: "macro",
      title:
        "Booking and closing are both under target and nothing has ever closed, treat this as one problem",
      evidence: `${leads} leads, ${booked} booked, ${shows} attended, 0 closed ever on their sheet.`,
      diagnosis:
        "When booking and closing both fail at once, the constraint is upstream: the offer or the message is attracting the wrong people. Patching each leak separately wastes months, this is a macro constraint.",
      fixes: [
        "Book a reset call, not a check-in. Use the reset call framework.",
        "Rebuild the offer and the message with them: who exactly, what project size, what price.",
        "Bring the creative strategist in, this is not a bid or budget tweak.",
        "Agree one metric to move in the next 14 days and nothing else.",
      ],
      owner: "CSM + creative strategist",
    });
  }

  // ---- Relationship risk sits alongside the funnel, it is never the top fix. ----
  const pocDays = Number(p?.pocDays ?? Number.NaN);
  if (Number.isFinite(pocDays) && pocDays > 7) {
    found.push({
      id: "silence",
      layer: "admin",
      title: `${pocDays} days since we last spoke to them`,
      evidence: "No proactive message logged in over a week.",
      diagnosis:
        "Churn does not start with a bad result, it starts with silence. The SOP floor is three touches a week once they are ramped.",
      fixes: [
        "Send something today, numbers, a new creative, anything real.",
        "Book the next check-in call in the same message.",
      ],
      owner: "CSM",
    });
  }

  // No em dashes in anything the client reads.
  for (const c of [...found, ...watch])
    if (c.say) c.say = { en: humanise(c.say.en), ar: humanise(c.say.ar) };

  // Done with you: the client books and tracks their own appointments, so we are not
  // accountable for the sheet or for anything downstream of the lead. Judging them on
  // booking, attendance and close rates would send the CSM chasing work that is not ours.
  const DWY_BLIND = new Set([
    "no_sheet",
    "sheet_not_filled",
    "booking_rate",
    "show_rate",
    "close_rate",
    "macro_offer",
    "cpb_high",
  ]);
  const ranked = dwy ? found.filter(c => !DWY_BLIND.has(c.id)) : found;
  const healthy = ranked.length === 0;
  const basis = dwy
    ? [
        `${leads7} leads in the last 7 days`,
        cpl != null
          ? `cost per lead $${cpl.toFixed(2)}`
          : "no cost per lead yet",
        "done with you, so lead volume and cost per lead only",
      ].join(" · ")
    : [
        `${leads} leads`,
        `${booked} booked`,
        `${decided} with an outcome`,
        `${closes} closed`,
        "last two months of their sheet",
      ].join(" · ");

  const watched = dwy ? watch.filter(c => !DWY_BLIND.has(c.id)) : watch;
  const watching = watched
    .map(c => (c.id === "show_rate" ? "the show rate" : "the cost per lead"))
    .join(" and ");
  return {
    top: ranked[0],
    rest: ranked.slice(1),
    watch: watched,
    healthy,
    headline: healthy
      ? dwy
        ? "Lead volume and cost per lead are both inside the gates. They book their own appointments, so ask about their close rate on the call rather than reporting it."
        : watched.length > 0
          ? `Nothing needs fixing first. Keep an eye on ${watching} below, and ask for a review, a referral or more budget.`
          : Number(m.leads ?? 0) > 0
            ? "Every gate with enough data behind it is met. Do not manufacture work here, ask for a review, a referral or more budget."
            : "Nothing is out of KPI, but there is not enough data yet to judge. Get the sheet filled and come back to it."
      : `Fix ${ranked[0].title.toLowerCase()} first. ${ranked.length - 1 > 0 ? `${ranked.length - 1} more below, one leak at a time.` : "One leak at a time."}`,
    basis,
  };
}
