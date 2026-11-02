import type {
  FunnelStep,
  PageFormListed,
  PageFormPage,
} from "./pageFormClient";
import { type Range, rangeDays } from "./range";

/**
 * A lead page in Open funnel, shown the way an instant form is: the steps a
 * lead goes through, the phone, Edit form and the versions. Muhammed,
 * 2026-10-27: "I want the lead page form to be the same as the instant form
 * funnel, so the media buyer won't be confused. He has one button to edit
 * the funnel, whether it's an instant form or a lead page form."
 */

const host = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

/** The client form page a website ad opens, matched on the link's host (its path and tags may differ). */
export function pageForUrl(
  list: PageFormListed[] | undefined,
  url: string | undefined,
): PageFormListed | undefined {
  const want = host(url);
  return want ? list?.find(p => host(p.siteUrl) === want) : undefined;
}

/** The page counts its visits 7, 30 or 90 days back from now: the window nearest the sheet's dates. */
export function visitDays(range: Range): 7 | 30 | 90 {
  const n = rangeDays(range);
  return n <= 7 ? 7 : n <= 30 ? 30 : 90;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The campaign line: the page by name and its questions, as an instant form is named. */
export function pageLine(page: PageFormPage, ads: number): string {
  const questions = page.current?.questions.length;
  return [
    `Lead page “${page.title}”`,
    ...(questions === undefined ? [] : [plural(questions, "question")]),
    plural(ads, "ad"),
  ].join(" · ");
}

export type PageRailQuestion = {
  key: string;
  label: string;
  /** The phone's screen: 1 for the first question. */
  screen: number;
  visits: number | null;
  leak: boolean;
};

export type PageRailStep = {
  id: "intro" | "questions" | "contact" | "thanks";
  name: string;
  detail: string;
  /** The phone's screen for this step; null where the preview has none. */
  screen: number | null;
  visits: number | null;
  leak: boolean;
  questions?: PageRailQuestion[];
};

/**
 * Where most visitors stop: the screen they left from, by the most visits
 * lost before the next one. The last step (send to thank-you) is the CRM
 * saving the lead, not the visitor leaving, so it never counts.
 */
export function leakScreen(steps: FunnelStep[] | undefined): string | null {
  let worst: { screen: string; lost: number } | null = null;
  for (let i = 1; i < (steps?.length ?? 0); i++) {
    const s = steps as FunnelStep[];
    if (s[i].screen === "thanks") continue;
    const lost = s[i - 1].visits - s[i].visits;
    if (lost > 0 && (!worst || lost > worst.lost))
      worst = { screen: s[i - 1].screen, lost };
  }
  return worst?.screen ?? null;
}

/**
 * Every screen a lead goes through on the page, in the page's order, with
 * the visits that reached each one when they are known. The contact step
 * also names how many pressed send, so a leak there is people who stopped
 * on it.
 */
export function pageJourney(
  page: PageFormPage,
  steps?: FunnelStep[],
): PageRailStep[] {
  const questions = page.current?.questions ?? [];
  const seen = new Map((steps ?? []).map(s => [s.screen, s.visits]));
  const visits = (screen: string) => seen.get(screen) ?? null;
  const leak = leakScreen(steps);
  const bound = questions.filter(q => page.bindings[q.key]).length;
  const fields =
    bound === questions.length
      ? "Each answer fills its own CRM field."
      : bound === 0
        ? "The answers go to the CRM's Answers field."
        : `${plural(bound, "answer")} fill their own CRM field. The rest go to the Answers field.`;
  const send = visits("send");
  return [
    {
      id: "intro",
      name: "First screen",
      detail:
        "The page's own opening screen with its start button. Not editable here.",
      screen: 0,
      visits: visits("intro"),
      leak: leak === "intro",
    },
    {
      id: "questions",
      name: "Questions",
      detail: questions.length
        ? `${plural(questions.length, "question")}, one per screen. ${fields}`
        : "The questions could not be read.",
      screen: questions.length ? 1 : null,
      visits: null,
      leak: false,
      questions: questions.map((q, i) => ({
        key: q.key,
        label: q.label,
        screen: i + 1,
        visits: visits(`q:${q.key}`),
        leak: leak === `q:${q.key}`,
      })),
    },
    {
      id: "contact",
      name: "Contact step",
      detail: `Name, phone, area and notes, in the CRM's own form. Not editable here.${send === null ? "" : ` ${plural(send, "visitor")} pressed send.`}`,
      screen: questions.length + 1,
      visits: visits("contact"),
      leak: leak === "contact",
    },
    {
      id: "thanks",
      name: "Thank-you page",
      detail: "Shown once the CRM has saved the lead.",
      screen: null,
      visits: visits("thanks"),
      leak: false,
    },
  ];
}
