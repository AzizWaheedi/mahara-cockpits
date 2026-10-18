import type { ReactNode } from "react";
import { capitalize, count, pct } from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Na } from "@/components/ceo/Na";
import type { StatusTone } from "@/components/ceo/StatusChip";
import { range as rangeText } from "@/components/ceo/windows";
import type {
  B2bAdsPayload,
  B2bAdWindow,
  B2bPeople,
  B2bVerdict,
} from "@/types/ceo/payloads";

/**
 * The small pieces of the Ads tab's funnel lines: a "label value" fact, the
 * explained n/a, and the frequency fact with the hint that says whose number
 * it is and for which days.
 *
 * The CEO, 2026-10-16: the cockpit's frequency did not match Ads Manager
 * (8.42 on the short-form retargeting campaign against 1.86 here). The worker
 * now reads Meta's own frequency at each level, impressions over the people
 * reached across the whole window on the account's own days, so the screen
 * shows it the way Ads Manager does (two decimals) and names those days.
 */

export const NA_ZERO =
  "Nothing to divide by in this window, so there is no figure.";

/**
 * A payload stored before intros were counted once per lead (2026-10-18)
 * has no confirmed count: its intro figures are n/a, never 0, until the
 * worker's next refresh writes them.
 */
export const NA_REFRESH =
  "Counted from the next refresh: these numbers were stored before intros were counted once per lead.";

/** A number, or the explained n/a: nothing to divide by, or `na` when the reason is another. */
export function Num({
  v,
  f,
  na = NA_ZERO,
}: {
  v: number | null | undefined;
  f: (x: number) => string;
  na?: string;
}) {
  return v === null || v === undefined ? <Na hint={na} /> : f(v);
}

/**
 * One "label value" fact in a quiet line: the label muted, the value in the
 * text colour. A fact with a hint carries it on its label, which opens on
 * hover with a mouse and on a tap on a touch screen.
 */
export function Fact({
  label,
  hint,
  wrap = false,
  children,
}: {
  label: string;
  hint?: string;
  /** Let a long value break onto a second line (a name on a phone). */
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={wrap ? undefined : "whitespace-nowrap"}>
      {hint ? (
        <Hint content={hint}>
          <button
            type="button"
            aria-label={`${label}: ${hint}`}
            className="no-touch relative cursor-help rounded-sm underline decoration-muted-foreground/35 decoration-dotted underline-offset-4 after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </button>
        </Hint>
      ) : (
        label
      )}{" "}
      <span className="font-medium text-foreground">{children}</span>
    </span>
  );
}

export type StageFact = {
  label: string;
  v: number | null;
  f: (x: number) => string;
  /** What the fact counts, on its label. */
  hint?: string;
  /** Why it is n/a when it is, if not "nothing to divide by". */
  na?: string;
};

// ---- intros, each lead once ---------------------------------------------------

/**
 * The CEO, 2026-10-18: "For the demo entry on the ads, it needs fixing, so it
 * should be just on intros or intros confirmed ... The link to intro, that's
 * it. For intros, it shouldn't count re-scheduled either. It should just
 * count once." Per ad the funnel stops at the intro, counted per lead.
 */
export type IntroFigures = {
  /** False on a payload stored before 2026-10-18: every figure is null and reads n/a. */
  known: boolean;
  intros: number | null;
  confirmed: number | null;
  /** Intros over leads. */
  leadToIntro: number | null;
  /** Confirmed intros over intros. */
  confirmedShare: number | null;
  costPerIntro: number | null;
  costPerConfirmed: number | null;
  /** The n/a hint for these figures: nothing to divide by, or wait for the refresh. */
  na: string;
};

/** A window's intro figures, or all n/a on a payload from before they were counted once per lead. */
export function introFigures(w: B2bAdWindow): IntroFigures {
  if (w.leadsToConfirmedIntro === undefined)
    return {
      known: false,
      intros: null,
      confirmed: null,
      leadToIntro: null,
      confirmedShare: null,
      costPerIntro: null,
      costPerConfirmed: null,
      na: NA_REFRESH,
    };
  return {
    known: true,
    intros: w.leadsToIntro ?? null,
    confirmed: w.leadsToConfirmedIntro,
    leadToIntro: w.bookRate,
    confirmedShare: w.confirmedIntroRate ?? null,
    costPerIntro: w.costPerIntro ?? null,
    costPerConfirmed: w.costPerConfirmedIntro ?? null,
    na: NA_ZERO,
  };
}

