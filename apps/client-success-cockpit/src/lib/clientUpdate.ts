/**
 * What the team tells a client, in the client's own words.
 *
 * Aziz, 2026-09-27: "Most clients don't even understand what leads are, and
 * they're not seeing those in booking ... You can just say the performance
 * is going well." A client sees appointments in the calendar, and only about
 * a third of leads become one. So nothing written to a client quotes leads
 * or cost per lead: it says how the campaign is doing in plain words, counts
 * appointments only for clients we book for, and says what we did the way a
 * business owner would, never in the cockpit's own labels.
 *
 * The same file sits in the media buyer and client success cockpits;
 * scripts/check-shared.sh keeps the copies equal. The Arabic follows the
 * Kuwaiti voice rules: casual, no em dashes, no quote marks, and dollars as
 * a word with Arabic digits, never a $ sign inside Arabic.
 */

export type Lang = "ar" | "en";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** 60 -> "٦٠". */
export function arNumber(n: number): string {
  return String(n).replace(/\d/g, d => AR_DIGITS[Number(d)]);
}

/** "4 appointments" or "٤ مواعيد", with Arabic's agreement for counted nouns. */
export function appointments(n: number, lang: Lang): string {
  if (lang === "en") return `${n} appointment${n === 1 ? "" : "s"}`;
  if (n === 1) return "موعد واحد";
  if (n === 2) return "موعدين";
  if (n >= 3 && n <= 10) return `${arNumber(n)} مواعيد`;
  return `${arNumber(n)} موعد`;
}

/** "a, b and c" or "a، b، وc". */
export function joinList(items: string[], lang: Lang): string {
  if (items.length <= 1) return items[0] ?? "";
  const head = items.slice(0, -1);
  const last = items[items.length - 1];
  return lang === "en"
    ? `${head.join(", ")} and ${last}`
    : `${head.join("، ")}، و${last}`;
}

/**
 * How the campaign is doing this week, with no leads and no cost per lead.
 * One sentence, no final full stop. `weBook` is true for clients we book
 * appointments for (DFY); only then is a count of appointments said.
 */
export function howItIsGoing(
  a: { verdict?: string; bookings?: number; weBook: boolean },
  lang: Lang,
): string {
  const booked = a.weBook && (a.bookings ?? 0) > 0 ? (a.bookings ?? 0) : 0;
  const en = lang === "en";
  switch (a.verdict) {
    case "kill":
      return en ? "results have dropped" : "النتائج نزلت";
    case "fatiguing":
      return en
        ? "results have slowed a little as the current ads get tired"
        : "النتائج خفّت شوي لأن الإعلانات الحالية بدت تتعب";
    case "no delivery":
      return en
        ? "the ads are not running at the moment"
        : "الإعلانات واقفة الحين";
  }
  const steady = a.verdict === "hold" || a.verdict === "below KPI";
  if (booked > 0) {
    const count = appointments(booked, lang);
    if (en)
      return `${count} ${booked === 1 ? "was" : "were"} booked with you this week${steady ? ", and we're working to get more out of the campaign" : ""}`;
    return `انحجز لكم ${count} هالأسبوع${steady ? "، وقاعدين نشتغل عشان نطلع من الحملة أكثر" : ""}`;
  }
  if (steady)
    return en
      ? "the campaign is running steadily, and we're working to get more out of it"
      : "الحملة ماشية، وقاعدين نشتغل عليها عشان نطلع منها أكثر";
  if (a.verdict === "scale")
    return en ? "the campaign is performing well" : "الحملة ماشية زين";
  return en ? "the campaign is running" : "الحملة شغالة";
}

/** What a client hears for one change, and which kind of change it is. */
type Said = { kind: string; en: string; ar: string };

const BUDGET: Said = {
  kind: "budget",
  en: "raised the daily budget",
  ar: "رفعنا الميزانية اليومية",
};
const CUT: Said = {
  kind: "cut",
  en: "switched off the weakest ad, so the budget goes to the ads that work",
  ar: "وقفنا الإعلان الأضعف عشان الميزانية تروح للإعلانات اللي شغالة",
};

/**
 * The cockpit's words for a change (a decision's label, a request to another
 * team, a line of the change log) and what a client hears for it. A label not
 * listed here is not the client's business (Left, Watch for 3 days, a card
 * declined, Asked Aziz) or cannot be said safely without a person reading it
 * first (a change typed by hand), so it says nothing. Budgets are never given
 * as amounts: Meta holds them in the ad account's own currency, and a raise
 * is capped at 25% a step, so the label's figure is not always what happened.
 */
