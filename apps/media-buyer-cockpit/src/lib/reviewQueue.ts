/**
 * The review queue on Today: every live campaign gets a decision at least
 * once a week. A real change in Meta (the sync's lastChangeAt) or a decision
 * taken on the campaign in Ads counts as a review. "Leave it" picks when the
 * campaign comes back. Before 24 Oct 2026 only a Meta change counted, so a
 * campaign the buyer had looked at and left stayed "Review due".
 */
import { LEARNING_DAYS } from "./kpi";

export const REVIEW_DAYS = 7;
const DAY = 86_400_000;

/** Kinds that are a decision on the campaign. A client message ("touch") is not. */
const REVIEW_KINDS = new Set([
  "approved",
  "alternative",
  "left",
  "rerouted",
  "decision",
]);

export const ONLY_IF_WORSE = "Only if the number gets worse";
/** Leave it's clock, in days. Anything else waits the full week. */
const SNOOZE_DAYS: Record<string, number> = {
  Tomorrow: 1,
  "In 3 days": 3,
  "Next week": 7,
};
/** How bad the cockpit's call is: a move up this scale is "worse". */
const CALL_RANK: Record<string, number> = {
  scale: 0,
  hold: 1,
  "below KPI": 1,
  fatiguing: 1,
  "no delivery": 1,
  kill: 2,
  "off board": 2,
};

export type Review = {
  subject: string;
  kind: string;
  action: string;
  reason?: string;
  at: number;
  snooze?: string;
  verdictAtDecision?: string;
};

export type ReviewState =
  | { state: "launch"; day: number }
  | { state: "learning"; sinceChange: number }
  | { state: "due"; since: number | null }
  | { state: "reviewed"; review: Review; nextAt: number | null };

type Watched = { daysLive?: number; lastChangeAt?: number; verdict?: string };

const days = (ms: number) => Math.floor(ms / DAY);

/** The latest decision on one campaign that counts as a review. */
export function lastReview(reviews: Review[]): Review | undefined {
  return reviews
    .filter(r => REVIEW_KINDS.has(r.kind) && Number.isFinite(r.at))
    .reduce<Review | undefined>(
      (a, r) => (!a || r.at > a.at ? r : a),
      undefined,
    );
}

/**
 * Where one campaign stands. `null`: nothing to show, it was touched in the
 * last week. `since` is null when the campaign has no change and no decision
 * and the sync does not know its age.
 */
export function reviewState(
  c: Watched,
  reviews: Review[],
  now: number,
): ReviewState | null {
  const live = c.daysLive;
  if (live !== undefined && live <= 3)
    return { state: "launch", day: Math.max(live, 0) + 1 };
  const changedAt = Number.isFinite(c.lastChangeAt)
    ? (c.lastChangeAt as number)
    : undefined;
  if (changedAt !== undefined && days(now - changedAt) < LEARNING_DAYS)
    return { state: "learning", sinceChange: days(now - changedAt) };
  const review = lastReview(reviews);
  if (review && review.at >= (changedAt ?? Number.NEGATIVE_INFINITY)) {
    const since = days(now - review.at);
    if (review.kind === "left" && review.snooze === ONLY_IF_WORSE) {
      const before = CALL_RANK[review.verdictAtDecision ?? ""];
      const after = CALL_RANK[c.verdict ?? ""];
      // A call saved before 24 Oct has no verdict: the plain week applies.
      if (before !== undefined && after !== undefined)
        return after > before
          ? { state: "due", since }
          : { state: "reviewed", review, nextAt: null };
    }
    const wait =
      review.kind === "left"
        ? (SNOOZE_DAYS[review.snooze ?? ""] ?? REVIEW_DAYS)
        : REVIEW_DAYS;
    const nextAt = review.at + wait * DAY;
    return now >= nextAt
      ? { state: "due", since }
      : { state: "reviewed", review, nextAt };
  }
  if (changedAt !== undefined) {
    const since = days(now - changedAt);
    return since >= REVIEW_DAYS ? { state: "due", since } : null;
  }
  if (live === undefined) return { state: "due", since: null };
  return live >= REVIEW_DAYS ? { state: "due", since: live } : null;
}