/** Frequency the way Ads Manager shows it: two decimals. */
export const frequency = (n: number) => n.toFixed(2);

/** "Los Angeles" from "America/Los_Angeles". */
function city(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replaceAll("_", " ");
}

/**
 * What the frequency is and which days it covers: the window's first day to
 * the last day Meta has started in the account's time zone. An older payload
 * carries no `metaUntil`, so its hint names no dates.
 */
export function frequencyHint(
  windows: B2bAdsPayload["windows"],
  win: "w7" | "w30",
  scope?: "lead gen",
): string {
  const from = win === "w7" ? windows.from7 : windows.from30;
  const days = windows.metaUntil
    ? ` for ${rangeText(from, windows.metaUntil)}`
    : "";
  const zone = windows.metaTimeZone
    ? ` (Meta's days, ${city(windows.metaTimeZone)})`
    : "";
  // The account row is the lead-gen campaigns only; Ads Manager's account total
  // also counts retargeting, so the hint names what it matches.
  const what = scope ? " for the lead-gen campaigns" : "";
  const same = windows.metaUntil
    ? `Ads Manager shows the same number${what} for those dates.`
    : `Ads Manager shows the same number${what} for the window.`;
  return `Meta's own frequency${days}${zone}: impressions divided by people reached. ${same}`;
}

/** The frequency fact under impressions, when Meta gave one. */
export function frequencyFact(w: B2bAdWindow, hint: string): StageFact[] {
  return w.frequency !== null
    ? [{ label: "Freq", v: w.frequency, f: frequency, hint }]
    : [];
}

// ---- verdicts and the words around the funnel -------------------------------

/**
 * The tone of each verdict. "not_judged" is an ad in a campaign that is not
 * lead gen (retargeting, hiring): it is never held to the $15 cost per lead
 * gate, so it reads neutral and never joins scale, fatiguing or kill (the
 * audit of 2026-10-16 found 17 retargeting ads under "Scale").
 */
export const TONE: Record<B2bVerdict["verdict"], StatusTone> = {
  scale: "good",
  hold: "warning",
  kill: "critical",
  fatiguing: "warning",
  "no delivery": "neutral",
  not_judged: "neutral",
  off: "neutral",
  "leads do not book": "serious",
  "intros do not confirm": "serious",
  // On a payload stored before 2026-10-18 only.
  "intros do not convert": "serious",
  "demos do not close": "serious",
};

/** "not_judged" reads "not judged"; every other key is already words. */
export const verdictWords = (v: string) => v.replaceAll("_", " ");

/** The verdict as a chip label: "Not judged", "Scale". */
export const verdictLabel = (v: string) => capitalize(verdictWords(v));

/**
 * The header's verdict counts, biggest first, each under its own key: an ad
 * that is not judged is counted there and never inside scale, fatiguing or
 * kill. A key the screen has no tone for reads neutral.
 */
export function verdictChips(
  verdicts: B2bAdsPayload["verdicts"],
): { key: string; label: string; tone: StatusTone; n: number }[] {
  return Object.entries(verdicts)
    .filter(([, n]) => typeof n === "number" && n > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([key, n]) => ({
      key,
      label: verdictWords(key),
      tone: TONE[key as B2bVerdict["verdict"]] ?? "neutral",
      n: n ?? 0,
    }));
}

/** Fit, the setters' own call on each lead (the ROAS tags), never a stage. */
export const FIT_HINT =
  "The share of leads the setters tagged roas-qualified, out of qualified plus unqualified.";

export const LEADS_HINT = `Leads that reached the CRM, by the ROAS tags. Fit is the share of leads the setters tagged roas-qualified, out of qualified plus unqualified. Meta is Meta's own count.`;

/** Per lead, so a rebooked intro is one lead, never two. */
export const LEAD_TO_INTRO_HINT =
  "Intros over the leads that came in during the window. Per lead, so a rebooked intro counts once.";

/** The Ads tab's intro: a lead, never an appointment. */
export const INTROS_HINT =
  "Leads from these days, on this ad, that booked an intro at or after they came in. Each lead counts once however often the intro was rebooked; a lead whose intros were all cancelled, or who went straight to a demo, is not an intro. An intro marked invalid was held, so it counts. Cost is spend over intros.";