const SAID: [RegExp, Said][] = [
  [
    /^Scale the winner$/i,
    {
      kind: "budget",
      en: "gave more budget to your best-performing ad",
      ar: "عطينا أقوى إعلان عندكم ميزانية أكثر",
    },
  ],
  [/^Raise to /i, BUDGET],
  [/^Raised the .*budget/i, BUDGET],
  [/^Cut the worst ad$/i, CUT],
  [/^Paused ".*the worst in the campaign/i, CUT],
  [
    /^Turned off ad "/i,
    {
      kind: "cut",
      en: "switched off an ad that was not pulling its weight",
      ar: "وقفنا إعلان ما كان يعطي",
    },
  ],
  [
    /^Duplicate the winner$/i,
    {
      kind: "duplicate",
      en: "copied your best ad into a fresh test to reach more people",
      ar: "نسخنا أقوى إعلان عندكم بتجربة يديدة عشان يوصل لناس أكثر",
    },
  ],
  [
    /^Turn it off$/i,
    {
      kind: "campaign-off",
      en: "paused the campaign while we rework it",
      ar: "وقفنا الحملة لين نضبطها",
    },
  ],
  [
    /^Turned off campaign /i,
    { kind: "campaign-off", en: "paused the campaign", ar: "وقفنا الحملة" },
  ],
  [
    /^Turned on campaign /i,
    {
      kind: "campaign-on",
      en: "switched the campaign back on",
      ar: "رجعنا شغلنا الحملة",
    },
  ],
  [
    /^Queue replacement creative$/i,
    {
      kind: "new-ads",
      en: "started on new ads to replace the ones that are getting tired",
      ar: "بدينا نسوي إعلانات يديدة بدال اللي بدت تتعب",
    },
  ],
  [
    /^Thank-you video/i,
    {
      kind: "thank-you",
      en: "started a thank-you video for the people who book, so more of them turn up",
      ar: "بدينا فيديو شكر للي يحجزون عشان يحضر عدد أكبر منهم",
    },
  ],
  [
    /^Switch to a landing page/i,
    {
      kind: "landing",
      en: "started moving your ads to a landing page",
      ar: "بدينا ننقل الإعلانات على لاندنق بيج",
    },
  ],
  [
    /^Add qualification questions/i,
    {
      kind: "form",
      en: "started adding a few questions to the form, so the people who reach you are a better fit",
      ar: "بدينا نضيف كم سؤال للفورم عشان اللي يوصلونكم يكونون مناسبين أكثر",
    },
  ],
  // The change log (edit.ts, builder.ts, control.ts).
  [
    /^Built a new campaign/i,
    {
      kind: "campaign-new",
      en: "built a new campaign for you",
      ar: "سوينا لكم حملة يديدة",
    },
  ],
  [
    /^Created ad set/i,
    {
      kind: "audience",
      en: "set up a new audience to test",
      ar: "جهزنا جمهور يديد نجربه",
    },
  ],
  [
    /^Created \d+ new ads? .*new copy/i,
    {
      kind: "copy",
      en: "wrote new wording for your ads",
      ar: "كتبنا كلام يديد للإعلانات",
    },
  ],
  [
    /^Added a new video creative/i,
    {
      kind: "video-ad",
      en: "added a new video ad",
      ar: "نزلنا إعلان فيديو يديد",
    },
  ],
  [
    /^Added a new image creative/i,
    {
      kind: "image-ad",
      en: "added a new picture ad",
      ar: "نزلنا إعلان صورة يديد",
    },
  ],
  [
    /^Turned on ad "/i,
    { kind: "ad-on", en: "switched on another ad", ar: "شغلنا إعلان ثاني" },
  ],
];

/** One thing we did, in the client's words (after "we"), or null. */
export function whatWeDid(label: string, lang: Lang): string | null {
  const text = label.trim();
  for (const [pattern, said] of SAID) {
    if (pattern.test(text)) return said[lang];
  }
  return null;
}

/**
 * The things we did, oldest first, one line per kind of change: the first
 * label of a kind speaks for it, so a decision and the change-log line it
 * wrote are said once.
 */
export function whatWeDidAll(labels: string[], lang: Lang): string[] {
  const kinds = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const said = SAID.find(([pattern]) => pattern.test(label.trim()))?.[1];
    if (!said || kinds.has(said.kind)) continue;
    kinds.add(said.kind);
    out.push(said[lang]);
  }
  return out;
}

