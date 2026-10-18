import { count, plural } from "@/components/ceo/format";
import type { B2bAdNode, B2bAdsPayload } from "@/types/ceo/payloads";

/**
 * Which ads the Launch card offers to copy creatives from.
 *
 * The audit of 2026-10-16 found the card's "winners" were any ad that spent in
 * thirty days: 4 of the 8 it listed had no lead, demo or close, and one had a
 * Kill verdict. An ad is offered only when it produced something in the last
 * thirty days (a lead or a close) and is not marked to kill.
 *
 * The CEO, 2026-10-18: per ad the funnel stops at the intro, so the list is
 * ranked on confirmed intros and intros, each lead once, never on demos.
 */

export type LaunchKind = "lead_gen" | "retargeting";

const KIND_WORDS: Record<LaunchKind, string> = {
  lead_gen: "lead-gen",
  retargeting: "retargeting",
};

/** A lead or a close in thirty days, and no kill verdict. Every intro is a lead's. */
export function hasResults(a: B2bAdNode): boolean {
  return a.w30.leads + a.w30.closes > 0 && a.verdict.verdict !== "kill";
}

/** Confirmed intros and intros, or 0 and 0 on a payload from before they were counted once per lead. */
function intros(a: B2bAdNode): { confirmed: number; intros: number } {
  const w = a.w30;
  return w.leadsToConfirmedIntro === undefined
    ? { confirmed: 0, intros: 0 }
    : { confirmed: w.leadsToConfirmedIntro, intros: w.leadsToIntro ?? 0 };
}

/**
 * The ads of the chosen kind with results in the last thirty days, closes
 * first, then confirmed intros, then intros, then leads, at most eight. A
 * payload stored before 2026-10-18 has no confirmed count and ranks on closes
 * and leads. A retargeting draft can only copy retargeting ads and a lead-gen
 * draft only lead-gen ones.
 */
export function launchWinners(
  ads: B2bAdsPayload | null,
  kind: LaunchKind,
): B2bAdNode[] {
  return (ads?.campaigns ?? [])
    .filter(c => c.type === kind)
    .flatMap(c => c.adsets.flatMap(s => s.ads))
    .filter(hasResults)
    .sort(
      (a, b) =>
        b.w30.closes - a.w30.closes ||
        intros(b).confirmed - intros(a).confirmed ||
        intros(b).intros - intros(a).intros ||
        b.w30.leads - a.w30.leads,
    )
    .slice(0, 8);
}

/**
 * One ad's thirty days under its name: "9 leads · 5 intros · 2 confirmed ·
 * 1 close". The intro counts are left out on a payload stored before they
 * were counted once per lead, never shown as 0.
 */
export function resultsLine(a: B2bAdNode): string {
  const w = a.w30;
  const intros =
    w.leadsToConfirmedIntro === undefined
      ? []
      : [
          plural(w.leadsToIntro ?? 0, "intro"),
          `${count(w.leadsToConfirmedIntro)} confirmed`,
        ];
  return [plural(w.leads, "lead"), ...intros, plural(w.closes, "close")].join(
    " · ",
  );
}

/** The heading over the list. */
export const WINNERS_HEADING = "Results in the last 30 days";

/** The line under the heading: what to do with the list. */
export function winnersPrompt(kind: LaunchKind): string {
  return `Tick the ${KIND_WORDS[kind]} ads whose creatives the draft should reuse.`;
}

/** What the card says when no ad of the kind has results, and what to do. */
export function noWinnersText(kind: LaunchKind): string {
  const k = KIND_WORDS[kind];
  return `No ${k} ad has a lead or a close in the last 30 days, so there is no creative to reuse. Build the draft anyway: it copies settings from the best ${k} ad set on record.`;
}
