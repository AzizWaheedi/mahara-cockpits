/**
 * Constraint diagnosis for one client — "bring solutions, not updates".
 *
 * Two sources, nothing invented:
 * - The gates are Mahara's locked client KPI gates: CPL < $20 · lead→booking ≥ 25% ·
 *   cost per booking ≤ $80 · show rate ≥ 75% · close rate 20–30% · daily budget floor $30.
 * - The diagnosis and the fixes are the company's doc "Diagnosing & Fixing Acquisition
 *   Constraints" (macro vs micro, the golden rule, scenarios 3–6, 9, 10).
 *
 * The golden rule is enforced in the output: ONE constraint is flagged "fix this first",
 * everything else is listed as "after that". A client whose gates are all met gets
 * "nothing needs fixing — scale" instead of manufactured work.
 */

import { humanise, humaniseDeep, serviceModel } from "./csmTemplates";

// biome-ignore lint/suspicious/noExplicitAny: profile payloads are untyped by design
type Any = any;

export const GATES = {
  bookingRate: 25,
  showRate: 75,
  closeRate: 20,
  cpl: 20,
  costPerBooking: 80,
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
  /** True when every gate with enough data behind it is met. */
  healthy: boolean;
  /** Why the ranking came out this way, in one line. */
  headline: string;
  /** Sample sizes, so nobody acts on two appointments. */
  basis: string;
};

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

  const found: Constraint[] = [];

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
  } else if (cpl != null && cpl > GATES.cpl && leads7 >= 5) {
    found.push({
      id: "cpl_high",
      layer: "micro",
      title: `Cost per lead is $${cpl.toFixed(2)} against a $${GATES.cpl} gate`,
      evidence: `$${spend7.toFixed(0)} spent in the last 7 days for ${leads7} leads.`,
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

  if (showRate != null && decided >= 8 && showRate < GATES.showRate) {
    found.push({
      id: "show_rate",
      layer: "micro",
      title: `Show rate is ${showRate}% (gate ${GATES.showRate}%)`,
      evidence: `${shows} attended out of ${decided} appointments with an outcome over the last two months.`,
      diagnosis:
        "Below 70% they are not just losing deals, they are losing 40% of their own selling time to empty slots. This is fixed with confirmation discipline, not more leads.",
      fixes: [
        "Confirm every appointment twice: right after booking, and the morning of.",
        "Same-day or next-day appointments only, the further out the slot, the more no-shows.",
        "Have them send a voice note before the meeting rather than a text; it lifts attendance.",
        "Get the reminder sequence switched on in their sub-account (ticket to tech).",
      ],
      say: {
        en: `Hey ${name}, one thing is costing you more than anything else right now: ${100 - showRate}% of the appointments booked are not being attended. That is your team's time, not just leads.\n\nTwo changes fix most of it, book people in the same or next day rather than later in the week, and confirm twice: once when it's booked, once the morning of. I'll switch on the automatic reminders from our side today.`,
        ar: `هلا ${name}، فيه شي يكلفك أكثر من أي شي ثاني حالياً: ${100 - showRate}% من المواعيد المحجوزة ما يتم حضورها. وهذا وقت فريقك، مو بس ليدز.\n\nتغييرين يحلون أغلبها, احجزوا نفس اليوم أو اليوم اللي بعده بدال آخر الأسبوع، وأكدوا مرتين: أول ما يتحجز، وصباح نفس اليوم. وأنا أشغّل التذكيرات الأوتوماتيكية من طرفنا اليوم.`,
      },
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
  const brokenGates = [
    bookingRate != null && bookingRate < GATES.bookingRate,
    showRate != null && showRate < GATES.showRate,
    closeRate != null && closeRate < GATES.closeRate,
  ].filter(Boolean).length;
  if (brokenGates >= 3 && Number(all.closes ?? 0) === 0 && leads >= 20) {
    found.unshift({
      id: "macro_offer",
      layer: "macro",
      title:
        "Every stage is leaking and nothing has ever closed, treat this as one problem",
      evidence: `${leads} leads, ${booked} booked, ${shows} attended, 0 closed ever on their sheet.`,
      diagnosis:
        "When every metric is broken at once, the constraint is upstream: the offer or the message is attracting the wrong people. Patching each leak separately wastes months, this is a macro constraint.",
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
  for (const c of found)
    if (c.say) c.say = { en: humanise(c.say.en), ar: humanise(c.say.ar) };

  // Done with you: the client books and tracks their own appointments, so we are not
  // accountable for the sheet or for anything downstream of the lead. Judging them on
  // booking, attendance and close rates would send the CSM chasing work that is not ours.
  const dwy = serviceModel(p?.service).dwy;
  const DWY_BLIND = new Set([
    "no_sheet",
    "sheet_not_filled",
    "booking_rate",
    "show_rate",
    "close_rate",
    "macro_offer",
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

  return {
    top: ranked[0],
    rest: ranked.slice(1),
    healthy,
    headline: healthy
      ? dwy
        ? "Lead volume and cost per lead are both inside the gates. They book their own appointments, so ask about their close rate on the call rather than reporting it."
        : Number(m.leads ?? 0) > 0
          ? "Every gate with enough data behind it is met. Do not manufacture work here, ask for a review, a referral or more budget."
          : "Nothing is out of KPI, but there is not enough data yet to judge. Get the sheet filled and come back to it."
      : `Fix ${ranked[0].title.toLowerCase()} first. ${ranked.length - 1 > 0 ? `${ranked.length - 1} more below, one leak at a time.` : "One leak at a time."}`,
    basis,
  };
}