/** The CEO's rule: confirmed or showed counts as shown. */
export const CONFIRMED_INTROS_HINT =
  "Of those intros, the leads whose intro showed, or is still marked confirmed after its time. No-shows, cancelled and invalid are left out, and an intro still ahead counts once its time passes. Cost is spend over confirmed intros.";

/**
 * Who worked an ad's calls is read over the payload's thirty days (the
 * chosen days on a custom range), never the seven-day window the row shows.
 */
export function peopleDays(windows: B2bAdsPayload["windows"]): number {
  return (
    Math.round(
      (Date.parse(windows.to) - Date.parse(windows.from30)) / 86_400_000,
    ) + 1
  );
}

/** Why the setter's count can differ from Intros and Confirmed on the same row. */
export function setterHint(windows: B2bAdsPayload["windows"]): string {
  return `Counted on its own rule, so it can differ from Intros and Confirmed: the setter with the most leads in intros booked on this ad from ${rangeText(windows.from30, windows.to)}, every lead, older ones and ones with no ROAS tag included. Of those leads whose intro was due, how many showed: showed, or confirmed or invalid once its time passed (the B2B show rule). Each lead once, however often it was rebooked.`;
}

/** Why the closer's count can differ from Signed on the same row. */
export function closerHint(windows: B2bAdsPayload["windows"]): string {
  return `Counted over its own days, so it can differ from Signed: the closer with the most signed deals credited to this ad from ${rangeText(windows.from30, windows.to)}, voided deals left out.`;
}

/**
 * The setter and closer under an ad or a campaign. Their counts use their own
 * days and rule, so the line says both itself, where a phone can read it,
 * never only in a hover title (2026-10-18: "Intros 3 · Confirmed 2" sat above
 * "5 of 6 shown" with nothing on the screen to say why).
 */
export function People({
  p,
  windows,
}: {
  p: B2bPeople;
  windows: B2bAdsPayload["windows"];
}) {
  if (!p.setter && !p.closer) return null;
  const days = `${count(peopleDays(windows))} days`;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {p.setter ? (
        <span>
          <Fact label="Setter" hint={setterHint(windows)} wrap>
            {`${p.setter.name}: ${count(p.setter.shown)} of ${count(p.setter.due)} leads shown`}
          </Fact>
          {` · ${days}, every intro booked`}
        </span>
      ) : null}
      {p.closer ? (
        <span>
          <Fact label="Closer" hint={closerHint(windows)} wrap>
            {`${p.closer.name}: ${count(p.closer.closes)} signed`}
          </Fact>
          {` · ${days}`}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Constraint stages that read appointments or demos, retired on 2026-10-18.
 * A payload stored before then can still carry one; the screen leaves it out.
 */
export const RETIRED_STAGES = new Set([
  "intros due to shown",
  "intros booked to shown",
  "intros shown to demos booked",
  "demos shown to closes",
]);

/** What the "carry an ad" line counts, and whose ad a call or deal is. */
export const COVERAGE_HINT =
  "Every lead and signed deal in the CRM for the window against the ones on an ad from this account, paused ads included. The rest came in organically, by WhatsApp or by hand. Calls and deals are credited to the ad on the contact's lead record when it is one of this account's ads and was already running when the call was booked or the deal signed; otherwise they keep the ad on the call or deal.";

/** The coverage line: how much of the CRM carries one of this account's ads. */
export function coverageLine(c: B2bAdsPayload["coverage"]["w7"]): string {
  return `${count(c.adLeads)} of ${count(c.leads)} leads and ${count(c.adCloses)} of ${count(c.closes)} signed deals carry an ad from this account`;
}

/**
 * A campaign's weakest stage, said with the days it is worked out on: the
 * stored payload judges it on thirty days even in the seven-day view; a
 * custom range judges it on the chosen days (`from7` equals `from30` there).
 */
export function constraintText(
  c: { stage: string; mine: number; account: number },
  windows: B2bAdsPayload["windows"],
): string {
  const days =
    windows.from7 === windows.from30 ? "the chosen days" : "thirty days";
  return `Over ${days}, ${c.stage} runs at ${pct(c.mine)} against ${pct(c.account)} across the account.`;
}