/** "3 videos" or "٣ فيديوهات", with Arabic's agreement for counted nouns. */
export function videos(n: number, lang: Lang): string {
  if (lang === "en") return `${n} video${n === 1 ? "" : "s"}`;
  if (n === 1) return "فيديو واحد";
  if (n === 2) return "فيديوين";
  if (n >= 3 && n <= 10) return `${arNumber(n)} فيديوهات`;
  return `${arNumber(n)} فيديو`;
}

/**
 * Their videos this week, in client words, or null when there is nothing to
 * say. "Finished" is only what was finished this week.
 */
export function videoNews(
  v: { finished: number; withClient: number; making: number } | undefined,
  lang: Lang,
): string | null {
  if (!v) return null;
  const en = lang === "en";
  const parts: string[] = [];
  if (v.finished > 0)
    parts.push(
      en
        ? v.finished === 1
          ? "a new video is finished"
          : `${v.finished} new videos are finished`
        : `خلصنا لكم ${v.finished === 1 ? "فيديو يديد" : videos(v.finished, lang)}`,
    );
  if (v.withClient > 0)
    parts.push(
      en
        ? `${videos(v.withClient, lang)} ${v.withClient === 1 ? "is" : "are"} with you for review`
        : `فيه ${videos(v.withClient, lang)} عندكم للمراجعة`,
    );
  if (v.making > 0)
    parts.push(
      en
        ? `we're working on ${parts.length ? `${v.making} more` : v.making === 1 ? "a new video" : `${v.making} new videos`}`
        : `قاعدين نشتغل على ${videos(v.making, lang)}`,
    );
  return parts.length ? joinList(parts, lang) : null;
}

/** A client's week as the client success cockpit receives it (fanout.ts). */
export type Week = {
  ads?: { label: string }[];
  verdict?: string;
  bookings?: number;
  weBook?: boolean;
  videos?: {
    finished: string[] | number;
    withClient: string[] | number;
    making: number;
  };
};

const count = (x: string[] | number | undefined) =>
  Array.isArray(x) ? x.length : Number(x ?? 0);

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The client success manager's "What we did this week": the ad changes a
 * client can be told, how the campaign is doing, and their videos. Null when
 * the team did nothing this week it can tell them, so the option only shows
 * when there is something real to say.
 */
export function weekUpdate(
  w: Week | undefined,
  firstName: string,
  lang: Lang,
): string | null {
  if (!w) return null;
  const done = whatWeDidAll(
    (w.ads ?? []).map(a => a.label),
    lang,
  );
  const vids = videoNews(
    w.videos
      ? {
          finished: count(w.videos.finished),
          withClient: count(w.videos.withClient),
          making: count(w.videos.making),
        }
      : undefined,
    lang,
  );
  if (done.length === 0 && !vids) return null;
  const en = lang === "en";
  const lines: string[] = [];
  if (done.length > 0 || w.verdict !== undefined) {
    const going =
      w.verdict !== undefined
        ? howItIsGoing(
            {
              verdict: w.verdict,
              bookings: w.bookings,
              weBook: w.weBook ?? true,
            },
            lang,
          )
        : "";
    const said = en
      ? [
          done.length ? `we ${joinList(done, lang)}.` : "",
          going ? `${capital(going)}.` : "",
        ]
      : [
          done.length ? `${joinList(done, lang)}.` : "",
          going ? `${going}.` : "",
        ];
    const text = said.filter(Boolean).join(" ");
    lines.push(en ? `• Ads: ${capital(text)}` : `• الإعلانات: ${text}`);
  }
  if (vids)
    lines.push(en ? `• Videos: ${capital(vids)}.` : `• الفيديوهات: ${vids}.`);
  const name = firstName.trim();
  return en
    ? `Hi${name ? ` ${name}` : ""}, a quick update on what we did for you this week:\n\n${lines.join("\n")}\n\nAnything you'd like us to focus on next week?`
    : `هلا${name ? ` ${name}` : ""}، تحديث سريع على اللي سويناه لكم هالأسبوع:\n\n${lines.join("\n")}\n\nفيه شي تبون نركز عليه الأسبوع الياي؟`;
}
