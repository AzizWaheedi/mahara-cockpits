/**
 * Which proof to send a lead: B2B's sales assets (copied into the cockpit
 * every hour), picked the way B2B's b2b_asset_shortlist picks them, for the
 * lead's own objections and where they are in the sale.
 *
 * The order: an asset that answers more of this lead's objections first,
 * then one made for their stage, then by the kind of proof (a real result,
 * then a client saying it, then an answer written for the objection, then
 * how it works, who we are, the process), then the most focused (fewest
 * objections), the shortest and the newest. Only what B2B allows to be sent
 * (sendable) and the canonical copy of each.
 */

export interface Asset {
  id: string;
  slug: string;
  title: string;
  asset_type: string;
  send_when: string | null;
  stages: string[];
  objections: string[];
  industries: string[];
  proof_types: string[];
  language: string | null;
  what_it_proves: string | null;
  paste_message_ar: string | null;
  paste_message_en: string | null;
  does_not_cover: string | null;
  url: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  is_canonical: boolean;
  sendable: boolean;
  send_count: number | null;
}

const PROOF_ORDER = [
  "result",
  "social_proof",
  "objection_handler",
  "mechanism",
  "authority",
  "process",
];

const PROOF_WHY = [
  "A real result, not an explanation",
  "A client says it, not us",
  "Written to answer this objection",
  "Shows how it works rather than claiming it",
  "Establishes who we are",
  "Walks through the process",
  "Background on the topic",
];

export function proofRank(a: Pick<Asset, "proof_types">): number {
  const i = PROOF_ORDER.findIndex(p => a.proof_types.includes(p));
  return i === -1 ? PROOF_ORDER.length : i;
}

export interface AssetPick {
  asset: Asset;
  /** The lead's objections this asset answers. */
  answers: string[];
  why: string;
}

export function shortlist(
  assets: Asset[],
  want: {
    objections: string[];
    stage: string | null;
    language: "ar" | "en" | null;
  },
  limit = 3,
): AssetPick[] {
  const scored = assets
    .filter(
      a =>
        a.sendable &&
        a.is_canonical &&
        (!want.language ||
          !a.language ||
          a.language === want.language ||
          a.language === "mixed"),
    )
    .map(a => ({
      a,
      answers: want.objections.filter(o => a.objections.includes(o)),
      stage: want.stage && a.stages.includes(want.stage) ? 1 : 0,
      proof: proofRank(a),
    }))
    .filter(x => x.answers.length || x.stage);
  scored.sort(
    (x, y) =>
      y.answers.length - x.answers.length ||
      y.stage - x.stage ||
      x.proof - y.proof ||
      (x.a.objections.length || 99) - (y.a.objections.length || 99) ||
      (x.a.duration_seconds ?? 99_999) - (y.a.duration_seconds ?? 99_999) ||
      String(y.a.published_at ?? "").localeCompare(
        String(x.a.published_at ?? ""),
      ),
  );
  return scored.slice(0, limit).map(x => ({
    asset: x.a,
    answers: x.answers,
    why: PROOF_WHY[x.proof],
  }));
}

/**
 * The objections in a call's notes, as the library's words. The notes are
 * the desk's (English, sometimes Arabic); anything not recognised is left
 * out rather than guessed.
 */
const OBJECTION_WORDS: [string, RegExp][] = [
  [
    "burned_before",
    /burn|tried (it|this|agencies|before)|bad experience|another agency failed|جربنا|جربت|تجربة سيئة/i,
  ],
  [
    "price_too_high",
    /price|expensive|cost too|too much|pricey|غالي|السعر|سعر/i,
  ],
  [
    "no_budget_now",
    /budget|can'?t afford|cash ?flow|money right now|ميزانية|ما عندي فلوس/i,
  ],
  [
    "ad_spend_required",
    /ad spend|ads budget|spend on ads|media budget|ميزانية الإعلانات|صرف إعلاني/i,
  ],
  ["doubt_results", /results?|guarantee|doubt|will it work|prove|نتائج|ضمان/i],
  [
    "not_my_niche",
    /niche|our industry|our field|different market|not for us|مجالنا|مجال مختلف/i,
  ],
  ["trust_unknown", /trust|scam|legit|who are you|never heard|ثقة|نصب/i],
  [
    "lead_quality",
    /lead quality|unqualified|bad leads|serious clients|time.?wasters|جودة|جادين/i,
  ],
  [
    "capacity",
    /capacity|too busy|can'?t handle|workload|ضغط الشغل|ما نقدر نستقبل/i,
  ],
  [
    "do_it_inhouse",
    /in.?house|our own team|do it ourselves|hire (a )?marketer|فريقنا|بنفسنا/i,
  ],
  [
    "how_it_works",
    /how (it|does it|this) works?|the process|what exactly|mechanism|شلون|كيف/i,
  ],
  [
    "timing",
    /timing|later|next (month|quarter|year)|not now|after (ramadan|summer|eid)|بعدين|مو الحين|الوقت/i,
  ],
  [
    "decision_maker",
    /partner|decision|boss|manager has to|consult|الشريك|أشاور|القرار/i,
  ],
  ["commitment", /contract|commit|lock.?in|long term|minimum|عقد|التزام/i],
  [
    "competitor",
    /competitor|other agenc|already (have|work with) an? agency|منافس|وكالة ثانية/i,
  ],
  ["no_show_risk", /no.?show|didn'?t (show|attend)|missed the call/i],
];

export function objectionsFrom(texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const [value, re] of OBJECTION_WORDS) if (re.test(t)) out.add(value);
  }
  return [...out];
}

/** Where a lead is in the sale, as the library's stages, from their pipeline stage's meaning. */
export function assetStage(role: string | null | undefined): string | null {
  switch (role) {
    case "new":
    case "hot":
    case "nurture_short":
    case "intro_booked":
    case "intro_confirmed":
    case "intro_cancelled":
    case "intro_noshow":
      return "pre_intro";
    case "no_progress":
      return "post_intro";
    case "demo_booked":
    case "demo_cancelled":
    case "demo_noshow":
      return "pre_demo";
    case "deposit":
      return "negotiation";
    case "nurture_long":
    case "paused":
    case "lost":
      return "revival";
    case "won":
      return "onboarding";
    default:
      return null;
  }
}

/**
 * The message to send with an asset: the library's own message in the
 * lead's language, with the link at the end if the message does not carry
 * it already.
 */
export function assetMessage(a: Asset, language: "ar" | "en"): string {
  const text =
    (language === "ar" ? a.paste_message_ar : a.paste_message_en) ??
    a.paste_message_en ??
    a.paste_message_ar ??
    a.title;
  const body = String(text).trim();
  if (!a.url || body.includes(a.url)) return body;
  return `${body}\n${a.url}`;
}

export function durationWords(s: number | null | undefined): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}
