/**
 * The media buyer's EOD form rules that run before a submit.
 *
 * The three health scores are each a whole number from 1 to 10, and all three
 * are asked for: on 2026-10-13 they went to Slack blank ("Focus - ") because
 * the form let them through empty.
 */
export const HEALTH = [
  ["focus", "Focus"],
  ["energy", "Energy"],
  ["biology", "Food, sleep, water"],
] as const;

export const healthScore = (v: string | undefined): boolean =>
  /^(10|[1-9])$/.test((v ?? "").trim());

/** "Focus and Energy scores": the health scores still missing, or "". */
export function missingHealth(form: Record<string, string>): string {
  const names = HEALTH.filter(([k]) => !healthScore(form[k])).map(
    ([, label]) => label,
  );
  if (!names.length) return "";
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} score${names.length === 1 ? "" : "s"}`;
}
