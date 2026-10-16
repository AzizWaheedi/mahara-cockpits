import type { ReactNode } from "react";
import { capitalize, count, pct } from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import { Na } from "@/components/ceo/Na";
import type { StatusTone } from "@/components/ceo/StatusChip";
import { range as rangeText } from "@/components/ceo/windows";
import type {
  B2bAdsPayload,
  B2bAdWindow,
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

/** A number, or the explained n/a when there is nothing to divide by. */
export function Num({ v, f }: { v: number | null; f: (x: number) => string }) {
  return v === null ? <Na hint={NA_ZERO} /> : f(v);
}

/**
 * One "label value" fact in a quiet line: the label muted, the value in the
 * text colour. A fact with a hint carries it on its label, which opens on
 * hover with a mouse and on a tap on a touch screen.
 */
export function Fact({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <span className="whitespace-nowrap">
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
};

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
  "Leads that came in during the window with an intro booked at or after they came in, over those leads. Per lead, so a rebooked intro counts once.";

export const INTROS_BOOKED_HINT =
  "Intro appointments booked in the window, rebookings included. Lead to intro counts each lead once.";

/** The same formula as the campaign constraint's intro stage. */
export const INTRO_TO_DEMO_HINT =
  "Intros shown that went on to a demo booked for the same contact, over intros shown.";

/** Confirmed, showed or invalid counts as shown: the B2B dashboard's rule. */
export const INTROS_SHOWN_HINT =
  "Intros shown over intros whose time has passed. Confirmed, showed or invalid counts as shown, the B2B dashboard's rule.";

export const DEMOS_BOOKED_HINT =
  "Demos booked in the window. Intro to demo is intros shown that went on to a demo booked for the same contact, over intros shown.";

export const DEMOS_SHOWN_HINT =
  "Demos shown over demos due. Confirmed, showed or invalid counts as shown. Cost is spend over demos shown.";

/** What the "carry an ad" line counts, and whose ad a call or deal is. */
export const COVERAGE_HINT =
  "Every lead and signed deal in the CRM for the window against the ones whose ad id is an ad on this account, paused ads included. The rest came in organically, by WhatsApp or by hand. Calls and deals are credited to the ad on the call or deal record, which can differ from the ad on the lead.";

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
